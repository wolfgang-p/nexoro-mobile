import { Platform } from 'react-native';

import { phoneManager } from './phoneManager';
import { holeSipZugang } from './sipZugang';
import { callKitEinrichten, eingehendenAnrufZeigen } from './callKit';

/**
 * VoIP-Push (Apple PushKit) — Klingeln, wenn die App beendet ist.
 *
 * Ohne das klingelt Nexoro nur, solange die App läuft oder kürzlich lief: iOS
 * friert das JavaScript im Hintergrund ein, der WebSocket stirbt, und die
 * SIP-Registrierung läuft nach spätestens zwei Minuten ab. Der Asterisk kennt
 * die App dann nicht mehr.
 *
 * PushKit ist der einzige Weg, auf dem iOS eine **beendete** App für einen
 * Anruf startet. Der normale Expo-Push weckt nur eine App, die noch im
 * Hintergrund liegt — für einen klingelnden Anruf zu wenig.
 *
 * Ablauf:
 *   1. iOS liefert uns einen VoIP-Token (eigener Token, NICHT der Expo-Push-Token)
 *   2. Wir hinterlegen ihn im CRM, zusammen mit unserer Nebenstelle
 *   3. Bei einem Anruf schickt der Server einen VoIP-Push
 *   4. iOS startet die App, wir zeigen sofort CallKit und melden uns per SIP an
 *
 * Punkt 4 ist zeitkritisch: Apple verlangt, dass nach einem VoIP-Push
 * UNVERZÜGLICH ein Anruf angezeigt wird. Wer das versäumt, dessen App wird
 * beendet und bekommt künftig keine VoIP-Pushes mehr. Deshalb zeigt der native
 * Teil (plugins/withVoipPushKit.js) den Anruf bereits an, bevor JavaScript
 * überhaupt läuft.
 */

// Weicher Import: Ohne nativen Build gibt es das Modul nicht.
const VOIP_MODUL = 'react-native-voip-push-notification';
let VoipPush = null;
try { VoipPush = require(VOIP_MODUL).default || require(VOIP_MODUL); }
catch (e) { /* kein nativer Build */ }

let gestartet = false;
let letzterToken = null;
let tokenHinterlegt = false;

export function voipVerfuegbar()
{
  return Platform.OS === 'ios' && !!VoipPush;
}

/** Nur für die Diagnose — was ist der aktuelle Stand? */
export function voipStatus()
{
  return {
    verfuegbar: voipVerfuegbar(),
    gestartet,
    token: letzterToken ? `${ letzterToken.slice(0, 8) }…` : null,
    hinterlegt: tokenHinterlegt,
  };
}

/**
 * Token im CRM hinterlegen.
 *
 * Ausweis sind die SIP-Zugangsdaten, die die App über den Einmal-Schein
 * bekommen hat — dieselbe Absicherung wie beim Speichern einer Notiz. Einen
 * eigenen Login hat die App nicht.
 */
async function tokenHinterlegen(token)
{
  if (!token) return;
  const zugang = await holeSipZugang();
  if (!zugang?.basisUrl)
  {
    // Noch keine Zugangsdaten — beim nächsten App-Start erneut versuchen.
    console.log('[voip] Token da, aber noch keine Zugangsdaten');
    return;
  }

  try
  {
    const antwort = await fetch(`${ zugang.basisUrl }/telefonie/backend.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        action: 'register_voip_token',
        voip_token: token,
        sip_user: zugang.benutzer,
        sip_secret: zugang.passwort,
      }).toString(),
    });
    const daten = antwort.ok ? await antwort.json() : null;
    tokenHinterlegt = !!daten?.success;
    console.log(`[voip] Token hinterlegt: ${ tokenHinterlegt }`);
  } catch (err)
  {
    console.warn('[voip] Token konnte nicht hinterlegt werden', err);
  }
}

/**
 * Ein VoIP-Push ist eingetroffen.
 *
 * Wichtig: CallKit wurde nativ bereits angezeigt (siehe Plugin). Hier holen
 * wir nur nach, was JavaScript beitragen muss — die SIP-Registrierung, damit
 * das eigentliche INVITE ankommt und angenommen werden kann.
 */
async function eingehenderPush(nutzlast)
{
  const anrufId = nutzlast?.call_id || `voip-${ Date.now() }`;
  const wer = nutzlast?.from_name || nutzlast?.from || 'Unbekannt';
  console.log(`[voip] Push für Anruf ${ anrufId } von ${ wer }`);

  // Falls der native Teil nicht zum Zug kam (z. B. App lief im Hintergrund),
  // hier nachziehen. eingehendenAnrufZeigen() ist gegen Doppelanzeige
  // geschützt.
  eingehendenAnrufZeigen({ anrufId, name: wer });

  // Jetzt schnellstmöglich anmelden, damit das INVITE des Asterisk ankommt.
  // Ohne das klingelt CallKit zwar, aber das Annehmen liefe ins Leere.
  try
  {
    const zugang = await holeSipZugang();
    if (zugang) phoneManager.verbinden(zugang);
  } catch (err) { console.warn('[voip] Anmelden nach Push fehlgeschlagen', err); }
}

/**
 * Einmalig beim App-Start aufrufen.
 *
 * Muss FRÜH laufen — bei einem Kaltstart durch einen VoIP-Push liegen die
 * Ereignisse bereits zwischengespeichert vor und werden über
 * `didLoadWithEvents` nachgereicht.
 */
export function voipPushStarten()
{
  if (!voipVerfuegbar())
  {
    if (Platform.OS === 'ios')
    {
      console.warn('[voip] PushKit fehlt in diesem Build — Klingeln bei '
        + 'beendeter App nicht möglich. Neu bauen mit dem Plugin withVoipPushKit.');
    }
    return;
  }
  if (gestartet) return;
  gestartet = true;

  // CallKit verdrahten, bevor der erste Push eintreffen kann. Bei einem
  // Kaltstart durch einen Anruf läuft das hier VOR dem Telefon-Bildschirm.
  callKitEinrichten({
    onAnnehmen: () => phoneManager.annehmen(),
    onBeenden: () => phoneManager.auflegen(),
    onAudioBereit: () => { /* phoneManager startet das Audio selbst */ },
  });

  try
  {
    VoipPush.addEventListener('register', (token) =>
    {
      console.log(`[voip] Token erhalten: ${ String(token).slice(0, 8) }…`);
      letzterToken = token;
      tokenHinterlegt = false;
      tokenHinterlegen(token);
    });

    VoipPush.addEventListener('notification', (meldung) =>
    {
      const nutzlast = meldung || {};
      eingehenderPush(nutzlast);
      // iOS mitteilen, dass wir fertig sind. Bleibt das aus, beendet das
      // System die App.
      try { VoipPush.onVoipNotificationCompleted?.(nutzlast.call_id || ''); }
      catch (e) { /* egal */ }
    });

    // Ereignisse, die vor dem Start von JavaScript eintrafen (Kaltstart durch
    // einen Anruf). Ohne das ginge der erste Push nach dem Start verloren.
    VoipPush.addEventListener('didLoadWithEvents', (ereignisse) =>
    {
      if (!Array.isArray(ereignisse)) return;
      console.log(`[voip] ${ ereignisse.length } zwischengespeicherte Ereignisse`);
      for (const e of ereignisse)
      {
        if (e?.name === 'RNVoipPushRemoteNotificationsRegisteredEvent'
            && typeof e.data === 'string')
        {
          letzterToken = e.data;
          tokenHinterlegen(e.data);
        }
        else if (e?.name === 'RNVoipPushRemoteNotificationReceivedEvent' && e.data)
        {
          eingehenderPush(e.data);
          try { VoipPush.onVoipNotificationCompleted?.(e.data.call_id || ''); }
          catch (err) { /* egal */ }
        }
      }
    });

    VoipPush.registerVoipToken();
  } catch (err) { console.warn('[voip] Start fehlgeschlagen', err); }
}

/**
 * Nachreichen, sobald Zugangsdaten vorliegen.
 *
 * Der Token kommt oft, bevor die WebView den Einmal-Schein durchgereicht hat.
 * Diese Funktion wird aufgerufen, wenn die Zugangsdaten eintreffen.
 */
export function voipTokenNachreichen()
{
  if (letzterToken && !tokenHinterlegt) tokenHinterlegen(letzterToken);
}
