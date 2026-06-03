import React, { useState, useEffect } from 'react';
import { StyleSheet, View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  loadInstances,
  addInstance,
  setActiveInstance,
  removeInstance,
} from './src/utils/instances';

// Screens
import DomainEntryScreen from './src/screens/DomainEntryScreen';
import WebViewScreen from './src/screens/WebViewScreen';

export default function App()
{
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}

function AppInner()
{
  const [domains, setDomains] = useState([]);
  const [activeDomain, setActiveDomain] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() =>
  {
    init();
  }, []);

  const init = async () =>
  {
    try
    {
      const { list, active } = await loadInstances();
      setDomains(list);
      setActiveDomain(active);
    } catch (e)
    {
      console.error('Failed to load instances', e);
    } finally
    {
      setLoading(false);
    }
  };

  // Called from the entry screen and the in-app instance switcher.
  const handleAddDomain = async (fullDomain) =>
  {
    const { list, active } = await addInstance(domains, fullDomain);
    setDomains(list);
    setActiveDomain(active);
  };

  // Switch the active instance.
  const handleSelectDomain = async (fullDomain) =>
  {
    await setActiveInstance(fullDomain);
    setActiveDomain(fullDomain);
  };

  // Remove an instance from the cache.
  const handleRemoveDomain = async (fullDomain) =>
  {
    const { list, active } = await removeInstance(domains, fullDomain, activeDomain);
    setDomains(list);
    setActiveDomain(active);
  };

  if (loading)
  {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#40BCC7" />
        <StatusBar style="auto" />
      </View>
    );
  }

  if (activeDomain)
  {
    return (
      <WebViewScreen
        url={activeDomain}
        domains={domains}
        onSelectDomain={handleSelectDomain}
        onAddDomain={handleAddDomain}
        onRemoveDomain={handleRemoveDomain}
      />
    );
  }

  return <DomainEntryScreen onDomainSaved={handleAddDomain} />;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
