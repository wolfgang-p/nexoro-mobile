import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Redirect, useGlobalSearchParams } from 'expo-router';

import { parseMeetingUrl } from '../lib/meet/deepLinks';
import { light, radius } from '../lib/meet/theme';

/**
 * Auffangseite für Pfade, die zu keiner Route passen.
 *
 * Ohne diese Datei zeigt expo-router seine eingebaute Entwicklerseite
 * ("Unmatched Route") — im fertigen Build eine Sackgasse, die niemand
 * versteht. Landet hier trotzdem ein Meeting-Link, leiten wir ihn in den
 * Beitritts-Ablauf; alles andere führt zurück in die Nexoro-Ansicht, statt den
 * Nutzer stehen zu lassen.
 */
export default function NotFound()
{
  const params = useGlobalSearchParams();

  // Letzte Rettung: kam hier ein Meeting-Link an, den keine Route gefasst hat,
  // ziehen wir die Raum-Kennung selbst heraus.
  const raw = typeof params?.url === 'string' ? params.url : null;
  const roomId = parseMeetingUrl(raw);
  if (roomId) return <Redirect href={`/meet/join/${ encodeURIComponent(roomId) }`} />;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Seite nicht gefunden</Text>
      <Text style={styles.text}>
        Dieser Link führt zu keiner Ansicht in der App.
      </Text>
      <Redirect href="/" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: 24, gap: 10, backgroundColor: light.bg,
  },
  title: { fontSize: 18, fontWeight: '700', color: light.text },
  text: { fontSize: 14, color: light.subtext, textAlign: 'center' },
});
