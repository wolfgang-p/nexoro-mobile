/**
 * TURN-Zugangsdaten direkt in der App (Cloudflare Realtime).
 *
 * ACHTUNG — bewusste Abwägung, auf ausdrücklichen Wunsch eingebaut:
 * Diese Schlüssel liegen im App-Bundle und lassen sich daraus auslesen. Wer
 * sie extrahiert, kann auf Kosten dieses Cloudflare-Kontos beliebigen
 * Relay-Verkehr erzeugen. Der reguläre Weg ist deshalb weiterhin der erste:
 * `getIceServers()` fragt zuerst die API (/meetings/:roomId/ice-servers), die
 * dieselben Zugangsdaten serverseitig und raumgebunden mintet.
 *
 * Diese Datei greift nur, wenn dieser Aufruf scheitert — schlechtes Netz,
 * API nicht erreichbar, Raum noch nicht angelegt. Ohne Relay bliebe sonst nur
 * STUN, und hinter Carrier-Grade-NAT (praktisch jedes Mobilfunknetz) scheitert
 * die Verbindung dann lautlos: schwarzes Bild, kein Ton, in beide Richtungen.
 *
 * Wenn diese Schlüssel je rotiert werden, muss diese Datei mitgeändert und die
 * App neu ausgeliefert werden — anders als bei den serverseitig geminteten,
 * die sofort überall wirken.
 */

const TURN_KEY_ID = '134339e4f950b78b791414d4e788ed88';
const TURN_TOKEN = '7129b044596182ada5b6517e040d98738d258c1eb85db4094cf1fa2f76b6972a';

/** Gültigkeit der geminteten Zugangsdaten. Länger als jedes Meeting. */
const TTL_SECONDS = 86400;

// Einmal geminteteZugangsdaten für die Sitzung behalten: ein zweiter Beitritt
// soll nicht erneut bei Cloudflare anfragen.
let cached = null;
let cachedAt = 0;

/**
 * Kurzlebige TURN-Zugangsdaten bei Cloudflare anfordern.
 * Gibt null zurück, wenn das fehlschlägt — der Aufrufer fällt dann auf STUN
 * zurück und zeigt den entsprechenden Hinweis im Raum an.
 */
export async function mintTurnServers()
{
  // Zwischenspeicher noch frisch? (halbe TTL als Sicherheitsabstand)
  if (cached && Date.now() - cachedAt < (TTL_SECONDS * 500)) return cached;

  try
  {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${ TURN_KEY_ID }/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ TURN_TOKEN }`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
      },
    );
    if (!res.ok)
    {
      console.warn('[turn] Cloudflare antwortete mit', res.status);
      return null;
    }
    const data = await res.json();
    // Cloudflare liefert iceServers je nach Fall als Objekt oder als Liste.
    const list = data?.iceServers
      ? (Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers])
      : [];
    if (!list.length) return null;

    cached = list;
    cachedAt = Date.now();
    return list;
  } catch (err)
  {
    console.warn('[turn] Minten fehlgeschlagen', err);
    return null;
  }
}
