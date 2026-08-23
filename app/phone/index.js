import React, { useCallback, useEffect, useState } from 'react';
import
  {
    View, Text, Pressable, TextInput, Modal,
    StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
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

  const phase = usePhoneStore((s) => s.phase);
  const registriert = usePhoneStore((s) => s.registriert);
  const fehler = usePhoneStore((s) => s.fehler);
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
  // Was steht im sicheren Speicher? Ohne diese Anzeige waere nicht erkennbar,
  // ob die Anmeldung scheitert oder ob nie Zugangsdaten ankamen - beides
  // faellt sonst unter "nicht angemeldet".
  const [zugangInfo, setZugangInfo] = useState(null);

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
      setZugangInfo(zugang
        ? { benutzer: zugang.benutzer, server: zugang.server }
        : { fehlt: true });
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
          <Text style={styles.nummer} numberOfLines={1} adjustsFontSizeToFit>
            {ziel || ' '}
          </Text>

          <View style={styles.tastatur}>
            {TASTEN.map(([z, b]) => (
              <Pressable
                key={z}
                onPress={() => setZiel((v) => v + z)}
                style={({ pressed }) => [styles.taste, pressed && styles.tasteGedrueckt]}
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

        {!registriert && zugangInfo && (
          <View style={styles.diagnose}>
            {zugangInfo.fehlt ? (
              <Text style={styles.diagnoseText}>
                Keine Zugangsdaten in der App. Bitte im CRM unter Einstellungen
                auf „Nexoro" umstellen und die Seite einmal neu laden.
              </Text>
            ) : (
              <Text style={styles.diagnoseText}>
                Melde an als {zugangInfo.benutzer} @ {zugangInfo.server}
              </Text>
            )}
          </View>
        )}

        {!!fehler && <FehlerZeile text={fehler} />}
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
            <Pressable
              onPress={() => phoneManager.auflegen()}
              style={({ pressed }) => [styles.grossKnopf, styles.rot, pressed && styles.gedrueckt]}
            >
              <Ionicons name="call" size={30} color="#FFFFFF"
                style={{ transform: [{ rotate: '135deg' }] }} />
            </Pressable>
            <Pressable
              onPress={() => phoneManager.annehmen()}
              style={({ pressed }) => [styles.grossKnopf, styles.gruen, pressed && styles.gedrueckt]}
            >
              <Ionicons name="call" size={30} color="#FFFFFF" />
            </Pressable>
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

      {!!fehler && <FehlerZeile text={fehler} />}

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

function FehlerZeile({ text })
{
  return (
    <View style={styles.fehlerZeile}>
      <Ionicons name="alert-circle" size={15} color={C.danger} />
      <Text style={styles.fehlerText} numberOfLines={2}>{text}</Text>
    </View>
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
  waehlBereich: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 20 },
  nummer: {
    fontSize: 38, fontWeight: '500', color: C.text,
    textAlign: 'center', minHeight: 52, marginBottom: 18,
  },
  tastatur: {
    flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'space-between', rowGap: 14,
  },
  taste: {
    width: '30%', aspectRatio: 1.25, borderRadius: 999,
    backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center',
  },
  tasteGedrueckt: { backgroundColor: C.border },
  tasteZiffer: { fontSize: 30, fontWeight: '400', color: C.text },
  tasteBuchstaben: {
    fontSize: 10, color: C.faint, letterSpacing: 1.8, fontWeight: '600', marginTop: 1,
  },
  waehlZeile: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginTop: 24,
  },
  waehlPlatz: { width: 72, alignItems: 'center' },
  loeschKnopf: { padding: 10 },
  anrufKnopf: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: C.success,
    alignItems: 'center', justifyContent: 'center',
  },
  anrufKnopfAus: { backgroundColor: C.border },
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

  diagnose: {
    marginHorizontal: 20, marginTop: 10, padding: 12,
    backgroundColor: C.muted, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
  },
  diagnoseText: { fontSize: 12.5, color: C.subtext, lineHeight: 18 },

  fehlerZeile: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  fehlerText: { flex: 1, fontSize: 12.5, color: C.danger },

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
