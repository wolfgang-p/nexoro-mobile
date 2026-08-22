/**
 * Zentrale Endpunkte für die native Meeting-Integration.
 *
 * Die App spricht dieselbe nexora-api wie koro-meet im Browser — HTTP für die
 * /meetings-Endpoints, WebSocket für das Signaling. Beide sind öffentlich; die
 * Authentifizierung läuft pro Request (Bearer-Token bzw. Gast-Device-Header),
 * nicht über die URL.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Produktions-API. Identisch zu dem, was koro-meet im Browser benutzt
 * (NEXT_PUBLIC_KORO_API_URL in den Vercel-Envs) und zu PROD_API_URL in
 * nexora-mobile — dieselbe Instanz, dieselben /meetings-Endpoints.
 */
const PROD_API_URL = 'https://api.koro.chat:3001';

function stripTrailingSlash(s)
{
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

/**
 * Basis-URL auflösen. Reihenfolge:
 *   1. EXPO_PUBLIC_API_URL (.env / eas.json)
 *   2. nur im Dev-Build: IP des Expo-Dev-Servers, Port 3001
 *   3. nur im Dev-Build: localhost bzw. 10.0.2.2 (Android-Emulator)
 *   4. Release: die fest eingebaute Produktions-URL
 *
 * Die Dev-Erkennung greift bewusst nur unter __DEV__: im Release-Build ist
 * hostUri undefiniert und "localhost" wäre das Telefon selbst.
 */
function resolveApiUrl()
{
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return stripTrailingSlash(fromEnv);

  if (__DEV__)
  {
    const host =
      Constants.expoConfig?.hostUri ||
      Constants.manifest2?.extra?.expoClient?.hostUri ||
      Constants.manifest?.debuggerHost;
    if (host && typeof host === 'string')
    {
      const ip = host.split(':')[0];
      if (ip && ip !== 'localhost' && ip !== '127.0.0.1')
      {
        const isSimulator = !Constants.deviceName || Constants.deviceName.includes('Simulator');
        if (isSimulator)
        {
          return Platform.OS === 'android' ? 'http://10.0.2.2:3001' : 'http://localhost:3001';
        }
        return `http://${ ip }:3001`;
      }
    }
    return Platform.OS === 'android' ? 'http://10.0.2.2:3001' : 'http://localhost:3001';
  }

  return PROD_API_URL;
}

export const API_URL = resolveApiUrl();

/**
 * Die API akzeptiert WebSocket-Upgrades ausschließlich auf dem Pfad `/ws`
 * (nexora-api/src/ws/server.js). Fehlt der Suffix, verwirft der Server den
 * Upgrade kommentarlos — deshalb hier fest angehängt statt geraten.
 */
export const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws';

/** Basis der Web-App. Nur noch für Links nach draußen (Zusammenfassungen). */
export const MEET_WEB_URL = 'https://meet.nexoro.net';

/**
 * Fallback-ICE-Server. Im Normalfall liefert die API unter
 * /meetings/:roomId/ice-servers echte TURN-Credentials — ohne TURN scheitert
 * die Verbindung in Mobilfunknetzen (Carrier-Grade-NAT) lautlos, weil dort kein
 * direkter Peer-to-Peer-Pfad existiert. STUN allein reicht nur im WLAN.
 */
export const FALLBACK_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
