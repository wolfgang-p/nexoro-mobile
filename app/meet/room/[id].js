import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useMeetStore } from '../../../stores/meetStore';

/**
 * Meeting-Raum.
 *
 * Platzhalter aus Phase 1: die Verbindungsschicht (meetManager, PeerMesh,
 * Signaler) steht bereits vollständig, die Video-Oberfläche kommt in Phase 2.
 * Der Screen existiert schon, weil das Wurzel-Layout und die Minimier-Leiste
 * auf die Route verweisen.
 */
export default function MeetingRoom()
{
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const phase = useMeetStore((s) => s.phase);

  const minimize = () =>
  {
    useMeetStore.getState().setMinimized(true);
    router.back();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Pressable onPress={minimize} style={styles.minimize} hitSlop={8}>
        <Ionicons name="chevron-down" size={26} color="#fff" />
      </Pressable>

      <View style={styles.center}>
        <Text style={styles.title}>Raum {String(id)}</Text>
        <Text style={styles.subtitle}>Status: {phase}</Text>
        <Text style={styles.note}>Die Video-Oberfläche folgt in Phase 2.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F14' },
  minimize: {
    width: 44, height: 44, borderRadius: 22, marginLeft: 12, marginTop: 6,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  subtitle: { color: 'rgba(255,255,255,0.75)', fontSize: 15 },
  note: { color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 12 },
});
