import React, { useCallback, useEffect, useRef, useState } from 'react';
import
  {
    View, Text, Pressable, TextInput, StyleSheet,
    ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
  } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { mediaDevices } from 'react-native-webrtc';

import { meetings, ApiError } from '../../../lib/meet/api';
import { getIdentity, setDisplayName, ensureIdentity } from '../../../lib/meet/identity';
import { meetManager } from '../../../lib/meet/meetManager';
import { useMeetStore } from '../../../stores/meetStore';
import { useMicLevel, playTestTone } from '../../../lib/meet/audioTest';
import { VideoTile } from '../../../components/meet/VideoTile';
import { dark, radius } from '../../../lib/meet/theme';

/**
 * Lobby: Vorschau, Ton testen, Name, dann beitreten.
 *
 * Bewusst ein eigener Schritt vor dem Raum — sowohl beim Tippen in der App als
 * auch beim Öffnen eines meet.nexoro.net/m/…-Links. Wer über einen Link kommt,
 * landet ohne Vorwarnung in einem Raum mit fremden Menschen; hier prüft er
 * vorher Kamera, Mikrofon und seinen Namen.
 */
export default function JoinMeeting()
{
  const { id: roomId } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [joining, setJoining] = useState(false);

  const [name, setName] = useState('');
  const [previewStream, setPreviewStream] = useState(null);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [speaker, setSpeaker] = useState(true);
  const [tonePlaying, setTonePlaying] = useState(false);
  const [mediaError, setMediaError] = useState(null);

  const streamRef = useRef(null);
  const micLevel = useMicLevel(previewStream, micOn);

  // ── Meeting-Daten + Identität laden ───────────────────────────────
  useEffect(() =>
  {
    let cancelled = false;
    (async () =>
    {
      try
      {
        const id = await ensureIdentity();
        if (!cancelled) setName(id.display_name === 'Gast' ? '' : id.display_name);
        const r = await meetings.get(String(roomId), id);
        if (cancelled) return;
        setMeeting(r.meeting);
      } catch (err)
      {
        if (!cancelled)
        {
          setError(err instanceof ApiError && err.status === 404
            ? 'Dieses Meeting existiert nicht (mehr).'
            : (err?.message || 'Meeting konnte nicht geladen werden.'));
        }
      } finally
      {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [roomId]);

  // ── Vorschau-Medien ───────────────────────────────────────────────
  useEffect(() =>
  {
    let cancelled = false;
    (async () =>
    {
      try
      {
        const stream = await mediaDevices.getUserMedia({
          audio: true,
          video: { facingMode: 'user', width: 1280, height: 720 },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        setPreviewStream(stream);
      } catch (err)
      {
        // Ohne Kamera geht es weiter — nur mit Ton. Der Beitritt darf an einer
        // belegten oder gesperrten Kamera nicht scheitern.
        try
        {
          const audioOnly = await mediaDevices.getUserMedia({ audio: true, video: false });
          if (cancelled) { audioOnly.getTracks().forEach((t) => t.stop()); return; }
          streamRef.current = audioOnly;
          setPreviewStream(audioOnly);
          setCameraOn(false);
          setMediaError('Kamera nicht verfügbar — du trittst nur mit Ton bei.');
        } catch (err2)
        {
          if (!cancelled) setMediaError('Kein Zugriff auf Kamera und Mikrofon. Bitte in den Einstellungen erlauben.');
        }
      }
    })();

    return () =>
    {
      cancelled = true;
      try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch (e) { /* egal */ }
      streamRef.current = null;
    };
  }, []);

  const toggleCamera = useCallback(() =>
  {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraOn(track.enabled);
  }, []);

  const toggleMic = useCallback(() =>
  {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }, []);

  const testTone = useCallback(() =>
  {
    setTonePlaying(true);
    playTestTone(speaker);
    setTimeout(() => setTonePlaying(false), 1600);
  }, [speaker]);

  // ── Beitreten ─────────────────────────────────────────────────────
  const join = useCallback(async () =>
  {
    if (joining) return;
    setJoining(true);
    setError(null);
    try
    {
      const identity = await setDisplayName(name || 'Gast');

      // Vorschau-Medien freigeben: der Manager fordert eigene an, und zwei
      // gleichzeitige Zugriffe auf dieselbe Kamera scheitern auf Android.
      try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch (e) { /* egal */ }
      streamRef.current = null;
      setPreviewStream(null);

      useMeetStore.getState().startJoining(String(roomId), meeting);
      await meetManager.join({ roomId: String(roomId), identity, video: cameraOn });

      // Stummschaltung aus der Lobby übernehmen.
      if (!micOn) meetManager.toggleMic();
      meetManager.setSpeaker(speaker);

      router.replace(`/meet/room/${ roomId }`);
    } catch (err)
    {
      useMeetStore.getState().reset();
      setError(err?.message || 'Beitritt fehlgeschlagen.');
      setJoining(false);
    }
  }, [joining, name, roomId, meeting, cameraOn, micOn, speaker, router]);

  // ── Darstellung ───────────────────────────────────────────────────

  if (loading)
  {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={dark.brand} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={dark.text} />
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>
          {meeting?.title || 'Meeting'}
        </Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Vorschau */}
        <View style={styles.preview}>
          <VideoTile
            streamUrl={previewStream?.toURL?.() || null}
            name={name || 'Du'}
            label="Du"
            cameraOn={cameraOn}
            micOn={micOn}
            mirror
            conn="connected"
            style={styles.previewTile}
          />
          <View style={styles.previewControls}>
            <RoundBtn icon={micOn ? 'mic' : 'mic-off'} active={micOn} onPress={toggleMic} />
            <RoundBtn icon={cameraOn ? 'videocam' : 'videocam-off'} active={cameraOn} onPress={toggleCamera} />
            <RoundBtn
              icon={speaker ? 'volume-high' : 'volume-low'}
              active={speaker}
              onPress={() => setSpeaker((s) => !s)}
            />
          </View>
        </View>

        {mediaError && (
          <View style={styles.warnBox}>
            <Ionicons name="warning-outline" size={16} color="#FCD34D" />
            <Text style={styles.warnText}>{mediaError}</Text>
          </View>
        )}

        {/* Ton testen */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Ton testen</Text>

          <Text style={styles.label}>Mikrofon</Text>
          <View style={styles.meterTrack}>
            <View style={[styles.meterFill, { width: `${ Math.round(micLevel * 100) }%` }]} />
          </View>
          <Text style={styles.hint}>
            {micOn
              ? 'Sag etwas — der Balken sollte ausschlagen.'
              : 'Mikrofon ist stumm. Zum Testen oben einschalten.'}
          </Text>

          <Text style={[styles.label, { marginTop: 16 }]}>Lautsprecher</Text>
          <Pressable onPress={testTone} style={styles.toneBtn} disabled={tonePlaying}>
            <Ionicons
              name={tonePlaying ? 'volume-high' : 'play'}
              size={16}
              color={dark.brand}
            />
            <Text style={styles.toneBtnText}>
              {tonePlaying ? 'Ton läuft…' : 'Prüfton abspielen'}
            </Text>
          </Pressable>
          <Text style={styles.hint}>
            Hörst du den Ton, wirst du auch die anderen hören.
          </Text>
        </View>

        {/* Name */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Dein Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Wie sollen dich die anderen sehen?"
            placeholderTextColor={dark.faint}
            style={styles.input}
            maxLength={64}
            returnKeyType="done"
            onSubmitEditing={join}
          />
        </View>

        {/* Hinweise */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Tipps für ein gutes Meeting</Text>
          <Tip icon="wifi" text="WLAN ist stabiler als Mobilfunk. Im Zug oder Auto bricht das Bild leicht ab." />
          <Tip icon="headset" text="Kopfhörer verhindern Echo — ohne sie hören die anderen sich selbst zurück." />
          <Tip icon="mic-off" text="Stumm bleiben, wenn du nicht sprichst. Das hält Nebengeräusche draußen." />
          <Tip icon="sunny" text="Licht von vorn, nicht von hinten. Ein Fenster im Rücken macht dich zur Silhouette." />
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>

      {/* Beitreten */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          onPress={join}
          disabled={joining}
          style={[styles.joinBtn, joining && styles.joinBtnBusy]}
        >
          {joining
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.joinBtnText}>Jetzt beitreten</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function RoundBtn({ icon, active, onPress })
{
  return (
    <Pressable
      onPress={onPress}
      style={[styles.roundBtn, !active && styles.roundBtnOff]}
      hitSlop={6}
    >
      <Ionicons name={icon} size={20} color={active ? dark.text : '#fff'} />
    </Pressable>
  );
}

function Tip({ icon, text })
{
  return (
    <View style={styles.tipRow}>
      <Ionicons name={icon} size={15} color={dark.brand} style={{ marginTop: 1 }} />
      <Text style={styles.tipText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: dark.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingBottom: 10, gap: 4,
  },
  headerTitle: { flex: 1, color: dark.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  scroll: { paddingHorizontal: 16, gap: 14 },

  preview: { gap: 12 },
  previewTile: { height: 260, flex: 0 },
  previewControls: { flexDirection: 'row', justifyContent: 'center', gap: 14 },

  roundBtn: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: dark.control,
    alignItems: 'center', justifyContent: 'center',
  },
  roundBtnOff: { backgroundColor: dark.danger },

  card: {
    backgroundColor: dark.surface,
    borderRadius: radius.lg,
    padding: 16,
    gap: 6,
  },
  cardTitle: { color: dark.text, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  label: { color: dark.subtext, fontSize: 12, fontWeight: '600' },
  hint: { color: dark.faint, fontSize: 12, lineHeight: 17 },

  meterTrack: {
    height: 8, borderRadius: 4,
    backgroundColor: dark.surfaceHi,
    overflow: 'hidden', marginVertical: 6,
  },
  meterFill: { height: '100%', backgroundColor: dark.brand, borderRadius: 4 },

  toneBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: dark.brand,
    marginVertical: 6,
  },
  toneBtnText: { color: dark.brand, fontSize: 13, fontWeight: '700' },

  input: {
    backgroundColor: dark.surfaceHi,
    borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 12,
    color: dark.text, fontSize: 16,
  },

  tipRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 5 },
  tipText: { flex: 1, color: dark.subtext, fontSize: 13, lineHeight: 18 },

  warnBox: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    backgroundColor: 'rgba(252,211,77,0.12)',
    borderRadius: radius.md, padding: 12,
  },
  warnText: { flex: 1, color: '#FCD34D', fontSize: 12.5, lineHeight: 17 },

  errorBox: {
    backgroundColor: 'rgba(220,38,38,0.15)',
    borderRadius: radius.md, padding: 12,
  },
  errorText: { color: '#FCA5A5', fontSize: 13 },

  footer: {
    paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: dark.border,
    backgroundColor: dark.bg,
  },
  joinBtn: {
    height: 54, borderRadius: radius.md,
    backgroundColor: dark.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  joinBtnBusy: { opacity: 0.7 },
  joinBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
