import { batch, computed, type ReadonlySignal, signal } from "@preact/signals";
import type { Phase } from "../../shared/protocol";
import { type Clock, createClock } from "../lib/clock";
import {
  type ConnectionOptions,
  type ConnectionStatus,
  type Intent,
  IntentError,
  type IntentErrorCode,
  RoomConnection,
} from "../lib/connection";
import { applyPendingOps, type OptimisticIntent, type PendingOp } from "./optimistic";
import { applyServerMessage, type RoomState } from "./roomState";

export type IntentResult = { ok: true } | { ok: false; error: IntentError };

export type RoomStoreError = { id: number; code: IntentErrorCode; message: string };

export type ConnectionLike = Pick<RoomConnection, "connect" | "send" | "dispose">;

export type RoomStoreOptions = {
  code: string;
  clientId: string;
  createConnection?: (options: ConnectionOptions) => ConnectionLike;
  clock?: Clock;
};

export type RoomStore = {
  readonly code: string;
  readonly room: ReadonlySignal<RoomState | null>;
  readonly status: ReadonlySignal<ConnectionStatus>;
  readonly isLive: ReadonlySignal<boolean>;
  readonly lastError: ReadonlySignal<RoomStoreError | null>;
  serverNow(): number;
  dismissError(): void;
  connect(): void;
  dispose(): void;

  addItem(categoryId: string, text: string): Promise<IntentResult>;
  editItem(itemId: string, text: string): Promise<IntentResult>;
  deleteItem(itemId: string): Promise<IntentResult>;
  setReady(ready: boolean): Promise<IntentResult>;

  moveItemToGroup(itemId: string, groupId: string): Promise<IntentResult>;
  mergeGroups(sourceGroupId: string, targetGroupId: string): Promise<IntentResult>;
  ungroupItem(itemId: string): Promise<IntentResult>;
  renameGroup(groupId: string, title: string): Promise<IntentResult>;

  vote(groupId: string): Promise<IntentResult>;
  unvote(groupId: string): Promise<IntentResult>;

  addComment(groupId: string, text: string): Promise<IntentResult>;
  editComment(commentId: string, text: string): Promise<IntentResult>;
  deleteComment(commentId: string): Promise<IntentResult>;
  addAction(groupId: string, text: string, assignee: string): Promise<IntentResult>;
  editAction(actionId: string, text: string, assignee: string): Promise<IntentResult>;
  deleteAction(actionId: string): Promise<IntentResult>;

  advance(from: Phase): Promise<IntentResult>;
  setVoteLimit(limit: number): Promise<IntentResult>;
  setTimer(durationMs: number): Promise<IntentResult>;
  pauseTimer(): Promise<IntentResult>;
  resumeTimer(): Promise<IntentResult>;
  addTimerMinute(): Promise<IntentResult>;
  clearTimer(): Promise<IntentResult>;
  next(fromIndex: number): Promise<IntentResult>;
  prev(fromIndex: number): Promise<IntentResult>;
  goTo(fromIndex: number, toIndex: number): Promise<IntentResult>;
  skip(fromIndex: number): Promise<IntentResult>;
};

const OK: IntentResult = { ok: true };
const UNREPORTED: readonly IntentErrorCode[] = ["stale", "disconnected"];

export function createRoomStore(options: RoomStoreOptions): RoomStore {
  const clock = options.clock ?? createClock();
  const serverRoom = signal<RoomState | null>(null);
  const pending = signal<readonly PendingOp[]>([]);
  const status = signal<ConnectionStatus>("connecting");
  const lastError = signal<RoomStoreError | null>(null);
  let errorSeq = 0;

  const room = computed(() => {
    const state = serverRoom.value;
    return state ? applyPendingOps(state, pending.value) : null;
  });
  const isLive = computed(() => status.value === "open" && serverRoom.value !== null);

  const connection = (options.createConnection ?? ((o) => new RoomConnection(o)))({
    code: options.code,
    clientId: options.clientId,
    onStatus: (next) => {
      status.value = next;
    },
    onMessage: (msg, meta) => {
      batch(() => {
        serverRoom.value = applyServerMessage(serverRoom.value, msg);
        if (msg.type === "snapshot") {
          pending.value = [];
          clock.observe(msg.room.serverNow, meta.receivedAt, meta.helloSentAt ?? meta.receivedAt);
        } else if (msg.type === "timer") {
          clock.observe(msg.serverNow, meta.receivedAt);
        } else if (msg.type === "error" && !msg.reqId) {
          report(new IntentError(msg.code, msg.message));
        }
      });
    },
  });

  function report(error: IntentError): void {
    errorSeq += 1;
    lastError.value = { id: errorSeq, code: error.code, message: error.message };
  }

  function toIntentError(cause: unknown): IntentError {
    if (cause instanceof IntentError) return cause;
    return new IntentError("disconnected", cause instanceof Error ? cause.message : String(cause));
  }

  async function send(
    intent: Intent,
    reqId?: string,
    silent: readonly IntentErrorCode[] = [],
  ): Promise<IntentResult> {
    try {
      await connection.send(intent, reqId);
      return OK;
    } catch (cause) {
      const error = toIntentError(cause);
      if (!UNREPORTED.includes(error.code) && !silent.includes(error.code)) report(error);
      return { ok: false, error };
    }
  }

  async function sendOptimistic(
    intent: OptimisticIntent,
    silent: readonly IntentErrorCode[] = [],
  ): Promise<IntentResult> {
    const reqId = crypto.randomUUID();
    pending.value = [...pending.value, { reqId, intent, issuedAt: clock.serverNowEstimate() }];
    try {
      return await send(intent, reqId, silent);
    } finally {
      pending.value = pending.value.filter((op) => op.reqId !== reqId);
    }
  }

  return {
    code: options.code,
    room,
    status,
    isLive,
    lastError,
    serverNow: () => clock.serverNowEstimate(),
    dismissError: () => {
      lastError.value = null;
    },
    connect: () => connection.connect(),
    dispose: () => connection.dispose(),

    addItem: (categoryId, text) => send({ type: "addItem", categoryId, text }),
    editItem: (itemId, text) => send({ type: "editItem", itemId, text }),
    deleteItem: (itemId) => send({ type: "deleteItem", itemId }),
    setReady: (ready) => send({ type: "setReady", ready }),

    moveItemToGroup: (itemId, groupId) =>
      sendOptimistic({ type: "moveItemToGroup", itemId, groupId }, ["not_found"]),
    mergeGroups: (sourceGroupId, targetGroupId) =>
      sendOptimistic({ type: "mergeGroups", sourceGroupId, targetGroupId }, ["not_found"]),
    ungroupItem: (itemId) => sendOptimistic({ type: "ungroupItem", itemId }, ["not_found"]),
    renameGroup: (groupId, title) => send({ type: "renameGroup", groupId, title }),

    vote: (groupId) => send({ type: "vote", groupId }),
    unvote: (groupId) => send({ type: "unvote", groupId }),

    addComment: (groupId, text) => send({ type: "addComment", groupId, text }),
    editComment: (commentId, text) => send({ type: "editComment", commentId, text }),
    deleteComment: (commentId) => send({ type: "deleteComment", commentId }),
    addAction: (groupId, text, assignee) => send({ type: "addAction", groupId, text, assignee }),
    editAction: (actionId, text, assignee) =>
      send({ type: "editAction", actionId, text, assignee }),
    deleteAction: (actionId) => send({ type: "deleteAction", actionId }),

    advance: (from) => send({ type: "advance", from }),
    setVoteLimit: (limit) => sendOptimistic({ type: "setVoteLimit", limit }),
    setTimer: (durationMs) => send({ type: "setTimer", durationMs }),
    pauseTimer: () => send({ type: "pauseTimer" }),
    resumeTimer: () => send({ type: "resumeTimer" }),
    addTimerMinute: () => send({ type: "addTimerMinute" }),
    clearTimer: () => send({ type: "clearTimer" }),
    next: (fromIndex) => send({ type: "next", fromIndex }),
    prev: (fromIndex) => send({ type: "prev", fromIndex }),
    goTo: (fromIndex, toIndex) => send({ type: "goTo", fromIndex, toIndex }),
    skip: (fromIndex) => send({ type: "skip", fromIndex }),
  };
}
