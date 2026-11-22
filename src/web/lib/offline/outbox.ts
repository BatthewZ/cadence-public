import { WRITE_ERROR_CODES } from "@/shared/constants/offline-sync";

import { type OfflineDb, OUTBOX_STORE } from "./idb";
import { performWrite, type QueuedWrite, type WriteOutcome, type WriteRequest } from "./perform-write";

export type SyncState = "idle" | "syncing" | "waiting" | "blocked";

export interface SyncStatus {
  online: boolean;
  /** Writes stored and not yet accepted or refused by the server. */
  pending: number;
  /** Of `pending`: writes made online that a caller is awaiting the reply to. Not shown as queued. */
  sending: number;
  state: SyncState;
  /** `auth`: the session ended mid-replay. `stuck`: the oldest write kept failing with a server error. */
  blockedReason: "auth" | "stuck" | null;
  /** Epoch ms of the next automatic attempt while `waiting`. */
  nextRetryAt: number | null;
  lastError: string | null;
}

/** A queued write the server refused for good (4xx); it has been removed from the queue. */
export interface Refusal {
  write: QueuedWrite;
  status: number;
  message: string;
  code?: string;
  body: unknown;
}

/**
 * What a write passed to `send` gets back: the server's answer, or `queued` when the write has
 * to wait after all (connection lost, sign-in needed, another tab sent it). A `queued` write
 * replays later like any other.
 */
export type SendAnswer =
  | Exclude<WriteOutcome, { kind: "network" } | { kind: "in-progress" }>
  | { kind: "queued" };

export interface NewWrite {
  request: WriteRequest;
  key: string;
}

/** Writes visible to the person as waiting to sync (excludes those still awaited online). */
export function queuedCount(status: SyncStatus): number {
  return Math.max(0, status.pending - status.sending);
}

/**
 * How long a write made online keeps its caller waiting for the server. Past it, the caller gets
 * `queued` and the write carries on in the background like any queued one: on a network that is up
 * but not answering (flaky Wi-Fi), "Saving…" would otherwise hold until the request gives up.
 */
export const ANSWER_DEADLINE_MS = 3_000;

export const MAX_SERVER_ERROR_ATTEMPTS = 5;
const MIN_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

interface ChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

type ChannelMessage = { type: "changed" } | { type: "drained" };

export interface OutboxDeps {
  db: OfflineDb;
  userId: string;
  isOnline: () => boolean;
  /** Re-read server state once the queue empties after sending (the replies' side effects aren't in the cache). */
  onDrained: () => void;
  onUnauthorized: () => void;
  fetch?: typeof fetch;
  now?: () => number;
  /** Cross-tab exclusive lock; the default uses Web Locks when the browser has them. */
  lock?: (name: string, run: () => Promise<void>) => Promise<void>;
  channel?: ChannelLike | null;
  answerDeadlineMs?: number;
}

interface Waiter {
  resolve: (answer: SendAnswer) => void;
  deadline: ReturnType<typeof setTimeout>;
}

function defaultLock(name: string, run: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  return locks ? locks.request(name, run).then(() => undefined) : run();
}

function defaultChannel(userId: string): ChannelLike | null {
  return typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel(`cadence-outbox:${userId}`);
}

export function byReplayOrder(a: QueuedWrite, b: QueuedWrite): number {
  return a.order - b.order || (a.id ?? 0) - (b.id ?? 0);
}

/** The writes to send next: the first, plus the rest of its batch (stopping at a stuck one). */
function leadingBatch(rows: QueuedWrite[]): QueuedWrite[] {
  const [first] = rows;
  if (!first.batch) return [first];
  let end = 1;
  while (end < rows.length && rows[end].batch === first.batch && !rows[end].stuck) end++;
  return rows.slice(0, end);
}

export class Outbox {
  private status: SyncStatus;
  private readonly listeners = new Set<() => void>();
  private readonly refusalListeners = new Set<(refusal: Refusal) => void>();
  private flushing: Promise<void> | null = null;
  private flushAgain = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = MIN_BACKOFF_MS;
  private uncommitted = 0;
  /** By idempotency key: callers of `send` awaiting that write's answer. */
  private readonly waiters = new Map<string, Waiter>();
  /** Awaited writes a drain has taken up to settle: no longer subject to the deadline, still `sending`. */
  private claimed = 0;
  private writesStored = 0;
  private stopped = false;
  private readonly channel: ChannelLike | null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly lock: (name: string, run: () => Promise<void>) => Promise<void>;
  private readonly answerDeadlineMs: number;

  constructor(private readonly deps: OutboxDeps) {
    this.fetchImpl = deps.fetch ?? ((...args) => fetch(...args));
    this.now = deps.now ?? Date.now;
    this.lock = deps.lock ?? defaultLock;
    this.answerDeadlineMs = deps.answerDeadlineMs ?? ANSWER_DEADLINE_MS;
    this.channel = deps.channel === undefined ? defaultChannel(deps.userId) : deps.channel;
    this.status = {
      online: deps.isOnline(),
      pending: 0,
      sending: 0,
      state: "idle",
      blockedReason: null,
      nextRetryAt: null,
      lastError: null,
    };
    if (this.channel) {
      this.channel.onmessage = (event) => this.onChannelMessage(event.data as ChannelMessage);
    }
  }

  /** Reads the stored queue's size and marks the queue `syncing` if it can drain now, before any GET runs. */
  async start(): Promise<void> {
    await this.recount();
    const stuck = (await this.list()).some((w) => w.stuck);
    if (stuck) this.update({ state: "blocked", blockedReason: "stuck" });
    this.kick();
  }

  stop(): void {
    this.stopped = true;
    this.releaseWaiters();
    this.clearRetry();
    this.channel?.close();
    this.listeners.clear();
    this.refusalListeners.clear();
  }

  getStatus = (): SyncStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  subscribeRefusals(listener: (refusal: Refusal) => void): () => void {
    this.refusalListeners.add(listener);
    return () => void this.refusalListeners.delete(listener);
  }

  /**
   * True when a new write can be sent at once and its answer awaited: nothing is queued ahead of
   * it except writes that are themselves being sent online (it goes in order behind those). With a
   * backlog, or the queue blocked, the write is only stored — waiting on a long replay would leave
   * the caller hanging.
   */
  canSendNow(): boolean {
    if (!this.status.online || this.status.state === "blocked") return false;
    return this.status.pending + this.uncommitted - this.liveCount() <= 0;
  }

  /**
   * Goes up whenever a write is made on this device. A background read started before it may
   * hold the pre-write state, so it mustn't be written over the optimistic one (see prefetch.ts).
   */
  writesMade(): number {
    return this.writesStored;
  }

  async list(): Promise<QueuedWrite[]> {
    const rows = await this.deps.db.getAll<QueuedWrite>(OUTBOX_STORE);
    return rows.sort(byReplayOrder);
  }

  async enqueue(request: WriteRequest, order: number, key: string): Promise<void> {
    await this.store([{ request, key }], order);
    this.broadcast({ type: "changed" });
  }

  /** Stores the writes of one bulk action together, as one batch (see `QueuedWrite.batch`). */
  async enqueueBatch(writes: NewWrite[], order: number): Promise<void> {
    await this.store(writes, order);
    this.broadcast({ type: "changed" });
  }

  /**
   * For writes made while `canSendNow()`: stores them (a batch when several), starts sending, and
   * gives one promise per write for the server's answer. Every write goes through the queue, so a
   * write never overtakes an earlier one still in flight (an edit can't reach the server before
   * the create it depends on). Throws when the writes couldn't be stored.
   */
  async send(writes: NewWrite[], order: number): Promise<Promise<SendAnswer>[]> {
    const answers = writes.map(
      ({ key }) =>
        new Promise<SendAnswer>((resolve) => {
          const deadline = setTimeout(() => this.stopWaiting(key), this.answerDeadlineMs);
          this.waiters.set(key, { resolve, deadline });
        }),
    );
    this.update({ sending: this.liveCount() });
    try {
      await this.store(writes, order);
    } catch (error) {
      for (const { key } of writes) {
        clearTimeout(this.waiters.get(key)?.deadline);
        this.waiters.delete(key);
      }
      this.update({ sending: this.liveCount() });
      throw error;
    }
    this.kick();
    if (!this.flushing) this.releaseWaiters();
    return answers;
  }

  private async store(writes: NewWrite[], order: number): Promise<void> {
    const batch = writes.length > 1 ? crypto.randomUUID() : undefined;
    const rows: QueuedWrite[] = writes.map(({ request, key }) => ({
      v: 1,
      method: request.method,
      path: request.path,
      body: request.body,
      label: request.label,
      order,
      key,
      createdAt: this.now(),
      attempts: 0,
      stuck: false,
      lastError: null,
      ...(batch && { batch }),
    }));
    // Synchronous up to `addAll`: `canSendNow` must count these from the moment they're made.
    this.writesStored += rows.length;
    this.trackUncommitted(rows.length);
    try {
      // One transaction, so no later write can be stored between a batch's rows.
      await this.deps.db.addAll(OUTBOX_STORE, rows);
    } finally {
      this.trackUncommitted(-rows.length);
    }
    this.update({ pending: this.status.pending + rows.length });
  }

  setOnline(online: boolean): void {
    this.update({ online });
    if (online) {
      this.backoffMs = MIN_BACKOFF_MS;
      this.kick();
    }
  }

  /** Starts a drain unless one is running (then it runs again once more after it). */
  kick(): void {
    if (this.stopped) return;
    if (this.flushing) {
      this.flushAgain = true;
      return;
    }
    if (!this.status.online || this.status.pending === 0) return;
    if (this.status.state === "blocked") return;
    this.clearRetry();
    this.update({ state: "syncing", nextRetryAt: null });
    this.flushing = this.lock(`cadence-outbox:${this.deps.userId}`, () => this.drain()).finally(() => {
      this.flushing = null;
      if (this.status.state === "syncing") this.update({ state: "idle" });
      if (this.flushAgain) {
        this.flushAgain = false;
        this.kick();
      }
      // No drain left to answer them (offline, stopped on an error, or another tab sent them).
      if (!this.flushing) this.releaseWaiters();
    });
  }

  /** Resolves once an active drain finishes; immediately when none runs. The read barrier. */
  whenSettled = (): Promise<void> =>
    this.status.state === "syncing" && this.flushing ? this.flushing : Promise.resolve();

  /** The person's "Retry now": un-sticks the queue and drains at once. */
  async retry(): Promise<void> {
    const rows = await this.list();
    for (const row of rows.filter((w) => w.stuck)) {
      await this.deps.db.put(OUTBOX_STORE, { ...row, stuck: false, attempts: 0 });
    }
    this.backoffMs = MIN_BACKOFF_MS;
    this.update({ state: "idle", blockedReason: null, lastError: null });
    this.kick();
  }

  /** Drops one write without sending it (the person's "Discard" on a stuck write). */
  async discard(id: number): Promise<void> {
    await this.deps.db.delete(OUTBOX_STORE, id);
    await this.recount();
    this.broadcast({ type: "changed" });
    if (this.status.blockedReason === "stuck" && !(await this.list()).some((w) => w.stuck)) {
      this.update({ state: "idle", blockedReason: null, lastError: null });
      this.deps.onDrained();
    }
    this.kick();
  }

  private async drain(): Promise<void> {
    let sentAny = false;
    // Only writes nobody awaited need the refresh: an awaited write's caller applies its reply.
    let sentQueued = false;
    while (!this.stopped) {
      if (!this.deps.isOnline()) break;
      const rows = await this.list();
      const next = rows[0];
      if (!next) break;
      if (next.stuck) {
        this.update({ state: "blocked", blockedReason: "stuck", lastError: next.lastError });
        break;
      }
      const group = leadingBatch(rows);
      const outcomes = await Promise.all(group.map((write) => performWrite(write, this.fetchImpl)));
      let stop = false;
      for (const [i, write] of group.entries()) {
        const awaited = this.waiters.has(write.key);
        if ((await this.settle(write, outcomes[i])) === "stop") {
          stop = true;
        } else {
          sentAny = true;
          if (!awaited) sentQueued = true;
        }
      }
      if (stop) break;
    }
    await this.recount();
    if (this.stopped) return;
    if (sentAny) this.broadcast({ type: "changed" });
    if (sentQueued && this.status.pending === 0) {
      this.deps.onDrained();
      this.broadcast({ type: "drained" });
    }
  }

  /**
   * An awaited write (from `send`) settles as the server answered: removed and handed to its
   * caller, who applies or rolls back. Only "no answer yet" keeps it queued, as `queued`.
   */
  private async settle(write: QueuedWrite, outcome: WriteOutcome): Promise<"next" | "stop"> {
    const answer = this.takeWaiter(write.key);
    switch (outcome.kind) {
      case "ok":
        await this.remove(write);
        this.backoffMs = MIN_BACKOFF_MS;
        answer?.(outcome);
        return "next";
      case "refused":
        await this.remove(write);
        if (answer) {
          answer(outcome);
          return "next";
        }
        // A create of ours already landed under an earlier key: the write is applied.
        if (outcome.code !== WRITE_ERROR_CODES.idConflict) {
          const refusal: Refusal = {
            write,
            status: outcome.status,
            message: outcome.message,
            code: outcome.code,
            body: outcome.body,
          };
          for (const listener of this.refusalListeners) listener(refusal);
        }
        return "next";
      case "unauthorized":
        if (answer) {
          // Its caller rolls back; the queue isn't blocked, since nothing of the person's waits in it.
          await this.remove(write);
          answer(outcome);
        } else {
          this.update({ state: "blocked", blockedReason: "auth", lastError: outcome.message });
        }
        this.deps.onUnauthorized();
        return "stop";
      case "rate-limited":
        if (answer) {
          await this.remove(write);
          answer(outcome);
        }
        this.scheduleRetry(outcome.retryAfterMs, outcome.message);
        return "stop";
      case "in-progress":
        answer?.({ kind: "queued" });
        this.scheduleRetry(1_000, null);
        return "stop";
      case "network":
        answer?.({ kind: "queued" });
        this.scheduleRetry(this.nextBackoff(), "Can't reach Cadence");
        return "stop";
      case "server-error": {
        if (answer) {
          await this.remove(write);
          answer(outcome);
          return "next";
        }
        const attempts = write.attempts + 1;
        const stuck = attempts >= MAX_SERVER_ERROR_ATTEMPTS;
        await this.deps.db.put(OUTBOX_STORE, { ...write, attempts, stuck, lastError: outcome.message });
        if (stuck) {
          this.update({ state: "blocked", blockedReason: "stuck", lastError: outcome.message });
        } else {
          this.scheduleRetry(this.nextBackoff(), outcome.message);
        }
        return "stop";
      }
    }
  }

  private liveCount(): number {
    return this.waiters.size + this.claimed;
  }

  /**
   * Claims the caller awaiting `key`, if any, for `settle`: past this point the deadline can't
   * answer it `queued` while its real answer is in hand. It stays counted in `sending` until
   * answered, which every branch of `settle` does only after removing the write: answered first,
   * the write would show as queued in the badge for the length of the IndexedDB delete.
   */
  private takeWaiter(key: string): ((answer: SendAnswer) => void) | undefined {
    const waiter = this.waiters.get(key);
    if (!waiter) return undefined;
    clearTimeout(waiter.deadline);
    this.waiters.delete(key);
    this.claimed++;
    let answered = false;
    return (answer) => {
      if (answered) return;
      answered = true;
      this.claimed--;
      this.update({ sending: this.liveCount() });
      waiter.resolve(answer);
    };
  }

  /** The deadline passed with no answer: the caller gets `queued`, the write stays in the queue. */
  private stopWaiting(key: string): void {
    const waiter = this.waiters.get(key);
    if (!waiter) return;
    this.waiters.delete(key);
    this.update({ sending: this.liveCount() });
    waiter.resolve({ kind: "queued" });
    this.broadcast({ type: "changed" });
  }

  /** Answers every unclaimed awaited write `queued`: it stays stored and replays like any other. */
  private releaseWaiters(): void {
    if (this.waiters.size === 0) return;
    for (const waiter of this.waiters.values()) {
      clearTimeout(waiter.deadline);
      waiter.resolve({ kind: "queued" });
    }
    this.waiters.clear();
    this.update({ sending: this.liveCount() });
    this.broadcast({ type: "changed" });
  }

  private async remove(write: QueuedWrite): Promise<void> {
    if (write.id !== undefined) await this.deps.db.delete(OUTBOX_STORE, write.id);
    this.update({ pending: Math.max(0, this.status.pending - 1) });
  }

  private nextBackoff(): number {
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    return delay;
  }

  private scheduleRetry(delayMs: number, lastError: string | null): void {
    // A batch settles every write; a later one's retry mustn't replace an earlier one's block.
    if (this.status.state === "blocked") return;
    this.clearRetry();
    this.update({ state: "waiting", nextRetryAt: this.now() + delayMs, lastError });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.status.state === "waiting") this.update({ state: "idle", nextRetryAt: null });
      this.kick();
    }, delayMs);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private async recount(): Promise<void> {
    if (this.stopped) return;
    this.update({ pending: await this.deps.db.count(OUTBOX_STORE) });
  }

  private onChannelMessage(message: ChannelMessage): void {
    if (message.type === "drained") this.deps.onDrained();
    void this.recount().then(() => this.kick());
  }

  private broadcast(message: ChannelMessage): void {
    // `stop()` closes the channel, and posting to a closed one throws; a drain may still be finishing.
    if (this.stopped) return;
    this.channel?.postMessage(message);
  }

  private trackUncommitted(delta: number): void {
    const before = this.uncommitted;
    this.uncommitted += delta;
    if (typeof window === "undefined") return;
    if (before === 0 && this.uncommitted > 0) window.addEventListener("beforeunload", preventUnload);
    if (before > 0 && this.uncommitted === 0) window.removeEventListener("beforeunload", preventUnload);
  }

  private update(patch: Partial<SyncStatus>): void {
    const next = { ...this.status, ...patch };
    const changed = (Object.keys(patch) as (keyof SyncStatus)[]).some((k) => next[k] !== this.status[k]);
    if (!changed) return;
    this.status = next;
    for (const listener of this.listeners) listener();
  }
}

/** Held only between a write being made and IndexedDB committing it (milliseconds). */
function preventUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
}
