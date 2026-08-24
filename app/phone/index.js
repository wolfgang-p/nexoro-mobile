import React, { useCallback, useEffect, useState } from 'react';
import
  {
    View, Text, Pressable, TextInput, Modal,
    StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
    useWindowDimensions,
  } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { usePhoneStore, anrufAktiv } from '../../stores/phoneStore';
import { phoneManager } from '../../lib/phone/phoneManager';
import { holeSipZugang, notizSenden } from '../../lib/phone/sipZugang';

/**
 * Das Telefon — Vollbild.
 *
 * Zwei Ansichten: Wähltastatur und laufendes Gespräch. Beide füllen den
 * Bildschirm; Minimieren legt das Gespräch in die Leiste oben und gibt die
 * App frei, genau wie bei Meetings.
 *
 * Die Zugangsdaten kommen aus dem CRM (siehe `sipZugang.js`) — hier wird
 * nichts mehr von Hand eingetippt.
 */

const C = {
  brand: '#40BCC7',
  bg: '#F8FAFC',
  card: '#FFFFFF',
  text: '#1E293B',
  subtext: '#64748B',
  faint: '#94A3B8',
  border: '#E2E8F0',
  muted: '#F1F5F9',
  danger: '#EF4444',
  success: '#10B981',
};

const TASTEN = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
];

export default function PhoneScreen()
{
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: fensterBreite } = useWindowDimensions();

  /**
   * Größe einer Wähltaste.
   *
   * Bewusst berechnet statt in Prozent: Mit `width: '30%'` und `aspectRatio`
   * entstanden Ovale, weil die Breite vom Elternelement abhängt und die Höhe
   * daraus abgeleitet wurde. Eine feste Zahl für beide Seiten ergibt einen
   * echten Kreis — auf jedem Gerät.
   *
   * Rechnung: Bildschirmbreite minus Seitenränder, minus zwei Lücken,
   * geteilt durch drei Spalten. Nach oben begrenzt, damit die Tastatur auf
   * einem Tablet nicht ins Absurde wächst.
   */
  const seitenrand = 26;
  const luecke = 20;
  const tasteGroesse = Math.min(
    76,
    Math.floor((fensterBreite - seitenrand * 2 - luecke * 2) / 3)
  );

  const phase = usePhoneStore((s) => s.phase);
  const registriert = usePhoneStore((s) => s.registriert);
  const gegenstelle = usePhoneStore((s) => s.gegenstelle);
  const startedAt = usePhoneStore((s) => s.startedAt);
  const stumm = usePhoneStore((s) => s.stumm);
  const gehalten = usePhoneStore((s) => s.gehalten);
  const lautsprecher = usePhoneStore((s) => s.lautsprecher);

  const [ziel, setZiel] = useState('');
  const [dauer, setDauer] = useState(0);
  const [dtmfSichtbar, setDtmfSichtbar] = useState(false);
  const [notizOffen, setNotizOffen] = useState(false);
  const [notiz, setNotiz] = useState('');
  const [notizLaeuft, setNotizLaeuft] = useState(false);
  const [notizHinweis, setNotizHinweis] = useState('');
  // Nur die Tatsache, ob Zugangsdaten vorliegen - NICHT welche. Nebenstelle
  // und Servername stehen bewusst nirgends in der Oberflaeche.
  const [zugangFehlt, setZugangFehlt] = useState(false);

  const imGespraech = phase === 'gespraech';
  const klingelt = phase === 'klingelt';
  const aktiv = anrufAktiv(phase);

  useEffect(() =>
  {
    if (!startedAt) { setDauer(0); return undefined; }
    setDauer(Math.floor((Date.now() - startedAt) / 1000));
    const id = setInterval(
      () => setDauer(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  // Beim Öffnen anmelden, falls das noch nicht passiert ist. Die Zugangsdaten
  // liegen nach dem Start bereits im sicheren Speicher.
  useEffect(() =>
  {
    let abgebrochen = false;
    (async () =>
    {
      const zugang = await holeSipZugang();
      if (abgebrochen) return;
      setZugangFehlt(!zugang);
      if (registriert || phase === 'verbinden' || !zugang) return;
      phoneManager.verbinden(zugang);
    })();
    return () => { abgebrochen = true; };
  }, [registriert, phase]);

  // Gespräch beendet: Notizfenster schließen, sonst schwebt es über nichts.
  useEffect(() =>
  {
    if (!aktiv && notizOffen) setNotizOffen(false);
  }, [aktiv, notizOffen]);

  const minimieren = useCallback(() =>
  {
    usePhoneStore.getState().setMinimiert(true);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const notizSpeichern = useCallback(async () =>
  {
    const text = notiz.trim();
    if (!text) { setNotizOffen(false); return; }
    setNotizLaeuft(true);
    setNotizHinweis('');
    const ok = await notizSenden({ nummer: gegenstelle, notiz: text });
    setNotizLaeuft(false);
    if (ok)
    {
      setNotiz('');
      setNotizOffen(false);
    }
    else
    {
      setNotizHinweis('Konnte nicht gespeichert werden. Text bleibt erhalten.');
    }
  }, [notiz, gegenstelle]);

  // ── Wähltastatur (Vollbild) ──────────────────────────────────────

  if (!aktiv)
  {
    return (
      <View style={[styles.seite, { paddingTop: insets.top + 4 }]}>
        <View style={styles.kopf}>
          <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/')}
            hitSlop={12} style={styles.kopfKnopf}>
            <Ionicons name="chevron-back" size={26} color={C.brand} />
          </Pressable>
          <View style={styles.kopfMitte}>
            <Text style={styles.kopfTitel}>Telefon</Text>
            <View style={styles.zustandZeile}>
              <View style={[styles.punkt, {
                backgroundColor: registriert ? C.success : C.faint,
              }]} />
              <Text style={styles.kopfZustand}>
                {registriert ? 'Bereit' : phase === 'verbinden' ? 'Verbinde…' : 'Nicht angemeldet'}
              </Text>
            </View>
          </View>
          <View style={styles.kopfKnopf} />
        </View>

        <View style={styles.waehlBereich}>
          {/* Eigener Bereich mit fester Hoehe: Ohne ihn sprang die Tastatur
              beim ersten Tastendruck nach unten, weil die Zeile von leer auf
              eine Zeile Text wuchs. */}
          <View style={styles.nummerBereich}>
            {ziel ? (
              <Text style={styles.nummer} numberOfLines={1} adjustsFontSizeToFit>
                {ziel}
              </Text>
            ) : (
              <Text style={[styles.nummer, styles.nummerLeer]}>
                Nummer eingeben
              </Text>
            )}
          </View>

          <View style={[styles.tastatur, { gap: luecke }]}>
            {TASTEN.map(([z, b]) => (
              <Pressable
                key={z}
                onPress={() => setZiel((v) => v + z)}
                style={({ pressed }) => [
                  styles.taste,
                  {
                    width: tasteGroesse,
                    height: tasteGroesse,
                    borderRadius: tasteGroesse / 2,
                  },
                  pressed && styles.tasteGedrueckt,
                ]}
              >
                <Text style={styles.tasteZiffer}>{z}</Text>
                {!!b && <Text style={styles.tasteBuchstaben}>{b}</Text>}
              </Pressable>
            ))}
          </View>

          <View style={[styles.waehlZeile, { marginBottom: insets.bottom + 12 }]}>
            <View style={styles.waehlPlatz} />
            <Pressable
              onPress={() => phoneManager.anrufen(ziel)}
              disabled={!ziel.trim() || !registriert}
              style={({ pressed }) => [
                styles.anrufKnopf,
                (!ziel.trim() || !registriert) && styles.anrufKnopfAus,
                pressed && styles.gedrueckt,
              ]}
            >
              {phase === 'verbinden'
                ? <ActivityIndicator color="#FFFFFF" />
                : <Ionicons name="call" size={30} color="#FFFFFF" />}
            </Pressable>
            <View style={styles.waehlPlatz}>
              {!!ziel && (
                <Pressable
                  onPress={() => setZiel((v) => v.slice(0, -1))}
                  onLongPress={() => setZiel('')}
                  hitSlop={14}
                  style={styles.loeschKnopf}
                >
                  <Ionicons name="backspace-outline" size={26} color={C.subtext} />
                </Pressable>
              )}
            </View>
          </View>
        </View>

        {/* Bewusst OHNE technische Angaben: Nebenstelle, Servername und
            SIP-Fehlertexte gehen den Nutzer nichts an. Er sieht nur, ob das
            Telefon bereit ist — der Rest steht im Entwicklerprotokoll. */}
        {!registriert && zugangFehlt && (
          <View style={styles.hinweis}>
            <Text style={styles.hinweisText}>
              Telefonie ist für dieses Konto noch nicht eingerichtet.
            </Text>
          </View>
        )}
      </View>
    );
  }

  // ── Laufendes Gespräch (Vollbild) ────────────────────────────────

  const status = klingelt ? 'Eingehender Anruf'
    : phase === 'ruft' ? 'Wird angerufen…'
    : gehalten ? 'Gehalten'
    : formatDauer(dauer);

  return (
    <View style={[styles.seite, { paddingTop: insets.top + 4 }]}>
      <View style={styles.kopf}>
        <Pressable onPress={minimieren} hitSlop={12} style={styles.kopfKnopf}>
          <Ionicons name="chevron-down" size={26} color={C.brand} />
        </Pressable>
        <View style={styles.kopfMitte}>
          <Text style={styles.kopfZustand}>Minimieren</Text>
        </View>
        <View style={styles.kopfKnopf} />
      </View>

      <View style={styles.gespraechBereich}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(gegenstelle[0] || '?').toUpperCase()}
          </Text>
        </View>
        <Text style={styles.gegenstelle} numberOfLines={1}>
          {gegenstelle || 'Unbekannt'}
        </Text>
        <Text style={styles.dauer}>{status}</Text>
      </View>

      <View style={[styles.unten, { paddingBottom: insets.bottom + 16 }]}>
        {dtmfSichtbar && imGespraech && (
          <View style={styles.tastaturKlein}>
            {TASTEN.map(([z]) => (
              <Pressable
                key={z}
                onPress={() => phoneManager.dtmf(z)}
                style={({ pressed }) => [styles.tasteKlein, pressed && styles.tasteGedrueckt]}
              >
                <Text style={styles.tasteZifferKlein}>{z}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {imGespraech && (
          <View style={styles.steuerung}>
            <Steuerknopf icon={stumm ? 'mic-off' : 'mic-outline'}
              text="Stumm" aktiv={stumm}
              onPress={() => phoneManager.stummSchalten()} />
            <Steuerknopf icon="keypad-outline"
              text="Tasten" aktiv={dtmfSichtbar}
              onPress={() => setDtmfSichtbar((v) => !v)} />
            <Steuerknopf icon={lautsprecher ? 'volume-high' : 'volume-medium-outline'}
              text="Lautsprecher" aktiv={lautsprecher}
              onPress={() => phoneManager.lautsprecher(!lautsprecher)} />
            <Steuerknopf icon="pause-outline"
              text="Halten" aktiv={gehalten}
              onPress={() => phoneManager.halten()} />
            <Steuerknopf icon="create-outline"
              text="Notiz" aktiv={notizOffen}
              onPress={() => setNotizOffen(true)} />
          </View>
        )}

        {klingelt ? (
          <View style={styles.klingelZeile}>
            <View style={styles.klingelKnopf}>
              <Pressable
                onPress={() => phoneManager.auflegen()}
                style={({ pressed }) => [styles.grossKnopf, styles.rot, pressed && styles.gedrueckt]}
              >
                <Ionicons name="call" size={30} color="#FFFFFF"
                  style={{ transform: [{ rotate: '135deg' }] }} />
              </Pressable>
              <Text style={styles.klingelText}>Ablehnen</Text>
            </View>
            <View style={styles.klingelKnopf}>
              <Pressable
                onPress={() => phoneManager.annehmen()}
                style={({ pressed }) => [styles.grossKnopf, styles.gruen, pressed && styles.gedrueckt]}
              >
                <Ionicons name="call" size={30} color="#FFFFFF" />
              </Pressable>
              <Text style={styles.klingelText}>Annehmen</Text>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => phoneManager.auflegen()}
            style={({ pressed }) => [styles.grossKnopf, styles.rot, styles.mittig, pressed && styles.gedrueckt]}
          >
            <Ionicons name="call" size={30} color="#FFFFFF"
              style={{ transform: [{ rotate: '135deg' }] }} />
          </Pressable>
        )}
      </View>

      {/* ── Notiz ── */}
      <Modal
        visible={notizOffen}
        transparent
        animationType="slide"
        onRequestClose={() => setNotizOffen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.notizHintergrund}
        >
          <Pressable style={styles.notizWeg} onPress={() => setNotizOffen(false)} />
          <View style={[styles.notizBlatt, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.notizGriff} />
            <Text style={styles.notizTitel}>Notiz zum Anruf</Text>
            <Text style={styles.notizUnter}>
              {gegenstelle ? `Wird dem Anruf mit ${ gegenstelle } zugeordnet.` : ''}
            </Text>

            <TextInput
              value={notiz}
              onChangeText={setNotiz}
              placeholder="Was wurde besprochen?"
              placeholderTextColor={C.faint}
              multiline
              autoFocus
              style={styles.notizFeld}
            />

            {!!notizHinweis && <Text style={styles.notizFehler}>{notizHinweis}</Text>}

            <View style={styles.notizZeile}>
              <Pressable onPress={() => setNotizOffen(false)} style={styles.notizAbbruch}>
                <Text style={styles.notizAbbruchText}>Abbrechen</Text>
              </Pressable>
              <Pressable
                onPress={notizSpeichern}
                disabled={notizLaeuft}
                style={({ pressed }) => [styles.notizSpeichern, pressed && styles.gedrueckt]}
              >
                {notizLaeuft
                  ? <ActivityIndicator color="#FFFFFF" />
                  : <Text style={styles.notizSpeichernText}>Speichern</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Steuerknopf({ icon, text, aktiv, onPress })
{
  return (
    <Pressable onPress={onPress} style={styles.steuerknopf}>
      <View style={[styles.steuerkreis, aktiv && styles.steuerkreisAktiv]}>
        <Ionicons name={icon} size={22} color={aktiv ? '#FFFFFF' : C.text} />
      </View>
      <Text style={[styles.steuerText, aktiv && styles.steuerTextAktiv]}>{text}</Text>
    </Pressable>
  );
}

function formatDauer(s)
{
  const m = Math.floor(s / 60);
  return `${ String(m).padStart(2, '0') }:${ String(s % 60).padStart(2, '0') }`;
}

const styles = StyleSheet.create({
  seite: { flex: 1, backgroundColor: C.bg },

  kopf: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 6 },
  kopfKnopf: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  kopfMitte: { flex: 1, alignItems: 'center' },
  kopfTitel: { fontSize: 17, fontWeight: '700', color: C.text },
  zustandZeile: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  punkt: { width: 6, height: 6, borderRadius: 3 },
  kopfZustand: { fontSize: 12.5, color: C.subtext, fontWeight: '600' },

  // Wählen
  // Der Bereich verteilt sich von selbst: Die Nummer bekommt oben Raum, die
  // Tastatur sitzt in der Mitte, der Anrufknopf unten. Vorher war alles mit
  // 'flex-end' nach unten gedrueckt und klebte aneinander.
  waehlBereich: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 26,
    paddingTop: 8,
  },
  nummerBereich: {
    flex: 1, justifyContent: 'center', minHeight: 70, maxHeight: 130,
  },
  nummer: {
    fontSize: 36, fontWeight: '400', color: C.text,
    textAlign: 'center', letterSpacing: 1,
  },
  nummerLeer: { color: C.faint, fontSize: 17, letterSpacing: 0, fontWeight: '500' },

  tastatur: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center',
  },
  // Breite, Hoehe und Radius kommen zur Laufzeit (siehe tasteGroesse) - nur
  // so entsteht ein echter Kreis statt eines Ovals.
  taste: {
    backgroundColor: C.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  tasteGedrueckt: { backgroundColor: C.border, transform: [{ scale: 0.94 }] },
  tasteZiffer: { fontSize: 30, fontWeight: '400', color: C.text, lineHeight: 36 },
  tasteBuchstaben: {
    fontSize: 9.5, color: C.faint, letterSpacing: 1.6, fontWeight: '700',
    marginTop: -2,
  },

  waehlZeile: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginTop: 26,
  },
  waehlPlatz: { width: 76, alignItems: 'center', justifyContent: 'center' },
  loeschKnopf: { padding: 12 },
  anrufKnopf: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: C.success,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.success, shadowOpacity: 0.32,
    shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 5,
  },
  anrufKnopfAus: {
    backgroundColor: C.border,
    shadowOpacity: 0, elevation: 0,
  },
  gedrueckt: { opacity: 0.75 },

  // Gespräch
  gespraechBereich: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  avatar: {
    width: 104, height: 104, borderRadius: 52, backgroundColor: C.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 42, fontWeight: '700', color: '#FFFFFF' },
  gegenstelle: {
    fontSize: 26, fontWeight: '700', color: C.text,
    marginTop: 18, paddingHorizontal: 24, textAlign: 'center',
  },
  dauer: {
    fontSize: 16, color: C.subtext, marginTop: 6,
    fontVariant: ['tabular-nums'],
  },

  unten: { paddingHorizontal: 20 },
  steuerung: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginBottom: 26, paddingHorizontal: 2,
  },
  steuerknopf: { alignItems: 'center', gap: 7, width: '19%' },
  steuerkreis: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: C.card,
    borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  steuerkreisAktiv: { backgroundColor: C.brand, borderColor: C.brand },
  steuerText: { fontSize: 10, fontWeight: '600', color: C.subtext, textAlign: 'center' },
  steuerTextAktiv: { color: C.brand },

  tastaturKlein: {
    flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'space-between', rowGap: 8, marginBottom: 20,
  },
  tasteKlein: {
    width: '31%', aspectRatio: 2.2, borderRadius: 12,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  tasteZifferKlein: { fontSize: 21, fontWeight: '500', color: C.text },

  grossKnopf: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
  },
  mittig: { alignSelf: 'center' },
  rot: { backgroundColor: C.danger },
  gruen: { backgroundColor: C.success },
  klingelZeile: {
    flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center',
  },
  klingelKnopf: { alignItems: 'center', gap: 9 },
  klingelText: { fontSize: 13, fontWeight: '600', color: C.subtext },

  hinweis: {
    marginHorizontal: 20, marginTop: 10, padding: 12,
    backgroundColor: C.muted, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
  },
  hinweisText: { fontSize: 12.5, color: C.subtext, lineHeight: 18, textAlign: 'center' },

  // Notiz
  notizHintergrund: { flex: 1, justifyContent: 'flex-end' },
  notizWeg: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)' },
  notizBlatt: {
    backgroundColor: C.card,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 20, paddingTop: 10,
  },
  notizGriff: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: C.border,
    alignSelf: 'center', marginBottom: 14,
  },
  notizTitel: { fontSize: 17, fontWeight: '700', color: C.text },
  notizUnter: { fontSize: 12.5, color: C.subtext, marginTop: 3 },
  notizFeld: {
    backgroundColor: C.muted, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    padding: 13, marginTop: 14,
    minHeight: 110, maxHeight: 200,
    fontSize: 15, color: C.text, textAlignVertical: 'top',
  },
  notizFehler: { fontSize: 12.5, color: C.danger, marginTop: 8 },
  notizZeile: { flexDirection: 'row', gap: 10, marginTop: 14 },
  notizAbbruch: {
    flex: 1, height: 48, borderRadius: 12, backgroundColor: C.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  notizAbbruchText: { fontSize: 15, fontWeight: '600', color: C.subtext },
  notizSpeichern: {
    flex: 2, height: 48, borderRadius: 12, backgroundColor: C.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  notizSpeichernText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
});
