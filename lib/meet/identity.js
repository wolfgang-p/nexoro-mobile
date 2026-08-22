import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

/**
 * Lokale Identität für Meetings.
 *
 * In der App gibt es (anders als im Browser) nur den Gast-Modus: der Nutzer ist
 * bereits über die Instanz-WebView im CRM angemeldet, aber dieses Login ist ein
 * Cookie der WebView und kein Koro-Access-Token — an das kommt der native Code
 * nicht heran. Die API akzeptiert Gäste auf allen /meetings-Endpoints über den
 * `x-koro-meet-device`-Header, also reicht das vollständig aus.
 *
 * `device_id` ist der Schlüssel, unter dem die Teilnahme serverseitig geführt
 * wird UND das Ziel für WS-Signaling. Sie muss über App-Starts hinweg stabil
 * bleiben, sonst erscheint derselbe Nutzer nach einem Reconnect als zweiter
 * Teilnehmer.
 */

const KEY = 'nexoro.meet.identity.v1';

let cached = null;

function uuid()
{
  return Crypto.randomUUID();
}

/** Identität laden (Cache, dann Storage). Null, wenn noch keine gesetzt ist. */
export async function getIdentity()
{
  if (cached) return cached;
  try
  {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.device_id) return null;
    cached = parsed;
    return cached;
  } catch (e)
  {
    return null;
  }
}

export async function setIdentity(id)
{
  cached = id;
  try
  {
    await AsyncStorage.setItem(KEY, JSON.stringify(id));
  } catch (e)
  {
    console.warn('[meet-identity] persist failed', e);
  }
}

/**
 * Anzeigenamen setzen und dabei die vorhandene device_id behalten. Genau das
 * ist der Grund, warum das hier nicht einfach ein neues Objekt baut: eine neue
 * device_id würde die laufende Teilnahme abreißen lassen.
 */
export async function setDisplayName(displayName, avatarUrl)
{
  const existing = await getIdentity();
  const id = {
    kind: 'guest',
    device_id: existing?.device_id || uuid(),
    display_name: (displayName || '').trim().slice(0, 64) || 'Gast',
    avatar_url: avatarUrl ?? existing?.avatar_url ?? null,
  };
  await setIdentity(id);
  return id;
}

/**
 * Identität garantiert vorhanden machen. Legt beim ersten Aufruf eine mit
 * Platzhalternamen an — den echten Namen fragt der Join-Flow ab.
 */
export async function ensureIdentity()
{
  const existing = await getIdentity();
  if (existing) return existing;
  return await setDisplayName('Gast');
}

export async function clearIdentity()
{
  cached = null;
  try
  {
    await AsyncStorage.removeItem(KEY);
  } catch (e) { /* egal */ }
}
