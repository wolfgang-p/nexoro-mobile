import { WS_URL } from './env';

/**
 * WebSocket-Signaling für Meetings. Port von koro-meet/src/lib/signaler.ts.
 *
 * Protokoll (nexora-api/src/ws/):
 *   meet.auth      — Gast-Handshake, braucht kein Koro-Token
 *   meet.signal    — Punkt-zu-Punkt (offer/answer/ice/media-state)
 *   meet.broadcast — an alle anderen Teilnehmer (Chat, Hand, Notizen, …)
 *   meet.bye       — explizites Verlassen, damit Peers schneller aufräumen
 *
 * Reconnect mit exponentiellem Backoff. Ausgehende Nachrichten werden gepuffert,
 * solange der Socket unten ist — wichtig in der Lücke zwischen
 * setLocalDescription und dem tatsächlichen Senden der Negotiation.
 *
 * Unterschiede zur Web-Version:
 *   • setTimeout statt window.setTimeout (in RN gibt es kein window-Timer-API)
 *   • WebSocket-Events über onopen/onmessage/… statt addEventListener, weil die
 *     RN-Implementierung nur diese Form zuverlässig unterstützt
 */
export class Signaler
{
  constructor(identity, meetingId)
  {
    this.identity = identity;
    this.meetingId = meetingId;
    this.url = WS_URL;
    this.ws = null;
    this.handlers = new Set();
    this.outbox = [];
    this.retry = 0;
    this.retryTimer = null;
    this.closed = false;
    this.authReady = new Promise((r) => { this.authResolve = r; });
    this.connect();
  }

  connect()
  {
    if (this.closed) return;
    try { this.ws?.close(); } catch (e) { /* egal */ }

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () =>
    {
      this.retry = 0;
      // Sofort nach dem Öffnen authentifizieren. Der Server killt die
      // Verbindung, wenn innerhalb von 5s kein auth-Frame kommt.
      if (this.identity.kind === 'koro' && this.identity.access_token)
      {
        this.rawSend({ type: 'auth', token: this.identity.access_token });
      } else
      {
        this.rawSend({
          type: 'meet.auth',
          meeting_id: this.meetingId,
          device_id: this.identity.device_id,
        });
      }
    };

    ws.onmessage = (ev) =>
    {
      let msg;
      try { msg = JSON.parse(ev.data); }
      catch (e) { return; }

      if (msg?.type === 'auth.ok' || msg?.type === 'meet.auth.ok')
      {
        this.authResolve();
        // Alles nachschicken, was während des Handshakes aufgelaufen ist.
        while (this.outbox.length) this.rawSend(this.outbox.shift());
        return;
      }
      for (const h of this.handlers)
      {
        try { h(msg); }
        catch (err) { console.warn('[meet-signaler] handler', err); }
      }
    };

    ws.onclose = () =>
    {
      if (this.closed) return;
      // Exponentieller Backoff mit Jitter, gedeckelt bei 8s.
      const delay = Math.min(8000, 500 * Math.pow(2, this.retry++)) + Math.random() * 250;
      this.retryTimer = setTimeout(() => this.connect(), delay);
      // Auth-Promise zurücksetzen, damit send() bis zum neuen Handshake wartet.
      this.authReady = new Promise((r) => { this.authResolve = r; });
    };

    ws.onerror = () =>
    {
      // RN feuert error und close; close treibt den Retry. Hier bewusst still.
    };
  }

  rawSend(payload)
  {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (!this.ws || this.ws.readyState !== 1 /* OPEN */)
    {
      this.outbox.push(data);
      return;
    }
    try { this.ws.send(data); }
    catch (e) { this.outbox.push(data); }
  }

  async send(payload)
  {
    await this.authReady;
    this.rawSend(payload);
  }

  on(handler)
  {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  // ── typisierte Helfer ────────────────────────────────────────────

  /** kind: 'offer' | 'answer' | 'ice' | 'media-state' */
  signal(targetDeviceId, kind, payload)
  {
    return this.send({
      type: 'meet.signal',
      meeting_id: this.meetingId,
      target_device_id: targetDeviceId,
      signal: kind,
      payload,
    });
  }

  broadcast(subtype, payload)
  {
    return this.send({
      type: 'meet.broadcast',
      meeting_id: this.meetingId,
      subtype,
      payload: payload ?? null,
    });
  }

  bye()
  {
    return this.send({ type: 'meet.bye', meeting_id: this.meetingId });
  }

  close()
  {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    try { this.ws?.close(); } catch (e) { /* egal */ }
    this.handlers.clear();
  }
}
