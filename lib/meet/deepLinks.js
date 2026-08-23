import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';

/**
 * Universal Links auf Meeting-Räume abfangen.
 *
 * Ziel: Wer auf https://meet.nexoro.net/m/xyz tippt, landet in der App im
 * Beitritts-Ablauf statt im Browser. Registriert ist ausschließlich
 * meet.nexoro.net (app.json → associatedDomains bzw. intentFilters), andere
 * nexoro-Adressen bleiben bewusst beim Browser bzw. der WebView-Shell.
 *
 * Den KALTSTART übernimmt expo-router selbst: es bildet die eingehende URL auf
 * den Pfad `/m/<id>` ab, den die Route app/m/[roomId].js auf den Beitritts-
 * Ablauf umleitet. Dieser Hook darf dafür nicht zusätzlich navigieren, sonst
 * lägen zwei Einträge übereinander im Verlauf.
 *
 * Er kümmert sich nur um den zweiten Fall: ein Link, der eintrifft, während die
 * App bereits läuft. Den reicht der Router nicht mehr durch seine Startlogik.
 */

const HOST = 'meet.nexoro.net';

/** Raum-ID aus einer URL ziehen. Null, wenn es kein Meeting-Link ist. */
export function parseMeetingUrl(url)
{
  if (!url) return null;
  try
  {
    const u = new URL(url);
    if (u.hostname.toLowerCase() !== HOST) return null;
    // /m/<roomId> — alles Weitere (z. B. /analysis) ist kein Beitritts-Link.
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length !== 2 || segs[0] !== 'm') return null;
    return decodeURIComponent(segs[1]) || null;
  } catch (e)
  {
    return null;
  }
}

export function useMeetingDeepLinks()
{
  const router = useRouter();

  useEffect(() =>
  {
    // Nur Links, die eintreffen, WÄHREND die App läuft. Der Kaltstart läuft
    // über app/m/[roomId].js — siehe oben.
    const sub = Linking.addEventListener('url', (e) =>
    {
      const roomId = parseMeetingUrl(e.url);
      if (!roomId) return;
      router.push(`/meet/join/${ encodeURIComponent(roomId) }`);
    });
    return () => sub.remove();
  }, [router]);
}
