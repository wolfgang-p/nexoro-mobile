import React, { useCallback, useState } from 'react';
import
  {
    View, Text, Pressable, TextInput, StyleSheet,
    ScrollView, Alert, Platform, KeyboardAvoidingView, ActivityIndicator,
  } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';

import { meetings } from '../../lib/meet/api';
import { ensureIdentity } from '../../lib/meet/identity';
import { recordRoomVisit } from '../../lib/meet/history';
import { light, radius } from '../../lib/meet/theme';

/**
 * Meeting anlegen — sofort oder zu einem Termin.
 *
 * Sofort startende Meetings führen direkt in die Lobby; geplante landen in der
 * Übersicht, weil der Server den Beitritt vor dem Termin ohnehin nur dem Host
 * erlaubt.
 */
export default function NewMeeting()
{
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState('instant');
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(() => new Date(Date.now() + 60 * 60 * 1000));
  const [picker, setPicker] = useState(null); // 'date' | 'time' | null
  const [allowGuests, setAllowGuests] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () =>
  {
    if (busy) return;
    const t = title.trim();
    if (!t) { Alert.alert('Titel fehlt', 'Bitte gib dem Meeting einen Titel.'); return; }
    if (mode === 'scheduled' && when.getTime() <= Date.now())
    {
      Alert.alert('Zeitpunkt', 'Der Termin muss in der Zukunft liegen.');
      return;
    }

    setBusy(true);
    try
    {
      const id = await ensureIdentity();
      const r = await meetings.create({
        title: t,
        scheduled_at: mode === 'scheduled' ? when.toISOString() : null,
        allow_guests: allowGuests,
      }, id);

      await recordRoomVisit({
        roomId: r.meeting.room_id,
        title: r.meeting.title,
        host: r.meeting.host_name,
        scheduledAt: r.meeting.scheduled_at,
        created: true,
      });

      if (mode === 'scheduled') router.replace('/meet');
      else router.replace(`/meet/join/${ r.meeting.room_id }`);
    } catch (err)
    {
      Alert.alert('Fehler', err?.message || 'Meeting konnte nicht erstellt werden.');
      setBusy(false);
    }
  }, [busy, title, mode, when, allowGuests, router]);

  const onPicked = useCallback((event, date) =>
  {
    // Android schließt den Dialog selbst; iOS zeigt ihn inline weiter.
    if (Platform.OS === 'android') setPicker(null);
    if (event?.type === 'dismissed' || !date) return;
    setWhen((prev) =>
    {
      const next = new Date(prev);
      if (picker === 'date')
      {
        next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
      } else
      {
        next.setHours(date.getHours(), date.getMinutes(), 0, 0);
      }
      return next;
    });
  }, [picker]);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={24} color={light.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Neues Meeting</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100, gap: 14 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Modus */}
        <View style={styles.segment}>
          <Pressable
            onPress={() => setMode('instant')}
            style={[styles.segmentBtn, mode === 'instant' && styles.segmentBtnActive]}
          >
            <Ionicons name="flash" size={15} color={mode === 'instant' ? '#fff' : light.subtext} />
            <Text style={[styles.segmentText, mode === 'instant' && styles.segmentTextActive]}>
              Sofort starten
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMode('scheduled')}
            style={[styles.segmentBtn, mode === 'scheduled' && styles.segmentBtnActive]}
          >
            <Ionicons name="calendar" size={15} color={mode === 'scheduled' ? '#fff' : light.subtext} />
            <Text style={[styles.segmentText, mode === 'scheduled' && styles.segmentTextActive]}>
              Termin planen
            </Text>
          </Pressable>
        </View>

        {/* Titel */}
        <View style={styles.card}>
          <Text style={styles.label}>Titel</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Worum geht es?"
            placeholderTextColor={light.subtext}
            style={styles.input}
            maxLength={120}
          />
        </View>

        {/* Zeitpunkt */}
        {mode === 'scheduled' && (
          <View style={styles.card}>
            <Text style={styles.label}>Zeitpunkt</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => setPicker('date')} style={styles.pickBtn}>
                <Ionicons name="calendar-outline" size={16} color={light.brand} />
                <Text style={styles.pickBtnText}>
                  {when.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
                </Text>
              </Pressable>
              <Pressable onPress={() => setPicker('time')} style={styles.pickBtn}>
                <Ionicons name="time-outline" size={16} color={light.brand} />
                <Text style={styles.pickBtnText}>
                  {when.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </Pressable>
            </View>

            {picker && (
              <DateTimePicker
                value={when}
                mode={picker}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={onPicked}
                minimumDate={picker === 'date' ? new Date() : undefined}
              />
            )}
            {Platform.OS === 'ios' && picker && (
              <Pressable onPress={() => setPicker(null)} style={styles.doneBtn}>
                <Text style={styles.doneBtnText}>Fertig</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Gäste */}
        <View style={styles.card}>
          <Pressable onPress={() => setAllowGuests((v) => !v)} style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Gäste zulassen</Text>
              <Text style={styles.toggleSub}>
                Auch Personen ohne Konto können über den Link beitreten.
              </Text>
            </View>
            <View style={[styles.checkbox, allowGuests && styles.checkboxOn]}>
              {allowGuests && <Ionicons name="checkmark" size={15} color="#fff" />}
            </View>
          </Pressable>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable onPress={submit} disabled={busy} style={[styles.submitBtn, busy && { opacity: 0.7 }]}>
          {busy
            ? <ActivityIndicator color="#fff" />
            : (
              <Text style={styles.submitBtnText}>
                {mode === 'scheduled' ? 'Termin anlegen' : 'Meeting starten'}
              </Text>
            )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: light.bg },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, color: light.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },

  segment: {
    flexDirection: 'row', gap: 6, padding: 4,
    backgroundColor: light.muted, borderRadius: radius.md,
  },
  segmentBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: radius.sm,
  },
  segmentBtnActive: { backgroundColor: light.brand },
  segmentText: { color: light.subtext, fontSize: 13.5, fontWeight: '600' },
  segmentTextActive: { color: '#fff' },

  card: {
    backgroundColor: light.card, borderRadius: radius.lg, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  label: { color: light.text, fontSize: 13, fontWeight: '700', marginBottom: 8 },
  input: {
    height: 48, backgroundColor: light.muted, borderRadius: radius.md,
    paddingHorizontal: 14, color: light.text, fontSize: 15,
  },

  pickBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    height: 46, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: light.border, backgroundColor: light.muted,
  },
  pickBtnText: { color: light.text, fontSize: 13.5, fontWeight: '600' },
  doneBtn: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 20 },
  doneBtnText: { color: light.brand, fontWeight: '700', fontSize: 14 },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleLabel: { color: light.text, fontSize: 14.5, fontWeight: '600' },
  toggleSub: { color: light.subtext, fontSize: 12, marginTop: 3, lineHeight: 17 },
  checkbox: {
    width: 26, height: 26, borderRadius: 8,
    borderWidth: 2, borderColor: light.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: light.brand, borderColor: light.brand },

  footer: {
    paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: light.border, backgroundColor: light.card,
  },
  submitBtn: {
    height: 54, borderRadius: radius.md, backgroundColor: light.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  submitBtnText: { color: '#fff', fontSize: 16.5, fontWeight: '700' },
});
