import React, { useState } from 'react';
import
  {
    StyleSheet,
    Text,
    View,
    TextInput,
    TouchableOpacity,
    KeyboardAvoidingView,
    Platform,
    Alert,
    Dimensions,
    Image,
  } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildDomain } from '../utils/instances';
import { OnboardingModal } from './WebViewScreen';

const LogoText = require('../../assets/logo-text.png');

const { width } = Dimensions.get('window');

// Premium color palette
const COLORS = {
  primary: '#40BCC7', // Updated teal color
  secondary: '#1E40AF',
  background: '#F8FAFC',
  card: '#FFFFFF',
  text: '#1E293B',
  subtext: '#64748B',
  border: '#E2E8F0',
  error: '#EF4444',
  success: '#10B981',
};

export default function DomainEntryScreen({ onDomainSaved })
{
  const [subdomain, setSubdomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  const insets = useSafeAreaInsets();

  // Der Funnel meldet die fertige Instanz per postMessage. Speichern + aktiv
  // setzen übernimmt der Parent (onDomainSaved -> addInstance), danach rendert
  // App.js direkt die WebView der neuen Instanz.
  const handleOnboardingMessage = async (event) =>
  {
    let msg;
    try
    {
      msg = JSON.parse(event.nativeEvent.data);
    } catch (e)
    {
      return; // Nicht-JSON ignorieren.
    }
    if (!msg || msg.type !== 'nexoro:instance-created') return;

    const fullDomain = msg.url || (msg.domain ? `https://${ msg.domain }` : null);
    if (!fullDomain) return;

    setOnboardingVisible(false);
    try
    {
      await onDomainSaved(fullDomain);
    } catch (e)
    {
      console.error('Failed to save created instance', e);
      Alert.alert('Fehler', 'Die neue Instanz konnte nicht gespeichert werden.');
    }
  };

  const handleSave = async () =>
  {
    if (!subdomain.trim())
    {
      Alert.alert('Fehler', 'Bitte geben Sie eine gültige Domain ein.');
      return;
    }

    setLoading(true);
    try
    {
      const fullDomain = buildDomain(subdomain);

      // Persistence is handled by the parent (instances cache).
      await onDomainSaved(fullDomain);
    } catch (error)
    {
      console.error('Failed to save domain', error);
      Alert.alert('Fehler', 'Domain konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.');
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        <View style={styles.headerContainer}>
          <Image
            source={LogoText}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.subtitle}>Geben Sie Ihre Workspace-Domain ein, um fortzufahren</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Nexoro Domain</Text>

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="nexoro"
              placeholderTextColor={COLORS.subtext}
              value={subdomain}
              onChangeText={setSubdomain}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
            <View style={styles.suffixContainer}>
              <Text style={styles.suffixText}>.nexoro.net</Text>
            </View>
          </View>

          <Text style={styles.helperText}>
            Beispiel: nexoro.nexoro.net
          </Text>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSave}
            activeOpacity={0.8}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Speichern...' : 'Weiter'}
            </Text>
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>oder</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={styles.createButton}
            onPress={() => setOnboardingVisible(true)}
            activeOpacity={0.8}
            disabled={loading}
          >
            <Text style={styles.createButtonText}>Neue Instanz erstellen</Text>
          </TouchableOpacity>

          <Text style={styles.createHint}>
            Noch kein Nexoro? Richten Sie Ihre Instanz in wenigen Minuten ein.
          </Text>
        </View>
      </KeyboardAvoidingView>

      <OnboardingModal
        visible={onboardingVisible}
        onClose={() => setOnboardingVisible(false)}
        onMessage={handleOnboardingMessage}
        insets={insets}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  headerContainer: {
    marginBottom: 40,
    alignItems: 'center',
    width: '100%',
  },
  logo: {
    width: '80%',
    height: 80,
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.subtext,
    textAlign: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: COLORS.card,
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 5,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
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
  helperText: {
    fontSize: 13,
    color: COLORS.subtext,
    marginTop: 8,
    marginLeft: 4,
    marginBottom: 24,
  },
  button: {
    width: '100%',
    height: 56,
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  buttonDisabled: {
    backgroundColor: COLORS.subtext,
    shadowOpacity: 0,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 16,
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  createButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.primary,
  },
  createHint: {
    fontSize: 13,
    color: COLORS.subtext,
    textAlign: 'center',
    marginTop: 12,
  },
});
