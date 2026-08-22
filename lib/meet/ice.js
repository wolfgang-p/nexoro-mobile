import { API_URL, FALLBACK_ICE } from './env';
import { mintTurnServers } from './turn';

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
 * Reihenfolge der Quellen:
 *   1. nexora-api /meetings/:roomId/ice-servers — der reguläre Weg. Der Server
 *      mintet die Zugangsdaten, gebunden an einen echten Raum, sodass das
 *      Geheimnis nur an einer Stelle liegt.
 *   2. Direktes Minten bei Cloudflare mit den in der App hinterlegten
 *      Schlüsseln (siehe turn.js — dort steht die Abwägung dazu). Greift nur,
 *      wenn (1) nicht erreichbar ist.
 *   3. STUN allein. Funktioniert nur im selben Netz bzw. bei freundlichem NAT;
 *      der Raum blendet dann einen Warnhinweis ein.
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
        if (Array.isArray(list) && list.length && hasTurn(list)) return list;
        // Antwort ohne Relay (TURN serverseitig nicht konfiguriert) — unten
        // selbst minten, statt mit STUN-only weiterzumachen.
        if (Array.isArray(list) && list.length) return await withMintedTurn(list);
      }
    } catch (e)
    {
      console.warn('[meet-ice] API nicht erreichbar, minte selbst', e);
    }
  }

  return await withMintedTurn([...FALLBACK_ICE]);
}

/** STUN-Liste um selbst gemintete TURN-Server ergänzen, sofern möglich. */
async function withMintedTurn(base)
{
  const minted = await mintTurnServers();
  return minted ? [...base, ...minted] : base;
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
