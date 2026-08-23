import { registerGlobals } from 'react-native-webrtc';

/**
 * Bereitet die Laufzeitumgebung für JsSIP vor.
 *
 * MUSS importiert werden, BEVOR `jssip` zum ersten Mal geladen wird — sonst
 * findet die Bibliothek beim Initialisieren die WebRTC-Symbole nicht.
 *
 * Zwei Dinge passieren hier:
 *
 * 1. registerGlobals() legt RTCPeerConnection, RTCSessionDescription,
 *    MediaStream und navigator.mediaDevices global ab. JsSIP greift an genau
 *    zwei Stellen auf `window.RTCPeerConnection` zu (RTCSession.js:232 und
 *    UA.js:527) — in React Native ist `window === global`, also greift das.
 *
 * 2. Ein Polyfill für `unescape`. JsSIP nutzt es in Utils.js:5, um die Länge
 *    einer UTF-8-Zeichenkette zu bestimmen. Die Funktion ist ein Altbestand aus
 *    frühen JavaScript-Zeiten und in Hermes nicht garantiert vorhanden. Fehlt
 *    sie, bricht schon der erste SIP-Nachrichtenaufbau ab.
 */

registerGlobals();

// Minimaler Ersatz für die veraltete Funktion `unescape`. Sie wandelt
// %XX-Folgen zurück in Zeichen — mehr braucht JsSIP davon nicht.
if (typeof global.unescape !== 'function')
{
  global.unescape = function (str)
  {
    return String(str).replace(/%([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)));
  };
}

/** Kurzer Bericht, was tatsächlich verfügbar ist — für die Diagnose in B1. */
export function umgebungsBericht()
{
  return {
    RTCPeerConnection: typeof global.RTCPeerConnection,
    RTCSessionDescription: typeof global.RTCSessionDescription,
    mediaDevices: typeof global.navigator?.mediaDevices,
    WebSocket: typeof global.WebSocket,
    TextDecoder: typeof global.TextDecoder,
    unescape: typeof global.unescape,
  };
}
