// Phase 5.8c (#301): Collaborative Cursors & Presence Client
// Manages real-time WebSocket connection to /ws/collab/{roomId},
// throttled cursor broadcasts, and state updates.

import { API_URL } from "../api";
import type { CollabCursor, CollabMessage, CollabPeer, CollabSelection } from "./types";

const PALETTE = [
  "#38bdf8", // Sky blue
  "#10b981", // Emerald
  "#f43f5e", // Rose
  "#a855f7", // Purple
  "#fbbf24", // Amber
  "#06b6d4", // Cyan
  "#ec4899", // Pink
  "#8b5cf6", // Violet
];

/** Normalize screen mouse position into [0, 1] relative coordinates. */
export function normalizeCursor(
  clientX: number,
  clientY: number,
  width: number,
  height: number,
  extras?: { activeLayer?: number | null; activeOp?: string | null }
): CollabCursor {
  const safeW = Math.max(width, 1);
  const safeH = Math.max(height, 1);
  const x = Math.max(0, Math.min(1, clientX / safeW));
  const y = Math.max(0, Math.min(1, clientY / safeH));
  return {
    x,
    y,
    activeLayer: extras?.activeLayer ?? null,
    activeOp: extras?.activeOp ?? null,
    timestamp: Date.now(),
  };
}

export function pickRandomColor(): string {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

export function generateUserId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "u-" + crypto.randomUUID().slice(0, 8);
  }
  return "u-" + Math.random().toString(36).slice(2, 10);
}

export interface CollabHandlers {
  onPresence?: (peers: CollabPeer[], count: number) => void;
  onPeerCursor?: (userId: string, cursor: CollabCursor) => void;
  onPeerSelection?: (userId: string, selection: CollabSelection | null) => void;
  onPeerStep?: (userId: string, opIndex: number, tokenIndex?: number) => void;
  onStatusChange?: (connected: boolean) => void;
  onError?: (err: string) => void;
}

export class CollabClient {
  private ws: WebSocket | null = null;
  private roomId: string = "default";
  private handlers: CollabHandlers = {};
  private lastCursorSend: number = 0;
  private pendingCursor: CollabCursor | null = null;
  private rafId: number | null = null;
  private isIntentionalClose: boolean = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  public self: CollabPeer;

  constructor(
    selfMeta?: Partial<CollabPeer>,
    handlers: CollabHandlers = {}
  ) {
    this.handlers = handlers;
    const uid = selfMeta?.user_id || generateUserId();
    const name = selfMeta?.name || `Viewer-${uid.slice(2, 6)}`;
    const color = selfMeta?.color || pickRandomColor();
    const role = selfMeta?.role || "viewer";

    this.self = {
      user_id: uid,
      name,
      color,
      role,
    };
  }

  public setHandlers(handlers: CollabHandlers) {
    this.handlers = { ...this.handlers, ...handlers };
  }

  public connect(roomId: string = "default") {
    this.roomId = roomId || "default";
    this.isIntentionalClose = false;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const baseWs = API_URL.replace(/^http/, "ws");
    const params = new URLSearchParams({
      user_id: this.self.user_id,
      name: this.self.name,
      color: this.self.color,
      role: this.self.role,
    });
    const url = `${baseWs}/ws/collab/${encodeURIComponent(this.roomId)}?${params.toString()}`;

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this.handlers.onError?.(e instanceof Error ? e.message : "Failed to open WebSocket");
      return;
    }

    this.ws.onopen = () => {
      this.handlers.onStatusChange?.(true);
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: CollabMessage = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch {
        /* Ignore malformed messages */
      }
    };

    this.ws.onerror = () => {
      this.handlers.onError?.("Collab WebSocket connection error");
    };

    this.ws.onclose = () => {
      this.handlers.onStatusChange?.(false);
      this.ws = null;
      if (!this.isIntentionalClose) {
        // Attempt reconnect after delay
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          if (!this.isIntentionalClose) {
            this.connect(this.roomId);
          }
        }, 3000);
      }
    };
  }

  public disconnect() {
    this.isIntentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore
      }
      this.ws = null;
    }
    this.handlers.onStatusChange?.(false);
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private handleMessage(msg: CollabMessage) {
    switch (msg.type) {
      case "presence":
        this.handlers.onPresence?.(msg.peers, msg.count);
        break;
      case "peer_cursor":
        this.handlers.onPeerCursor?.(msg.user_id, msg.cursor);
        break;
      case "peer_selection":
        this.handlers.onPeerSelection?.(msg.user_id, msg.selection);
        break;
      case "peer_step":
        this.handlers.onPeerStep?.(msg.user_id, msg.op_index, msg.token_index);
        break;
      default:
        break;
    }
  }

  /**
   * Broadcast cursor coordinates throttled to ~30ms to prevent network congestion.
   */
  public sendCursor(cursor: CollabCursor) {
    this.pendingCursor = cursor;
    const now = performance.now();
    const interval = 32; // ~30 fps cap

    if (now - this.lastCursorSend >= interval) {
      this.flushCursor();
    } else if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.flushCursor();
      });
    }
  }

  private flushCursor() {
    if (!this.pendingCursor || !this.isConnected()) return;
    this.lastCursorSend = performance.now();
    try {
      this.ws?.send(
        JSON.stringify({
          type: "cursor",
          cursor: this.pendingCursor,
        })
      );
    } catch {
      // Ignore send errors on dropping socket
    }
    this.pendingCursor = null;
  }

  /** Broadcast shared selection (e.g. layer, attention head, operation). */
  public sendSelection(selection: CollabSelection | null) {
    if (!this.isConnected()) return;
    try {
      this.ws?.send(
        JSON.stringify({
          type: "selection",
          selection,
        })
      );
    } catch {
      // Ignore
    }
  }

  /** Broadcast presenter step in classroom mode. */
  public sendStep(opIndex: number, tokenIndex?: number) {
    if (!this.isConnected()) return;
    try {
      this.ws?.send(
        JSON.stringify({
          type: "step",
          op_index: opIndex,
          token_index: tokenIndex,
        })
      );
    } catch {
      // Ignore
    }
  }
}

// Global shared client instance
let globalCollabClient: CollabClient | null = null;

export function getCollabClient(handlers?: CollabHandlers): CollabClient {
  if (!globalCollabClient) {
    globalCollabClient = new CollabClient(undefined, handlers);
  } else if (handlers) {
    globalCollabClient.setHandlers(handlers);
  }
  return globalCollabClient;
}
