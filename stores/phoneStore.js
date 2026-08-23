import { create } from 'zustand';

/**
 * Zustand des Telefons.
 *
 * Bewusst nach dem Vorbild von `meetStore.js` gebaut: Der Bildschirm liest
 * hier, die eigentliche SIP-Sitzung lebt außerhalb der React-Bäume im
 * `phoneManager`. Nur so überlebt ein Gespräch das Minimieren — würde die
 * Sitzung an einer Komponente hängen, risse sie beim Verlassen des Screens ab.
 *
 * Phasen:
 *   idle       — keine Registrierung
 *   verbinden  — WebSocket/REGISTER läuft
 *   bereit     — registriert, kein Gespräch
 *   klingelt   — eingehender Anruf, noch nicht angenommen
 *   ruft       — ausgehender Anruf, Gegenstelle klingelt
 *   gespraech  — verbunden
 */

export const usePhoneStore = create((set, get) => ({
  phase: 'idle',
  registriert: false,
  fehler: null,

  // Laufendes Gespräch
  anrufId: null,
  gegenstelle: '',
  richtung: null,        // 'ein' | 'aus'
  startedAt: null,

  // Gesprächssteuerung
  stumm: false,
  gehalten: false,
  lautsprecher: false,

  // Oberfläche
  minimiert: false,

  setPhase: (phase) => set({ phase }),
  setRegistriert: (registriert) =>
    set({ registriert, phase: registriert ? 'bereit' : 'idle' }),
  setFehler: (fehler) => set({ fehler }),

  anrufBegonnen: ({ anrufId, gegenstelle, richtung }) => set({
    anrufId,
    gegenstelle,
    richtung,
    phase: richtung === 'ein' ? 'klingelt' : 'ruft',
    stumm: false,
    gehalten: false,
    lautsprecher: false,
    minimiert: false,
    startedAt: null,
  }),

  anrufVerbunden: () => set({ phase: 'gespraech', startedAt: Date.now() }),

  anrufBeendet: () => set({
    phase: get().registriert ? 'bereit' : 'idle',
    anrufId: null,
    gegenstelle: '',
    richtung: null,
    startedAt: null,
    stumm: false,
    gehalten: false,
    lautsprecher: false,
    minimiert: false,
  }),

  setStumm: (stumm) => set({ stumm }),
  setGehalten: (gehalten) => set({ gehalten }),
  setLautsprecher: (lautsprecher) => set({ lautsprecher }),
  setMinimiert: (minimiert) => set({ minimiert }),

  zuruecksetzen: () => set({
    phase: 'idle', registriert: false, fehler: null,
    anrufId: null, gegenstelle: '', richtung: null, startedAt: null,
    stumm: false, gehalten: false, lautsprecher: false, minimiert: false,
  }),
}));

/** Läuft gerade ein Anruf — egal ob klingelnd, rufend oder verbunden? */
export function anrufAktiv(phase)
{
  return phase === 'klingelt' || phase === 'ruft' || phase === 'gespraech';
}
