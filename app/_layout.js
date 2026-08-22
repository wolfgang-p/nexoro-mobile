import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useInstanceStore } from '../stores/instanceStore';
import { ActiveMeetingBar } from '../components/meet/ActiveMeetingBar';
import { useMeetingDeepLinks } from '../lib/meet/deepLinks';

const COLORS = { primary: '#40BCC7', background: '#F8FAFC' };

/**
 * Wurzel-Layout.
 *
 * Ersetzt das frühere App.js. Zwei Aufgaben, die es vorher nicht gab:
 *   • Instanzen einmalig laden (jetzt im Store statt im Component-State,
 *     weil der Meeting-Screen auf einer eigenen Route liegt)
 *   • Die Minimier-Leiste global montieren, damit sie über der WebView UND
 *     über jedem anderen Screen liegt
 */
export default function RootLayout()
{
  const loading = useInstanceStore((s) => s.loading);
  const init = useInstanceStore((s) => s.init);

  useEffect(() => { init(); }, [init]);

  // meet.nexoro.net/m/<id> öffnet den Beitritts-Ablauf statt des Browsers.
  useMeetingDeepLinks();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : (
          /* Die Meeting-Leiste steht ÜBER dem Stack im Layoutfluss (Spalte),
             nicht als Overlay darüber. Dadurch schrumpft der Bereich darunter,
             statt verdeckt zu werden — die obere Navigation und die Fußzeile
             des oms-cluster bleiben in der WebView sichtbar. */
          <View style={{ flex: 1 }}>
            <ActiveMeetingBar />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: COLORS.background },
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="meet/index" />
              <Stack.Screen name="meet/new" />
              <Stack.Screen name="meet/join/[id]" />
              {/* Meeting-Räume kommen von unten und liegen über allem — der
                  Raum ist Vollbild und kehrt per Zurück-Pfeil nach Nexoro
                  zurück, ohne die WebView darunter neu zu laden. Die Wisch-
                  Geste ist deaktiviert, damit man nicht versehentlich aus
                  einem laufenden Meeting rutscht. */}
              <Stack.Screen
                name="meet/room/[id]/index"
                options={{ animation: 'slide_from_bottom', gestureEnabled: false }}
              />
              <Stack.Screen
                name="meet/room/[id]/more"
                options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
              />
            </Stack>
          </View>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
