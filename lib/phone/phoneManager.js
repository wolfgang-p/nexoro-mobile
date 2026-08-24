// WICHTIG: Muss vor jssip geladen werden — legt die WebRTC-Symbole global ab.
import '../../lib/phone/webrtcGlobals';
import JsSIP from 'jssip';

import { mediaDevices } from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';

import { usePhoneStore } from '../../stores/phoneStore';
import
  {
    callKitEinrichten, callKitVerfuegbar, eingehendenAnrufZeigen,
    ausgehendenAnrufMelden, annehmenMelden, verbundenMelden,
    haltenMelden, stummMelden, anrufBeendenMelden, callKitZuruecksetzen,
  } from './callKit';

/**
 * Das Telefon der App — ein Singleton außerhalb jedes React-Baums.
 *
 * Genau wie `meetManager` für Meetings: Die SIP-Sitzung darf nicht an einer
 * Komponente hängen, sonst risse sie ab, sobald der Nutzer den Bildschirm
 * verlässt. Genau das soll das Minimieren aber erlauben — Gespräch läuft
 * weiter, während im CRM gearbeitet wird.
 *
 * Der Manager kennt die Oberfläche nicht. Er meldet seinen Zustand an
 * `phoneStore`; wer etwas anzeigen will, liest dort.
 */

class PhoneManager
{
  constructor()
  {
    this.ua = null;
    this.session = null;
    this.anrufId = null;
    this.zaehler = 0;
    this.zugang = null;      // { server, benutzer, passwort, wsUrl }
    this.callKitBereit = false;
  }

  get store() { return usePhoneStore.getState(); }

  protokoll(text) { console.log('[phone]', text); }

  fehler(text)
  {
    this.protokoll(`FEHLER: ${ text }`);
    this.store.setFehler(text);
  }

  // ── Registrierung ───────────────────────────────────────────────

  /**
   * Meldet das Telefon an. Mehrfach aufrufbar: Sind die Zugangsdaten
   * unverändert und die Verbindung steht, passiert nichts — das ist wichtig,
   * weil die App bei jedem Start synchronisiert.
   */
  verbinden({ server, benutzer, passwort, wsUrl })
  {
    if (!server || !benutzer || !passwort)
    {
      this.fehler('Zugangsdaten unvollständig.');
      return false;
    }

    const gleich = this.zugang
      && this.zugang.benutzer === benutzer
      && this.zugang.passwort === passwort
      && this.zugang.server === server;
    if (gleich && this.ua?.isRegistered()) return true;

    // Zugangsdaten geändert: alte Verbindung sauber abbauen.
    if (this.ua) this.trennen({ behalteZugang: true });

    this.zugang = { server, benutzer, passwort, wsUrl: wsUrl || `wss://${ server }/ws` };
    this.store.setFehler(null);
    this.store.setPhase('verbinden');

    this._callKit();

    try
    {
      const socket = new JsSIP.WebSocketInterface(this.zugang.wsUrl);
      const ua = new JsSIP.UA({
        sockets: [socket],
        uri: `sip:${ benutzer }@${ server }`,
        password: passwort,
        display_name: 'Nexoro',
        // Kürzer als der Standard (600 s): Der Server merkt einen toten Client
        // schneller. Für ein Mobilgerät ein guter Kompromiss.
        register_expires: 120,
        // Session-Timer nach RFC 4028 — wir halten das Gespräch aktiv am Leben.
        session_timers: true,
        session_timers_force_refresher: true,
      });

      ua.on('connecting', () => this.store.setPhase('verbinden'));
      ua.on('connected', () => this.protokoll('WS verbunden'));
      ua.on('disconnected', (e) =>
      {
        this.store.setRegistriert(false);
        if (e?.error) this.fehler(`Verbindung getrennt: ${ e.reason || 'Netzwerkfehler' }`);
      });
      ua.on('registered', () =>
      {
        this.protokoll('registriert');
        this.store.setFehler(null);
        this.store.setRegistriert(true);
      });
      ua.on('unregistered', () => this.store.setRegistriert(false));
      ua.on('registrationFailed', (e) =>
      {
        this.store.setRegistriert(false);
        this.fehler(`Anmeldung abgelehnt: ${ e?.cause || 'Passwort prüfen' }`);
      });

      ua.on('newRTCSession', (e) =>
      {
        if (e.originator !== 'remote') return;
        this._eingehend(e);
      });

      ua.start();
      this.ua = ua;
      return true;
    } catch (err)
    {
      this.fehler(`Start fehlgeschlagen: ${ err?.message || err }`);
      this.store.setPhase('idle');
      return false;
    }
  }

  /**
   * Nach der Rückkehr aus dem Hintergrund sicherstellen, dass wir noch
   * angemeldet sind.
   *
   * iOS friert das JavaScript ein, sobald die App in den Hintergrund geht. Der
   * WebSocket stirbt dabei still, und die Registrierung läuft nach spätestens
   * `register_expires` (120 s) ab. Der Asterisk kennt dann nur noch die
   * 3CX-Anmeldung — ein eingehender Anruf erreicht die App nicht mehr, und
   * zwar ohne jede Fehlermeldung.
   *
   * `isRegistered()` ist dabei nicht verlässlich: JsSIP hält den Wert für
   * gültig, solange kein Fehler auftrat. Deshalb prüfen wir zusätzlich, ob der
   * Transport überhaupt noch verbunden ist.
   */
  aufwecken()
  {
    if (!this.zugang) return;

    const verbunden = this.ua?.isConnected?.() ?? false;
    if (this.ua?.isRegistered() && verbunden)
    {
      // Verbindung steht — trotzdem eine Auffrischung anstoßen, damit der
      // Server einen frischen Eintrag hat.
      try { this.ua.register(); } catch (e) { /* egal */ }
      return;
    }

    this.protokoll('Registrierung erneuern (App war im Hintergrund)');
    const zugang = this.zugang;
    this.trennen({ behalteZugang: true });
    this.zugang = zugang;
    this.verbinden(zugang);
  }

  trennen({ behalteZugang = false } = {})
  {
    this._toeneAus();
    try { this.session?.terminate(); } catch (e) { /* egal */ }
    try { this.ua?.stop(); } catch (e) { /* egal */ }
    try { InCallManager.stop(); } catch (e) { /* egal */ }
    if (this.anrufId) anrufBeendenMelden(this.anrufId);
    callKitZuruecksetzen();
    this.session = null;
    this.ua = null;
    this.anrufId = null;
    if (!behalteZugang) this.zugang = null;
    this.store.zuruecksetzen();
  }

  // ── Anrufe ──────────────────────────────────────────────────────

  /**
   * Wartet, bis die Anmeldung steht — höchstens `maxMs`.
   *
   * Nötig, weil ein Anruf aus dem CRM sofort nach dem Öffnen der App kommen
   * kann, während die Registrierung noch läuft. Ohne dieses Warten bekäme der
   * Nutzer „Nicht angemeldet", obwohl es eine Sekunde später geklappt hätte.
   */
  async _warteAufRegistrierung(maxMs = 6000)
  {
    if (this.ua?.isRegistered()) return true;
    if (!this.ua) return false;
    const bis = Date.now() + maxMs;
    while (Date.now() < bis)
    {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 200));
      if (this.ua?.isRegistered()) return true;
    }
    return false;
  }

  async anrufen(nummer)
  {
    const ziel = String(nummer || '').trim();
    if (!ziel) return false;
    if (this.session) { this.fehler('Es läuft bereits ein Gespräch.'); return false; }

    if (!await this._warteAufRegistrierung())
    {
      this.fehler('Telefon ist nicht angemeldet.');
      return false;
    }

    try
    {
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      const session = this.ua.call(`sip:${ ziel }@${ this.zugang.server }`, {
        mediaStream: stream,
        mediaConstraints: { audio: true, video: false },
        rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
      });

      const anrufId = `out-${ ++this.zaehler }-${ ziel }`;
      this._meetingStummschalten();
      this._verdrahte(session, 'aus', anrufId, ziel);
      ausgehendenAnrufMelden({ anrufId, name: ziel });
      annehmenMelden(anrufId);
      return true;
    } catch (err)
    {
      this.fehler(`Anruf nicht möglich: ${ err?.message || err }`);
      return false;
    }
  }

  annehmen()
  {
    try { this.session?.answer({ mediaConstraints: { audio: true, video: false } }); }
    catch (err) { this.fehler(`Annehmen: ${ err?.message }`); }
  }

  auflegen()
  {
    try { this.session?.terminate(); }
    catch (err) { this.fehler(`Auflegen: ${ err?.message }`); }
  }

  stummSchalten()
  {
    const s = this.session;
    if (!s) return;
    try
    {
      if (s.isMuted()?.audio) s.unmute({ audio: true });
      else s.mute({ audio: true });
    } catch (err) { this.fehler(`Stummschalten: ${ err?.message }`); }
  }

  halten()
  {
    const s = this.session;
    if (!s) return;
    try
    {
      // hold()/unhold() geben still `false` zurück, wenn gerade eine andere
      // INVITE-Transaktion läuft — etwa die Auffrischung des Session-Timers.
      // Ohne diese Prüfung sähe der Nutzer einen Knopf, der nichts tut.
      const ok = s.isOnHold()?.local ? s.unhold() : s.hold();
      if (ok === false) this.fehler('Gerade nicht möglich — bitte kurz erneut versuchen.');
    } catch (err) { this.fehler(`Halten: ${ err?.message }`); }
  }

  lautsprecher(an)
  {
    try
    {
      InCallManager.setForceSpeakerphoneOn(an);
      this.store.setLautsprecher(an);
    } catch (err) { this.fehler(`Lautsprecher: ${ err?.message }`); }
  }

  dtmf(ton)
  {
    const s = this.session;
    if (!s) return;
    try
    {
      // RFC 2833 statt des JsSIP-Standards "SIP INFO": Der Asterisk ist auf
      // rfc2833 eingestellt. Mit INFO kämen die Töne an, aber Sprachmenüs am
      // anderen Ende würden sie nicht erkennen.
      s.sendDTMF(ton, { transportType: JsSIP.C.DTMF_TRANSPORT.RFC2833 });
    } catch (err) { this.fehler(`Tastenton: ${ err?.message }`); }
  }

  // ── Intern ──────────────────────────────────────────────────────

  _callKit()
  {
    if (this.callKitBereit) return;
    callKitEinrichten({
      onAnnehmen: (id) => { if (this.anrufId === id) this.annehmen(); },
      onBeenden: (id) => { if (this.anrufId === id) this.auflegen(); },
      // Auf iOS gehört die Audiositzung CallKit. Erst wenn es sie freigibt,
      // darf der InCallManager ran — sonst bleibt das Gespräch stumm.
      onAudioBereit: () => this._audioStarten(),
    });
    this.callKitBereit = true;
  }

  /** Klingel- und Freizeichen beenden. Mehrfach aufrufbar. */
  _toeneAus()
  {
    try { InCallManager.stopRingtone(); } catch (e) { /* egal */ }
    try { InCallManager.stopRingback(); } catch (e) { /* egal */ }
  }

  _audioStarten()
  {
    try
    {
      InCallManager.start({ media: 'audio' });
      // Anrufe starten auf der Hörmuschel, wie man es vom Telefon kennt.
      InCallManager.setForceSpeakerphoneOn(false);
      this.store.setLautsprecher(false);
    } catch (err) { this.fehler(`Audio: ${ err?.message }`); }
  }

  /**
   * Laeuft gerade ein Meeting? Dann hat der Anruf Vorrang, und das Meeting
   * wird stummgeschaltet — zwei gleichzeitige Audio-Sitzungen wuerden sich
   * sonst gegenseitig ueberlagern, und der Nutzer haette in beiden nichts
   * verstanden.
   *
   * Bewusst nur stumm, nicht verlassen: Nach dem Auflegen kann er weitermachen.
   * Der Import liegt in der Funktion, damit die Telefonie nicht beim Laden
   * schon vom Meeting-Teil abhaengt.
   */
  _meetingStummschalten()
  {
    try
    {
      // eslint-disable-next-line global-require
      const { useMeetStore, isMeetingLive } = require('../../stores/meetStore');
      const zustand = useMeetStore.getState();
      if (!isMeetingLive(zustand) || !zustand.micOn) return;

      // Ueber den Manager, NICHT ueber setMicOn: Der Store haelt nur das
      // Anzeige-Flag, die Tonspur schaltet meetManager.toggleMic()
      // (meetManager.js:334). Nur den Store zu setzen haette das Mikrofon
      // offen gelassen und bloss den Knopf umgefaerbt.
      // eslint-disable-next-line global-require
      const { meetManager } = require('../meet/meetManager');
      meetManager.toggleMic();
      this.protokoll('Meeting stummgeschaltet — Anruf hat Vorrang');
    } catch (err) { /* kein Meeting-Teil geladen */ }
  }

  _eingehend(e)
  {
    this._meetingStummschalten();
    const wer = e.request?.from?.uri?.user || 'Unbekannt';
    const anrufId = `in-${ ++this.zaehler }-${ wer }`;
    this.protokoll(`eingehend von ${ wer }`);
    this._verdrahte(e.session, 'ein', anrufId, wer);

    if (callKitVerfuegbar())
    {
      // Das System zeigt den Anruf; Annehmen/Ablehnen kommt über die Rückrufe.
      eingehendenAnrufZeigen({ anrufId, name: wer });
    }
  }

  _verdrahte(session, richtung, anrufId, wer)
  {
    this.session = session;
    this.anrufId = anrufId;
    this.store.anrufBegonnen({ anrufId, gegenstelle: wer, richtung });

    // Hoerbar machen. Bei eingehenden Anrufen uebernimmt CallKit den Klingelton
    // selbst - dann darf der InCallManager NICHT zusaetzlich laeuten, sonst
    // klingelt es doppelt. Ohne CallKit (Android ohne Berechtigung, Expo Go)
    // waere der Anruf sonst voellig stumm.
    if (richtung === 'ein' && !callKitVerfuegbar())
    {
      try { InCallManager.startRingtone('_DEFAULT_'); } catch (e) { /* egal */ }
    }

    session.on('progress', () =>
    {
      this.protokoll(`${ richtung }: klingelt`);
      // Freizeichen fuer den Anrufer - sonst wirkt die Stille wie ein Fehler.
      if (richtung === 'aus')
      {
        try { InCallManager.startRingback('_DTMF_'); } catch (e) { /* egal */ }
      }
    });

    // Gespraech steht - Bildschirm umschalten.
    //
    // BEIDE Ereignisse anhaengen, weil sie bei den zwei Richtungen zu
    // verschiedenen Zeitpunkten feuern:
    //
    //   ausgehend:  'confirmed' kommt mit dem 200 OK der Gegenseite
    //   eingehend:  'accepted' feuert, sobald WIR das 200 OK senden
    //               (RTCSession.js:564). 'confirmed' kaeme erst mit dem ACK
    //               des Anrufers - das kann verzoegert eintreffen oder ganz
    //               ausbleiben. Genau deshalb blieb der Bildschirm bei
    //               eingehenden Anrufen im Klingel-Zustand haengen, obwohl
    //               man schon sprechen konnte.
    //
    // `verbunden` ist gegen Mehrfachaufruf geschuetzt: Beide Ereignisse
    // koennen nacheinander feuern.
    let schonVerbunden = false;
    const verbunden = () =>
    {
      if (schonVerbunden) return;
      schonVerbunden = true;
      this.protokoll(`${ richtung }: verbunden`);
      this._toeneAus();
      this.store.anrufVerbunden();
      verbundenMelden(anrufId);
      if (!callKitVerfuegbar()) this._audioStarten();
    };

    session.on('accepted', verbunden);
    session.on('confirmed', verbunden);

    const beenden = (text, sichtbar) =>
    {
      this.protokoll(text);
      if (sichtbar) this.store.setFehler(text);
      this._toeneAus();
      try { InCallManager.stop(); } catch (err) { /* egal */ }
      anrufBeendenMelden(anrufId);
      this.session = null;
      this.anrufId = null;
      this.store.anrufBeendet();
    };

    session.on('ended', (e) =>
      beenden(`Gespräch beendet (${ e?.cause || '—' })`, false));
    session.on('failed', (e) =>
      beenden(`Anruf fehlgeschlagen: ${ e?.cause || 'unbekannt' }`, true));

    // Die eigentliche Ursache eines "Bad Media Description" sichtbar machen.
    //
    // JsSIP meldet nur, DASS setRemoteDescription() fehlgeschlagen ist
    // (RTCSession.js:2096) - nicht warum. Der Grund steht in diesem Ereignis,
    // und ohne ihn sucht man im SDP blind.
    session.on('peerconnection:setremotedescriptionfailed', (err) =>
    {
      const text = err?.message || String(err);
      this.protokoll(`setRemoteDescription: ${ text }`);
      this.store.setFehler(`Medien abgelehnt: ${ text }`);
    });

    session.on('peerconnection', (e) =>
    {
      this.protokoll('PeerConnection aufgebaut');
      e.peerconnection.addEventListener('track', (ev) =>
        this.protokoll(`Medienspur empfangen: ${ ev.track?.kind }`));
      e.peerconnection.addEventListener('iceconnectionstatechange', () =>
        this.protokoll(`ICE: ${ e.peerconnection.iceConnectionState }`));
    });

    session.on('sdp', (e) =>
    {
      // Nur die Kopfzeilen der Medienbeschreibung - das ganze SDP waere im
      // Protokoll unlesbar, und die Transportzeile genuegt zur Diagnose.
      if (e.originator !== 'remote') return;
      const zeilen = String(e.sdp || '').split(/\r?\n/)
        .filter((z) => z.startsWith('m=') || z.startsWith('a=fingerprint')
                    || z.startsWith('a=setup') || z.startsWith('a=rtcp-mux'));
      this.protokoll(`SDP von der Gegenseite: ${ zeilen.join(' | ') }`);
    });

    session.on('hold', () => { this.store.setGehalten(true); haltenMelden(anrufId, true); });
    session.on('unhold', () => { this.store.setGehalten(false); haltenMelden(anrufId, false); });
    session.on('muted', () => { this.store.setStumm(true); stummMelden(anrufId, true); });
    session.on('unmuted', () => { this.store.setStumm(false); stummMelden(anrufId, false); });
  }
}

export const phoneManager = new PhoneManager();
