import
  {
    RTCPeerConnection,
    RTCIceCandidate,
    RTCSessionDescription,
  } from 'react-native-webrtc';

/**
 * Mesh-Verwaltung: eine PeerConnection pro entferntem Gerät.
 *
 * Port von koro-meet/src/lib/peerMesh.ts auf react-native-webrtc. Die Web-
 * Version ist die erprobte Fassung — bewusst NICHT der v0-Scaffold aus
 * nexora-mobile/lib/groupCallManager.ts, dem Perfect Negotiation, Watchdog und
 * Late-Join fehlen.
 *
 * Verhandlung nach dem "Perfect Negotiation"-Muster (RFC 8829): beide Seiten
 * hängen ihre lokalen Tracks an und lassen `onnegotiationneeded` die Offers
 * treiben. Glare (beide bieten gleichzeitig an) löst eine lexikografisch aus
 * den Geräte-IDs abgeleitete Rolle auf — das Gerät mit der GRÖSSEREN ID ist
 * "höflich" und rollt sein eigenes Offer zurück, die unhöfliche Seite ignoriert
 * das kollidierende. Das ist deutlich robuster als "nur die kleinere ID bietet
 * an", was bei einem verlorenen Offer über einen WS-Reconnect dauerhaft
 * blockierte.
 *
 * Darüber liegt ein Watchdog auf der initiierenden Seite: erreicht eine
 * Verbindung nicht binnen weniger Sekunden `connected` oder fällt sie auf
 * `failed`, erzwingt `restartIce()` eine neue Verhandlung. Das heilt die Klasse
 * "ich bin drin, sehe/höre aber eine Person nicht".
 *
 * RN-spezifische Abweichungen von der Web-Version:
 *   • Events über addEventListener mit expliziten Handler-Referenzen
 *   • setTimeout/clearTimeout statt window.*
 *   • Streams tragen zusätzlich `url` (stream.toURL()) für <RTCView>
 *   • Kein Screen-Audio: getDisplayMedia liefert auf Mobile keinen Audio-Track
 */

// Gäste sind auf dem WS als "meet:<uuid>" registriert, die HTTP-Teilnehmerliste
// führt dieselbe Geräte-ID aber blank. Vergleiche daher ohne Präfix — sonst
// öffnet ein Gerät eine Verbindung zu sich selbst und man hört sich doppelt.
function bareId(id) { return id.startsWith('meet:') ? id.slice(5) : id; }
function sameDevice(a, b) { return a === b || bareId(a) === bareId(b); }

const WATCHDOG_MS = 7000;
const MAX_RETRIES = 5;

export class PeerMesh
{
  constructor(myDeviceId, signaler, iceServers)
  {
    this.myDeviceId = myDeviceId;
    this.signaler = signaler;
    this.iceServers = iceServers;

    this.peers = new Map();        // deviceId -> Peer
    this.pendingIce = new Map();   // deviceId -> RTCIceCandidateInit[]
    this.state = new Map();        // deviceId -> RemoteState
    this.listeners = new Set();
    this.localStream = null;

    // Screenshare läuft als SEPARATER Track (nicht als Ersatz der Kamera),
    // damit das Kamerabild sichtbar bleibt.
    this.screenTrack = null;
    this.screenStream = null;
    this.screenSenders = new Map();
    this.peerStreams = new Map();     // deviceId -> Map<streamId, MediaStream>
    this.screenStreamIds = new Map(); // deviceId -> streamId
  }

  // ── lokale Medien ───────────────────────────────────────────────

  setLocalStream(stream)
  {
    this.localStream = stream;
    // Tracks an bestehende PCs neu hängen. Ein Track, der vorher nicht da war,
    // löst `onnegotiationneeded` aus — eine PC, die vor dem Medienzugriff
    // entstand, verhandelt also jetzt.
    for (const { pc } of this.peers.values()) this.attachLocalTracks(pc);
  }

  startScreenShare(track, stream)
  {
    this.screenTrack = track;
    this.screenStream = stream;
    for (const [deviceId, peer] of this.peers)
    {
      try
      {
        const sender = peer.pc.addTrack(track, stream);
        this.screenSenders.set(deviceId, sender);
      } catch (err) { console.warn('[mesh] addTrack screen', err); }
    }
  }

  stopScreenShare()
  {
    this.screenTrack = null;
    this.screenStream = null;
    for (const [deviceId, peer] of this.peers)
    {
      const sender = this.screenSenders.get(deviceId);
      if (sender) { try { peer.pc.removeTrack(sender); } catch (e) { /* egal */ } }
    }
    this.screenSenders.clear();
  }

  screenStreamId()
  {
    return this.screenStream?.id ?? null;
  }

  /**
   * Lokalen Audio-Track auf allen Peers ersetzen. Der neue Track erbt den
   * enabled-Status, damit ein stummes Mikrofon über den Tausch stumm bleibt.
   */
  replaceLocalAudioTrack(newTrack)
  {
    if (!this.localStream) return;
    const old = this.localStream.getAudioTracks()[0] || null;
    if (old)
    {
      newTrack.enabled = old.enabled;
      this.localStream.removeTrack(old);
    }
    this.localStream.addTrack(newTrack);
    for (const { pc } of this.peers.values())
    {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'audio' && s.track !== this.screenTrack);
      if (sender) sender.replaceTrack(newTrack).catch(() => {});
      else { try { pc.addTrack(newTrack, this.localStream); } catch (e) { /* egal */ } }
    }
  }

  /**
   * Kamera-Track nachreichen (z. B. nach Kamerawechsel). Fasst den
   * Screenshare-Sender nicht an, obwohl der ebenfalls kind 'video' ist.
   */
  addLocalVideoTrack(newTrack)
  {
    if (!this.localStream) return;
    const old = this.localStream.getVideoTracks().find((t) => t !== this.screenTrack) || null;
    if (old)
    {
      newTrack.enabled = old.enabled;
      this.localStream.removeTrack(old);
      old.stop();
    }
    this.localStream.addTrack(newTrack);
    for (const { pc } of this.peers.values())
    {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video' && s.track !== this.screenTrack);
      if (sender) sender.replaceTrack(newTrack).catch(() => {});
      else { try { pc.addTrack(newTrack, this.localStream); } catch (e) { /* egal */ } }
    }
  }

  // ── Abonnenten ──────────────────────────────────────────────────

  subscribe(fn)
  {
    this.listeners.add(fn);
    fn(new Map(this.state));
    return () => { this.listeners.delete(fn); };
  }

  getState()
  {
    return new Map(this.state);
  }

  emit()
  {
    const snap = new Map(this.state);
    for (const l of this.listeners) l(snap);
  }

  // ── Verbindungsauf-/abbau ───────────────────────────────────────

  /** Verbindung zu einem Gerät öffnen. Idempotent. */
  connectTo(remote)
  {
    if (sameDevice(remote.device_id, this.myDeviceId)) return;

    const existingPeer = this.peers.get(remote.device_id);
    if (existingPeer)
    {
      const existing = this.state.get(remote.device_id);
      if (existing)
      {
        existing.display_name = remote.display_name;
        existing.avatar_url = remote.avatar_url;
        existing.is_host = remote.is_host;
        this.emit();
      }
      // Ist die PC seitdem kaputtgegangen, hier wiederbeleben statt eine tote
      // Kachel stehen zu lassen.
      const st = existingPeer.pc.connectionState;
      if (!existingPeer.polite && (st === 'failed' || st === 'disconnected'))
      {
        existingPeer.retry = 0;
        try { existingPeer.pc.restartIce(); } catch (e) { /* egal */ }
        this.armWatchdog(remote.device_id);
      }
      return;
    }

    this.state.set(remote.device_id, {
      device_id: remote.device_id,
      display_name: remote.display_name,
      avatar_url: remote.avatar_url,
      is_host: remote.is_host,
      participant_id: remote.participant_id ?? null,
      stream: null,
      streamUrl: null,
      screenStream: null,
      screenStreamUrl: null,
      mic_on: true,
      camera_on: true,
      screen_sharing: false,
      conn: 'new',
    });
    this.emit();
    // Die PC zu bauen hängt die lokalen Tracks an, was `onnegotiationneeded`
    // auslöst — ein manuelles Offer ist nicht nötig.
    this.buildPc(remote.device_id);
  }

  disconnectFrom(deviceId)
  {
    const peer = this.peers.get(deviceId);
    if (peer)
    {
      if (peer.watchdog) { clearTimeout(peer.watchdog); peer.watchdog = null; }
      try { peer.pc.close(); } catch (e) { /* egal */ }
      this.peers.delete(deviceId);
    }
    this.pendingIce.delete(deviceId);
    this.state.delete(deviceId);
    this.screenSenders.delete(deviceId);
    this.peerStreams.delete(deviceId);
    this.screenStreamIds.delete(deviceId);
    this.emit();
  }

  destroy()
  {
    for (const id of Array.from(this.peers.keys())) this.disconnectFrom(id);
    this.listeners.clear();
  }

  peerKeys()
  {
    return Array.from(this.peers.keys());
  }

  // ── eingehendes Signaling ───────────────────────────────────────

  async handleOffer(fromDeviceId, payload, info)
  {
    if (sameDevice(fromDeviceId, this.myDeviceId)) return;
    if (!this.state.has(fromDeviceId))
    {
      this.state.set(fromDeviceId, {
        device_id: fromDeviceId,
        display_name: info?.display_name || `…${ fromDeviceId.slice(-4) }`,
        avatar_url: info?.avatar_url || null,
        is_host: !!info?.is_host,
        participant_id: null,
        stream: null,
        streamUrl: null,
        screenStream: null,
        screenStreamUrl: null,
        mic_on: true,
        camera_on: true,
        screen_sharing: false,
        conn: 'new',
      });
      this.emit();
    }
    await this.handleDescription(fromDeviceId, payload);
  }

  async handleAnswer(fromDeviceId, payload)
  {
    if (sameDevice(fromDeviceId, this.myDeviceId)) return;
    await this.handleDescription(fromDeviceId, payload);
  }

  async handleIce(fromDeviceId, payload)
  {
    if (!payload?.candidate) return;
    const peer = this.peers.get(fromDeviceId);
    // Kandidaten puffern, die vor der Remote-Description eintreffen — über den
    // WS können sie das Offer/Answer überholen.
    if (!peer || !peer.remoteReady)
    {
      const list = this.pendingIce.get(fromDeviceId) || [];
      list.push(payload);
      this.pendingIce.set(fromDeviceId, list);
      return;
    }
    try
    {
      await peer.pc.addIceCandidate(new RTCIceCandidate(payload));
    } catch (err)
    {
      // Kandidaten eines bewusst ignorierten Offers dürfen scheitern.
      if (!peer.ignoreOffer) console.warn('[mesh] addIce', err);
    }
  }

  handleMediaState(fromDeviceId, payload)
  {
    const cur = this.state.get(fromDeviceId);
    if (!cur) return;
    if (payload.mic_on !== undefined) cur.mic_on = !!payload.mic_on;
    if (payload.camera_on !== undefined) cur.camera_on = !!payload.camera_on;
    if (payload.screen_sharing !== undefined) cur.screen_sharing = !!payload.screen_sharing;
    if (payload.screen_stream_id !== undefined)
    {
      if (payload.screen_stream_id) this.screenStreamIds.set(fromDeviceId, payload.screen_stream_id);
      else this.screenStreamIds.delete(fromDeviceId);
    }
    this.reconcileStreams(fromDeviceId);
    this.emit();
  }

  /**
   * Neu bestimmen, welcher empfangene Stream Kamera und welcher Screenshare
   * ist. Wird sowohl aus `ontrack` als auch aus handleMediaState aufgerufen,
   * weil deren Reihenfolge über den WS nicht garantiert ist.
   */
  reconcileStreams(deviceId)
  {
    const cur = this.state.get(deviceId);
    const streams = this.peerStreams.get(deviceId);
    if (!cur) return;
    if (!streams || streams.size === 0)
    {
      cur.stream = null; cur.streamUrl = null;
      cur.screenStream = null; cur.screenStreamUrl = null;
      return;
    }

    const screenId = this.screenStreamIds.get(deviceId);
    const all = Array.from(streams.entries());
    let camera = null;
    let screen = null;

    if (screenId && streams.has(screenId))
    {
      screen = streams.get(screenId);
      camera = all.find(([id]) => id !== screenId)?.[1] ?? null;
    } else
    {
      // Die media-state-Ankündigung mit screen_stream_id fehlt noch (oder ging
      // verloren). Nach INHALT einordnen, nie nach Ankunftsreihenfolge: der
      // Screenshare-Stream landet häufig zuerst, was ihn früher fälschlich zur
      // Kamera machte — der Peer wurde dann stumm, weil sein Audio "nirgends"
      // war. Der Kamerastream existiert über den ganzen Anruf und trägt das
      // Audio, ist also der erste mit Audiospur.
      const withAudio = all.find(([, st]) => st.getAudioTracks().length > 0);
      if (withAudio)
      {
        camera = withAudio[1];
        if (cur.screen_sharing)
        {
          screen = all.find(([id]) => id !== withAudio[0])?.[1] ?? null;
        }
      } else
      {
        // Noch gar kein Audio (Peer ohne Mikro beigetreten). Auf Reihenfolge
        // zurückfallen.
        camera = all[0]?.[1] ?? null;
        if (all.length > 1 && cur.screen_sharing) screen = all[1][1];
      }
    }

    cur.stream = camera;
    cur.streamUrl = camera ? camera.toURL() : null;
    const wantScreen = cur.screen_sharing ? screen : null;
    cur.screenStream = wantScreen;
    cur.screenStreamUrl = wantScreen ? wantScreen.toURL() : null;
  }

  // ── Interna ─────────────────────────────────────────────────────

  /**
   * Kern der Perfect Negotiation: wendet ein entferntes Offer/Answer an und
   * verträgt Glare — die höfliche Seite rollt ihr eigenes Offer zurück, die
   * unhöfliche ignoriert die Kollision.
   */
  async handleDescription(fromDeviceId, description)
  {
    const peer = this.peers.get(fromDeviceId) ?? this.buildPc(fromDeviceId);
    const pc = peer.pc;
    const isOffer = description.type === 'offer';

    const readyForOffer =
      !peer.makingOffer &&
      (pc.signalingState === 'stable' || peer.isSettingRemoteAnswerPending);
    const offerCollision = isOffer && !readyForOffer;

    peer.ignoreOffer = !peer.polite && offerCollision;
    if (peer.ignoreOffer) return;

    try
    {
      peer.isSettingRemoteAnswerPending = description.type === 'answer';

      // Auf der höflichen Seite muss der Rollback bei einer Kollision explizit
      // erfolgen: der implizite Rollback von setRemoteDescription ist in
      // react-native-webrtc nicht zugesichert.
      if (peer.polite && offerCollision && pc.signalingState !== 'stable')
      {
        try { await pc.setLocalDescription({ type: 'rollback' }); }
        catch (e) { /* schon stabil — dann war nichts zurückzurollen */ }
      }

      await pc.setRemoteDescription(new RTCSessionDescription(description));
      peer.isSettingRemoteAnswerPending = false;
      peer.remoteReady = true;
      this.flushPendingIce(fromDeviceId);

      if (isOffer)
      {
        await pc.setLocalDescription(); // implizites Answer
        if (pc.localDescription)
        {
          this.signaler.signal(fromDeviceId, 'answer', {
            sdp: pc.localDescription.sdp,
            type: pc.localDescription.type,
          });
        }
      }
    } catch (err)
    {
      peer.isSettingRemoteAnswerPending = false;
      console.warn('[mesh] negotiation', err);
    }
  }

  buildPc(remoteDeviceId)
  {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer = {
      pc,
      // Die größere ID ist die höfliche Seite.
      polite: this.myDeviceId > remoteDeviceId,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      remoteReady: false,
      retry: 0,
      watchdog: null,
    };
    this.peers.set(remoteDeviceId, peer);
    this.attachLocalTracks(pc);

    // Teile ich bereits, bekommt der neue Peer den Screen sofort mit.
    if (this.screenTrack && this.screenStream)
    {
      try
      {
        const sender = pc.addTrack(this.screenTrack, this.screenStream);
        this.screenSenders.set(remoteDeviceId, sender);
      } catch (err) { console.warn('[mesh] addTrack screen (neuer Peer)', err); }
    }

    pc.addEventListener('negotiationneeded', async () =>
    {
      try
      {
        peer.makingOffer = true;
        await pc.setLocalDescription(); // implizites Offer
        if (pc.localDescription)
        {
          this.signaler.signal(remoteDeviceId, 'offer', {
            sdp: pc.localDescription.sdp,
            type: pc.localDescription.type,
          });
        }
      } catch (err)
      {
        console.warn('[mesh] negotiationneeded', err);
      } finally
      {
        peer.makingOffer = false;
      }
    });

    pc.addEventListener('icecandidate', (e) =>
    {
      if (!e.candidate) return;
      const c = e.candidate;
      this.signaler.signal(remoteDeviceId, 'ice', {
        candidate: c.candidate,
        sdpMid: c.sdpMid,
        sdpMLineIndex: c.sdpMLineIndex,
      });
    });

    pc.addEventListener('track', (e) =>
    {
      const stream = e.streams?.[0];
      if (!stream) return;
      let streams = this.peerStreams.get(remoteDeviceId);
      if (!streams) { streams = new Map(); this.peerStreams.set(remoteDeviceId, streams); }
      streams.set(stream.id, stream);
      this.reconcileStreams(remoteDeviceId);
      this.emit();
    });

    pc.addEventListener('connectionstatechange', () =>
    {
      const st = pc.connectionState;
      // Live-Zustand in RemoteState spiegeln, damit das Grid "verbinde…" bzw.
      // einen Verbindungshinweis zeigen kann statt einer schwarzen Kachel.
      const cur = this.state.get(remoteDeviceId);
      if (cur && cur.conn !== st) { cur.conn = st; this.emit(); }

      if (st === 'connected')
      {
        peer.retry = 0;
        if (peer.watchdog) { clearTimeout(peer.watchdog); peer.watchdog = null; }
      } else if (st === 'failed')
      {
        // Heilen statt abreißen: ein ICE-Restart verhandelt neu und verbindet
        // meist binnen zwei Sekunden wieder.
        if (!peer.polite)
        {
          try { pc.restartIce(); } catch (e) { /* egal */ }
          this.armWatchdog(remoteDeviceId);
        }
      } else if (st === 'closed')
      {
        this.disconnectFrom(remoteDeviceId);
      }
    });

    this.armWatchdog(remoteDeviceId);
    return peer;
  }

  /**
   * Erreicht eine Verbindung nicht binnen WATCHDOG_MS den Zustand `connected`,
   * ICE-Restart erzwingen — bis MAX_RETRIES. Läuft nur auf der unhöflichen
   * (initiierenden) Seite, damit nicht beide gleichzeitig neu starten.
   */
  armWatchdog(remoteDeviceId)
  {
    const peer = this.peers.get(remoteDeviceId);
    if (!peer || peer.polite) return;
    if (peer.watchdog) clearTimeout(peer.watchdog);

    peer.watchdog = setTimeout(() =>
    {
      const cur = this.peers.get(remoteDeviceId);
      if (!cur) return;
      cur.watchdog = null;
      if (cur.pc.connectionState === 'connected') return;
      if (cur.retry >= MAX_RETRIES) return; // aufgeben — roster/bye räumt auf
      cur.retry++;
      try { cur.pc.restartIce(); } catch (e) { /* egal */ }
      this.armWatchdog(remoteDeviceId);
    }, WATCHDOG_MS);
  }

  attachLocalTracks(pc)
  {
    if (!this.localStream) return;
    const existing = pc.getSenders();
    for (const track of this.localStream.getTracks())
    {
      // Den Screenshare-Sender (ebenfalls kind 'video') beim Neuanhängen der
      // Kamera nicht treffen — das würde den Screen mit dem Kamerabild ersetzen.
      const sender = existing.find((s) => s.track?.kind === track.kind && s.track !== this.screenTrack);
      if (sender) sender.replaceTrack(track).catch(() => {});
      else
      {
        try { pc.addTrack(track, this.localStream); }
        catch (err) { console.warn('[mesh] addTrack', err); }
      }
    }
  }

  flushPendingIce(deviceId)
  {
    const buf = this.pendingIce.get(deviceId);
    if (!buf) return;
    const peer = this.peers.get(deviceId);
    if (!peer) return;
    for (const c of buf) peer.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    this.pendingIce.delete(deviceId);
  }
}
