import { useLocalSearchParams, Redirect } from 'expo-router';

/**
 * Auffangroute für Meeting-Links.
 *
 * Ein Universal Link auf https://meet.nexoro.net/m/<id> reicht expo-router den
 * Pfad `/m/<id>` durch. Ohne diese Datei findet der Router dafür keine Route
 * und legt eine "Unmatched Route"-Seite auf den Stapel — sichtbar, sobald der
 * Nutzer aus dem Meeting zurückwischt.
 *
 * Die Route bildet den Pfad daher direkt auf den Beitritts-Ablauf ab. Als
 * <Redirect> statt router.push, damit sie sich im Verlauf ERSETZT statt
 * darüberzulegen: Zurückwischen führt dann in die Nexoro-Ansicht und nicht auf
 * eine leere Zwischenseite.
 */
export default function MeetingLinkRedirect()
{
  const { roomId } = useLocalSearchParams();
  const id = Array.isArray(roomId) ? roomId[0] : roomId;
  if (!id) return <Redirect href="/meet" />;
  return <Redirect href={`/meet/join/${ encodeURIComponent(id) }`} />;
}
