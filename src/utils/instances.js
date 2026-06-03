import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys
const ACTIVE_KEY = 'nexoro_domain'; // active full domain (kept for backwards compat)
const LIST_KEY = 'nexoro_domains';  // JSON array of full domains (all added instances)

const SUFFIX = '.nexoro.net';

// Build a full domain URL from a raw subdomain input.
export function buildDomain(subdomain)
{
  const clean = subdomain.trim().toLowerCase().replace(/\.nexoro\.net$/, '');
  return `https://${ clean }${ SUFFIX }`;
}

// Turn a full domain back into the short label (subdomain part).
export function toLabel(fullDomain)
{
  return fullDomain
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
}

// Load the list of saved instances. Migrates a legacy single domain into the list.
export async function loadInstances()
{
  let list = [];
  try
  {
    const raw = await AsyncStorage.getItem(LIST_KEY);
    if (raw)
    {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed.filter(Boolean);
    }
  } catch (e)
  {
    console.error('Failed to parse instances list', e);
  }

  let active = null;
  try
  {
    active = await AsyncStorage.getItem(ACTIVE_KEY);
  } catch (e)
  {
    console.error('Failed to load active domain', e);
  }

  // Migration: legacy active domain not yet in the list
  if (active && !list.includes(active))
  {
    list = [active, ...list];
    await persistList(list);
  }

  // Ensure active is valid
  if (!active && list.length > 0)
  {
    active = list[0];
    await AsyncStorage.setItem(ACTIVE_KEY, active);
  }

  return { list, active };
}

async function persistList(list)
{
  await AsyncStorage.setItem(LIST_KEY, JSON.stringify(list));
}

// Add an instance (idempotent) and make it the active one. Returns the new state.
export async function addInstance(currentList, fullDomain)
{
  const list = currentList.includes(fullDomain)
    ? currentList
    : [...currentList, fullDomain];
  await persistList(list);
  await AsyncStorage.setItem(ACTIVE_KEY, fullDomain);
  return { list, active: fullDomain };
}

// Switch the active instance.
export async function setActiveInstance(fullDomain)
{
  await AsyncStorage.setItem(ACTIVE_KEY, fullDomain);
}

// Remove an instance. If it was active, fall back to the first remaining one.
export async function removeInstance(currentList, fullDomain, currentActive)
{
  const list = currentList.filter((d) => d !== fullDomain);
  await persistList(list);

  let active = currentActive;
  if (currentActive === fullDomain)
  {
    active = list.length > 0 ? list[0] : null;
    if (active)
    {
      await AsyncStorage.setItem(ACTIVE_KEY, active);
    } else
    {
      await AsyncStorage.removeItem(ACTIVE_KEY);
    }
  }
  return { list, active };
}
