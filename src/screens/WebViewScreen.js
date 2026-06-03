import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildDomain, toLabel } from '../utils/instances';

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
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const [newSubdomain, setNewSubdomain] = useState('');
  const [adding, setAdding] = useState(false);

  // Safe check for URL validity
  if (!url)
  {
    return (
      <View style={styles.errorContainer}>
        <Text>No URL provided</Text>
      </View>
    );
  }

  const displayDomain = toLabel(url);

  const openSwitcher = () =>
  {
    setNewSubdomain('');
    setSwitcherVisible(true);
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
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <StatusBar style="dark" />
      <View style={[styles.topBarContainer, { paddingTop: insets.top }]}>
        <View style={styles.topBar}>
          <Text style={styles.domainText} numberOfLines={1}>
            {displayDomain}
          </Text>
          <TouchableOpacity
            style={styles.changeButton}
            onPress={openSwitcher}
            activeOpacity={0.7}
          >
            <Text style={styles.changeButtonText}>Ändern</Text>
          </TouchableOpacity>
        </View>
      </View>

      <WebView
        source={{ uri: url }}
        style={styles.webview}
        startInLoadingState={true}
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
        onRequestClose={() => setSwitcherVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            style={styles.backdrop}
            activeOpacity={1}
            onPress={() => setSwitcherVisible(false)}
          />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Instanz wechseln</Text>

            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
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
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  topBarContainer: {
    backgroundColor: COLORS.card,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    zIndex: 10,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    height: 60,
  },
  domainText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
    marginRight: 16,
  },
  changeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  changeButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
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
    maxHeight: '80%',
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
    flexGrow: 0,
    marginBottom: 8,
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
