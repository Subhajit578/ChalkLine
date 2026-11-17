import { WS_URL } from "@/lib/config";
import { getToken } from "@/lib/session";

/**
 * The socket to one board. A WebSocket doesn't reconnect by itself, so this:
 *   - reconnects with backoff, then signs in and rejoins the room
 *   - pings to detect connections that died silently
 *   - queues changes made offline and sends them once back
 *   - resends changes the server never acknowledged
 *
 * It knows nothing about shapes. Game sends it messages and reloads the
 * board when told; React reads the status.
 */

export type ServerMessage = { type: string; [key: string]: unknown };
export type OutgoingMessage = { type: string; [key: string]: unknown };

/**
 * connecting:   first attempt, board not loaded yet
 * online:       joined
 * reconnecting: was online, lost it, retrying
 * closed:       gave up (refused or signed out); retrying won't help
 */
export type ConnectionStatus = "connecting" | "online" | "reconnecting" | "closed";

type Handlers = {
  /** everything the server sends that is about the board */
  onMessage: (message: ServerMessage) => void;
  /** the room is joined: load the board, then call flush() */
  onJoined: () => void;
};

type Pending = { seq: number; frame: string; message: OutgoingMessage };

/** Live pencil previews are useless late, so they are never queued. */
const EPHEMERAL = new Set(["stroke_start", "stroke_points"]);

/** Limits on changes held while offline. */
const MAX_OUTBOX = 3000;
const MAX_OUTBOX_BYTES = 6 * 1024 * 1024;

/** Outbox send rate, kept under the server's per-socket limit. */
const FLUSH_PER_SECOND = 150;

const PING_EVERY_MS = 25_000;
const PONG_WITHIN_MS = 10_000;
const JOIN_WITHIN_MS = 15_000;
const RETRY_MAX_MS = 15_000;

/** Server close code for a bad or expired token. */
const CLOSE_UNAUTHENTICATED = 4401;

export class RoomConnection {
  private socket: WebSocket | null = null;
  private handlers: Handlers | null = null;
  private status: ConnectionStatus = "connecting";
  private statusListener: ((status: ConnectionStatus, message?: string) => void) | null = null;

  /** the room is joined on the current socket */
  private joined = false;
  /** joined, board loaded, outbox empty: sends go straight out */
  private live = false;
  private everOnline = false;
  private stopped = false;
  private attempt = 0;

  private nextSeq = 1;
  /** sent but not acknowledged; resent if the connection drops */
  private inFlight = new Map<number, Pending>();
  /** not yet sent, oldest first */
  private outbox: Pending[] = [];
  private outboxBytes = 0;
  /** the outbox filled up and was discarded */
  private overflowed = false;

  /** server messages received before attach() */
  private early: ServerMessage[] = [];

  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private joinTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly roomId: string) {
    window.addEventListener("online", this.retryNow);
    this.connect();
  }

  /* ── for React ──────────────────────────────────────────────────────── */

  /** Subscribe to status changes. Fires immediately with the current one. */
  onStatus(listener: ((status: ConnectionStatus, message?: string) => void) | null) {
    this.statusListener = listener;
    listener?.(this.status);
  }

  /** Stop for good; call when leaving the board. */
  close() {
    this.stopped = true;
    window.removeEventListener("online", this.retryNow);
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
  }

  /* ── for Game ───────────────────────────────────────────────────────── */

  /**
   * Start receiving. Messages that arrived earlier are delivered now, and if
   * the room is already joined, load is triggered, so it doesn't matter
   * whether the socket or the canvas is ready first.
   */
  attach(handlers: Handlers) {
    this.handlers = handlers;
    const early = this.early;
    this.early = [];
    for (const message of early) handlers.onMessage(message);
    if (this.joined) handlers.onJoined();
  }

  detach() {
    this.handlers = null;
  }

  /** Send a change now, or queue it (offline, or board still loading) in order. */
  send(message: OutgoingMessage) {
    if (EPHEMERAL.has(message.type)) {
      if (this.live) this.socket?.send(JSON.stringify(message));
      return;
    }

    const seq = this.nextSeq++;
    const pending: Pending = { seq, frame: JSON.stringify({ ...message, seq }), message };

    if (this.live && this.socket?.readyState === WebSocket.OPEN) {
      this.inFlight.set(seq, pending);
      this.socket.send(pending.frame);
      return;
    }
    this.hold(pending);
  }

  /** Changes the server hasn't confirmed. Game re-applies these after a reload. */
  unsent(): OutgoingMessage[] {
    return [...this.inFlight.values(), ...this.outbox].map((pending) => pending.message);
  }

  /** True if the outbox overflowed since the last call (resets on read). */
  takeOverflow(): boolean {
    const overflowed = this.overflowed;
    this.overflowed = false;
    return overflowed;
  }

  /** Board loaded: send queued changes, paced so the server doesn't see a flood, then go live. */
  flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.joined || this.socket?.readyState !== WebSocket.OPEN) return;

    for (const pending of this.outbox.splice(0, FLUSH_PER_SECOND)) {
      this.outboxBytes -= pending.frame.length;
      this.inFlight.set(pending.seq, pending);
      this.socket.send(pending.frame);
    }
    if (this.outbox.length > 0) {
      this.flushTimer = setTimeout(() => this.flush(), 1000);
      return;
    }
    this.live = true;
  }

  /* ── internals ──────────────────────────────────────────────────────── */

  private hold(pending: Pending) {
    if (this.outbox.length >= MAX_OUTBOX || this.outboxBytes + pending.frame.length > MAX_OUTBOX_BYTES) {
      // Too much to replay. Dropping only the oldest would send half an edit
      // history, so drop all of it; the user is told after the reload.
      this.outbox = [];
      this.outboxBytes = 0;
      this.overflowed = true;
      return;
    }
    this.outbox.push(pending);
    this.outboxBytes += pending.frame.length;
  }

  private setStatus(status: ConnectionStatus, message?: string) {
    if (status === this.status && !message) return;
    this.status = status;
    this.statusListener?.(status, message);
  }

  private clearTimers() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    if (this.joinTimer) clearTimeout(this.joinTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.retryTimer = this.pingTimer = this.pongTimer = this.joinTimer = this.flushTimer = null;
  }

  /** Stop retrying; another attempt can't fix this. */
  private giveUp(message: string) {
    this.stopped = true;
    this.clearTimers();
    this.socket?.close();
    this.setStatus("closed", message);
  }

  private retryNow = () => {
    if (this.stopped || this.socket || !this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.connect();
  };

  private connect() {
    if (this.stopped) return;
    const token = getToken();
    if (!token) {
      this.giveUp("Your session has ended. Sign in again.");
      return;
    }

    const socket = new WebSocket(WS_URL);
    this.socket = socket;

    socket.onopen = () => {
      // Token goes in a message, not the URL, which proxies log.
      socket.send(JSON.stringify({ type: "auth", token }));
      socket.send(JSON.stringify({ type: "join_room", roomId: this.roomId }));

      // if the join is never answered (e.g. DB asleep), drop and retry
      this.joinTimer = setTimeout(() => socket.close(), JOIN_WITHIN_MS);

      // A dead connection can stay "open". Ping; no reply means close and reconnect.
      this.pingTimer = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ type: "ping" }));
        if (!this.pongTimer) {
          this.pongTimer = setTimeout(() => socket.close(), PONG_WITHIN_MS);
        }
      }, PING_EVERY_MS);
    };

    socket.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      // any message proves the connection is alive
      if (this.pongTimer) {
        clearTimeout(this.pongTimer);
        this.pongTimer = null;
      }
      this.receive(message);
    };

    socket.onclose = (event) => {
      if (this.socket !== socket) return;   // already replaced
      this.socket = null;
      this.clearTimers();
      this.joined = false;
      this.live = false;

      // Unacknowledged changes may not have arrived: requeue them first, in order.
      if (this.inFlight.size > 0) {
        const unacknowledged = [...this.inFlight.values()];
        this.inFlight.clear();
        this.outbox = [...unacknowledged, ...this.outbox];
        this.outboxBytes = this.outbox.reduce((sum, pending) => sum + pending.frame.length, 0);
      }

      if (this.stopped) return;
      if (event.code === CLOSE_UNAUTHENTICATED) {
        this.giveUp("Your session has ended. Sign in again.");
        return;
      }

      // 0.5s, 1s, 2s... capped, with jitter so clients don't all return at once
      const delay = Math.min(RETRY_MAX_MS, 500 * 2 ** this.attempt) * (0.75 + Math.random() * 0.5);
      this.attempt++;
      this.setStatus(this.everOnline ? "reconnecting" : "connecting");
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.connect();
      }, delay);
    };

    // onclose always follows and handles it
    socket.onerror = () => {};
  }

  private receive(message: ServerMessage) {
    switch (message.type) {
      case "ready":
      case "pong":
        return;

      case "ack":
        this.inFlight.delete(message.seq as number);
        return;

      case "joined":
        if (this.joinTimer) clearTimeout(this.joinTimer);
        this.joinTimer = null;
        this.joined = true;
        this.attempt = 0;
        this.everOnline = true;
        this.setStatus("online");
        this.handlers?.onJoined();
        return;

      case "resync":
        // Sent only after the room's writes settle, so anything still
        // unacknowledged was refused; resending would just repeat that.
        this.inFlight.clear();
        break;

      case "error":
        if (message.code === "forbidden") {
          this.giveUp(typeof message.message === "string" ? message.message : "You do not have access to this board");
          return;
        }
        if (message.code === "join_failed") {
          // server couldn't check access right now; retry
          this.socket?.close();
          return;
        }
        break;
    }

    if (this.handlers) this.handlers.onMessage(message);
    else this.early.push(message);
  }
}
