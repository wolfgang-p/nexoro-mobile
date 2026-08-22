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
 * Zwei Wege, beide nötig:
 *   • getInitialURL — App war zu und wird durch den Link gestartet
 *   • addEventListener — App lief schon im Hintergrund
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
    let handled = false;

    const open = (url) =>
    {
      const roomId = parseMeetingUrl(url);
      if (!roomId) return;
      router.push(`/meet/join/${ encodeURIComponent(roomId) }`);
    };

    // Kaltstart über den Link.
    Linking.getInitialURL()
      .then((url) =>
      {
        if (url && !handled) { handled = true; open(url); }
      })
      .catch(() => {});

    // Link, während die App bereits läuft.
    const sub = Linking.addEventListener('url', (e) => open(e.url));
    return () => sub.remove();
  }, [router]);
}
