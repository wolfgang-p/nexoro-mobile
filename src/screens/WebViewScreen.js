import React from 'react';
import { StyleSheet, View, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function WebViewScreen({ url, onChangeDomain })
{
  const insets = useSafeAreaInsets();

  // Safe check for URL validity
  if (!url)
  {
    return (
      <View style={styles.errorContainer}>
        <Text>No URL provided</Text>
      </View>
    );
  }

  // Extract domain for display
  const displayDomain = url.replace('https://', '').replace('/', '');

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
            onPress={onChangeDomain}
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
            <ActivityIndicator size="large" color="#40BCC7" />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  topBarContainer: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
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
    color: '#1E293B',
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
    color: '#40BCC7',
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
    backgroundColor: '#FFFFFF',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
