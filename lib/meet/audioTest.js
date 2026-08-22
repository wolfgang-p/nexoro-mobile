import { useEffect, useRef, useState } from 'react';
import { RTCPeerConnection } from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';

/**
 * Mikrofon-Pegel für den "Ton testen"-Schritt vor dem Beitritt.
 *
 * Im Browser liest koro-meet den Pegel über einen AnalyserNode der Web Audio
 * API. Die gibt es in React Native nicht, und `MediaStreamTrack` allein liefert
 * keinen Pegel.
 *
 * Der native Weg: den lokalen Track durch ein kurzgeschlossenes Paar von
 * PeerConnections schicken (nur lokal, kein Netzwerk, kein ICE-Server) und den
 * `audioLevel` aus `getStats()` der empfangenden Seite lesen. Genau derselbe
 * Messwert, den auch die Sprechererkennung im Meeting nutzt — nur eben schon
 * vor dem Beitritt verfügbar.
 *
 * Gibt einen geglätteten Wert 0..1 zurück, der die Pegelanzeige treibt.
 */
export function useMicLevel(stream, active)
{
  const [level, setLevel] = useState(0);
  const smoothed = useRef(0);

  const trackId = stream?.getAudioTracks?.()[0]?.id || '';

  useEffect(() =>
  {
    if (!active || !stream || stream.getAudioTracks().length === 0)
    {
      smoothed.current = 0;
      setLevel(0);
      return undefined;
    }

    let cancelled = false;
    let timer = null;
    let pcSend = null;
    let pcRecv = null;

    const start = async () =>
    {
      try
      {
        // Rein lokale Schleife: keine ICE-Server, nichts verlässt das Gerät.
        pcSend = new RTCPeerConnection({ iceServers: [] });
        pcRecv = new RTCPeerConnection({ iceServers: [] });

        pcSend.addEventListener('icecandidate', (e) =>
        {
          if (e.candidate) pcRecv?.addIceCandidate(e.candidate).catch(() => {});
        });
        pcRecv.addEventListener('icecandidate', (e) =>
        {
          if (e.candidate) pcSend?.addIceCandidate(e.candidate).catch(() => {});
        });

        const track = stream.getAudioTracks()[0];
        pcSend.addTrack(track, stream);

        const offer = await pcSend.createOffer({});
        await pcSend.setLocalDescription(offer);
        await pcRecv.setRemoteDescription(pcSend.localDescription);
        const answer = await pcRecv.createAnswer();
        await pcRecv.setLocalDescription(answer);
        await pcSend.setRemoteDescription(pcRecv.localDescription);

        const tick = async () =>
        {
          if (cancelled) return;
          try
          {
            const stats = await pcRecv.getStats();
            let raw = 0;
            stats.forEach((r) =>
            {
              if (typeof r.audioLevel === 'number' && r.audioLevel > raw) raw = r.audioLevel;
            });
            // Wurzel spreizt die leisen Bereiche, in denen normale Sprache
            // liegt — sonst bliebe der Balken fast immer am linken Anschlag.
            const shaped = Math.min(1, Math.sqrt(raw) * 1.6);
            // Schnell rauf, langsam runter: der Ausschlag folgt der Stimme,
            // fällt aber ruhig ab statt zu zappeln.
            smoothed.current = shaped > smoothed.current
              ? shaped
              : smoothed.current * 0.8 + shaped * 0.2;
            setLevel(smoothed.current);
          } catch (e) { /* im Abbau — ignorieren */ }
          if (!cancelled) timer = setTimeout(tick, 100);
        };
        timer = setTimeout(tick, 100);
      } catch (err)
      {
        console.warn('[audioTest] Pegelmessung nicht möglich', err);
      }
    };

    start();

    return () =>
    {
      cancelled = true;
      if (timer) clearTimeout(timer);
      try { pcSend?.close(); } catch (e) { /* egal */ }
      try { pcRecv?.close(); } catch (e) { /* egal */ }
    };
  }, [active, trackId, stream]);

  return level;
}

/**
 * Prüfton über den aktuell gewählten Ausgang. Bestätigt dem Nutzer, dass er
 * andere hören wird, bevor er beitritt.
 *
 * InCallManager bringt eigene Klingel-/Signaltöne mit; `_BUNDLE_` nutzt den
 * eingebauten Ton, sodass keine Audiodatei mitgeliefert werden muss.
 */
export function playTestTone(useSpeaker = true)
{
  try
  {
    InCallManager.setForceSpeakerphoneOn(!!useSpeaker);
    InCallManager.startRingback('_BUNDLE_');
    setTimeout(() =>
    {
      try { InCallManager.stopRingback(); } catch (e) { /* egal */ }
    }, 1500);
    return true;
  } catch (e)
  {
    console.warn('[audioTest] Prüfton fehlgeschlagen', e);
    return false;
  }
}
