import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { Ionicons } from '@expo/vector-icons';

import { dark, radius } from '../../lib/meet/theme';

/**
 * Eine Teilnehmer-Kachel: Video oder Initialen-Avatar, plus Statusabzeichen.
 *
 * Zeigt bewusst auch den Verbindungszustand an. Eine schwarze Kachel ohne
 * Erklärung ist der häufigste Verwirrungsgrund — "verbinde…" bzw. ein
 * Verbindungshinweis sagt dem Nutzer, dass es an der Leitung liegt und nicht
 * daran, dass die Gegenseite die Kamera aus hat.
 */
export function VideoTile({
  streamUrl,
  name,
  isHost,
  cameraOn = true,
  micOn = true,
  speaking = false,
  handUp = false,
  conn = 'connected',
  mirror = false,
  objectFit = 'cover',
  label,
  style,
})
{
  const connecting = conn === 'new' || conn === 'connecting';
  const trouble = conn === 'failed' || conn === 'disconnected';
  const showVideo = !!streamUrl && cameraOn && !trouble;

  return (
    <View style={[styles.tile, speaking && styles.tileSpeaking, style]}>
      {showVideo ? (
        <RTCView
          streamURL={streamUrl}
          style={StyleSheet.absoluteFill}
          objectFit={objectFit}
          mirror={mirror}
          zOrder={0}
        />
      ) : (
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(name)}</Text>
          </View>
        </View>
      )}

      {(connecting || trouble) && (
        <View style={styles.statusOverlay}>
          <Text style={styles.statusText}>
            {trouble ? 'Verbindungsproblem' : 'Verbinde…'}
          </Text>
        </View>
      )}

      {/* Fußzeile: Name, Host-Kennzeichen, Mikrofon-Status */}
      <View style={styles.footer}>
        {!micOn && (
          <View style={styles.mutedBadge}>
            <Ionicons name="mic-off" size={11} color="#fff" />
          </View>
        )}
        <Text numberOfLines={1} style={styles.name}>
          {label || name}
          {isHost ? '  ·  Host' : ''}
        </Text>
      </View>

      {handUp && (
        <View style={styles.handBadge}>
          <Text style={styles.handEmoji}>✋</Text>
        </View>
      )}
    </View>
  );
}

function initials(name)
{
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?';
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    backgroundColor: dark.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tileSpeaking: {
    borderColor: dark.brand,
  },
  avatarWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: dark.surfaceHi,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: dark.text, fontSize: 22, fontWeight: '700' },
  statusOverlay: {
    position: 'absolute', top: 8, left: 8,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  statusText: { color: dark.text, fontSize: 11, fontWeight: '600' },
  footer: {
    position: 'absolute', left: 8, right: 8, bottom: 8,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  mutedBadge: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: dark.danger,
    alignItems: 'center', justifyContent: 'center',
  },
  name: {
    flex: 1,
    color: dark.text, fontSize: 12, fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  handBadge: {
    position: 'absolute', top: 8, right: 8,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  handEmoji: { fontSize: 14 },
});
