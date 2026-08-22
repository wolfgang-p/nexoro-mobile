import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useMeetStore, isMeetingLive } from '../../stores/meetStore';
import { dark } from '../../lib/meet/theme';
import { meetManager } from '../../lib/meet/meetManager';

const BRAND = '#40BCC7';

/**
 * Leiste für das minimierte Meeting, oben in der App.
 *
 * Sichtbar, sobald ein Meeting läuft und der Raum-Screen nicht im Vordergrund
 * ist — egal ob der Nutzer bewusst minimiert oder einfach zurücknavigiert hat.
 * Tippen führt zurück in den Raum. Minimieren trennt NICHTS: der meetManager
 * lebt außerhalb der Screens weiter, hier hängen nur Anzeige und zwei
 * Schnellzugriffe (Mikro, Auflegen) dran.
 *
 * WICHTIG — die Leiste liegt im normalen Layoutfluss, NICHT absolut darüber.
 * Als Overlay verdeckte sie die obere Navigation des oms-cluster in der
 * WebView. Der Inhalt darunter muss stattdessen SCHRUMPFEN, damit Kopf- und
 * Fußzeile der Webseite sichtbar bleiben. Deshalb rendert das Wurzel-Layout
 * die Leiste als Geschwisterelement über dem Stack und nicht darüberliegend.
 */
export function ActiveMeetingBar()
{
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const phase = useMeetStore((s) => s.phase);
  const micOn = useMeetStore((s) => s.micOn);
  const meeting = useMeetStore((s) => s.meeting);
  const roomId = useMeetStore((s) => s.roomId);
  const joinedAt = useMeetStore((s) => s.joinedAt);
  const remotes = useMeetStore((s) => s.remotes);

  const [elapsed, setElapsed] = useState(0);

  // Laufende Dauer, sobald wir drin sind.
  useEffect(() =>
  {
    if (!joinedAt) { setElapsed(0); return undefined; }
    setElapsed(Math.floor((Date.now() - joinedAt) / 1000));
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - joinedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [joinedAt]);

  const onRoomScreen = !!pathname && pathname.startsWith('/meet/room');
  const live = isMeetingLive({ phase });
  const visible = live && !onRoomScreen;

  // Einblenden statt Hereinschieben: im Layoutfluss würde ein Slide die
  // darunterliegende WebView bei jedem Frame neu umbrechen.
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() =>
  {
    Animated.timing(fade, {
      toValue: visible ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [visible, fade]);

  if (!visible) return null;

  const others = remotes?.size ?? 0;
  const statusLabel = phase === 'joining'
    ? 'Verbinde…'
    : `${ formatDuration(elapsed) }  ·  ${ others + 1 } ${ others + 1 === 1 ? 'Teilnehmer' : 'Teilnehmer' }`;

  const expand = () =>
  {
    useMeetStore.getState().setMinimized(false);
    if (roomId) router.push(`/meet/room/${ roomId }`);
  };

  return (
    <Animated.View
      style={{
        backgroundColor: dark.bg,
        opacity: fade,
      }}
    >
      <Pressable
        onPress={expand}
        accessibilityRole="button"
        accessibilityLabel="Zurück zum Meeting"
        style={{
          marginTop: insets.top + 4,
          marginBottom: 4,
          marginHorizontal: 10,
          paddingLeft: 14, paddingRight: 8, paddingVertical: 8,
          borderRadius: 16,
          backgroundColor: BRAND,
          flexDirection: 'row', alignItems: 'center', gap: 10,
          shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 }, elevation: 6,
        }}
      >
        <View
          style={{
            width: 30, height: 30, borderRadius: 15,
            backgroundColor: 'rgba(255,255,255,0.2)',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Ionicons name="videocam" size={16} color="#fff" />
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
            {meeting?.title || 'Meeting'}
          </Text>
          <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11.5, fontWeight: '500' }}>
            {statusLabel}
          </Text>
        </View>

        <Pressable
          onPress={() => meetManager.toggleMic()}
          accessibilityRole="button"
          accessibilityLabel={micOn ? 'Stummschalten' : 'Stummschaltung aufheben'}
          hitSlop={6}
          style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: micOn ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.42)',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Ionicons name={micOn ? 'mic' : 'mic-off'} size={18} color="#fff" />
        </Pressable>

        <Pressable
          onPress={() => { meetManager.leave().catch(() => {}); }}
          accessibilityRole="button"
          accessibilityLabel="Meeting verlassen"
          hitSlop={6}
          style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: '#DC2626',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Ionicons name="call" size={18} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

function formatDuration(secs)
{
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${ String(m).padStart(2, '0') }:${ String(s).padStart(2, '0') }`;
}
