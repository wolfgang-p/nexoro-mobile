import { create } from 'zustand';
import
  {
    loadInstances,
    addInstance,
    setActiveInstance,
    removeInstance,
  } from '../src/utils/instances';

/**
 * Instanz-Verwaltung (…​.nexoro.net Workspaces).
 *
 * Vorher lag dieser State in App.js. Mit expo-router gibt es kein einzelnes
 * Root-Component mehr, das ihn an alle Screens durchreichen könnte — der
 * Meeting-Screen liegt auf einer eigenen Route und braucht die aktive Instanz
 * trotzdem (Branding, Rücksprung). Daher als Store, gespeist aus denselben
 * AsyncStorage-Helfern wie bisher.
 */
export const useInstanceStore = create((set, get) =>
({
  list: [],
  active: null,
  loading: true,

  init: async () =>
  {
    try
    {
      const { list, active } = await loadInstances();
      set({ list, active, loading: false });
    } catch (e)
    {
      console.error('[instances] load failed', e);
      set({ loading: false });
    }
  },

  add: async (fullDomain) =>
  {
    const { list, active } = await addInstance(get().list, fullDomain);
    set({ list, active });
  },

  select: async (fullDomain) =>
  {
    await setActiveInstance(fullDomain);
    set({ active: fullDomain });
  },

  remove: async (fullDomain) =>
  {
    const { list, active } = await removeInstance(get().list, fullDomain, get().active);
    set({ list, active });
  },
}));
