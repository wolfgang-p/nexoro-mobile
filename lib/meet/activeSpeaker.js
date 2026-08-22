import { useEffect, useRef, useState } from 'react';

/**
 * Aktive Sprecher erkennen.
 *
 * Im Browser macht koro-meet das über die Web Audio API (AnalyserNode + RMS).
 * Die gibt es in React Native nicht. Nativ liefert stattdessen `getStats()` den
 * Wert `audioLevel` (0..1) pro eingehendem Audio-Stream — derselbe Messwert,
 * nur vom WebRTC-Kern statt aus einem eigenen Analyser.
 *
 * Ein Teilnehmer gilt als sprechend, solange sein Pegel über der Schwelle
 * liegt, mit kurzer Nachlaufzeit, damit die Anzeige nicht zwischen Silben
 * flackert.
 *
 * Das Ergebnis steuert, welche vier Kacheln das Grid zeigt: die aktuell
 * Sprechenden, aufgefüllt mit den zuletzt Aktiven.
 */

const SPEAKING_LEVEL = 0.02;
const RELEASE_MS = 900;
const POLL_MS = 400;

/**
 * @param mesh   PeerMesh-Instanz (oder null)
 * @param remotes Map<deviceId, RemoteState> — Auslöser für Neuaufbau
 * @returns { speaking: Set<deviceId>, lastSpokeAt: Record<deviceId, number> }
 */
export function useActiveSpeakers(mesh, remotes)
{
  const [speaking, setSpeaking] = useState(() => new Set());
  // Zeitstempel überleben Re-Renders: daraus leitet das Grid die Reihenfolge
  // "zuletzt gesprochen" ab, wenn gerade niemand spricht.
  const lastSpokeRef = useRef({});
  const lastAboveRef = useRef({});

  const keys = Array.from(remotes?.keys?.() || []).sort().join('|');

  useEffect(() =>
  {
    if (!mesh) return undefined;
    let cancelled = false;
    let timer = null;

    const tick = async () =>
    {
      if (cancelled) return;
      const now = Date.now();
      const active = new Set();

      for (const [deviceId, peer] of mesh.peers)
      {
        try
        {
          const stats = await peer.pc.getStats();
          let level = 0;
          stats.forEach((report) =>
          {
            // `audioLevel` steht am inbound-rtp-Report des Audio-Tracks; je
            // nach Plattform auch am media-source/track-Report.
            if (typeof report.audioLevel === 'number' && report.audioLevel > level)
            {
              level = report.audioLevel;
            }
          });
          if (level > SPEAKING_LEVEL)
          {
            lastAboveRef.current[deviceId] = now;
            lastSpokeRef.current[deviceId] = now;
          }
          if (now - (lastAboveRef.current[deviceId] || 0) < RELEASE_MS) active.add(deviceId);
        } catch (e) { /* Peer gerade im Abbau — überspringen */ }
      }

      if (!cancelled)
      {
        setSpeaking((prev) => (sameSet(prev, active) ? prev : active));
        timer = setTimeout(tick, POLL_MS);
      }
    };

    timer = setTimeout(tick, POLL_MS);
    return () =>
    {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [mesh, keys]);

  return { speaking, lastSpokeAt: lastSpokeRef.current };
}

function sameSet(a, b)
{
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

/**
 * Die sichtbaren Kacheln bestimmen: maximal `limit` Stück, priorisiert nach
 * aktuell sprechend → zuletzt gesprochen → Host → Rest. So bleiben genau die
 * Personen im Bild, die reden oder zuletzt geredet haben.
 */
export function pickVisible(remotes, speaking, lastSpokeAt, limit = 4)
{
  const list = Array.from(remotes.values());
  return list
    .slice()
    .sort((a, b) =>
    {
      const aSpeak = speaking.has(a.device_id) ? 1 : 0;
      const bSpeak = speaking.has(b.device_id) ? 1 : 0;
      if (aSpeak !== bSpeak) return bSpeak - aSpeak;

      const aLast = lastSpokeAt[a.device_id] || 0;
      const bLast = lastSpokeAt[b.device_id] || 0;
      if (aLast !== bLast) return bLast - aLast;

      if (a.is_host !== b.is_host) return a.is_host ? -1 : 1;
      return (a.display_name || '').localeCompare(b.display_name || '');
    })
    .slice(0, limit);
}
