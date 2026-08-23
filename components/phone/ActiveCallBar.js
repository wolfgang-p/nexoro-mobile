import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, StyleSheet } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { usePhoneStore, anrufAktiv } from '../../stores/phoneStore';
import { phoneManager } from '../../lib/phone/phoneManager';

/**
 * Leiste für ein minimiertes Gespräch — Gegenstück zu `ActiveMeetingBar`.
 *
 * Steht im Layoutfluss ÜBER dem Stack, nicht als Overlay: Der Bereich darunter
 * schrumpft, statt verdeckt zu werden. Sonst läge die Leiste über der
 * Navigation des oms-cluster. Genau dieser Fehler ist bei der Meeting-Leiste
 * schon einmal aufgetreten und dort so gelöst worden.
 *
 * Antippen kehrt ins Gespräch zurück, der rote Knopf legt auf.
 */

const C = {
  brand: '#40BCC7',
  text: '#1E293B',
  subtext: '#64748B',
  danger: '#EF4444',
  card: '#FFFFFF',
  border: '#E2E8F0',
};

export function ActiveCallBar()
{
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const phase = usePhoneStore((s) => s.phase);
  const gegenstelle = usePhoneStore((s) => s.gegenstelle);
  const startedAt = usePhoneStore((s) => s.startedAt);
  const stumm = usePhoneStore((s) => s.stumm);
  const gehalten = usePhoneStore((s) => s.gehalten);

  const [dauer, setDauer] = useState(0);

  useEffect(() =>
  {
    if (!startedAt) { setDauer(0); return undefined; }
    setDauer(Math.floor((Date.now() - startedAt) / 1000));
    const id = setInterval(
      () => setDauer(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  // Auf dem Telefon-Bildschirm selbst wäre die Leiste doppelt gemoppelt.
  const aufTelefonScreen = !!pathname && pathname.startsWith('/phone');
  const sichtbar = anrufAktiv(phase) && !aufTelefonScreen;

  // Einblenden statt Hereinschieben: Im Layoutfluss würde ein Schieben die
  // darunterliegende WebView bei jedem Einzelbild neu umbrechen.
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() =>
  {
    Animated.timing(fade, {
      toValue: sichtbar ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [sichtbar, fade]);

  if (!sichtbar) return null;

  const status = phase === 'klingelt' ? 'Eingehender Anruf'
    : phase === 'ruft' ? 'Wird angerufen…'
    : gehalten ? 'Gehalten'
    : formatDauer(dauer);

  const oeffnen = () =>
  {
    usePhoneStore.getState().setMinimiert(false);
    router.push('/phone');
  };

  return (
    <Animated.View style={[styles.leiste, { paddingTop: insets.top + 6, opacity: fade }]}>
      <Pressable onPress={oeffnen} style={styles.inhalt} hitSlop={4}>
        <View style={styles.symbol}>
          <Ionicons
            name={phase === 'klingelt' ? 'call' : gehalten ? 'pause' : 'call'}
            size={16}
            color="#FFFFFF"
          />
        </View>

        <View style={styles.texte}>
          <Text style={styles.name} numberOfLines={1}>{gegenstelle || 'Anruf'}</Text>
          <Text style={styles.status} numberOfLines={1}>{status}</Text>
        </View>

        {stumm && (
          <View style={styles.hinweis}>
            <Ionicons name="mic-off" size={14} color={C.subtext} />
          </View>
        )}

        <Pressable
          onPress={() => phoneManager.auflegen()}
          hitSlop={10}
          style={styles.auflegen}
        >
          <Ionicons name="call" size={16} color="#FFFFFF"
            style={{ transform: [{ rotate: '135deg' }] }} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

function formatDauer(s)
{
  const m = Math.floor(s / 60);
  return `${ String(m).padStart(2, '0') }:${ String(s % 60).padStart(2, '0') }`;
}

const styles = StyleSheet.create({
  leiste: {
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  inhalt: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  symbol: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center',
  },
  texte: { flex: 1 },
  name: { fontSize: 14, fontWeight: '700', color: C.text },
  status: { fontSize: 12, color: C.subtext, fontVariant: ['tabular-nums'] },
  hinweis: { paddingHorizontal: 4 },
  auflegen: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.danger, alignItems: 'center', justifyContent: 'center',
  },
});
