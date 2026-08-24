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
  useWindowDimensions, AppState } from 'react-native';
import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { buildDomain, toLabel, ONBOARDING_URL, APP_UA_MARKER } from '../utils/instances';
import { parseMeetingUrl } from '../../lib/meet/deepLinks';
import { useMeetStore, isMeetingLive } from '../../stores/meetStore';
import
  {
    getDeviceId, getPushToken, buildRegisterScript,
    buildUnregisterScript, configureForegroundHandler,
  } from '../../lib/push';
import { bauScheinSkript, loeseScheinEin, loescheSipZugang, holeSipZugang } from '../../lib/phone/sipZugang';
import { phoneManager } from '../../lib/phone/phoneManager';
import { voipTokenNachreichen } from '../../lib/phone/voipPush';
import { usePhoneStore } from '../../stores/phoneStore';

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
  // Meetings laufen nativ in der App statt als Weiterleitung auf
  // meet.nexoro.net. Das oms-cluster-Menue ruft diese Funktion auf, wenn es
  // die Klasse .nexoro-native-app am <html> sieht.
  window.nexoroOpenMeetings = function() {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'nexoro:open-meetings' }));
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
// App-Version fuer das Geraete-Register (rein informativ in der Uebersicht).
const APP_VERSION = Constants.expoConfig?.version || null;

const SWITCHER_MESSAGE = 'nexoro:open-instance-switcher';
// Die Seite reicht einen Einmal-Schein herein, mit dem die App die
// SIP-Zugangsdaten NATIV abholt - das Passwort selbst laeuft nie durch die
// WebView. Siehe lib/phone/sipZugang.js.
const SIP_TICKET_MESSAGE = 'nexoro:sip-ticket';
// Ein Anruf-Knopf im CRM wurde gedrueckt. Statt die Telefonanlage zurueckrufen
// zu lassen (originate), waehlt die App direkt - siehe
// oms-cluster/dist/js/nexoro-call-bridge.js.
const PLACE_CALL_MESSAGE = 'nexoro:place-call';
// Der schwebende Knopf auf /anrufe: oeffnet nur die Waehltastatur, ohne
// bereits eine Nummer zu waehlen. Deshalb eine eigene Nachricht - place-call
// steigt bei leerer Nummer aus.
const OPEN_DIALPAD_MESSAGE = 'nexoro:open-dialpad';

// Message des Onboarding-Funnels, sobald eine Instanz fertig provisioniert ist.
// Gegenstück: notifyNativeInstanceCreated() in oms-cluster
// onboarding-wizard/wizard.js.
const CREATED_MESSAGE = 'nexoro:instance-created';

// Message, die die Webseite schickt, um die native Meeting-Oberflaeche zu
// oeffnen (Menuepunkt "Meetings").
const MEETINGS_MESSAGE = 'nexoro:open-meetings';

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

/**
 * Vollbild-Modal mit dem öffentlichen Onboarding-Funnel.
 *
 * Eigene WebView statt Navigation der Haupt-WebView: die aktive Instanz bleibt
 * dahinter im Zustand (eingeloggt, Scrollposition), und ein Abbruch führt
 * garantiert dorthin zurück. Der UA-Marker muss auch hier gesetzt sein, sonst
 * leitet der app-only Host auf nexoro.net um.
 */
export function OnboardingModal({ visible, onClose, onMessage, insets })
{
  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.onbContainer, { paddingTop: insets.top }]}>
        <View style={styles.onbHeader}>
          <Text style={styles.onbTitle}>Neue Instanz erstellen</Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.onbClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.onbCloseText}>✕</Text>
          </TouchableOpacity>
        </View>
        <WebView
          source={{ uri: ONBOARDING_URL }}
          style={styles.webview}
          startInLoadingState={true}
          applicationNameForUserAgent={APP_UA_MARKER}
          onMessage={onMessage}
          injectedJavaScriptBeforeContentLoaded={DISABLE_ZOOM_JS}
          // Der Funnel ist bereits mobil ausgelegt; nur der Zoom-Lock wird
          // gebraucht, nicht die Instanz-Switcher-Bridge.
          setBuiltInZoomControls={false}
          setDisplayZoomControls={false}
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          )}
        />
      </View>
    </Modal>
  );
}

export default function WebViewScreen({
  url,
  domains = [],
  onSelectDomain,
  onAddDomain,
  onRemoveDomain,
})
{
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Laeuft ein Meeting im Hintergrund, sitzt die Meeting-Leiste ueber dieser
  // Ansicht und traegt den oberen Safe-Area-Abstand bereits. Wuerden wir ihn
  // hier nochmals setzen, entstuende ein doppelter Rand.
  const meetPhase = useMeetStore((s) => s.phase);
  const meetLive = isMeetingLive({ phase: meetPhase });
  // Push-Registrierung. Der Token wird einmal ermittelt und danach bei jedem
  // Seiten-Load angeboten - die Seite nimmt ihn nur an, wenn jemand angemeldet
  // ist. Dadurch greift es auch, wenn sich der Nutzer erst spaeter anmeldet.
  const [pushScript, setPushScript] = useState(null);
  const deviceIdRef = useRef(null);
  const { height: windowHeight } = useWindowDimensions();
  const webViewRef = useRef(null);
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  const [newSubdomain, setNewSubdomain] = useState('');
  const [adding, setAdding] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // Steht auf true, sobald ein Schein erfolgreich eingeloest wurde - also
  // dieser Nutzer auf Nexoro Communications umgestellt hat UND Zugangsdaten
  // hinterlegt sind. Steuert den Telefon-Eintrag im Switcher.
  const [telefonBereit, setTelefonBereit] = useState(false);

  // Beim App-Start sofort mit den gespeicherten Zugangsdaten anmelden, ohne
  // auf die WebView zu warten.
  //
  // Ohne das kaeme ein eingehender Anruf erst an, nachdem die Seite geladen und
  // ein neuer Schein durchgereicht wurde - also je nach Netz mehrere Sekunden
  // zu spaet. Der Schein aus der WebView aktualisiert die Daten anschliessend
  // ohnehin; verbinden() erkennt unveraenderte Zugangsdaten und tut dann nichts.
  useEffect(() =>
  {
    let abgebrochen = false;
    (async () =>
    {
      const zugang = await holeSipZugang();
      if (abgebrochen || !zugang) return;
      phoneManager.verbinden(zugang);
      setTelefonBereit(true);
    })();
    return () => { abgebrochen = true; };
  }, []);

  // Eingehender Anruf: den Telefon-Bildschirm oeffnen.
  //
  // CallKit zeigt zwar die Systemoberflaeche, aber nur auf iOS und nur, wenn
  // der native Teil verfuegbar ist. Ohne das saehe der Nutzer bloss die schmale
  // Leiste oben - bei einem klingelnden Telefon zu wenig. Nimmt er ueber
  // CallKit an, ist der Bildschirm ohnehin schon der richtige.
  const phaseFuerScreen = usePhoneStore((s) => s.phase);
  useEffect(() =>
  {
    if (phaseFuerScreen === 'klingelt') router.push('/phone');
  }, [phaseFuerScreen, router]);

  // Kommt die App aus dem Hintergrund zurueck, erneut nach einem Schein fragen.
  //
  // injectedJavaScript laeuft nur beim Seitenaufbau. Schaltet der Nutzer in den
  // Einstellungen von "3CX" auf "Nexoro" um, ohne dass die Seite neu laedt,
  // bliebe die App sonst bis zum naechsten Neustart ohne Zugangsdaten.
  useEffect(() =>
  {
    const ab = AppState.addEventListener('change', (zustand) =>
    {
      if (zustand !== 'active') return;

      // Registrierung erneuern: iOS friert das JavaScript im Hintergrund ein,
      // der WebSocket stirbt dabei still. Ohne diese Zeile erreicht ein
      // eingehender Anruf die App nach einigen Minuten nicht mehr - es
      // klingelt dann nur noch 3CX.
      phoneManager.aufwecken();

      if (!webViewRef.current) return;
      // Sperre loesen und Skript erneut einspielen.
      webViewRef.current.injectJavaScript(
        'window.__nexoroSipTicketLaeuft = false; true;');
      webViewRef.current.injectJavaScript(bauScheinSkript());
    });
    return () => ab.remove();
  }, []);

  // Push-Token einmalig ermitteln. Schlaegt es fehl (Simulator, abgelehnte
  // Berechtigung), bleibt pushScript null und es wird schlicht nichts
  // registriert - kein Fehlerfall, die App funktioniert ohne Push weiter.
  useEffect(() =>
  {
    let cancelled = false;
    (async () =>
    {
      configureForegroundHandler();
      const deviceId = await getDeviceId();
      if (!deviceId || cancelled) return;
      deviceIdRef.current = deviceId;
      const token = await getPushToken();
      if (!token || cancelled) return;
      setPushScript(buildRegisterScript(token, deviceId, APP_VERSION));
    })();
    return () => { cancelled = true; };
  }, []);

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

  // Onboarding-Funnel in derselben WebView öffnen. Der Host ist app-only; der
  // UA-Marker (applicationNameForUserAgent) reist bei jedem Request mit, auch
  // bei der Navigation innerhalb des Funnels.
  const openOnboarding = () =>
  {
    setSwitcherVisible(false);
    setOnboardingVisible(true);
  };

  // Funnel meldet eine fertige Instanz -> speichern, aktiv setzen, Funnel zu.
  // addInstance() ist idempotent und macht die neue Instanz automatisch aktiv,
  // die App rendert danach direkt deren WebView.
  const handleInstanceCreated = async (msg) =>
  {
    const domain = msg && (msg.url || (msg.domain ? `https://${ msg.domain }` : null));
    if (!domain) return;
    setOnboardingVisible(false);
    try
    {
      await onAddDomain(domain);
    } catch (e)
    {
      console.error('Failed to add created instance', e);
      Alert.alert('Fehler', 'Die neue Instanz konnte nicht gespeichert werden.');
    }
  };

  // Webseite (oms-cluster Menü "Instanz wechseln") bittet um den Switcher.
  /**
   * Die Seite hat einen Einmal-Schein hereingereicht.
   *
   * Steht der Telefonie-Modus auf 3CX, kommt kein Schein - dann melden wir
   * uns nicht an und raeumen hinterlegte Zugangsdaten weg, damit ein
   * Umschalten sofort wirkt.
   */
  const handleSipTicket = async (msg) =>
  {
    try
    {
      if (msg.mode !== 'nexoro' || !msg.ticket)
      {
        phoneManager.trennen();
        await loescheSipZugang();
        setTelefonBereit(false);
        return;
      }
      const zugang = await loeseScheinEin(msg.origin || url, msg.ticket);
      if (zugang)
      {
        phoneManager.verbinden(zugang);
        setTelefonBereit(true);
        // Der VoIP-Token liegt oft schon vor, bevor die Zugangsdaten da sind -
        // dann konnte er noch nicht hinterlegt werden. Jetzt nachholen.
        voipTokenNachreichen();
      }
    } catch (e)
    {
      // Ohne Telefonie laeuft die App normal weiter.
    }
  };

  /**
   * Das CRM moechte eine Nummer waehlen.
   *
   * Wir oeffnen den Telefon-Bildschirm SOFORT, noch bevor der Verbindungsaufbau
   * durch ist: Sonst starrt der Nutzer ein bis zwei Sekunden auf das CRM und
   * weiss nicht, ob sein Tippen angekommen ist.
   */
  const handlePlaceCall = async (msg) =>
  {
    const nummer = String(msg?.number || '').trim();
    if (!nummer) return;
    router.push('/phone');
    const ok = await phoneManager.anrufen(nummer);
    // Schlaegt es fehl, steht die Meldung bereits im phoneStore und der
    // Telefon-Bildschirm zeigt sie an.
    if (!ok) console.warn('[phone] Anruf aus dem CRM fehlgeschlagen');
  };

  const handleWebViewMessage = (event) =>
  {
    try
    {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg && msg.type === SWITCHER_MESSAGE)
      {
        openSwitcher();
      } else if (msg && msg.type === CREATED_MESSAGE)
      {
        handleInstanceCreated(msg);
      } else if (msg && msg.type === MEETINGS_MESSAGE)
      {
        // Menuepunkt "Meetings" -> native Uebersicht, kein Browser-Wechsel.
        router.push('/meet');
      } else if (msg && msg.type === SIP_TICKET_MESSAGE)
      {
        handleSipTicket(msg);
      } else if (msg && msg.type === PLACE_CALL_MESSAGE)
      {
        handlePlaceCall(msg);
      } else if (msg && msg.type === OPEN_DIALPAD_MESSAGE)
      {
        router.push('/phone');
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

    // Meeting-Links nativ oeffnen statt im Browser. Betrifft sowohl den
    // Menuepunkt (falls das oms-cluster noch die alte target="_blank"-Variante
    // ausliefert) als auch jeden Meeting-Link, der irgendwo im CRM steht.
    const roomId = parseMeetingUrl(targetUrl);
    if (roomId)
    {
      router.push(`/meet/join/${ encodeURIComponent(roomId) }`);
      return false;
    }
    // Das Meet-Dashboard fuehrt in der App zur nativen Uebersicht.
    if (targetUrl && /^https?:\/\/meet\.nexoro\.net(\/(dashboard|new|join)?)?(\?|#|$)/i.test(targetUrl))
    {
      router.push('/meet');
      return false;
    }

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

    // Der Menuepunkt "Meetings" ist ein target="_blank"-Link. Ohne diese
    // Abzweigung landet er im externen Browser statt in der nativen Ansicht.
    const roomId = parseMeetingUrl(targetUrl);
    if (roomId)
    {
      router.push(`/meet/join/${ encodeURIComponent(roomId) }`);
      return;
    }
    if (/^https?:\/\/meet\.nexoro\.net/i.test(targetUrl))
    {
      router.push('/meet');
      return;
    }

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
      // Beim Wechsel NICHT abmelden: der Nutzer bleibt bei der alten Instanz
      // angemeldet und soll von dort weiter Meldungen bekommen. Die neue
      // Instanz registriert das Geraet selbst, sobald ihre Seite geladen ist.
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
          onPress: () =>
          {
            // Ist es die AKTIVE Instanz, das Geraet dort noch abmelden, solange
            // die WebView sie noch geladen hat. Danach kaeme man nicht mehr an
            // ihre Session heran und der Nutzer bekaeme weiter Meldungen von
            // einer Instanz, die er entfernt hat.
            if (domain === url && deviceIdRef.current && webViewRef.current)
            {
              webViewRef.current.injectJavaScript(buildUnregisterScript(deviceIdRef.current));
            }
            onRemoveDomain(domain);
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { paddingTop: meetLive ? 0 : insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="dark" />

      <WebView
        ref={webViewRef}
        source={{ uri: url }}
        style={styles.webview}
        startInLoadingState={true}
        scalesPageToFit={false}
        injectedJavaScriptBeforeContentLoaded={INJECT_ALL}
        // Push-Registrierung an den Seiteninhalt anhaengen: sie laeuft damit
        // nach JEDEM Load. Das ist Absicht - meldet sich der Nutzer erst
        // spaeter an, greift sie beim naechsten Seitenwechsel. Das Skript
        // erkennt selbst, ob es schon gemeldet hat.
        injectedJavaScript={INJECT_ALL + (pushScript || '') + bauScheinSkript()}
        onMessage={handleWebViewMessage}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onOpenWindow={handleOpenWindow}
        // Hängt "NexoroApp/x.y" an die normale WebView-UA an (ersetzt sie nicht).
        // Der Onboarding-Host ist app-only und prüft genau diesen Marker.
        applicationNameForUserAgent={APP_UA_MARKER}
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

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>oder</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={styles.createButton}
              onPress={openOnboarding}
              activeOpacity={0.8}
              disabled={adding}
            >
              <Text style={styles.createButtonText}>Neue Instanz erstellen</Text>
            </TouchableOpacity>

            {/* Telefon. Nur sichtbar, wenn dieser Nutzer auf Nexoro
                Communications umgestellt hat - sonst laeuft alles wie bisher
                ueber 3CX, und ein Knopf hierher waere irrefuehrend. */}
            {telefonBereit && (
              <TouchableOpacity
                style={styles.phoneButton}
                onPress={() =>
                {
                  setSwitcherVisible(false);
                  router.push('/phone');
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.phoneButtonText}>Telefon öffnen</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      <OnboardingModal
        visible={onboardingVisible}
        onClose={() => setOnboardingVisible(false)}
        onMessage={handleWebViewMessage}
        insets={insets}
      />
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

  // --- "oder" Trenner + Neue-Instanz-Button -------------------------------
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 14,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.subtext,
  },
  createButton: {
    width: '100%',
    height: 56,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  createButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.primary,
  },

  // Testknopf: bewusst unauffaellig und deutlich anders als die echten
  // Aktionen, damit er nicht versehentlich fuer eine Funktion gehalten wird.
  phoneButton: {
    width: '100%',
    height: 46,
    borderRadius: 12,
    backgroundColor: '#40BCC7',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  phoneButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  testButton: {
    width: '100%',
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#94A3B8',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  testButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },

  // --- Onboarding-Vollbild-Modal -------------------------------------------
  onbContainer: {
    flex: 1,
    backgroundColor: COLORS.card,
  },
  onbHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  onbTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  onbClose: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onbCloseText: {
    fontSize: 20,
    color: COLORS.subtext,
    fontWeight: '600',
  },
});
