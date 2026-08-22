import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Lokale Meeting-Historie ("zuletzt besuchte Räume").
 *
 * Gäste haben serverseitig bewusst keinen Meeting-Index — aus Datenschutz-
 * gründen wird keine geräte-bezogene Historie geführt. Ohne diese lokale Spur
 * wäre die Übersicht in der App also leer. Genau wie im Browser
 * (koro-meet/src/lib/history.ts) halten wir daher einen kleinen Cache der
 * Räume, die dieses Gerät geöffnet hat.
 *
 * Rein lokal, nie an den Server geschickt, nach Raum-ID dedupliziert,
 * neueste zuerst, gedeckelt.
 */

const KEY = 'nexoro.meet.history.v1';
const CAP = 20;

export async function getRoomHistory()
{
  try
  {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v) => v && typeof v.roomId === 'string')
      .sort((a, b) => b.lastVisited - a.lastVisited);
  } catch (e)
  {
    return [];
  }
}

export async function recordRoomVisit(v)
{
  if (!v?.roomId) return;
  try
  {
    const list = await getRoomHistory();
    const prev = list.find((x) => x.roomId === v.roomId);
    const entry = {
      roomId: v.roomId,
      title: (v.title || '').trim() || prev?.title || `Raum ${ v.roomId }`,
      host: v.host ?? prev?.host ?? null,
      scheduledAt: v.scheduledAt ?? prev?.scheduledAt ?? null,
      lastVisited: Date.now(),
      created: v.created ?? prev?.created ?? false,
    };
    const next = [entry, ...list.filter((x) => x.roomId !== v.roomId)].slice(0, CAP);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch (e)
  {
    console.warn('[meet-history] speichern fehlgeschlagen', e);
  }
}

export async function removeRoomVisit(roomId)
{
  try
  {
    const list = await getRoomHistory();
    await AsyncStorage.setItem(KEY, JSON.stringify(list.filter((x) => x.roomId !== roomId)));
  } catch (e) { /* egal */ }
}

export async function clearRoomHistory()
{
  try
  {
    await AsyncStorage.removeItem(KEY);
  } catch (e) { /* egal */ }
}
