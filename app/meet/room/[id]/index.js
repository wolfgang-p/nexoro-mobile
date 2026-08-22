import React, { useCallback, useEffect, useMemo, useState } from 'react';
import
  {
    View, Text, Pressable, StyleSheet, ScrollView,
    ActivityIndicator, BackHandler,
  } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useMeetStore } from '../../../../stores/meetStore';
import { meetManager } from '../../../../lib/meet/meetManager';
import { useActiveSpeakers, pickVisible } from '../../../../lib/meet/activeSpeaker';
import { VideoTile } from '../../../../components/meet/VideoTile';
import { dark, radius } from '../../../../lib/meet/theme';

const MAX_TILES = 4;

/**
 * Meeting-Raum — Vollbild, dunkel, video-first.
 *
 * Zeigt höchstens vier Kacheln gleichzeitig: die, die gerade sprechen oder
 * zuletzt gesprochen haben. Teilt jemand seinen Bildschirm, tritt der an die
 * Stelle des Rasters und die Personen rutschen in eine Leiste darunter.
 *
 * Der Screen hält KEINEN Verbindungszustand. Alles Langlebige liegt im
 * meetManager, damit Minimieren (Zurück-Pfeil oben links) den Screen abbauen
 * kann, ohne aufzulegen.
 */
export default function MeetingRoom()
{
  const { id: roomId } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const phase = useMeetStore((s) => s.phase);
  const meeting = useMeetStore((s) => s.meeting);
  const remotes = useMeetStore((s) => s.remotes);
  const participants = useMeetStore((s) => s.participants);
  const localStreamUrl = useMeetStore((s) => s.localStreamUrl);
  const micOn = useMeetStore((s) => s.micOn);
  const cameraOn = useMeetStore((s) => s.cameraOn);
  const screenSharing = useMeetStore((s) => s.screenSharing);
  const view = useMeetStore((s) => s.view);
  const handsUp = useMeetStore((s) => s.handsUp);
  const unreadChat = useMeetStore((s) => s.unreadChat);
  const turnAvailable = useMeetStore((s) => s.turnAvailable);
  const error = useMeetStore((s) => s.error);

  const [handRaised, setHandRaised] = useState(false);

  const { speaking, lastSpokeAt } = useActiveSpeakers(meetManager.mesh, remotes);

  // Zurück-Geste am Gerät = minimieren, nicht auflegen.
  useEffect(() =>
  {
    const sub = BackHandler.addEventListener('hardwareBackPress', () =>
    {
      minimize();
      return true;
    });
    return () => sub.remove();
  });

  // Beendet der Host das Meeting oder werden wir entfernt, hier hinausführen.
  useEffect(() =>
  {
    if (phase === 'ended')
    {
      const t = setTimeout(() =>
      {
        useMeetStore.getState().reset();
        router.replace('/meet');
      }, 2200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [phase, router]);

  const minimize = useCallback(() =>
  {
    useMeetStore.getState().setMinimized(true);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const leave = useCallback(async () =>
  {
    await meetManager.leave().catch(() => {});
    router.replace('/meet');
  }, [router]);

  const toggleHand = useCallback(() =>
  {
    const next = !handRaised;
    setHandRaised(next);
    meetManager.raiseHand(next);
  }, [handRaised]);

  const toggleScreenShare = useCallback(async () =>
  {
    try
    {
      if (screenSharing) await meetManager.stopScreenShare();
      else await meetManager.startScreenShare();
    } catch (e)
    {
      // Nutzer hat die Systemabfrage abgebrochen — kein Fehlerfall.
    }
  }, [screenSharing]);

  // ── Was ist zu sehen? ─────────────────────────────────────────────

  const remoteList = useMemo(() => Array.from(remotes.values()), [remotes]);

  // Teilt jemand den Bildschirm, hat der Vorrang vor dem Raster.
  const sharer = useMemo(
    () => remoteList.find((r) => r.screen_sharing && r.screenStreamUrl),
    [remoteList],
  );

  const visible = useMemo(
    () => pickVisible(remotes, speaking, lastSpokeAt, MAX_TILES),
    [remotes, speaking, lastSpokeAt],
  );

  const hiddenCount = Math.max(0, remoteList.length - visible.length);

  if (phase === 'idle')
  {
    // Direkt auf die Route gesprungen, ohne Beitritt — in die Lobby schicken.
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.infoText}>Kein aktives Meeting.</Text>
        <Pressable onPress={() => router.replace(`/meet/join/${ roomId }`)} style={styles.linkBtn}>
          <Text style={styles.linkBtnText}>Zur Lobby</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'ended')
  {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="checkmark-circle-outline" size={44} color={dark.brand} />
        <Text style={styles.endedTitle}>Meeting beendet</Text>
        {!!error && <Text style={styles.infoText}>{error}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Kopfzeile — der Minimieren-Pfeil sitzt links oben, wo er keine
          Kachel verdeckt. */}
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Pressable onPress={minimize} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-down" size={24} color={dark.text} />
        </Pressable>

        <View style={styles.headerCenter}>
          <Text numberOfLines={1} style={styles.headerTitle}>
            {meeting?.title || 'Meeting'}
          </Text>
          <Text style={styles.headerSub}>
            {participants.length || remoteList.length + 1} Teilnehmer
          </Text>
        </View>

        <Pressable
          onPress={() => useMeetStore.getState().setView(view === 'grid' ? 'people' : 'grid')}
          hitSlop={10}
          style={styles.headerBtn}
        >
          <Ionicons name={view === 'grid' ? 'people' : 'grid'} size={21} color={dark.text} />
        </Pressable>
      </View>

      {!turnAvailable && (
        <View style={styles.turnWarn}>
          <Ionicons name="warning-outline" size={13} color="#FCD34D" />
          <Text style={styles.turnWarnText}>
            Kein Relay verfügbar — im Mobilfunknetz kann die Verbindung scheitern.
          </Text>
        </View>
      )}

      {/* Bühne */}
      {view === 'people'
        ? <PeopleView participants={participants} remotes={remotes} handsUp={handsUp} />
        : (
          <View style={styles.stage}>
            {phase === 'joining' && (
              <View style={styles.joining}>
                <ActivityIndicator color={dark.brand} />
                <Text style={styles.infoText}>Verbinde…</Text>
              </View>
            )}

            {sharer ? (
              <ScreenShareStage
                sharer={sharer}
                others={visible.filter((r) => r.device_id !== sharer.device_id)}
                speaking={speaking}
                handsUp={handsUp}
                localStreamUrl={localStreamUrl}
                cameraOn={cameraOn}
                micOn={micOn}
              />
            ) : (
              <Grid
                visible={visible}
                speaking={speaking}
                handsUp={handsUp}
                localStreamUrl={localStreamUrl}
                cameraOn={cameraOn}
                micOn={micOn}
                hiddenCount={hiddenCount}
              />
            )}
          </View>
        )}

      {/* Steuerleiste */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 10 }]}>
        <CtrlBtn
          icon={micOn ? 'mic' : 'mic-off'}
          label="Mikro"
          off={!micOn}
          onPress={() => meetManager.toggleMic()}
        />
        <CtrlBtn
          icon={cameraOn ? 'videocam' : 'videocam-off'}
          label="Kamera"
          off={!cameraOn}
          onPress={() => meetManager.toggleCamera()}
        />
        <CtrlBtn
          icon="scan-outline"
          label="Teilen"
          active={screenSharing}
          onPress={toggleScreenShare}
        />
        <CtrlBtn
          icon="hand-left"
          label="Hand"
          active={handRaised}
          onPress={toggleHand}
        />
        <CtrlBtn
          icon="ellipsis-vertical"
          label="Mehr"
          badge={unreadChat}
          onPress={() => router.push(`/meet/room/${ roomId }/more`)}
        />
        <CtrlBtn
          icon="call"
          label="Auflegen"
          danger
          iconStyle={{ transform: [{ rotate: '135deg' }] }}
          onPress={leave}
        />
      </View>
    </View>
  );
}

// ── Bühnen-Varianten ────────────────────────────────────────────────

/** Raster mit bis zu vier Kacheln — die eigene immer zuerst. */
function Grid({ visible, speaking, handsUp, localStreamUrl, cameraOn, micOn, hiddenCount })
{
  const tiles = [
    <VideoTile
      key="self"
      streamUrl={localStreamUrl}
      name="Du"
      label="Du"
      cameraOn={cameraOn}
      micOn={micOn}
      mirror
      conn="connected"
      style={styles.gridTile}
    />,
    ...visible.map((r) => (
      <VideoTile
        key={r.device_id}
        streamUrl={r.streamUrl}
        name={r.display_name}
        isHost={r.is_host}
        cameraOn={r.camera_on}
        micOn={r.mic_on}
        speaking={speaking.has(r.device_id)}
        handUp={!!handsUp[r.device_id]}
        conn={r.conn}
        style={styles.gridTile}
      />
    )),
  ];

  // Bei zwei Kacheln untereinander, sonst zweispaltig — so bleiben die Bilder
  // auf einem Hochkant-Display möglichst groß.
  const twoUp = tiles.length <= 2;

  return (
    <View style={styles.gridWrap}>
      <View style={[styles.grid, twoUp && styles.gridColumn]}>
        {tiles.map((t, i) => (
          <View key={i} style={twoUp ? styles.gridCellFull : styles.gridCellHalf}>
            {t}
          </View>
        ))}
      </View>
      {hiddenCount > 0 && (
        <Text style={styles.moreHint}>+{hiddenCount} weitere im Meeting</Text>
      )}
    </View>
  );
}

/** Bildschirmfreigabe groß, Personen als Streifen darunter. */
function ScreenShareStage({ sharer, others, speaking, handsUp, localStreamUrl, cameraOn, micOn })
{
  return (
    <View style={styles.shareWrap}>
      <VideoTile
        streamUrl={sharer.screenStreamUrl}
        name={`${ sharer.display_name } teilt den Bildschirm`}
        label={`${ sharer.display_name } teilt den Bildschirm`}
        cameraOn
        micOn={sharer.mic_on}
        conn={sharer.conn}
        objectFit="contain"
        style={styles.shareMain}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        <VideoTile
          streamUrl={localStreamUrl}
          name="Du"
          label="Du"
          cameraOn={cameraOn}
          micOn={micOn}
          mirror
          conn="connected"
          style={styles.stripTile}
        />
        <VideoTile
          streamUrl={sharer.streamUrl}
          name={sharer.display_name}
          isHost={sharer.is_host}
          cameraOn={sharer.camera_on}
          micOn={sharer.mic_on}
          speaking={speaking.has(sharer.device_id)}
          handUp={!!handsUp[sharer.device_id]}
          conn={sharer.conn}
          style={styles.stripTile}
        />
        {others.map((r) => (
          <VideoTile
            key={r.device_id}
            streamUrl={r.streamUrl}
            name={r.display_name}
            isHost={r.is_host}
            cameraOn={r.camera_on}
            micOn={r.mic_on}
            speaking={speaking.has(r.device_id)}
            handUp={!!handsUp[r.device_id]}
            conn={r.conn}
            style={styles.stripTile}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/** Mitgliedsansicht: alle Teilnehmer als Liste statt als Video. */
function PeopleView({ participants, remotes, handsUp })
{
  const rows = participants.length
    ? participants
    : Array.from(remotes.values()).map((r) => ({
      id: r.device_id,
      device_id: r.device_id,
      display_name: r.display_name,
      is_host: r.is_host,
      mic_on: r.mic_on,
      camera_on: r.camera_on,
    }));

  return (
    <ScrollView style={styles.people} contentContainerStyle={{ padding: 16, gap: 8 }}>
      {rows.map((p) => (
        <View key={p.id || p.device_id} style={styles.personRow}>
          <View style={styles.personAvatar}>
            <Text style={styles.personAvatarText}>
              {String(p.display_name || '?').trim().charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={styles.personName}>
              {p.display_name}
              {p.is_host ? '  ·  Host' : ''}
            </Text>
          </View>
          {!!handsUp[p.device_id] && <Text style={{ fontSize: 15 }}>✋</Text>}
          <Ionicons
            name={p.mic_on === false ? 'mic-off' : 'mic'}
            size={16}
            color={p.mic_on === false ? dark.danger : dark.subtext}
          />
          <Ionicons
            name={p.camera_on === false ? 'videocam-off' : 'videocam'}
            size={16}
            color={p.camera_on === false ? dark.faint : dark.subtext}
          />
        </View>
      ))}
    </ScrollView>
  );
}

// ── Steuerknopf ─────────────────────────────────────────────────────

function CtrlBtn({ icon, label, onPress, off, active, danger, badge, iconStyle })
{
  const bg = danger ? dark.danger : off ? dark.danger : active ? dark.brand : dark.control;
  return (
    <Pressable onPress={onPress} style={styles.ctrl} hitSlop={4}>
      <View style={[styles.ctrlCircle, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={21} color="#fff" style={iconStyle} />
        {badge > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        )}
      </View>
      <Text style={styles.ctrlLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: dark.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingBottom: 8, gap: 6,
  },
  headerBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: dark.control,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: dark.text, fontSize: 15, fontWeight: '700' },
  headerSub: { color: dark.faint, fontSize: 11.5, marginTop: 1 },

  turnWarn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: 12, marginBottom: 6,
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(252,211,77,0.12)',
  },
  turnWarnText: { flex: 1, color: '#FCD34D', fontSize: 11.5 },

  stage: { flex: 1 },
  joining: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', gap: 8, zIndex: 5,
  },
  infoText: { color: dark.subtext, fontSize: 14 },
  endedTitle: { color: dark.text, fontSize: 19, fontWeight: '700' },
  linkBtn: {
    marginTop: 8, paddingHorizontal: 18, paddingVertical: 11,
    borderRadius: radius.md, backgroundColor: dark.brand,
  },
  linkBtnText: { color: '#fff', fontWeight: '700' },

  gridWrap: { flex: 1, paddingHorizontal: 8, paddingBottom: 4 },
  grid: {
    flex: 1, flexDirection: 'row', flexWrap: 'wrap',
  },
  gridColumn: { flexDirection: 'column' },
  gridCellHalf: { width: '50%', height: '50%', padding: 4 },
  gridCellFull: { width: '100%', flex: 1, padding: 4 },
  gridTile: { flex: 1 },
  moreHint: {
    color: dark.faint, fontSize: 12, textAlign: 'center', paddingVertical: 6,
  },

  shareWrap: { flex: 1, paddingHorizontal: 8, gap: 8 },
  shareMain: { flex: 1 },
  strip: { gap: 8, paddingBottom: 6 },
  stripTile: { width: 108, height: 80, flex: 0 },

  people: { flex: 1 },
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

  controls: {
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-start',
    paddingTop: 12, paddingHorizontal: 6,
    borderTopWidth: 1, borderTopColor: dark.border,
  },
  ctrl: { alignItems: 'center', gap: 5, minWidth: 52 },
  ctrlCircle: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  ctrlLabel: { color: dark.faint, fontSize: 10.5, fontWeight: '600' },
  badge: {
    position: 'absolute', top: -2, right: -2,
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: dark.danger,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});
