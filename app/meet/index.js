import React, { useCallback, useState } from 'react';
import
  {
    View, Text, Pressable, StyleSheet, ScrollView,
    TextInput, RefreshControl, Alert, Linking,
  } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { meetings } from '../../lib/meet/api';
import { ensureIdentity } from '../../lib/meet/identity';
import { getRoomHistory, removeRoomVisit } from '../../lib/meet/history';
import { MEET_WEB_URL } from '../../lib/meet/env';
import { light, radius } from '../../lib/meet/theme';

/**
 * Meeting-Übersicht: Sofort-Meeting, Beitreten per Code und die Historie.
 *
 * Die Historie kommt aus dem lokalen Cache — Gäste haben serverseitig bewusst
 * keinen Meeting-Index. Damit entspricht die App genau dem, was der Browser
 * über seinen localStorage-Cache zeigt.
 */
export default function MeetIndex()
{
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [history, setHistory] = useState([]);
  const [scheduled, setScheduled] = useState([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () =>
  {
    setHistory(await getRoomHistory());
    try
    {
      const id = await ensureIdentity();
      const r = await meetings.listMine(id);
      const now = Date.now();
      setScheduled((r.meetings || []).filter(
        (m) => m.scheduled_at && !m.ended_at && new Date(m.scheduled_at).getTime() > now,
      ));
    } catch (e)
    {
      // Gäste bekommen hier eine leere Liste — kein Fehlerfall.
      setScheduled([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () =>
  {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const startInstant = useCallback(async () =>
  {
    if (busy) return;
    setBusy(true);
    try
    {
      const id = await ensureIdentity();
      const r = await meetings.create({ title: 'Schnell-Meeting' }, id);
      router.push(`/meet/join/${ r.meeting.room_id }`);
    } catch (err)
    {
      Alert.alert('Fehler', err?.message || 'Meeting konnte nicht erstellt werden.');
    } finally
    {
      setBusy(false);
    }
  }, [busy, router]);

  const joinByCode = useCallback(() =>
  {
    let id = code.trim();
    // Ganze Links werden akzeptiert: der letzte Pfadteil ist die Raum-ID.
    const m = id.match(/\/m\/([^/?#]+)/);
    if (m) id = m[1];
    if (!id) return;
    setCode('');
    router.push(`/meet/join/${ encodeURIComponent(id) }`);
  }, [code, router]);

  const forget = useCallback(async (roomId) =>
  {
    await removeRoomVisit(roomId);
    setHistory(await getRoomHistory());
  }, []);

  /** Zusammenfassungen bewusst NICHT in der App: extern im Standardbrowser. */
  const openSummary = useCallback((roomId) =>
  {
    Linking.openURL(`${ MEET_WEB_URL }/m/${ roomId }/analysis`).catch(() =>
      Alert.alert('Fehler', 'Link konnte nicht geöffnet werden.'));
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.replace('/')} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={24} color={light.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Meetings</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={light.brand} />}
      >
        {/* Aktionen */}
        <View style={styles.actions}>
          <Pressable onPress={startInstant} disabled={busy} style={[styles.primaryBtn, busy && { opacity: 0.6 }]}>
            <Ionicons name="videocam" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>Sofort starten</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/meet/new')} style={styles.ghostBtn}>
            <Ionicons name="calendar-outline" size={18} color={light.brand} />
            <Text style={styles.ghostBtnText}>Termin planen</Text>
          </Pressable>
        </View>

        {/* Beitreten per Code */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Mit Code beitreten</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="Code oder Link einfügen"
              placeholderTextColor={light.subtext}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={joinByCode}
              returnKeyType="go"
            />
            <Pressable onPress={joinByCode} disabled={!code.trim()} style={[styles.goBtn, !code.trim() && { opacity: 0.4 }]}>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </Pressable>
          </View>
        </View>

        {/* Geplant */}
        {scheduled.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Geplant</Text>
            {scheduled.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => router.push(`/meet/join/${ m.room_id }`)}
                style={styles.row}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name="calendar" size={16} color={light.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={styles.rowTitle}>{m.title}</Text>
                  <Text style={styles.rowSub}>{formatDate(m.scheduled_at)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={light.subtext} />
              </Pressable>
            ))}
          </View>
        )}

        {/* Historie */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Zuletzt</Text>
          {history.length === 0 && (
            <Text style={styles.empty}>Noch keine Meetings besucht.</Text>
          )}
          {history.map((h) => (
            <View key={h.roomId} style={styles.row}>
              <Pressable
                onPress={() => router.push(`/meet/join/${ h.roomId }`)}
                style={styles.rowMain}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name={h.created ? 'star' : 'time-outline'} size={16} color={light.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={styles.rowTitle}>{h.title}</Text>
                  <Text style={styles.rowSub}>
                    {h.host ? `${ h.host }  ·  ` : ''}{formatRelative(h.lastVisited)}
                  </Text>
                </View>
              </Pressable>
              <Pressable onPress={() => openSummary(h.roomId)} hitSlop={8} style={styles.rowAction}>
                <Ionicons name="open-outline" size={17} color={light.subtext} />
              </Pressable>
              <Pressable onPress={() => forget(h.roomId)} hitSlop={8} style={styles.rowAction}>
                <Ionicons name="close" size={17} color={light.subtext} />
              </Pressable>
            </View>
          ))}
          {history.length > 0 && (
            <Text style={styles.footnote}>
              Zusammenfassungen öffnen im Browser.
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function formatDate(iso)
{
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('de-DE', {
    weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatRelative(ts)
{
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${ min } Min.`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${ h } Std.`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'gestern';
  if (d < 7) return `vor ${ d } Tagen`;
  return new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: light.bg },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 6,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, color: light.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },

  actions: { flexDirection: 'row', gap: 10 },
  primaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: radius.md, backgroundColor: light.brand,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  ghostBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: light.brand, backgroundColor: light.card,
  },
  ghostBtnText: { color: light.brand, fontSize: 15, fontWeight: '700' },

  card: {
    backgroundColor: light.card,
    borderRadius: radius.lg, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  cardTitle: { color: light.text, fontSize: 15, fontWeight: '700', marginBottom: 10 },

  input: {
    flex: 1, height: 48,
    backgroundColor: light.muted, borderRadius: radius.md,
    paddingHorizontal: 14, color: light.text, fontSize: 15,
  },
  goBtn: {
    width: 48, height: 48, borderRadius: radius.md,
    backgroundColor: light.brand,
    alignItems: 'center', justifyContent: 'center',
  },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: light.border,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: light.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { color: light.text, fontSize: 14.5, fontWeight: '600' },
  rowSub: { color: light.subtext, fontSize: 12, marginTop: 2 },
  rowAction: { width: 30, alignItems: 'center' },

  empty: { color: light.subtext, fontSize: 13, paddingVertical: 8 },
  footnote: { color: light.subtext, fontSize: 11.5, marginTop: 10 },
});
