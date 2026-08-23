import { Platform } from 'react-native';

/**
 * Anbindung an CallKit (iOS) bzw. den ConnectionService (Android) über
 * `react-native-callkeep`.
 *
 * Damit erscheint ein Anruf in der Systemoberfläche: auf dem Sperrbildschirm,
 * im Anrufprotokoll des Telefons, mit den gewohnten Annehmen/Ablehnen-Knöpfen.
 *
 * Es braucht keine Schlüssel und keinen Dienst — CallKit ist ein reines
 * Betriebssystem-Rahmenwerk. Wir melden nur den Lebenslauf eines Gesprächs an
 * und hören auf die Aktionen des Nutzers zurück.
 *
 * WICHTIG (aus der Koro-Vorlage übernommen): Auf iOS gehört die Audiositzung
 * CallKit, nicht uns. Erst wenn `didActivateAudioSession` gemeldet wird, darf
 * WebRTC bzw. der InCallManager das Audio anfassen. Wer vorher startet, bekommt
 * angenommene Gespräche ohne Ton — dieser Fehler ist bei Koro real aufgetreten.
 *
 * Was hier NOCH fehlt und in B5 folgt: Klingeln bei vollständig beendeter App.
 * Dafür braucht iOS PushKit/VoIP-Push, ein eigener Weg neben dem normalen
 * Expo-Push. Solange die App läuft (Vordergrund oder Hintergrund), funktioniert
 * dieser Baustein bereits vollständig.
 */

// Weicher Import: Ohne nativen Build — etwa in Expo Go — gibt es das Modul
// nicht. Der Paketname läuft über eine Variable, damit Metro ihn beim Bündeln
// nicht statisch auflöst; fehlt das Modul, bleibt `lib` null und jede Funktion
// unten wird wirkungslos, statt die App abstürzen zu lassen.
const CK_MODUL = 'react-native-callkeep';
let lib = null;
try { lib = require(CK_MODUL).default; } catch (e) { /* kein nativer Build */ }

let eingerichtet = false;
let hoerernAngehaengt = false;

// CallKit spricht ausschließlich über UUIDs. Wir halten beide Richtungen, um
// eintreffende Systemereignisse wieder unserer Anruf-Kennung zuzuordnen.
const idZuUuid = new Map();
const uuidZuId = new Map();

let beiAnnehmen = null;
let beiBeenden = null;
let beiAudioBereit = null;

/** Ist die native Anbindung überhaupt vorhanden? Für Diagnosezwecke. */
export function callKitVerfuegbar()
{
  return !!lib;
}

export function callKitEinrichten({ onAnnehmen, onBeenden, onAudioBereit })
{
  beiAnnehmen = onAnnehmen || null;
  beiBeenden = onBeenden || null;
  beiAudioBereit = onAudioBereit || null;
  if (!lib) return false;

  if (!eingerichtet)
  {
    try
    {
      lib.setup({
        ios: {
          appName: 'Nexoro',
          supportsVideo: false,
          maximumCallGroups: '1',
          maximumCallsPerCallGroup: '1',
        },
        android: {
          alertTitle: 'Berechtigungen',
          alertDescription:
            'Nexoro braucht Anruf-Berechtigungen, damit Anrufe im System-Telefonprotokoll erscheinen.',
          cancelButton: 'Abbrechen',
          okButton: 'OK',
          additionalPermissions: [],
          // selfManaged bräuchte zusätzlich einen Vordergrunddienst. Solange
          // das nicht gebaut ist (B6), bleibt es aus — sonst klingelt Android
          // scheinbar, ohne dass ein Gespräch zustande kommt.
          selfManaged: false,
        },
      });
      eingerichtet = true;
    } catch (e) { /* Gespräche laufen dann eben nur in der App-Oberfläche */ }
  }

  if (!hoerernAngehaengt)
  {
    try
    {
      lib.addEventListener('answerCall', ({ callUUID }) =>
      {
        const id = uuidZuId.get(String(callUUID).toLowerCase());
        if (id && beiAnnehmen) beiAnnehmen(id);
      });

      lib.addEventListener('endCall', ({ callUUID }) =>
      {
        const id = uuidZuId.get(String(callUUID).toLowerCase());
        if (id && beiBeenden) beiBeenden(id);
      });

      // Der entscheidende Haken: CallKit besitzt die Audiositzung und sagt
      // hier, dass sie bereitsteht. Erst jetzt darf der InCallManager starten.
      lib.addEventListener('didActivateAudioSession', () =>
      {
        if (beiAudioBereit) { try { beiAudioBereit(); } catch (e) { /* egal */ } }
      });

      lib.addEventListener('didDeactivateAudioSession', () =>
      {
        // Der Abbau erfolgt bereits beim Beenden des Gesprächs; hier ist
        // nichts weiter zu tun. Der Haken bleibt als Andockpunkt bestehen.
      });

      hoerernAngehaengt = true;
    } catch (e) { /* egal */ }
  }
  return eingerichtet;
}

/** Systemoberfläche für einen eingehenden Anruf zeigen. Mehrfach aufrufbar. */
export function eingehendenAnrufZeigen({ anrufId, name })
{
  if (!lib) return;
  const uuid = uuidFuerAnrufId(anrufId);
  if (uuidZuId.has(uuid)) return;   // klingelt bereits
  idZuUuid.set(anrufId, uuid);
  uuidZuId.set(uuid, anrufId);
  try { lib.displayIncomingCall(uuid, name, name, 'generic', false); }
  catch (e) { /* egal */ }
}

/** Ausgehenden Anruf anmelden, damit er in den Anruflisten auftaucht. */
export function ausgehendenAnrufMelden({ anrufId, name })
{
  if (!lib) return;
  if (idZuUuid.has(anrufId)) return;
  const uuid = uuidFuerAnrufId(anrufId);
  idZuUuid.set(anrufId, uuid);
  uuidZuId.set(uuid, anrufId);
  try { lib.startCall(uuid, name, name, 'generic', false); }
  catch (e) { /* egal */ }
}

/**
 * CallKit mitteilen, dass in der App angenommen wurde.
 *
 * Nötig, wenn der Nutzer den Anruf in unserer eigenen Oberfläche annimmt,
 * während CallKit ebenfalls klingelt: Vom Tippen in der App weiß das System
 * nichts. Erst diese Meldung lässt iOS die Audiositzung aktivieren.
 */
export function annehmenMelden(anrufId)
{
  if (!lib) return;
  const uuid = idZuUuid.get(anrufId);
  if (!uuid) return;
  try { lib.answerIncomingCall?.(uuid); } catch (e) { /* egal */ }
}

/** Gespräch als verbunden melden — die Systemanzeige springt auf „im Gespräch"
 *  und die Dauer beginnt zu laufen. */
export function verbundenMelden(anrufId)
{
  if (!lib) return;
  const uuid = idZuUuid.get(anrufId);
  if (!uuid) return;
  try { lib.setCurrentCallActive?.(uuid); } catch (e) { /* egal */ }
}

/** Halten/Fortsetzen an die Systemanzeige weitergeben. */
export function haltenMelden(anrufId, gehalten)
{
  if (!lib) return;
  const uuid = idZuUuid.get(anrufId);
  if (!uuid) return;
  try { lib.setOnHold?.(uuid, gehalten); } catch (e) { /* egal */ }
}

/** Stummschaltung an die Systemanzeige weitergeben. */
export function stummMelden(anrufId, stumm)
{
  if (!lib) return;
  const uuid = idZuUuid.get(anrufId);
  if (!uuid) return;
  try { lib.setMutedCall?.(uuid, stumm); } catch (e) { /* egal */ }
}

/** Von unserer Seite beenden — entfernt die Systemoberfläche. */
export function anrufBeendenMelden(anrufId, grund = 'normal')
{
  if (!lib) return;
  const uuid = idZuUuid.get(anrufId);
  if (!uuid) return;
  try
  {
    if (grund === 'verpasst' || grund === 'abgelehnt')
    {
      // CXCallEndedReason: 3 = unanswered, 6 = missed
      lib.reportEndCallWithUUID?.(uuid, grund === 'verpasst' ? 3 : 6);
    }
    else { lib.endCall(uuid); }
  } catch (e) { /* egal */ }
  idZuUuid.delete(anrufId);
  uuidZuId.delete(uuid);
}

/** Alles vergessen — beim Abmelden oder Trennen der Registrierung. */
export function callKitZuruecksetzen()
{
  idZuUuid.clear();
  uuidZuId.clear();
}

// ── Anruf-Kennung → UUID ────────────────────────────────────────────────
// Bewusst deterministisch: Dieselbe Kennung ergibt immer dieselbe UUID. Sobald
// in B5 der native PushKit-Teil dazukommt, meldet dieser das Gespräch an
// CallKit, noch bevor JavaScript läuft — beide Seiten müssen dann zwingend auf
// dieselbe UUID kommen, sonst läuft das Annehmen ins Leere.
// Die Berechnung ist byte-gleich zu KoroVoipUUID.stableUUID aus
// nexora-mobile/plugins/withVoipPushKit.js.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidFuerAnrufId(anrufId)
{
  const s = String(anrufId);
  if (UUID_RE.test(s)) return s.toLowerCase();

  // FNV-1a über die UTF-8-Bytes, auf 16 Byte gefaltet. BigInt bildet den
  // Überlauf von Swifts UInt64 exakt nach.
  const bytes = new Array(16).fill(0);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  const utf8 = utf8Bytes(s);
  for (let i = 0; i < utf8.length; i++)
  {
    hash = ((hash ^ BigInt(utf8[i])) * prime) & MASK;
    bytes[i % 16] ^= Number(hash & 0xffn);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${ hex.slice(0, 8) }-${ hex.slice(8, 12) }-${ hex.slice(12, 16) }-${ hex.slice(16, 20) }-${ hex.slice(20, 32) }`;
}

/** UTF-8 ohne TextEncoder — der ist in Hermes nicht garantiert vorhanden. */
function utf8Bytes(str)
{
  const out = [];
  for (let i = 0; i < str.length; i++)
  {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length)
    {
      const c2 = str.charCodeAt(++i);
      c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f),
               0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}

void Platform;
