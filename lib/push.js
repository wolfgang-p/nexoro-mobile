import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Push-Benachrichtigungen für die Nexoro-App.
 *
 * Die App hat keinen eigenen Login — der Nutzer ist ausschließlich über das
 * Session-Cookie der WebView angemeldet, an das nativer Code nicht herankommt.
 * Deshalb schickt dieses Modul den Token NICHT selbst an den Server, sondern
 * reicht ihn über die WebView-Brücke an die bereits eingeloggte Seite weiter;
 * die ruft damit notifications/backend.php mit ihrer Session auf. So braucht es
 * keinen zweiten Anmeldeweg und keine Geheimnisse in der App.
 *
 * Die Geräte-Kennung ist bewusst von der Instanz entkoppelt: dasselbe Gerät
 * kann bei mehreren Instanzen gleichzeitig registriert sein (der Nutzer ist
 * dort ja jeweils angemeldet). Abgemeldet wird immer gezielt bei genau einer.
 */

const DEVICE_ID_KEY = 'nexoro.push.device_id.v1';

let cachedDeviceId = null;
let cachedToken = null;

/**
 * Stabile Installations-Kennung. Muss App-Neustarts überleben, sonst entstünde
 * bei jedem Start ein neuer Eintrag und der Nutzer bekäme Meldungen mehrfach.
 */
export async function getDeviceId()
{
  if (cachedDeviceId) return cachedDeviceId;
  try
  {
    let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (!id)
    {
      id = Crypto.randomUUID();
      await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    }
    cachedDeviceId = id;
    return id;
  } catch (e)
  {
    // Ohne Speicher kein stabiler Wert — dann lieber gar keine Registrierung
    // als eine, die sich bei jedem Start verdoppelt.
    return null;
  }
}

/** Anzeigename des Geräts, rein informativ für die Geräteliste. */
function deviceLabel()
{
  const name = Device.deviceName || Device.modelName || '';
  return name ? String(name).slice(0, 120) : null;
}

/**
 * Berechtigung anfragen und Expo-Token holen.
 *
 * Fragt aktiv nach der Erlaubnis: anders als bei Koro gibt es hier keinen
 * Onboarding-Schritt, an dem das sonst passieren würde. Gibt null zurück, wenn
 * der Nutzer ablehnt, das Gerät keine Pushes kann (Simulator) oder etwas
 * schiefgeht — der Aufrufer behandelt das als "kein Push", nicht als Fehler.
 */
export async function getPushToken()
{
  if (cachedToken) return cachedToken;
  // Simulatoren bekommen keine echten Tokens.
  if (!Device.isDevice) return null;

  try
  {
    if (Platform.OS === 'android')
    {
      // Ohne Kanal zeigt Android 8+ keine Meldung an.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Benachrichtigungen',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: 'default',
        enableVibrate: true,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.status === 'granted';
    if (!granted)
    {
      const asked = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      granted = asked.status === 'granted';
    }
    if (!granted) return null;

    // projectId ist im Release-Build erforderlich, sonst weiß Expo nicht,
    // für welches Projekt der Token gilt.
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const res = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();

    cachedToken = res?.data || null;
    return cachedToken;
  } catch (err)
  {
    console.warn('[push] Token konnte nicht ermittelt werden', err);
    return null;
  }
}

/**
 * JavaScript, das in die WebView injiziert wird, um den Token an die
 * eingeloggte Seite zu übergeben.
 *
 * Die Seite entscheidet selbst, ob sie ihn annimmt: Ist niemand angemeldet,
 * antwortet das Backend mit 401 und es passiert schlicht nichts. Sobald sich
 * der Nutzer anmeldet, wird der Token beim nächsten Seitenaufruf erneut
 * angeboten — deshalb ist das Einspielen bewusst idempotent.
 */
export function buildRegisterScript(token, deviceId, appVersion)
{
  const payload = JSON.stringify({
    device_id: deviceId,
    push_token: token,
    platform: Platform.OS,
    app_version: appVersion || null,
    device_name: deviceLabel(),
  });

  return `
(function() {
  try {
    if (!window.NEXORO_NATIVE) return;
    var payload = ${ payload };
    // Geraete-ID fuer die Seite hinterlegen: der Logout-Handler in
    // includes/menu.php meldet das Geraet damit ab, BEVOR die Session zerstoert
    // wird. Danach waere kein authentifizierter Aufruf mehr moeglich.
    try { if (window.localStorage) localStorage.setItem('nexoro_push_device_id', payload.device_id); } catch (e) {}
    // Merken, was zuletzt erfolgreich gemeldet wurde: bei jeder Navigation
    // innerhalb der Instanz laeuft dieses Skript erneut, ein erneuter Aufruf
    // waere aber sinnlose Last.
    var mark = 'nexoro_push_' + payload.device_id + '_' + payload.push_token;
    if (window.sessionStorage && sessionStorage.getItem(mark) === 'ok') return;

    fetch('/notifications/backend.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: 'register_push_device' }, payload))
    })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(d) {
      if (d && d.success && window.sessionStorage) sessionStorage.setItem(mark, 'ok');
    })
    .catch(function() { /* offline oder abgemeldet - beim naechsten Mal erneut */ });
  } catch (e) {}
})();
true;
`;
}

/**
 * JavaScript zum Abmelden des Geräts bei EINER Instanz.
 *
 * Wird beim Abmelden und vor dem Entfernen einer Instanz eingespielt. Ohne das
 * bekäme der vorherige Nutzer weiterhin Meldungen auf ein Gerät, das ihm nicht
 * mehr gehört.
 */
export function buildUnregisterScript(deviceId)
{
  return `
(function() {
  try {
    fetch('/notifications/backend.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unregister_push_device', device_id: ${ JSON.stringify(deviceId) } })
    }).catch(function() {});
    if (window.sessionStorage) {
      // Merker loeschen, damit eine erneute Anmeldung wieder registriert.
      Object.keys(sessionStorage).forEach(function(k) {
        if (k.indexOf('nexoro_push_') === 0) sessionStorage.removeItem(k);
      });
    }
  } catch (e) {}
})();
true;
`;
}

/**
 * Anzeigeverhalten im Vordergrund. Ohne das bliebe eine eintreffende Meldung
 * unsichtbar, solange die App offen ist — verwirrend beim Testen.
 */
export function configureForegroundHandler()
{
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}
