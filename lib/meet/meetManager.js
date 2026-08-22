import { mediaDevices } from 'react-native-webrtc';
import { Platform } from 'react-native';
import InCallManager from 'react-native-incall-manager';

import { meetings } from './api';
import { Signaler } from './signaler';
import { PeerMesh } from './peerMesh';
import { getIceServers, hasTurn } from './ice';
import { recordRoomVisit } from './history';
import { useMeetStore } from '../../stores/meetStore';

/**
 * Orchestriert ein laufendes Meeting: Medien, Signaling, Mesh, Serverzustand.
 *
 * Bewusst ein Singleton außerhalb der React-Bäume. Beim Minimieren wird der
 * Raum-Screen abgebaut — läge der Mesh in dessen State, würde Minimieren die
 * Verbindung kappen. Genau das soll es nicht: minimieren OHNE aufzulegen.
 * Der Screen liest nur aus dem Store und ruft hier Methoden auf.
 *
 * Protokollgleich zu koro-meet im Browser (siehe src/app/m/[roomId]/page.tsx),
 * damit App- und Browser-Teilnehmer im selben Raum funktionieren.
 */
class MeetManager
{
  constructor()
  {
    this.identity = null;
    this.roomId = null;
    this.signaler = null;
    this.mesh = null;
    this.localStream = null;
    this.screenStream = null;
    this.offSignal = null;
    this.myWsKey = null;
    this.onKicked = null;
    this.onEnded = null;
  }

  get active() { return !!this.mesh; }

  // ── Beitritt ────────────────────────────────────────────────────

  /**
   * Vollständiger Beitrittsablauf. Reihenfolge ist bewusst so:
   * Medien → Server-Join → ICE → Signaling → Mesh. Die ICE-Server müssen
   * VOR der ersten PeerConnection stehen, sonst entstünden die ersten Peers
   * STUN-only und scheiterten hinter Carrier-Grade-NAT.
   */
  async join({ roomId, identity, video = true, audioDeviceId })
  {
    const store = useMeetStore.getState();
    this.roomId = roomId;
    this.identity = identity;

    // 1. Medien holen. Ohne Kamera trotzdem beitreten (nur Audio) — ein
    //    besetztes oder verweigertes Kamera-Gerät darf den Beitritt nicht
    //    verhindern.
    const stream = await this.acquireLocalMedia({ video, audioDeviceId });
    this.localStream = stream;
    store.setLocalStreamUrl(stream.toURL());
    store.setCameraOn(!!stream.getVideoTracks()[0]?.enabled);
    store.setMicOn(!!stream.getAudioTracks()[0]?.enabled);

    // 2. Teilnahme serverseitig registrieren und die Liste frisch ziehen,
    //    damit wir zu allen bereits Anwesenden eine Verbindung öffnen.
    const joinRes = await meetings.join(roomId, identity);
    const detail = await meetings.get(roomId, identity);
    const active = detail.participants.filter((p) => !p.left_at);
    store.setMeeting(joinRes.meeting);
    store.setParticipants(active);

    recordRoomVisit({
      roomId,
      title: joinRes.meeting?.title,
      host: joinRes.meeting?.host_name,
      scheduledAt: joinRes.meeting?.scheduled_at,
    });

    // 3. Signaling öffnen und Mesh aufsetzen.
    const sig = new Signaler(identity, roomId);
    this.signaler = sig;

    // Der WS registriert Gäste unter "meet:<uuid>", die HTTP-Teilnehmerzeile
    // führt die blanke device_id. Beim Herausfiltern der eigenen Person beide
    // Formen prüfen — sonst öffnet das Gerät eine Verbindung zu sich selbst
    // und erscheint als leere Dummy-Kachel.
    this.myWsKey = identity.kind === 'koro' ? identity.device_id : `meet:${ identity.device_id }`;

    const iceServers = await getIceServers(roomId);
    store.setTurnAvailable(hasTurn(iceServers));

    const mesh = new PeerMesh(this.myWsKey, sig, iceServers);
    this.mesh = mesh;
    mesh.setLocalStream(stream);
    mesh.subscribe((snapshot) => useMeetStore.getState().setRemotes(snapshot));

    this.offSignal = sig.on((msg) => { this.handleMessage(msg).catch(() => {}); });

    // 4. Verbindung zu allen bereits Anwesenden aufbauen.
    for (const p of active)
    {
      if (this.isSelf(p)) continue;
      mesh.connectTo({
        device_id: p.device_id,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
        is_host: p.is_host,
        participant_id: p.id,
      });
    }

    // 5. Andere informieren, dass sie zu uns eine Verbindung öffnen sollen.
    sig.broadcast('roster.changed');
    this.announceMediaState();

    // 6. Bisherigen Chatverlauf laden.
    try
    {
      const m = await meetings.listMessages(roomId, identity);
      store.setChatMessages(m.messages || []);
      store.clearUnreadChat();
    } catch (e) { /* Chat ist nicht beitrittskritisch */ }

    // 7. Audio-Routing: Lautsprecher an, wenn Video läuft; sonst Hörmuschel.
    this.startAudioSession(video);

    useMeetStore.getState().setLive();
    return joinRes.meeting;
  }

  isSelf(p)
  {
    const id = this.identity;
    if (!id) return false;
    if (p.device_id === id.device_id || p.device_id === this.myWsKey) return true;
    if (id.kind === 'koro' && p.user_id && p.user_id === id.user_id) return true;
    return false;
  }

  // ── Medien ──────────────────────────────────────────────────────

  /**
   * Kamera + Mikrofon anfordern. Scheitert die Kamera (belegt, verweigert),
   * fällt der Beitritt auf Audio zurück statt komplett zu misslingen.
   */
  async acquireLocalMedia({ video = true, audioDeviceId } = {})
  {
    const audio = audioDeviceId ? { deviceId: audioDeviceId } : true;
    if (video)
    {
      try
      {
        return await mediaDevices.getUserMedia({
          audio,
          video: { facingMode: 'user', width: 1280, height: 720, frameRate: 30 },
        });
      } catch (err)
      {
        console.warn('[meet] Kamera nicht verfügbar, nur Audio', err);
      }
    }
    return await mediaDevices.getUserMedia({ audio, video: false });
  }

  startAudioSession(video)
  {
    try
    {
      InCallManager.start({ media: 'video' });
      InCallManager.setForceSpeakerphoneOn(!!video);
      if (Platform.OS === 'android') InCallManager.setKeepScreenOn(true);
    } catch (e)
    {
      console.warn('[meet] InCallManager start', e);
    }
  }

  stopAudioSession()
  {
    try
    {
      if (Platform.OS === 'android') InCallManager.setKeepScreenOn(false);
      InCallManager.stop();
    } catch (e) { /* egal */ }
  }

  // ── eingehende Nachrichten ──────────────────────────────────────

  async handleMessage(msg)
  {
    const store = useMeetStore.getState();
    const mesh = this.mesh;
    if (!mesh) return;

    if (msg?.type === 'meet.signal')
    {
      const { signal, payload, from_device_id } = msg;
      if (signal === 'offer') await mesh.handleOffer(from_device_id, payload);
      else if (signal === 'answer') await mesh.handleAnswer(from_device_id, payload);
      else if (signal === 'ice') await mesh.handleIce(from_device_id, payload);
      else if (signal === 'media-state') mesh.handleMediaState(from_device_id, payload || {});
      return;
    }

    if (msg?.type === 'meet.broadcast')
    {
      switch (msg.subtype)
      {
        case 'chat':
          if (msg.payload) store.addChatMessage(msg.payload);
          return;

        case 'media-state':
          if (msg.payload && msg.from_device_id) mesh.handleMediaState(msg.from_device_id, msg.payload);
          return;

        case 'hand':
          if (msg.from_device_id) store.setHandUp(msg.from_device_id, !!msg.payload?.up);
          return;

        case 'notes':
          if (typeof msg.payload?.content === 'string') store.setNotes(msg.payload.content);
          return;

        case 'started':
          store.setMeeting({
            ...(store.meeting || {}),
            started_at: msg.payload?.started_at || new Date().toISOString(),
            scheduled_at: null,
          });
          return;

        case 'pdf':
          store.setMeeting({ ...(store.meeting || {}), pdf: msg.payload?.pdf ?? null });
          return;

        case 'ended':
          await this.teardown();
          store.setEnded();
          this.onEnded?.();
          return;

        case 'roster.changed':
          await this.refreshRoster();
          return;

        default:
          return;
      }
    }

    if (msg?.type === 'meet.bye')
    {
      // Schnellpfad: roster.changed deckt es auch ab, aber auf bye zu reagieren
      // lässt die Kachel ~1s früher verschwinden.
      mesh.disconnectFrom(msg.from_device_id);
      store.setParticipants(store.participants.filter((p) => p.device_id !== msg.from_device_id));
      return;
    }

    if (msg?.type === 'meet.kicked')
    {
      await this.teardown();
      store.setError('Du wurdest vom Host aus dem Meeting entfernt.');
      store.setEnded();
      this.onKicked?.();
    }
  }

  /**
   * Teilnehmerliste neu laden, Verbindungen zu Neuen öffnen und zu
   * Verschwundenen abbauen — damit deren Kachel verschwindet, selbst wenn die
   * RTC-Verbindung nicht sauber ausgelaufen ist.
   */
  async refreshRoster()
  {
    if (!this.mesh || !this.roomId || !this.identity) return;
    const store = useMeetStore.getState();
    try
    {
      const fresh = await meetings.get(this.roomId, this.identity);
      const active = fresh.participants.filter((p) => !p.left_at);
      store.setParticipants(active);
      store.setMeeting(fresh.meeting);

      const activeKeys = new Set(active.map((p) => p.device_id));
      for (const peerKey of this.mesh.peerKeys())
      {
        if (!activeKeys.has(peerKey)) this.mesh.disconnectFrom(peerKey);
      }
      for (const p of active)
      {
        if (this.isSelf(p)) continue;
        this.mesh.connectTo({
          device_id: p.device_id,
          display_name: p.display_name,
          avatar_url: p.avatar_url,
          is_host: p.is_host,
          participant_id: p.id,
        });
      }
      // Eigenen Medienzustand neu ankündigen (inkl. Screenshare-Stream-ID),
      // damit gerade Beigetretene Kamera und Screen unterscheiden können.
      this.announceMediaState();
    } catch (e)
    {
      console.warn('[meet] roster refresh', e);
    }
  }

  announceMediaState()
  {
    this.signaler?.broadcast('media-state', {
      mic_on: !!this.localStream?.getAudioTracks()[0]?.enabled,
      camera_on: !!this.localStream?.getVideoTracks()[0]?.enabled,
      screen_sharing: !!this.screenStream,
      screen_stream_id: this.screenStream?.id ?? null,
    });
  }

  // ── Steuerung ───────────────────────────────────────────────────

  toggleMic()
  {
    const track = this.localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    useMeetStore.getState().setMicOn(track.enabled);
    this.announceMediaState();
  }

  toggleCamera()
  {
    const track = this.localStream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    useMeetStore.getState().setCameraOn(track.enabled);
    this.announceMediaState();
  }

  switchCamera()
  {
    const track = this.localStream?.getVideoTracks()[0];
    if (!track) return;
    try
    {
      track._switchCamera();
      const next = useMeetStore.getState().facing === 'user' ? 'environment' : 'user';
      useMeetStore.getState().setFacing(next);
    } catch (e)
    {
      console.warn('[meet] switchCamera', e);
    }
  }

  setSpeaker(on)
  {
    try { InCallManager.setForceSpeakerphoneOn(!!on); }
    catch (e) { /* egal */ }
  }

  /**
   * Bildschirm teilen. Auf Mobile ohne System-Audio — getDisplayMedia liefert
   * dort keinen Audio-Track (anders als Chrome am Desktop).
   */
  async startScreenShare()
  {
    if (!this.mesh || this.screenStream) return;
    const stream = await mediaDevices.getDisplayMedia({ video: true });
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    this.screenStream = stream;
    this.mesh.startScreenShare(track, stream);
    useMeetStore.getState().setScreenSharing(true);
    this.announceMediaState();

    // Beendet der Nutzer die Freigabe über die System-Oberfläche, muss die App
    // nachziehen — sonst bliebe der Zustand hängen.
    track.addEventListener?.('ended', () => { this.stopScreenShare().catch(() => {}); });
  }

  async stopScreenShare()
  {
    if (!this.screenStream) return;
    this.mesh?.stopScreenShare();
    try { this.screenStream.getTracks().forEach((t) => t.stop()); } catch (e) { /* egal */ }
    this.screenStream = null;
    useMeetStore.getState().setScreenSharing(false);
    this.announceMediaState();
  }

  raiseHand(up)
  {
    if (!this.identity) return;
    this.signaler?.broadcast('hand', { up: !!up });
    useMeetStore.getState().setHandUp(this.myWsKey, !!up);
  }

  sendReaction(emoji)
  {
    this.signaler?.broadcast('reaction', { emoji });
  }

  async sendChat(body)
  {
    const text = (body || '').trim();
    if (!text || !this.roomId || !this.identity) return;
    const res = await meetings.postMessage(this.roomId, text, this.identity);
    // Server fächert an die anderen aus; die eigene Nachricht lokal anhängen,
    // damit sie sofort steht.
    if (res?.message) useMeetStore.getState().addChatMessage(res.message, { markRead: true });
    this.signaler?.broadcast('chat', res?.message);
  }

  async saveNotes(content)
  {
    if (!this.roomId || !this.identity) return;
    this.signaler?.broadcast('notes', { content });
    try { await meetings.putNotes(this.roomId, content, this.identity); }
    catch (e) { console.warn('[meet] notes speichern', e); }
  }

  // ── Host-Aktionen ───────────────────────────────────────────────

  async kick(participantId)
  {
    if (!this.roomId || !this.identity) return;
    await meetings.kick(this.roomId, participantId, this.identity);
  }

  async setLocked(locked)
  {
    if (!this.roomId || !this.identity) return;
    const res = await meetings.update(this.roomId, { locked }, this.identity);
    if (res?.meeting) useMeetStore.getState().setMeeting(res.meeting);
    return res?.meeting;
  }

  /** Meeting für alle beenden. Der Server fächert 'ended' aus. */
  async endForAll()
  {
    if (!this.roomId || !this.identity) return null;
    const res = await meetings.end(this.roomId, this.identity);
    await this.teardown();
    useMeetStore.getState().setEnded();
    return res;
  }

  // ── Verlassen / Abbau ───────────────────────────────────────────

  /** Selbst verlassen. Andere bleiben drin. */
  async leave()
  {
    const roomId = this.roomId;
    const identity = this.identity;
    try { this.signaler?.bye(); } catch (e) { /* egal */ }
    await this.teardown();
    if (roomId && identity)
    {
      try { await meetings.leave(roomId, identity); }
      catch (e) { /* Server räumt ohnehin per Timeout auf */ }
    }
    useMeetStore.getState().reset();
  }

  /** Alle Ressourcen freigeben, ohne den Store zurückzusetzen. */
  async teardown()
  {
    try { this.offSignal?.(); } catch (e) { /* egal */ }
    this.offSignal = null;

    try { this.mesh?.destroy(); } catch (e) { /* egal */ }
    this.mesh = null;

    try { this.signaler?.close(); } catch (e) { /* egal */ }
    this.signaler = null;

    try { this.localStream?.getTracks().forEach((t) => t.stop()); } catch (e) { /* egal */ }
    this.localStream = null;

    try { this.screenStream?.getTracks().forEach((t) => t.stop()); } catch (e) { /* egal */ }
    this.screenStream = null;

    this.stopAudioSession();
    this.roomId = null;
    this.myWsKey = null;
  }
}

export const meetManager = new MeetManager();
