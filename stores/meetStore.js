import { create } from 'zustand';

/**
 * Zustand des laufenden Meetings.
 *
 * Bewusst außerhalb des Raum-Screens: beim Minimieren wird der Screen abgebaut,
 * die Verbindung soll aber weiterlaufen. Lebte der Zustand im Component, würde
 * Minimieren die Verbindung kappen — genau das soll es nicht (Anforderung:
 * minimieren OHNE aufzulegen). Der eigentliche Mesh liegt in meetManager,
 * dieser Store hält nur das, was die Oberfläche rendert.
 *
 * phase:
 *   idle       — kein Meeting
 *   joining    — Beitritt läuft (Medien + Signaling)
 *   live       — im Raum
 *   ended      — beendet, Abschlusskarte
 */
export const useMeetStore = create((set, get) =>
({
  phase: 'idle',
  roomId: null,
  meeting: null,

  // Eigener Medienzustand
  localStreamUrl: null,
  micOn: true,
  cameraOn: true,
  facing: 'user',
  screenSharing: false,

  // Gegenstellen: device_id -> RemoteState (Schnappschuss aus PeerMesh)
  remotes: new Map(),
  participants: [],

  // Oberfläche
  minimized: false,
  view: 'grid',        // 'grid' | 'people'
  joinedAt: null,
  handsUp: {},
  chatMessages: [],
  unreadChat: 0,
  notes: '',
  turnAvailable: true,
  error: null,

  // ── Aktionen ────────────────────────────────────────────────────

  startJoining: (roomId, meeting) =>
    set({
      phase: 'joining',
      roomId,
      meeting: meeting ?? null,
      error: null,
      minimized: false,
      remotes: new Map(),
      chatMessages: [],
      unreadChat: 0,
      handsUp: {},
      notes: '',
      joinedAt: null,
    }),

  setLive: () => set({ phase: 'live', joinedAt: Date.now() }),

  setMeeting: (meeting) => set({ meeting }),
  setParticipants: (participants) => set({ participants }),
  setRemotes: (remotes) => set({ remotes: new Map(remotes) }),
  setLocalStreamUrl: (url) => set({ localStreamUrl: url }),

  setMicOn: (micOn) => set({ micOn }),
  setCameraOn: (cameraOn) => set({ cameraOn }),
  setFacing: (facing) => set({ facing }),
  setScreenSharing: (screenSharing) => set({ screenSharing }),
  setTurnAvailable: (turnAvailable) => set({ turnAvailable }),

  setMinimized: (minimized) => set({ minimized }),
  setView: (view) => set({ view }),
  setError: (error) => set({ error }),
  setNotes: (notes) => set({ notes }),

  setHandUp: (deviceId, up) =>
    set((s) =>
    {
      const handsUp = { ...s.handsUp };
      if (up) handsUp[deviceId] = true;
      else delete handsUp[deviceId];
      return { handsUp };
    }),

  /** Chat-Nachricht anhängen. Zählt ungelesen mit, solange das Chat-Panel zu ist. */
  addChatMessage: (msg, { markRead = false } = {}) =>
    set((s) =>
    {
      if (msg.id && s.chatMessages.some((m) => m.id === msg.id)) return s;
      return {
        chatMessages: [...s.chatMessages, msg],
        unreadChat: markRead ? 0 : s.unreadChat + 1,
      };
    }),

  setChatMessages: (chatMessages) => set({ chatMessages }),
  clearUnreadChat: () => set({ unreadChat: 0 }),

  setEnded: () => set({ phase: 'ended', minimized: false }),

  /** Vollständig zurücksetzen. Nach dem Verlassen, bevor das nächste startet. */
  reset: () =>
    set({
      phase: 'idle',
      roomId: null,
      meeting: null,
      localStreamUrl: null,
      micOn: true,
      cameraOn: true,
      facing: 'user',
      screenSharing: false,
      remotes: new Map(),
      participants: [],
      minimized: false,
      view: 'grid',
      joinedAt: null,
      handsUp: {},
      chatMessages: [],
      unreadChat: 0,
      notes: '',
      turnAvailable: true,
      error: null,
    }),
}));

/** Läuft gerade ein Meeting? Für die Minimier-Leiste. */
export function isMeetingLive(state)
{
  return state.phase === 'joining' || state.phase === 'live';
}
