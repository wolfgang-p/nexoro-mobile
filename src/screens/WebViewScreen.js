import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  Platform,
  Alert,
  Linking,
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildDomain, toLabel } from '../utils/instances';

// Verhindert sowohl den Pinch-Zoom (zwei Finger) als auch den automatischen
// Zoom, den iOS beim Fokussieren eines Input-Feldes auslöst. Wird vor dem
// Laden der Seite injiziert und reagiert zusätzlich auf dynamisch nachgeladene
// Inhalte (z. B. SPA-Login), damit das Viewport-Tag erhalten bleibt.
const DISABLE_ZOOM_JS = `
(function() {
  function lockViewport() {
    var content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover';
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      (document.head || document.documentElement).appendChild(meta);
    }
    if (meta.getAttribute('content') !== content) {
      meta.setAttribute('content', content);
    }
  }
  // iOS zoomt beim Fokussieren in Felder mit Schriftgröße < 16px hinein.
  // Wir erzwingen daher mindestens 16px für alle Formularfelder – global auf
  // jeder Seite, nicht nur im Login.
  function lockFontSize() {
    var styleId = '__no_zoom_font_style';
    if (!document.getElementById(styleId)) {
      var style = document.createElement('style');
      style.id = styleId;
      style.appendChild(document.createTextNode(
        'input, select, textarea, [contenteditable] { font-size: 16px !important; }'
      ));
      (document.head || document.documentElement).appendChild(style);
    }
    // Direkt am Element setzen, damit auch Inline-Styles der Seite überstimmt werden.
    var fields = document.querySelectorAll('input, select, textarea, [contenteditable]');
    for (var i = 0; i < fields.length; i++) {
      if (fields[i].style.fontSize !== '16px') {
        fields[i].style.setProperty('font-size', '16px', 'important');
      }
    }
  }
  lockViewport();
  lockFontSize();
  document.addEventListener('DOMContentLoaded', function() { lockViewport(); lockFontSize(); });
  // Falls die Seite das Viewport-Tag später überschreibt, erneut setzen.
  if (window.MutationObserver) {
    var obs = new MutationObserver(function() { lockViewport(); lockFontSize(); });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }
  // Verhindert Pinch-Zoom über Gesten-Events (iOS Safari/WKWebView).
  document.addEventListener('gesturestart', function(e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturechange', function(e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('gestureend', function(e) { e.preventDefault(); }, { passive: false });
  // Verhindert Double-Tap-Zoom.
  var lastTouch = 0;
  document.addEventListener('touchend', function(e) {
    var now = Date.now();
    if (now - lastTouch <= 300) { e.preventDefault(); }
    lastTouch = now;
  }, { passive: false });
  true;
})();
`;

// Bridge web → native. Markiert die Seite als "läuft in der App"
// (Klasse .nexoro-native-app auf <html>, sodass das oms-cluster Menü den
// Punkt "Instanz wechseln" einblendet) und stellt window.nexoroOpenInstanceSwitcher()
// bereit, das den nativen Switcher per postMessage öffnet.
const NATIVE_BRIDGE_JS = `
(function() {
  window.NEXORO_NATIVE = true;
  window.nexoroOpenInstanceSwitcher = function() {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'nexoro:open-instance-switcher' }));
    } catch (e) {}
  };
  function flag() {
    if (document.documentElement) {
      document.documentElement.classList.add('nexoro-native-app');
    }
  }
  flag();
  document.addEventListener('DOMContentLoaded', flag);
})();
true;
`;

// Zoom-Lock + App-Bridge zusammen vor und nach dem Laden injizieren, damit
// SPA-Navigation beides behält.
const INJECT_ALL = DISABLE_ZOOM_JS + '\n' + NATIVE_BRIDGE_JS;

// Message, die die Webseite schickt, um den Instanz-Switcher zu öffnen.
const SWITCHER_MESSAGE = 'nexoro:open-instance-switcher';

// Entscheidet, ob eine URL innerhalb der App (WebView) geöffnet werden soll
// oder extern (echter Browser / System-Handler). Alles auf einer nexoro.net
// Subdomain bleibt in der App. tel:/mailto:/etc. gehen an das System, fremde
// http(s)-Domains öffnen wir bewusst im externen Browser.
function shouldStayInApp(rawUrl)
{
  if (!rawUrl) return false;
  const lower = rawUrl.toLowerCase();
  // App-interne Schemata und relative Navigation bleiben immer drin.
  if (lower.startsWith('about:') || lower.startsWith('data:') || lower.startsWith('blob:'))
  {
    return true;
  }
  if (lower.startsWith('http://') || lower.startsWith('https://'))
  {
    try
    {
      const host = lower.split('/')[2] || '';
      // Eigene Instanzen (…​.nexoro.net) und nexoro.net selbst bleiben in der App.
      return host === 'nexoro.net' || host.endsWith('.nexoro.net');
    } catch (e)
    {
      return false;
    }
  }
  // Nicht-http(s) Schemata (tel:, mailto:, …) übernimmt das System.
  return false;
}

const COLORS = {
  primary: '#40BCC7',
  background: '#F8FAFC',
  card: '#FFFFFF',
  text: '#1E293B',
  subtext: '#64748B',
  border: '#E2E8F0',
  error: '#EF4444',
};

export default function WebViewScreen({
  url,
  domains = [],
  onSelectDomain,
  onAddDomain,
  onRemoveDomain,
})
{
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const webViewRef = useRef(null);
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const [newSubdomain, setNewSubdomain] = useState('');
  const [adding, setAdding] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Tastaturhöhe selbst verfolgen, statt KeyboardAvoidingView zu benutzen:
  // Das Sheet ist höhenbegrenzt (maxHeight), und ein reines Hochschieben per
  // padding würde den oberen Teil (Liste) aus dem Bild schieben. Stattdessen
  // schrumpfen wir das Sheet um die Tastaturhöhe, die Liste gibt dabei nach.
  useEffect(() =>
  {
    // Auf iOS liefert "willShow" die Höhe vor der Animation -> kein Ruckeln.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) =>
    {
      // Android läuft mit softwareKeyboardLayoutMode "resize" (Expo-Default):
      // Das Fenster wird dort bereits verkleinert, useWindowDimensions liefert
      // also schon die reduzierte Höhe. Ein zusätzliches Abziehen würde den
      // Platz doppelt wegnehmen -> nur auf iOS selbst kompensieren.
      if (Platform.OS !== 'ios') return;
      setKeyboardHeight(e.endCoordinates ? e.endCoordinates.height : 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));

    return () =>
    {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Safe check for URL validity
  if (!url)
  {
    return (
      <View style={styles.errorContainer}>
        <Text>No URL provided</Text>
      </View>
    );
  }

  const openSwitcher = () =>
  {
    setNewSubdomain('');
    setSwitcherVisible(true);
  };

  // Webseite (oms-cluster Menü "Instanz wechseln") bittet um den Switcher.
  const handleWebViewMessage = (event) =>
  {
    try
    {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg && msg.type === SWITCHER_MESSAGE)
      {
        openSwitcher();
      }
    } catch (e)
    {
      // Nicht-JSON-Nachrichten ignorieren.
    }
  };

  // Fängt Navigationen ab, bevor sie geladen werden. So verhindern wir, dass
  // Links (auch target="_blank") den externen Browser aufmachen: nexoro-URLs
  // bleiben in der WebView, alles andere übergeben wir dem System.
  const handleShouldStartLoad = (request) =>
  {
    const targetUrl = request && request.url;
    if (shouldStayInApp(targetUrl))
    {
      return true;
    }
    // Externe URLs / tel: / mailto: an den System-Handler geben, aber die
    // WebView selbst nicht dorthin navigieren lassen.
    if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')
      || targetUrl.startsWith('tel:') || targetUrl.startsWith('mailto:')))
    {
      Linking.openURL(targetUrl).catch(() => {});
    }
    return false;
  };

  // Wird ausgelöst, wenn die Seite window.open() aufruft oder ein Link mit
  // target="_blank" angeklickt wird. Statt ein neues Fenster / einen Browser
  // zu öffnen, laden wir die Ziel-URL in derselben WebView nach.
  const handleOpenWindow = (event) =>
  {
    const targetUrl = event && event.nativeEvent && event.nativeEvent.targetUrl;
    if (!targetUrl) return;
    if (shouldStayInApp(targetUrl))
    {
      if (webViewRef.current)
      {
        webViewRef.current.injectJavaScript(
          `window.location.href = ${ JSON.stringify(targetUrl) }; true;`
        );
      }
    } else
    {
      Linking.openURL(targetUrl).catch(() => {});
    }
  };

  const handleSelect = async (domain) =>
  {
    setSwitcherVisible(false);
    if (domain !== url)
    {
      await onSelectDomain(domain);
    }
  };

  const handleAdd = async () =>
  {
    if (!newSubdomain.trim())
    {
      Alert.alert('Fehler', 'Bitte geben Sie eine gültige Domain ein.');
      return;
    }
    setAdding(true);
    try
    {
      const fullDomain = buildDomain(newSubdomain);
      await onAddDomain(fullDomain);
      setNewSubdomain('');
      setSwitcherVisible(false);
    } catch (e)
    {
      console.error('Failed to add instance', e);
      Alert.alert('Fehler', 'Instanz konnte nicht hinzugefügt werden.');
    } finally
    {
      setAdding(false);
    }
  };

  const handleRemove = (domain) =>
  {
    Alert.alert(
      'Instanz entfernen',
      `Möchten Sie "${ toLabel(domain) }" wirklich entfernen?`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Entfernen',
          style: 'destructive',
          onPress: () => onRemoveDomain(domain),
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="dark" />

      <WebView
        ref={webViewRef}
        source={{ uri: url }}
        style={styles.webview}
        startInLoadingState={true}
        scalesPageToFit={false}
        injectedJavaScriptBeforeContentLoaded={INJECT_ALL}
        injectedJavaScript={INJECT_ALL}
        onMessage={handleWebViewMessage}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onOpenWindow={handleOpenWindow}
        setSupportMultipleWindows={true}
        javaScriptCanOpenWindowsAutomatically={true}
        setBuiltInZoomControls={false}
        setDisplayZoomControls={false}
        // Persistente Cookies: das oms-cluster setzt beim Login mit
        // "Anmeldedaten speichern" einen 30-Tage-Cookie `crm_remember`
        // (HttpOnly, signiert, siehe login.php + layout_header.php).
        // Ohne diese beiden Props liegen die Cookies der WebView nur im
        // Speicher und sind nach dem Schließen der App weg — der Nutzer
        // müsste sich jedes Mal neu anmelden.
        //   iOS:     sharedCookiesEnabled nutzt den persistenten
        //            NSHTTPCookieStorage statt eines flüchtigen Stores.
        //   Android: thirdPartyCookiesEnabled hält den CookieManager aktiv;
        //            der Flush auf die Platte passiert im RNCWebViewClient
        //            nach jedem Seiten-Load.
        sharedCookiesEnabled={true}
        thirdPartyCookiesEnabled={true}
        // Cache mitbenutzen, damit die Session-Wiederherstellung auch
        // offline/bei langsamem Netz nicht in einen Fehler läuft.
        cacheEnabled={true}
        incognito={false}
        renderLoading={() => (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        )}
      />

      <Modal
        visible={switcherVisible}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setSwitcherVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.backdrop}
            activeOpacity={1}
            onPress={() => setSwitcherVisible(false)}
          />
          <View
            style={[
              styles.sheet,
              {
                // Sheet endet immer oberhalb der Tastatur; bei geschlossener
                // Tastatur bleibt der Safe-Area-Abstand unten erhalten.
                marginBottom: keyboardHeight,
                paddingBottom: (keyboardHeight > 0 ? 16 : insets.bottom + 16),
                maxHeight: Math.max(
                  240,
                  (windowHeight - keyboardHeight - insets.top) * 0.92
                ),
              },
            ]}
          >
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Instanz wechseln</Text>

            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={true}
            >
              {domains.map((domain) =>
              {
                const isActive = domain === url;
                return (
                  <View key={domain} style={styles.itemRow}>
                    <TouchableOpacity
                      style={[styles.item, isActive && styles.itemActive]}
                      onPress={() => handleSelect(domain)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.itemTextWrap}>
                        <Text
                          style={[styles.itemText, isActive && styles.itemTextActive]}
                          numberOfLines={1}
                        >
                          {toLabel(domain)}
                        </Text>
                      </View>
                      {isActive && <Text style={styles.checkmark}>✓</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.removeButton}
                      onPress={() => handleRemove(domain)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.removeButtonText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>

            <Text style={styles.addLabel}>Neue Instanz hinzufügen</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="nexoro"
                placeholderTextColor={COLORS.subtext}
                value={newSubdomain}
                onChangeText={setNewSubdomain}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleAdd}
                editable={!adding}
              />
              <View style={styles.suffixContainer}>
                <Text style={styles.suffixText}>.nexoro.net</Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.addButton, adding && styles.addButtonDisabled]}
              onPress={handleAdd}
              activeOpacity={0.8}
              disabled={adding}
            >
              <Text style={styles.addButtonText}>
                {adding ? 'Hinzufügen...' : 'Hinzufügen'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  webview: {
    flex: 1,
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.card,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Switcher modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    // maxHeight wird zur Laufzeit gesetzt (abhängig von der Tastaturhöhe).
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
  },
  list: {
    // Die Liste ist der einzige Teil, der nachgeben darf: Titel, Eingabefeld
    // und Button behalten ihre Höhe, die Liste schrumpft und wird scrollbar.
    flexGrow: 0,
    flexShrink: 1,
    marginBottom: 8,
  },
  listContent: {
    paddingBottom: 4,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  item: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  itemActive: {
    borderColor: COLORS.primary,
    backgroundColor: '#EFF6FF',
  },
  itemTextWrap: {
    flex: 1,
    marginRight: 8,
  },
  itemText: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  itemTextActive: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  checkmark: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.primary,
  },
  removeButton: {
    marginLeft: 8,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF2F2',
  },
  removeButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.error,
  },
  addLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 8,
    marginBottom: 8,
    marginLeft: 4,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderColor: COLORS.border,
    borderWidth: 1.5,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    overflow: 'hidden',
    height: 56,
    marginBottom: 12,
  },
  input: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 16,
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '500',
  },
  suffixContainer: {
    height: '100%',
    paddingHorizontal: 16,
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: COLORS.border,
  },
  suffixText: {
    fontSize: 16,
    color: COLORS.subtext,
    fontWeight: '600',
  },
  addButton: {
    width: '100%',
    height: 56,
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonDisabled: {
    backgroundColor: COLORS.subtext,
  },
  addButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
