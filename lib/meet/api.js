import { API_URL } from './env';

/**
 * Dünner JSON-fetch-Wrapper für die /meetings-Endpoints.
 *
 * Authentifizierung kennt zwei Wege, beide akzeptiert die API:
 *   • Koro-Account  → `Authorization: Bearer <access_token>`
 *   • Gast          → `x-koro-meet-device: <device_id>`
 *
 * Wirft ApiError bei non-2xx, damit Aufrufer auf `.status` verzweigen können
 * (404 = Raum existiert nicht, 403 = gesperrt/gebannt).
 */

export class ApiError extends Error
{
  constructor(status, message)
  {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api(path, opts = {})
{
  const url = path.startsWith('http') ? path : `${ API_URL }${ path }`;
  const headers = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const id = opts.identity;
  if (id?.kind === 'koro' && id.access_token) headers['Authorization'] = `Bearer ${ id.access_token }`;
  if (id?.device_id) headers['x-koro-meet-device'] = id.device_id;

  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  if (!res.ok)
  {
    let msg = `${ res.status }`;
    try
    {
      const j = await res.json();
      if (j?.error) msg = String(j.error);
    } catch (e) { /* Antwort war kein JSON — Statuscode als Meldung behalten */ }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined;
  return await res.json();
}

// ── Endpoint-Helfer ─────────────────────────────────────────────────
// Spiegelt koro-meet/src/lib/api.ts. Die v2-Themen (Copilot, Recording,
// Analyse-Retry) fehlen hier bewusst: die App zeigt Zusammenfassungen nur
// als Link nach draußen.

export const meetings = {
  create: (input, id) =>
    api('/meetings', {
      method: 'POST',
      identity: id,
      body: { ...input, device_id: id.device_id, display_name: id.display_name },
    }),

  listMine: (id) => api('/meetings', { identity: id }),

  get: (roomId, id) => api(`/meetings/${ roomId }`, { identity: id }),

  join: (roomId, id) =>
    api(`/meetings/${ roomId }/join`, {
      method: 'POST',
      identity: id,
      body: { device_id: id.device_id, display_name: id.display_name, avatar_url: id.avatar_url },
    }),

  leave: (roomId, id) =>
    api(`/meetings/${ roomId }/leave`, {
      method: 'POST',
      identity: id,
      body: { device_id: id.device_id },
    }),

  update: (roomId, patch, id) =>
    api(`/meetings/${ roomId }`, { method: 'PATCH', identity: id, body: patch }),

  destroy: (roomId, id) =>
    api(`/meetings/${ roomId }`, { method: 'DELETE', identity: id }),

  listMessages: (roomId, id) => api(`/meetings/${ roomId }/messages`, { identity: id }),

  postMessage: (roomId, body, id) =>
    api(`/meetings/${ roomId }/messages`, {
      method: 'POST',
      identity: id,
      body: { device_id: id.device_id, display_name: id.display_name, body },
    }),

  startNow: (roomId, id) =>
    api(`/meetings/${ roomId }/start`, { method: 'POST', identity: id }),

  kick: (roomId, participantId, id) =>
    api(`/meetings/${ roomId }/participants/${ participantId }/kick`, {
      method: 'POST',
      identity: id,
    }),

  end: (roomId, id) =>
    api(`/meetings/${ roomId }/end`, {
      method: 'POST',
      identity: id,
      body: { device_id: id.device_id },
    }),

  getNotes: (roomId, id) => api(`/meetings/${ roomId }/notes`, { identity: id }),

  putNotes: (roomId, content, id) =>
    api(`/meetings/${ roomId }/notes`, {
      method: 'PUT',
      identity: id,
      body: { content, device_id: id?.device_id, display_name: id?.display_name },
    }),

  /** Nur für den Status-Check, ob überhaupt eine Zusammenfassung existiert.
   *  Angezeigt wird sie nicht in der App, sondern als Link im Browser. */
  getAnalysis: (roomId, id) => api(`/meetings/${ roomId }/analysis`, { identity: id }),
};
