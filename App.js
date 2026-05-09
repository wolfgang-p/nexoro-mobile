import React, { useState, useEffect } from 'react';
import { StyleSheet, View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

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
  const [domain, setDomain] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() =>
  {
    checkDomain();
  }, []);

  const checkDomain = async () =>
  {
    try
    {
      const savedDomain = await AsyncStorage.getItem('nexoro_domain');
      if (savedDomain)
      {
        setDomain(savedDomain);
      }
    } catch (e)
    {
      console.error('Failed to load domain', e);
    } finally
    {
      setLoading(false);
    }
  };

  const handleDomainSaved = (newDomain) =>
  {
    setDomain(newDomain);
  };

  const handleChangeDomain = async () =>
  {
    try
    {
      await AsyncStorage.removeItem('nexoro_domain');
      setDomain(null);
    } catch (e)
    {
      console.error('Failed to clear domain', e);
    }
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

  if (domain)
  {
    return <WebViewScreen url={domain} onChangeDomain={handleChangeDomain} />;
  }

  return <DomainEntryScreen onDomainSaved={handleDomainSaved} />;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
