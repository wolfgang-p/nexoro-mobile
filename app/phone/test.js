// WICHTIG: Dieser Import MUSS vor jssip stehen — er legt die WebRTC-Symbole
// global ab, die JsSIP beim Laden erwartet.
import { umgebungsBericht } from '../../lib/phone/webrtcGlobals';
import JsSIP from 'jssip';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import
  {
    View, Text, Pressable, TextInput, ScrollView,
    StyleSheet, Platform,
  } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { mediaDevices } from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';

/**
 * SIP-Testbildschirm (Schritt B1) — Vorstufe des echten Telefon-Clients.
 *
 * Ursprünglich als Wegwerf-Nachweis gebaut („läuft JsSIP auf React Native?").
 * Diese Frage ist beantwortet: ja. Der Bildschirm trägt jetzt zusätzlich die
 * Funktionen, die im Gespräch gebraucht werden — Wähltastatur, Stumm, Halten,
 * Lautsprecher, DTMF —, damit sie einzeln geprüft werden können, bevor sie in
 * den eigentlichen Client (lib/phone/) einziehen.
 *
 * Was hier bewusst NOCH fehlt und in B4/B5 kommt:
 *   • CallKit (Systemtelefon-Oberfläche, Sperrbildschirm)
 *   • Klingeln bei geschlossener App (VoIP-Push)
 *   • Zugangsdaten aus dem CRM statt Eingabefeld
 *
 * Braucht einen echten Build auf einem Gerät — react-native-webrtc läuft nicht
 * in Expo Go, und der Simulator hat kein Mikrofon.
 */

// Zugangsdaten der Test-Nebenstelle. Für B1 bewusst hartcodiert; im späteren
// Client kommen sie über die WebView-Brücke aus dem CRM (Schritt B3).
const SIP_SERVER = 'pbx.averio.agency';
const SIP_USER = '99079562071116';
const WS_URL = 'wss://pbx.averio.agency/ws';

const TASTEN = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
];

export default function PhoneTest()
{
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [passwort, setPasswort] = useState('');
  const [ziel, setZiel] = useState('');
  const [zustand, setZustand] = useState('nicht verbunden');
  const [zeilen, setZeilen] = useState([]);
  const [ansicht, setAnsicht] = useState('setup');   // setup | waehlen | gespraech

  // Gesprächszustand
  const [stumm, setStumm] = useState(false);
  const [gehalten, setGehalten] = useState(false);
  const [lautsprecher, setLautsprecher] = useState(false);
  const [dauer, setDauer] = useState(0);
  const [dtmfSichtbar, setDtmfSichtbar] = useState(false);
  const [gegenstelle, setGegenstelle] = useState('');

  const uaRef = useRef(null);
  const sessionRef = useRef(null);
  const scrollRef = useRef(null);
  const startRef = useRef(null);

  const log = useCallback((text) =>
  {
    const zeit = new Date().toLocaleTimeString('de-DE');
    setZeilen((v) => [...v.slice(-150), `${ zeit }  ${ text }`]);
  }, []);

  // Gesprächsdauer mitzählen.
  useEffect(() =>
  {
    if (ansicht !== 'gespraech' || !startRef.current) { setDauer(0); return undefined; }
    const id = setInterval(() =>
      setDauer(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [ansicht]);

  // Beim Öffnen zeigen, was die Laufzeitumgebung bereitstellt.
  useEffect(() =>
  {
    const b = umgebungsBericht();
    log('── Umgebung ──');
    Object.entries(b).forEach(([k, v]) =>
      log(`${ v === 'undefined' ? '✗' : '✓' } ${ k }: ${ v }`));
    log(`JsSIP ${ JsSIP.version }`);
    log('──────────────');

    return () =>
    {
      try { sessionRef.current?.terminate(); } catch (e) { /* egal */ }
      try { uaRef.current?.stop(); } catch (e) { /* egal */ }
      try { InCallManager.stop(); } catch (e) { /* egal */ }
    };
  }, [log]);

  // ── Gesprächs-Ereignisse ──────────────────────────────────────────

  const verdrahteSession = useCallback((session, richtung) =>
  {
    sessionRef.current = session;
    setStumm(false);
    setGehalten(false);

    const wer = session.remote_identity?.uri?.user
             || session.remote_identity?.display_name || '—';
    setGegenstelle(wer);

    session.on('progress', () =>
    {
      log(`${ richtung }: klingelt`);
      setZustand('klingelt…');
    });

    session.on('accepted', () =>
    {
      log(`${ richtung }: angenommen`);
      setZustand('im Gespräch');
    });

    session.on('confirmed', () =>
    {
      log(`${ richtung }: verbunden`);
      startRef.current = Date.now();
      setAnsicht('gespraech');
      try
      {
        InCallManager.start({ media: 'audio' });
        // Anrufe starten auf der Hörmuschel, wie man es vom Telefon kennt.
        InCallManager.setForceSpeakerphoneOn(false);
        setLautsprecher(false);
      } catch (err) { log(`InCallManager: ${ err?.message }`); }
    });

    const beenden = (was) =>
    {
      log(was);
      setZustand('registriert ✓');
      setAnsicht('waehlen');
      setDtmfSichtbar(false);
      startRef.current = null;
      try { InCallManager.stop(); } catch (err) { /* egal */ }
      sessionRef.current = null;
    };

    session.on('ended', (e) => beenden(`${ richtung }: beendet (${ e?.cause || '—' })`));
    session.on('failed', (e) => beenden(`${ richtung }: FEHLGESCHLAGEN — ${ e?.cause || '?' }`));

    session.on('hold', () => { log('gehalten'); setGehalten(true); });
    session.on('unhold', () => { log('fortgesetzt'); setGehalten(false); });
    session.on('muted', () => setStumm(true));
    session.on('unmuted', () => setStumm(false));

    session.on('peerconnection', (e) =>
    {
      log('PeerConnection aufgebaut');
      e.peerconnection.addEventListener('track', (ev) =>
        log(`Medienspur empfangen: ${ ev.track?.kind }`));
    });
  }, [log]);

  // ── Registrieren ──────────────────────────────────────────────────

  const verbinden = useCallback(() =>
  {
    if (!passwort.trim()) { log('FEHLER: Passwort fehlt'); return; }

    try
    {
      JsSIP.debug.enable('JsSIP:*');

      const socket = new JsSIP.WebSocketInterface(WS_URL);
      const ua = new JsSIP.UA({
        sockets: [socket],
        uri: `sip:${ SIP_USER }@${ SIP_SERVER }`,
        password: passwort.trim(),
        display_name: 'Nexoro',
        // Kürzer als der Standard (600 s): So merkt der Server einen toten
        // Client schneller. Für ein Mobilgerät ein guter Kompromiss.
        register_expires: 120,
        // Session-Timer MÜSSEN an sein (RFC 4028). Der Asterisk verlangt sie
        // und erwartet regelmäßig eine Auffrischung; bleibt sie aus, legt er
        // nach etwa einem Drittel der ausgehandelten Zeit selbst auf — bei
        // 90 s Vorgabe also nach rund 30 Sekunden. Genau das war der Abbruch
        // "nach 34 Sekunden".
        session_timers: true,
        // Wir übernehmen das Auffrischen aktiv, statt es dem Server zu
        // überlassen. Auf einem Mobilgerät verlässlicher: Wir wissen, ob wir
        // noch leben, der Server kann es nur vermuten.
        session_timers_force_refresher: true,
      });

      ua.on('connecting', () => { setZustand('verbinde…'); log('WS: verbinde'); });
      ua.on('connected', () => log('WS: verbunden'));
      ua.on('disconnected', (e) =>
      {
        setZustand('getrennt');
        log(`WS: getrennt${ e?.error ? ' — ' + (e.reason || e.error) : '' }`);
      });
      ua.on('registered', () =>
      {
        setZustand('registriert ✓');
        log('SIP: REGISTER erfolgreich');
        setAnsicht('waehlen');
      });
      ua.on('unregistered', () => { setZustand('abgemeldet'); log('SIP: abgemeldet'); });
      ua.on('registrationFailed', (e) =>
      {
        setZustand('Registrierung fehlgeschlagen');
        log(`SIP: REGISTER abgelehnt — ${ e?.cause || 'unbekannt' }`);
      });

      ua.on('newRTCSession', (e) =>
      {
        if (e.originator !== 'remote') return;
        const wer = e.request?.from?.uri?.user || '?';
        log(`◀ EINGEHEND von ${ wer }`);
        verdrahteSession(e.session, 'eingehend');
        setZustand('eingehender Anruf');
        // Ohne CallKit (kommt in B5) nehmen wir hier direkt an, damit der
        // Weg überhaupt geprüft werden kann.
        try
        {
          e.session.answer({ mediaConstraints: { audio: true, video: false } });
          log('automatisch angenommen (Testbetrieb)');
        } catch (err) { log(`Annehmen: ${ err?.message }`); }
      });

      ua.start();
      uaRef.current = ua;
      log(`Starte als ${ SIP_USER }@${ SIP_SERVER }`);
    } catch (err)
    {
      log(`AUSNAHME beim Start: ${ err?.message || err }`);
      setZustand('Fehler');
    }
  }, [passwort, log, verdrahteSession]);

  const trennen = useCallback(() =>
  {
    try { sessionRef.current?.terminate(); } catch (e) { /* egal */ }
    try { uaRef.current?.stop(); } catch (e) { /* egal */ }
    try { InCallManager.stop(); } catch (e) { /* egal */ }
    sessionRef.current = null;
    uaRef.current = null;
    setZustand('nicht verbunden');
    setAnsicht('setup');
    log('gestoppt');
  }, [log]);

  // ── Anrufsteuerung ────────────────────────────────────────────────

  const anrufen = useCallback(async () =>
  {
    const ua = uaRef.current;
    if (!ua?.isRegistered()) { log('FEHLER: nicht registriert'); return; }
    if (!ziel.trim()) { log('FEHLER: keine Nummer'); return; }

    try
    {
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      const session = ua.call(`sip:${ ziel.trim() }@${ SIP_SERVER }`, {
        mediaStream: stream,
        mediaConstraints: { audio: true, video: false },
        rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
      });
      log(`▶ RUFE ${ ziel.trim() } AN`);
      verdrahteSession(session, 'ausgehend');
    } catch (err)
    {
      log(`Anruf fehlgeschlagen: ${ err?.message || err }`);
    }
  }, [ziel, log, verdrahteSession]);

  const auflegen = useCallback(() =>
  {
    try { sessionRef.current?.terminate(); log('aufgelegt'); }
    catch (err) { log(`Auflegen: ${ err?.message }`); }
  }, [log]);

  const stummSchalten = useCallback(() =>
  {
    const s = sessionRef.current;
    if (!s) return;
    try
    {
      if (s.isMuted()?.audio) { s.unmute({ audio: true }); log('Mikro an'); }
      else { s.mute({ audio: true }); log('stumm'); }
    } catch (err) { log(`Stumm: ${ err?.message }`); }
  }, [log]);

  const halten = useCallback(() =>
  {
    const s = sessionRef.current;
    if (!s) return;
    try
    {
      if (s.isOnHold()?.local) { s.unhold(); log('fortsetzen…'); }
      else { s.hold(); log('halten…'); }
    } catch (err) { log(`Halten: ${ err?.message }`); }
  }, [log]);

  const lautsprecherUm = useCallback(() =>
  {
    const neu = !lautsprecher;
    try { InCallManager.setForceSpeakerphoneOn(neu); setLautsprecher(neu); }
    catch (err) { log(`Lautsprecher: ${ err?.message }`); }
  }, [lautsprecher, log]);

  // DTMF im Gespräch — unverzichtbar für Sprachmenüs ("für Vertrieb die 1").
  const dtmf = useCallback((ton) =>
  {
    const s = sessionRef.current;
    if (!s) return;
    try
    {
      // RFC 2833 statt des JsSIP-Standards "SIP INFO": Der Asterisk ist auf
      // rfc2833 eingestellt (Advanced Settings -> SIP DTMF Signaling). Mit
      // INFO kaemen die Toene zwar an, aber Sprachmenues am anderen Ende
      // wuerden sie nicht erkennen.
      s.sendDTMF(ton, { transportType: JsSIP.C.DTMF_TRANSPORT.RFC2833 });
      log(`DTMF: ${ ton }`);
    }
    catch (err) { log(`DTMF: ${ err?.message }`); }
  }, [log]);

  // ── Darstellung ───────────────────────────────────────────────────

  const zurueck = () =>
  {
    trennen();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 6 }]}>
      <View style={styles.kopf}>
        <Pressable onPress={zurueck} hitSlop={10} style={styles.zurueck}>
          <Text style={styles.zurueckText}>‹ Zurück</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.titel}>Telefon (Test)</Text>
          <Text style={styles.zustand}>{zustand}</Text>
        </View>
        {ansicht !== 'setup' && (
          <Pressable onPress={() => setAnsicht('setup')} hitSlop={10} style={styles.zurueck}>
            <Ionicons name="settings-outline" size={20} color="#40BCC7" />
          </Pressable>
        )}
      </View>

      {/* ── Einrichtung ── */}
      {ansicht === 'setup' && (
        <View>
          <Text style={styles.label}>Passwort für {SIP_USER}</Text>
          <TextInput
            value={passwort}
            onChangeText={setPasswort}
            placeholder="Secret aus FreePBX"
            placeholderTextColor="#888"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.eingabe}
          />
          <View style={styles.reihe}>
            <Pressable onPress={verbinden} style={[styles.knopf, styles.primaer]}>
              <Text style={styles.knopfText}>Verbinden</Text>
            </Pressable>
            <Pressable onPress={trennen} style={styles.knopf}>
              <Text style={styles.knopfText}>Trennen</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ── Wähltastatur ── */}
      {ansicht === 'waehlen' && (
        <View>
          <Text style={styles.nummer}>{ziel || ' '}</Text>
          <View style={styles.tastatur}>
            {TASTEN.map(([z, b]) => (
              <Pressable
                key={z}
                onPress={() => setZiel((v) => v + z)}
                style={styles.taste}
              >
                <Text style={styles.tasteZiffer}>{z}</Text>
                {!!b && <Text style={styles.tasteBuchstaben}>{b}</Text>}
              </Pressable>
            ))}
          </View>
          <View style={styles.reihe}>
            <Pressable
              onPress={() => setZiel((v) => v.slice(0, -1))}
              onLongPress={() => setZiel('')}
              style={styles.knopf}
            >
              <Ionicons name="backspace-outline" size={20} color="#fff" />
            </Pressable>
            <Pressable onPress={anrufen} style={[styles.knopf, styles.gruen]}>
              <Ionicons name="call" size={20} color="#fff" />
            </Pressable>
          </View>
        </View>
      )}

      {/* ── Laufendes Gespräch ── */}
      {ansicht === 'gespraech' && (
        <View>
          <Text style={styles.gegenstelle}>{gegenstelle}</Text>
          <Text style={styles.dauer}>
            {gehalten ? 'gehalten' : formatDauer(dauer)}
          </Text>

          <View style={styles.steuerung}>
            <Steuerknopf
              icon={stumm ? 'mic-off' : 'mic'}
              text="Stumm"
              aktiv={stumm}
              onPress={stummSchalten}
            />
            <Steuerknopf
              icon="keypad"
              text="Tasten"
              aktiv={dtmfSichtbar}
              onPress={() => setDtmfSichtbar((v) => !v)}
            />
            <Steuerknopf
              icon={lautsprecher ? 'volume-high' : 'volume-low'}
              text="Lautspr."
              aktiv={lautsprecher}
              onPress={lautsprecherUm}
            />
            <Steuerknopf
              icon="pause"
              text="Halten"
              aktiv={gehalten}
              onPress={halten}
            />
          </View>

          {dtmfSichtbar && (
            <View style={[styles.tastatur, { marginTop: 12 }]}>
              {TASTEN.map(([z]) => (
                <Pressable key={z} onPress={() => dtmf(z)} style={styles.taste}>
                  <Text style={styles.tasteZiffer}>{z}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <Pressable onPress={auflegen} style={[styles.knopf, styles.rot, { marginTop: 10 }]}>
            <Ionicons name="call" size={20} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
          </Pressable>
        </View>
      )}

      <Text style={styles.label}>Protokoll</Text>
      <ScrollView
        ref={scrollRef}
        style={styles.protokoll}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {zeilen.map((z, i) => <Text key={i} style={styles.protokollZeile}>{z}</Text>)}
      </ScrollView>
    </View>
  );
}

function Steuerknopf({ icon, text, aktiv, onPress })
{
  return (
    <Pressable onPress={onPress} style={styles.steuerknopf}>
      <View style={[styles.steuerkreis, aktiv && styles.steuerkreisAktiv]}>
        <Ionicons name={icon} size={20} color={aktiv ? '#0B0F14' : '#fff'} />
      </View>
      <Text style={styles.steuerText}>{text}</Text>
    </Pressable>
  );
}

function formatDauer(s)
{
  const m = Math.floor(s / 60);
  return `${ String(m).padStart(2, '0') }:${ String(s % 60).padStart(2, '0') }`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F14', paddingHorizontal: 14 },
  kopf: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  zurueck: { paddingVertical: 6, paddingRight: 10 },
  zurueckText: { color: '#40BCC7', fontSize: 15, fontWeight: '600' },
  titel: { color: '#fff', fontSize: 18, fontWeight: '700' },
  zustand: { color: '#40BCC7', fontSize: 13, fontWeight: '600' },

  label: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600', marginBottom: 4, marginTop: 6 },
  eingabe: {
    backgroundColor: '#151B23', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, color: '#fff', fontSize: 15,
  },
  reihe: { flexDirection: 'row', gap: 8, marginTop: 10 },
  knopf: {
    flex: 1, paddingVertical: 13, borderRadius: 10,
    backgroundColor: '#1E2733', alignItems: 'center', justifyContent: 'center',
  },
  primaer: { backgroundColor: '#40BCC7' },
  gruen: { backgroundColor: '#10B981' },
  rot: { backgroundColor: '#DC2626' },
  knopfText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  nummer: {
    color: '#fff', fontSize: 26, fontWeight: '600',
    textAlign: 'center', paddingVertical: 8, minHeight: 44,
  },
  tastatur: {
    flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'space-between', marginTop: 4,
  },
  taste: {
    width: '31%', aspectRatio: 2.1, marginBottom: 6,
    backgroundColor: '#151B23', borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  tasteZiffer: { color: '#fff', fontSize: 22, fontWeight: '600' },
  tasteBuchstaben: { color: 'rgba(255,255,255,0.4)', fontSize: 9, letterSpacing: 1 },

  gegenstelle: { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center', marginTop: 6 },
  dauer: { color: '#40BCC7', fontSize: 15, textAlign: 'center', marginBottom: 12 },
  steuerung: { flexDirection: 'row', justifyContent: 'space-around' },
  steuerknopf: { alignItems: 'center', gap: 4 },
  steuerkreis: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#1E2733', alignItems: 'center', justifyContent: 'center',
  },
  steuerkreisAktiv: { backgroundColor: '#40BCC7' },
  steuerText: { color: 'rgba(255,255,255,0.6)', fontSize: 10.5, fontWeight: '600' },

  protokoll: { flex: 1, backgroundColor: '#000', borderRadius: 10, padding: 8, marginBottom: 8 },
  protokollZeile: {
    color: '#7CFFB2', fontSize: 10.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 15,
  },
});
