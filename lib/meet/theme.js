/**
 * Gestaltungs-Token für die Meeting-Oberfläche.
 *
 * Der Raum ist bewusst dunkel (video-first, wie im Browser), die Listen- und
 * Formular-Screens hell wie der Rest der App. Beides greift auf dieselbe
 * Markenfarbe zurück, die auch die WebView-Shell benutzt.
 */

export const BRAND = '#40BCC7';

export const light = {
  brand: BRAND,
  bg: '#F8FAFC',
  card: '#FFFFFF',
  text: '#1E293B',
  subtext: '#64748B',
  border: '#E2E8F0',
  muted: '#F1F5F9',
  danger: '#EF4444',
  success: '#10B981',
};

export const dark = {
  brand: BRAND,
  bg: '#0B0F14',
  surface: '#151B23',
  surfaceHi: '#1E2733',
  text: '#FFFFFF',
  subtext: 'rgba(255,255,255,0.68)',
  faint: 'rgba(255,255,255,0.42)',
  border: 'rgba(255,255,255,0.12)',
  control: 'rgba(255,255,255,0.14)',
  controlActive: '#FFFFFF',
  danger: '#DC2626',
};

export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 };
