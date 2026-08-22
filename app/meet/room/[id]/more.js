import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import
  {
    View, Text, Pressable, TextInput, StyleSheet, ScrollView,
    KeyboardAvoidingView, Platform, Alert, Share,
  } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

import { useMeetStore } from '../../../../stores/meetStore';
import { meetManager } from '../../../../lib/meet/meetManager';
import { meetings } from '../../../../lib/meet/api';
import { MEET_WEB_URL } from '../../../../lib/meet/env';
import { dark, radius } from '../../../../lib/meet/theme';

const TABS = [
  { key: 'chat', label: 'Chat', icon: 'chatbubble-ellipses' },
  { key: 'people', label: 'Personen', icon: 'people' },
  { key: 'notes', label: 'Notizen', icon: 'document-text' },
  { key: 'more', label: 'Mehr', icon: 'ellipsis-horizontal' },
];

/**
 * Vollbild-Seite hinter dem "Mehr"-Knopf (Vertical-Dots) im Raum.
 *
 * Alles, was nicht in die Steuerleiste passt, sammelt sich hier: Chat,
 * Teilnehmer inkl. Host-Aktionen, geteilte Notizen, Einstellungen und der
 * Einladungslink. Als eigene Route und nicht als Overlay, damit die Zurück-
 * Geste sie schließt und der Raum darunter unverändert weiterläuft.
 */
export default function MoreScreen()
{
  const { id: roomId } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState('chat');

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-down" size={24} color={dark.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Meeting</Text>
        <View style={styles.headerBtn} />
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            style={[styles.tab, tab === t.key && styles.tabActive]}
          >
            <Ionicons
              name={t.icon}
              size={16}
              color={tab === t.key ? dark.brand : dark.faint}
            />
            <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'chat' && <ChatTab insets={insets} />}
      {tab === 'people' && <PeopleTab />}
      {tab === 'notes' && <NotesTab insets={insets} />}
      {tab === 'more' && <SettingsTab roomId={String(roomId)} />}
    </View>
  );
}

// ── Chat ────────────────────────────────────────────────────────────

function ChatTab({ insets })
{
  const messages = useMeetStore((s) => s.chatMessages);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  // Sichtbarer Chat = gelesen.
  useEffect(() => { useMeetStore.getState().clearUnreadChat(); }, [messages.length]);

  const send = useCallback(async () =>
  {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try
    {
      await meetManager.sendChat(text);
      setDraft('');
    } catch (e)
    {
      Alert.alert('Fehler', 'Nachricht konnte nicht gesendet werden.');
    } finally
    {
      setSending(false);
    }
  }, [draft, sending]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + 60}
    >
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 && (
          <Text style={styles.empty}>Noch keine Nachrichten.</Text>
        )}
        {messages.map((m, i) => (
          <View key={m.id || i} style={styles.msg}>
            <Text style={styles.msgAuthor}>{m.display_name}</Text>
            <Text style={styles.msgBody}>{m.body}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: insets.bottom + 10 }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Nachricht schreiben…"
          placeholderTextColor={dark.faint}
          style={styles.composerInput}
          multiline
          onSubmitEditing={send}
        />
        <Pressable onPress={send} disabled={!draft.trim() || sending} style={styles.sendBtn}>
          <Ionicons name="send" size={17} color={draft.trim() ? '#fff' : dark.faint} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Personen + Host-Aktionen ────────────────────────────────────────

function PeopleTab()
{
  const participants = useMeetStore((s) => s.participants);
  const meeting = useMeetStore((s) => s.meeting);
  const handsUp = useMeetStore((s) => s.handsUp);

  // Host bin ich, wenn meine Teilnehmerzeile als Host markiert ist.
  const isHost = useMemo(
    () => participants.some((p) => meetManager.isSelf(p) && p.is_host),
    [participants],
  );

  const kick = useCallback((p) =>
  {
    Alert.alert(
      'Teilnehmer entfernen',
      `„${ p.display_name }“ aus dem Meeting entfernen?`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Entfernen',
          style: 'destructive',
          onPress: () =>
          {
            meetManager.kick(p.id).catch(() =>
              Alert.alert('Fehler', 'Teilnehmer konnte nicht entfernt werden.'));
          },
        },
      ],
    );
  }, []);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 8 }}>
      {isHost && (
        <Text style={styles.sectionHint}>
          Du bist Host — tippe auf einen Teilnehmer, um ihn zu entfernen.
        </Text>
      )}
      {participants.map((p) => (
        <Pressable
          key={p.id}
          onPress={() => { if (isHost && !meetManager.isSelf(p)) kick(p); }}
          style={styles.personRow}
        >
          <View style={styles.personAvatar}>
            <Text style={styles.personAvatarText}>
              {String(p.display_name || '?').trim().charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={styles.personName}>
              {p.display_name}
              {meetManager.isSelf(p) ? '  (du)' : ''}
            </Text>
            {p.is_host && <Text style={styles.personRole}>Host</Text>}
          </View>
          {!!handsUp[p.device_id] && <Text style={{ fontSize: 15 }}>✋</Text>}
          <Ionicons
            name={p.mic_on === false ? 'mic-off' : 'mic'}
            size={16}
            color={p.mic_on === false ? dark.danger : dark.subtext}
          />
          {isHost && !meetManager.isSelf(p) && (
            <Ionicons name="remove-circle-outline" size={18} color={dark.danger} />
          )}
        </Pressable>
      ))}
      {participants.length === 0 && <Text style={styles.empty}>Niemand sonst im Raum.</Text>}
      {!!meeting?.locked && (
        <Text style={styles.sectionHint}>Das Meeting ist gesperrt — niemand kann mehr beitreten.</Text>
      )}
    </ScrollView>
  );
}

// ── Geteilte Notizen ────────────────────────────────────────────────

function NotesTab({ insets })
{
  const notes = useMeetStore((s) => s.notes);
  const [draft, setDraft] = useState(notes);
  const saveTimer = useRef(null);
  const editingRef = useRef(0);

  // Entfernte Änderungen übernehmen, solange ich nicht gerade selbst tippe —
  // sonst springt der Cursor mitten im Wort.
  useEffect(() =>
  {
    if (Date.now() - editingRef.current > 800) setDraft(notes);
  }, [notes]);

  // Beim Öffnen des Tabs den Serverstand nachladen. Der Beitritt holt die
  // Notizen zwar bereits, aber jemand kann in der Zwischenzeit über den Browser
  // geschrieben haben, ohne dass ein Broadcast bei uns ankam (etwa weil der WS
  // kurz weg war). Der lokale Entwurf gewinnt, solange gerade getippt wird.
  useEffect(() =>
  {
    let cancelled = false;
    meetManager.loadNotes()
      .then((content) =>
      {
        if (cancelled || typeof content !== 'string') return;
        if (Date.now() - editingRef.current > 800) setDraft(content);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const onChange = useCallback((text) =>
  {
    setDraft(text);
    editingRef.current = Date.now();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    // Entprellt speichern: das Broadcast an die anderen und das Sichern auf
    // dem Server sollen nicht bei jedem Tastendruck feuern.
    saveTimer.current = setTimeout(() =>
    {
      meetManager.saveNotes(text).catch(() => {});
    }, 500);
  }, []);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + 60}
    >
      <View style={{ flex: 1, padding: 16 }}>
        <Text style={styles.sectionHint}>
          Alle im Meeting sehen und bearbeiten diese Notizen.
        </Text>
        <TextInput
          value={draft}
          onChangeText={onChange}
          placeholder="Notizen zum Meeting…"
          placeholderTextColor={dark.faint}
          style={styles.notesInput}
          multiline
          textAlignVertical="top"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Einstellungen / Host / Einladung ────────────────────────────────

function SettingsTab({ roomId })
{
  const meeting = useMeetStore((s) => s.meeting);
  const participants = useMeetStore((s) => s.participants);
  const [copied, setCopied] = useState(false);

  const isHost = useMemo(
    () => participants.some((p) => meetManager.isSelf(p) && p.is_host),
    [participants],
  );

  const link = `${ MEET_WEB_URL }/m/${ roomId }`;

  const copy = useCallback(async () =>
  {
    await Clipboard.setStringAsync(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [link]);

  const share = useCallback(() =>
  {
    Share.share({ message: `${ meeting?.title || 'Meeting' }\n${ link }` }).catch(() => {});
  }, [link, meeting]);

  const toggleLock = useCallback(() =>
  {
    meetManager.setLocked(!meeting?.locked).catch(() =>
      Alert.alert('Fehler', 'Einstellung konnte nicht geändert werden.'));
  }, [meeting]);

  const endForAll = useCallback(() =>
  {
    Alert.alert(
      'Meeting beenden',
      'Das Meeting wird für alle Teilnehmer beendet.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Beenden',
          style: 'destructive',
          onPress: () => { meetManager.endForAll().catch(() => {}); },
        },
      ],
    );
  }, []);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      {/* Einladung */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Einladen</Text>
        <Text style={styles.linkText} numberOfLines={1}>{link}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Pressable onPress={copy} style={styles.secondaryBtn}>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={15} color={dark.brand} />
            <Text style={styles.secondaryBtnText}>{copied ? 'Kopiert' : 'Kopieren'}</Text>
          </Pressable>
          <Pressable onPress={share} style={styles.secondaryBtn}>
            <Ionicons name="share-outline" size={15} color={dark.brand} />
            <Text style={styles.secondaryBtnText}>Teilen</Text>
          </Pressable>
        </View>
      </View>

      {/* Ton */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Ton</Text>
        <Row icon="volume-high" label="Lautsprecher" onPress={() => meetManager.setSpeaker(true)} />
        <Row icon="ear-outline" label="Hörmuschel" onPress={() => meetManager.setSpeaker(false)} />
        <Row icon="camera-reverse-outline" label="Kamera wechseln" onPress={() => meetManager.switchCamera()} />
      </View>

      {/* Host */}
      {isHost && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Host-Funktionen</Text>
          <Row
            icon={meeting?.locked ? 'lock-closed' : 'lock-open'}
            label={meeting?.locked ? 'Meeting entsperren' : 'Meeting sperren'}
            sub={meeting?.locked
              ? 'Aktuell kann niemand mehr beitreten.'
              : 'Verhindert, dass weitere Personen beitreten.'}
            onPress={toggleLock}
          />
          <Row
            icon="stop-circle-outline"
            label="Für alle beenden"
            danger
            onPress={endForAll}
          />
        </View>
      )}

      {/* Zusammenfassung — bewusst nur als Link nach draußen. */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Zusammenfassung</Text>
        <Text style={styles.cardHint}>
          Die Zusammenfassung entsteht nach dem Meeting und ist im Browser abrufbar.
          Du findest den Link nach dem Ende in der Meeting-Übersicht.
        </Text>
      </View>
    </ScrollView>
  );
}

function Row({ icon, label, sub, onPress, danger })
{
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <Ionicons name={icon} size={18} color={danger ? dark.danger : dark.subtext} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, danger && { color: dark.danger }]}>{label}</Text>
        {!!sub && <Text style={styles.rowSub}>{sub}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={16} color={dark.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: dark.bg },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingBottom: 8,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, color: dark.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },

  tabs: {
    flexDirection: 'row', gap: 6,
    paddingHorizontal: 12, paddingBottom: 10,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 9, borderRadius: radius.md,
    backgroundColor: dark.surface,
  },
  tabActive: { backgroundColor: dark.surfaceHi },
  tabLabel: { color: dark.faint, fontSize: 12, fontWeight: '600' },
  tabLabelActive: { color: dark.brand },

  empty: { color: dark.faint, fontSize: 13, textAlign: 'center', paddingVertical: 24 },
  sectionHint: { color: dark.faint, fontSize: 12, lineHeight: 17, marginBottom: 8 },

  msg: {
    backgroundColor: dark.surface,
    borderRadius: radius.md, padding: 12, gap: 3,
  },
  msgAuthor: { color: dark.brand, fontSize: 12, fontWeight: '700' },
  msgBody: { color: dark.text, fontSize: 14, lineHeight: 19 },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: dark.border,
  },
  composerInput: {
    flex: 1, maxHeight: 110,
    backgroundColor: dark.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 10,
    color: dark.text, fontSize: 15,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: dark.brand,
    alignItems: 'center', justifyContent: 'center',
  },

  personRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: dark.surface,
    borderRadius: radius.md, padding: 12,
  },
  personAvatar: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: dark.surfaceHi,
    alignItems: 'center', justifyContent: 'center',
  },
  personAvatarText: { color: dark.text, fontWeight: '700', fontSize: 14 },
  personName: { color: dark.text, fontSize: 14, fontWeight: '600' },
  personRole: { color: dark.brand, fontSize: 11, fontWeight: '600', marginTop: 1 },

  notesInput: {
    flex: 1,
    backgroundColor: dark.surface,
    borderRadius: radius.md,
    padding: 14,
    color: dark.text, fontSize: 15, lineHeight: 21,
  },

  card: {
    backgroundColor: dark.surface,
    borderRadius: radius.lg, padding: 16,
  },
  cardTitle: { color: dark.text, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  cardHint: { color: dark.faint, fontSize: 12.5, lineHeight: 18 },
  linkText: { color: dark.subtext, fontSize: 13 },

  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: dark.brand,
  },
  secondaryBtnText: { color: dark.brand, fontSize: 13, fontWeight: '700' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12,
  },
  rowLabel: { color: dark.text, fontSize: 14, fontWeight: '600' },
  rowSub: { color: dark.faint, fontSize: 11.5, marginTop: 2, lineHeight: 16 },
});
