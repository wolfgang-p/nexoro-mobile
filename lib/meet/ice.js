import { API_URL, FALLBACK_ICE } from './env';

/**
 * ICE-Server für den Mesh auflösen.
 *
 * Auf Mobilfunk ist TURN keine Optimierung, sondern Voraussetzung: hinter
 * symmetrischem NAT (Carrier-Grade-NAT, praktisch jedes Mobilfunknetz) gibt es
 * keinen direkten Peer-to-Peer-Pfad. Ohne Relay scheitert die Verbindung
 * lautlos — der Teilnehmer sieht und hört niemanden und wird selbst nicht
 * gesehen. Genau das Symptom, das im Browser schon aufgetreten ist
 * (siehe Memory "Meet TURN required").
 *
 * Die API mintet die Credentials selbst, gebunden an einen echten Raum, damit
 * das TURN-Secret nur an einer Stelle liegt und nicht als offener Minting-
 * Endpunkt missbraucht werden kann.
 */
export async function getIceServers(roomId)
{
  if (roomId)
  {
    try
    {
      const res = await fetch(
        `${ API_URL }/meetings/${ encodeURIComponent(roomId) }/ice-servers`,
        { headers: { Accept: 'application/json' } },
      );
      if (res.ok)
      {
        const data = await res.json();
        // Die API antwortet mit `ice_servers`; `iceServers` zur Sicherheit auch.
        const list = data?.ice_servers ?? data?.iceServers;
        if (Array.isArray(list) && list.length) return list;
      }
    } catch (e)
    {
      console.warn('[meet-ice] Abruf fehlgeschlagen, nutze STUN-Fallback', e);
    }
  }
  return FALLBACK_ICE;
}

/**
 * Sagt, ob die Liste einen echten Relay enthält. Der Meeting-Raum blendet
 * damit einen Hinweis ein, wenn nur STUN verfügbar ist — dann ist ein
 * Verbindungsfehler im Mobilfunknetz zu erwarten und der Nutzer weiß, warum.
 */
export function hasTurn(iceServers)
{
  return (iceServers || []).some((s) =>
  {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.some((u) => typeof u === 'string' && u.startsWith('turn'));
  });
}
