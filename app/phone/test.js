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
import { mediaDevices } from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';

/**
 * Machbarkeitsnachweis (Schritt B1) — WEGWERF-BILDSCHIRM.
 *
 * Beantwortet genau eine Frage: Läuft JsSIP unverändert auf React Native und
 * kann sich damit ein Anruf über die Kamailio-Brücke aufbauen?
 *
 * Bewusst ohne Zustandsverwaltung, ohne CallKit, ohne schöne Oberfläche —
 * alles Sichtbare ist das Protokoll. Wenn das hier funktioniert, wird der
 * eigentliche Client (lib/phone/sipManager.js) darauf aufgebaut und diese
 * Datei gelöscht.
 *
 * Aufruf: in der App auf /phone/test navigieren.
 *
 * Braucht einen echten Dev-Build auf einem Gerät — react-native-webrtc läuft
 * nicht in Expo Go, und der Simulator hat kein Mikrofon.
 */

// Zugangsdaten der Test-Nebenstelle. Für B1 bewusst hartcodiert; im späteren
// Client kommen sie über die WebView-Brücke aus dem CRM (Schritt B3).
const SIP_SERVER = 'pbx.averio.agency';
const SIP_USER = '99079562071116';
const WS_URL = 'wss://pbx.averio.agency/ws';

export default function PhoneTest()
{
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [passwort, setPasswort] = useState('');
  const [ziel, setZiel] = useState('079562071116');
  const [zustand, setZustand] = useState('nicht verbunden');
  const [zeilen, setZeilen] = useState([]);

  const uaRef = useRef(null);
  const sessionRef = useRef(null);
  const scrollRef = useRef(null);

  const log = useCallback((text) =>
  {
    const zeit = new Date().toLocaleTimeString('de-DE');
    setZeilen((v) => [...v.slice(-120), `${ zeit }  ${ text }`]);
  }, []);

  // Beim Öffnen zeigen, was die Laufzeitumgebung tatsächlich bereitstellt.
  // Genau das ist die Kernfrage von B1.
  useEffect(() =>
  {
    const b = umgebungsBericht();
    log('── Umgebung ──');
    Object.entries(b).forEach(([k, v]) =>
    {
      log(`${ v === 'undefined' ? '✗' : '✓' } ${ k }: ${ v }`);
    });
    log(`JsSIP ${ JsSIP.version }`);
    log('──────────────');

    return () =>
    {
      try { sessionRef.current?.terminate(); } catch (e) { /* egal */ }
      try { uaRef.current?.stop(); } catch (e) { /* egal */ }
      try { InCallManager.stop(); } catch (e) { /* egal */ }
    };
  }, [log]);

  // ── Anruf ─────────────────────────────────────────────────────────

  const verdrahteSession = useCallback((session, richtung) =>
  {
    sessionRef.current = session;

    session.on('progress', () => log(`${ richtung }: klingelt`));
    session.on('accepted', () => { log(`${ richtung }: angenommen`); setZustand('im Gespräch'); });
    session.on('confirmed', () =>
    {
      log(`${ richtung }: verbunden`);
      // Audio-Sitzung starten, sonst bleibt es auf dem Gerät stumm.
      try
      {
        InCallManager.start({ media: 'audio' });
        InCallManager.setForceSpeakerphoneOn(true);
        log('Lautsprecher an');
      } catch (err) { log(`InCallManager: ${ err?.message }`); }
    });
    session.on('ended', (e) =>
    {
      log(`${ richtung }: beendet (${ e?.cause || '—' })`);
      setZustand('registriert ✓');
      try { InCallManager.stop(); } catch (err) { /* egal */ }
      sessionRef.current = null;
    });
    session.on('failed', (e) =>
    {
      log(`${ richtung }: FEHLGESCHLAGEN — ${ e?.cause || 'unbekannt' }`);
      setZustand('registriert ✓');
      try { InCallManager.stop(); } catch (err) { /* egal */ }
      sessionRef.current = null;
    });

    // Der Ton kommt über diesen Datenstrom herein. In React Native genügt es,
    // ihn entgegenzunehmen — die Wiedergabe übernimmt das native WebRTC-Modul.
    session.on('peerconnection', (e) =>
    {
      log('PeerConnection aufgebaut');
      e.peerconnection.addEventListener('track', (ev) =>
      {
        log(`Medienspur empfangen: ${ ev.track?.kind }`);
      });
    });
  }, [log]);

  // ── Registrieren ──────────────────────────────────────────────────

  const verbinden = useCallback(() =>
  {
    if (!passwort.trim())
    {
      log('FEHLER: Passwort fehlt');
      return;
    }

    try
    {
      // JsSIPs eigene Protokollierung in unser Fenster umleiten, damit man
      // die SIP-Nachrichten sieht, ohne an der Konsole zu hängen.
      JsSIP.debug.enable('JsSIP:*');

      const socket = new JsSIP.WebSocketInterface(WS_URL);
      const ua = new JsSIP.UA({
        sockets: [socket],
        uri: `sip:${ SIP_USER }@${ SIP_SERVER }`,
        password: passwort.trim(),
        display_name: 'Nexoro Test',
        // Kürzer als der Standard (600 s): So merkt der Server einen toten
        // Client schneller. Für ein Mobilgerät ein guter Kompromiss.
        register_expires: 120,
        session_timers: false,
      });

      ua.on('connecting', () => { setZustand('verbinde…'); log('WS: verbinde'); });
      ua.on('connected', () => { log('WS: verbunden'); });
      ua.on('disconnected', (e) =>
      {
        setZustand('getrennt');
        log(`WS: getrennt${ e?.error ? ' — ' + (e.reason || e.error) : '' }`);
      });
      ua.on('registered', () => { setZustand('registriert ✓'); log('SIP: REGISTER erfolgreich'); });
      ua.on('unregistered', () => { setZustand('abgemeldet'); log('SIP: abgemeldet'); });
      ua.on('registrationFailed', (e) =>
      {
        setZustand('Registrierung fehlgeschlagen');
        log(`SIP: REGISTER abgelehnt — ${ e?.cause || 'unbekannt' }`);
      });

      // Eingehender Anruf (für den Test nur protokolliert, kein Klingeln).
      ua.on('newRTCSession', (e) =>
      {
        if (e.originator === 'remote')
        {
          log(`◀ EINGEHEND von ${ e.request?.from?.display_name || e.request?.from?.uri?.user || '?' }`);
          verdrahteSession(e.session, 'eingehend');
        }
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
    log('gestoppt');
  }, [log]);


  const anrufen = useCallback(async () =>
  {
    const ua = uaRef.current;
    if (!ua || !ua.isRegistered())
    {
      log('FEHLER: nicht registriert');
      return;
    }

    try
    {
      // Mikrofon anfordern, bevor der Anruf aufgebaut wird.
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      log('Mikrofon bereit');

      const session = ua.call(`sip:${ ziel.trim() }@${ SIP_SERVER }`, {
        mediaStream: stream,
        mediaConstraints: { audio: true, video: false },
        rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
      });

      log(`▶ RUFE ${ ziel.trim() } an`);
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

  // ── Darstellung ───────────────────────────────────────────────────

  const registriert = zustand.startsWith('registriert') || zustand === 'im Gespräch';

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.kopf}>
        <Pressable
          onPress={() =>
          {
            // Vor dem Verlassen sauber aufraeumen: eine offene Registrierung
            // haelt sonst den Socket und blockiert den naechsten Versuch.
            trennen();
            if (router.canGoBack()) router.back();
            else router.replace('/');
          }}
          hitSlop={10}
          style={styles.zurueck}
        >
          <Text style={styles.zurueckText}>‹ Zurück</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.titel}>SIP-Test (B1)</Text>
          <Text style={styles.zustand}>{zustand}</Text>
        </View>
      </View>

      <View style={styles.feld}>
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
      </View>

      <View style={styles.reihe}>
        <Pressable onPress={verbinden} style={[styles.knopf, styles.primaer]}>
          <Text style={styles.knopfText}>Verbinden</Text>
        </Pressable>
        <Pressable onPress={trennen} style={styles.knopf}>
          <Text style={styles.knopfText}>Trennen</Text>
        </Pressable>
      </View>

      <View style={styles.feld}>
        <Text style={styles.label}>Zielrufnummer</Text>
        <TextInput
          value={ziel}
          onChangeText={setZiel}
          placeholder="079562071116"
          placeholderTextColor="#888"
          keyboardType="phone-pad"
          style={styles.eingabe}
        />
      </View>

      <View style={styles.reihe}>
        <Pressable
          onPress={anrufen}
          disabled={!registriert}
          style={[styles.knopf, styles.gruen, !registriert && styles.aus]}
        >
          <Text style={styles.knopfText}>Anrufen</Text>
        </Pressable>
        <Pressable onPress={auflegen} style={[styles.knopf, styles.rot]}>
          <Text style={styles.knopfText}>Auflegen</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>Protokoll</Text>
      <ScrollView
        ref={scrollRef}
        style={styles.protokoll}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {zeilen.map((z, i) => (
          <Text key={i} style={styles.protokollZeile}>{z}</Text>
        ))}
      </ScrollView>

      <Text style={styles.fuss}>
        {Platform.OS} · {WS_URL}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F14', paddingHorizontal: 14 },
  kopf: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  zurueck: { paddingVertical: 6, paddingRight: 10 },
  zurueckText: { color: '#40BCC7', fontSize: 15, fontWeight: '600' },
  titel: { color: '#fff', fontSize: 20, fontWeight: '700' },
  zustand: { color: '#40BCC7', fontSize: 15, fontWeight: '600', marginTop: 2, marginBottom: 10 },
  feld: { marginBottom: 10 },
  label: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600', marginBottom: 4 },
  eingabe: {
    backgroundColor: '#151B23', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    color: '#fff', fontSize: 15,
  },
  reihe: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  knopf: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    backgroundColor: '#1E2733', alignItems: 'center',
  },
  primaer: { backgroundColor: '#40BCC7' },
  gruen: { backgroundColor: '#10B981' },
  rot: { backgroundColor: '#DC2626' },
  aus: { opacity: 0.4 },
  knopfText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  protokoll: {
    flex: 1, backgroundColor: '#000', borderRadius: 10,
    padding: 8, marginBottom: 6,
  },
  protokollZeile: {
    color: '#7CFFB2', fontSize: 10.5, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 15,
  },
  fuss: { color: 'rgba(255,255,255,0.35)', fontSize: 10, textAlign: 'center', paddingBottom: 6 },
});
