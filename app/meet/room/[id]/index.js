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

  // ALLE laufenden Bildschirmfreigaben, nicht nur die erste. Teilen zwei
  // Personen gleichzeitig, sollen auch beide sichtbar sein.
  const sharers = useMemo(
    () => remoteList.filter((r) => r.screen_sharing && r.screenStreamUrl),
    [remoteList],
  );

  const visible = useMemo(
    () => pickVisible(remotes, speaking, lastSpokeAt, MAX_TILES),
    [remotes, speaking, lastSpokeAt],
  );

  const hiddenCount = Math.max(0, remoteList.length - visible.length);

  // Angetippte Kachel im Vollbild. Als Kennung statt als Objekt, damit der
  // Inhalt bei jedem Renderdurchlauf frisch aus dem Store kommt — sonst würde
  // das Vollbild einen eingefrorenen Schnappschuss zeigen.
  const [fullscreen, setFullscreen] = useState(null); // { deviceId, kind }

  const fullscreenTile = useMemo(() =>
  {
    if (!fullscreen) return null;
    if (fullscreen.deviceId === 'self')
    {
      return {
        streamUrl: localStreamUrl, name: 'Du', label: 'Du',
        cameraOn, micOn, mirror: true, conn: 'connected', objectFit: 'cover',
      };
    }
    const r = remotes.get(fullscreen.deviceId);
    if (!r) return null;
    if (fullscreen.kind === 'screen')
    {
      if (!r.screenStreamUrl) return null;
      return {
        streamUrl: r.screenStreamUrl,
        name: `${ r.display_name } teilt den Bildschirm`,
        label: `${ r.display_name } teilt den Bildschirm`,
        cameraOn: true, micOn: r.mic_on, conn: r.conn,
        // Bildschirme nie beschneiden — sonst fehlen Ränder mit Inhalt.
        objectFit: 'contain',
      };
    }
    return {
      streamUrl: r.streamUrl, name: r.display_name, isHost: r.is_host,
      cameraOn: r.camera_on, micOn: r.mic_on, conn: r.conn,
      speaking: speaking.has(r.device_id), handUp: !!handsUp[r.device_id],
      objectFit: 'cover',
    };
  }, [fullscreen, remotes, localStreamUrl, cameraOn, micOn, speaking, handsUp]);

  // Verlässt die Quelle das Meeting (oder endet die Freigabe), Vollbild schließen.
  useEffect(() =>
  {
    if (fullscreen && !fullscreenTile) setFullscreen(null);
  }, [fullscreen, fullscreenTile]);

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

            {sharers.length > 0 ? (
              <ScreenShareStage
                sharers={sharers}
                others={visible.filter((r) => !sharers.some((s2) => s2.device_id === r.device_id))}
                speaking={speaking}
                handsUp={handsUp}
                localStreamUrl={localStreamUrl}
                cameraOn={cameraOn}
                micOn={micOn}
                onOpen={setFullscreen}
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
                onOpen={setFullscreen}
              />
            )}
          </View>
        )}

      {/* Vollbild einer angetippten Kachel. Liegt über der Bühne, aber UNTER
          nichts — die Steuerleiste bleibt darunter bedienbar, damit man auch im
          Vollbild stummschalten oder auflegen kann. */}
      {fullscreenTile && (
        <Pressable
          style={[styles.fullscreen, { paddingTop: insets.top }]}
          onPress={() => setFullscreen(null)}
        >
          <VideoTile {...fullscreenTile} style={styles.fullscreenTile} />
          <Pressable
            onPress={() => setFullscreen(null)}
            hitSlop={10}
            style={[styles.fullscreenClose, { top: insets.top + 8 }]}
          >
            <Ionicons name="contract" size={22} color={dark.text} />
          </Pressable>
        </Pressable>
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
function Grid({ visible, speaking, handsUp, localStreamUrl, cameraOn, micOn, hiddenCount, onOpen })
{
  const tiles = [
    {
      key: 'self',
      open: { deviceId: 'self', kind: 'camera' },
      props: {
        streamUrl: localStreamUrl, name: 'Du', label: 'Du',
        cameraOn, micOn, mirror: true, conn: 'connected',
      },
    },
    ...visible.map((r) => ({
      key: r.device_id,
      open: { deviceId: r.device_id, kind: 'camera' },
      props: {
        streamUrl: r.streamUrl, name: r.display_name, isHost: r.is_host,
        cameraOn: r.camera_on, micOn: r.mic_on,
        speaking: speaking.has(r.device_id), handUp: !!handsUp[r.device_id],
        conn: r.conn,
      },
    })),
  ];

  // Bei zwei Kacheln untereinander, sonst zweispaltig — so bleiben die Bilder
  // auf einem Hochkant-Display möglichst groß.
  const twoUp = tiles.length <= 2;

  return (
    <View style={styles.gridWrap}>
      <View style={[styles.grid, twoUp && styles.gridColumn]}>
        {tiles.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => onOpen(t.open)}
            style={twoUp ? styles.gridCellFull : styles.gridCellHalf}
          >
            <VideoTile {...t.props} style={styles.gridTile} />
          </Pressable>
        ))}
      </View>
      {hiddenCount > 0 && (
        <Text style={styles.moreHint}>+{hiddenCount} weitere im Meeting</Text>
      )}
    </View>
  );
}

/**
 * Bildschirmfreigabe(n) groß, Personen als Streifen darunter.
 *
 * Teilen mehrere gleichzeitig, werden alle gezeigt — untereinander, damit jede
 * Freigabe die volle Breite behält. Lesbarkeit geht hier vor Kachelgröße:
 * geteilte Bildschirme enthalten meist Text.
 */
function ScreenShareStage({ sharers, others, speaking, handsUp, localStreamUrl, cameraOn, micOn, onOpen })
{
  return (
    <View style={styles.shareWrap}>
      <View style={styles.shareMainWrap}>
        {sharers.map((sh) => (
          <Pressable
            key={`screen-${ sh.device_id }`}
            onPress={() => onOpen({ deviceId: sh.device_id, kind: 'screen' })}
            style={styles.shareMainCell}
          >
            <VideoTile
              streamUrl={sh.screenStreamUrl}
              name={`${ sh.display_name } teilt den Bildschirm`}
              label={`${ sh.display_name } teilt den Bildschirm`}
              cameraOn
              micOn={sh.mic_on}
              conn={sh.conn}
              objectFit="contain"
              style={styles.shareMain}
            />
          </Pressable>
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        <Pressable onPress={() => onOpen({ deviceId: 'self', kind: 'camera' })}>
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
        </Pressable>

        {/* Auch die Teilenden selbst als Kamerakachel — sonst sieht man den
            Bildschirm, aber nicht die Person dahinter. */}
        {[...sharers, ...others].map((r) => (
          <Pressable
            key={r.device_id}
            onPress={() => onOpen({ deviceId: r.device_id, kind: 'camera' })}
          >
            <VideoTile
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
          </Pressable>
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
  // Mehrere Freigaben untereinander: geteilte Bildschirme enthalten meist Text,
  // volle Breite ist wichtiger als eine gleichmässige Kachelgröße.
  shareMainWrap: { flex: 1, gap: 8 },
  shareMainCell: { flex: 1 },
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

  fullscreen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 20,
    padding: 6,
  },
  fullscreenTile: { flex: 1 },
  fullscreenClose: {
    position: 'absolute', right: 14,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },

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
