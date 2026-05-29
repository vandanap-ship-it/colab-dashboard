/**
 * Offline-aware mutation queue for Siddhi mobile.
 *
 * Problem: Site engineers log progress / snags / hindrances from the field
 * where signal is patchy. If the network drops mid-save, the entry vanishes
 * and the engineer doesn't know.
 *
 * Solution: Every mutation is written to IndexedDB FIRST. The queue then
 * attempts to flush it to the server. If the server call fails (offline, 500,
 * timeout), the entry stays in the queue. We re-flush whenever:
 *   - The browser fires the `online` event
 *   - The app comes back into the foreground (visibilitychange)
 *   - A new entry is enqueued (piggyback flush)
 *   - A timed retry fires (exponential backoff per item)
 *
 * Photos are not queued in v1 — they're attempted inline with a non-blocking
 * warning on failure (handled in the form component). The entry itself always
 * persists.
 */

const DB_NAME = "siddhi-offline-queue";
const DB_VERSION = 1;
const STORE = "mutations";

export type QueuedMutation = {
  id?: number;
  endpoint: string;
  method: "POST" | "PATCH" | "DELETE" | "PUT";
  body: unknown; // JSON-serialisable
  createdAt: number;
  attempts: number;
  lastError?: string;
  nextAttemptAt: number;
  label: string; // human-readable, e.g. "Progress for Footing Reinforcement"
};

type QueueListener = (count: number) => void;

const listeners = new Set<QueueListener>();
let flushInFlight: Promise<void> | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("nextAttemptAt", "nextAttemptAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    let result: T;
    Promise.resolve(fn(store))
      .then((r) => {
        result = r;
      })
      .catch((e) => reject(e));
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function notify(count: number) {
  for (const cb of listeners) {
    try {
      cb(count);
    } catch (e) {
      console.error("[offlineQueue] listener threw:", e);
    }
  }
}

async function count(): Promise<number> {
  return tx("readonly", (store) =>
    new Promise<number>((resolve, reject) => {
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
  );
}

async function readAll(): Promise<QueuedMutation[]> {
  return tx("readonly", (store) =>
    new Promise<QueuedMutation[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as QueuedMutation[]);
      req.onerror = () => reject(req.error);
    }),
  );
}

async function remove(id: number): Promise<void> {
  await tx("readwrite", (store) => {
    store.delete(id);
  });
}

async function update(item: QueuedMutation): Promise<void> {
  await tx("readwrite", (store) => {
    store.put(item);
  });
}

/**
 * Add a mutation to the queue and attempt to flush immediately.
 * Returns the queued item's id (useful if the caller wants to reference it).
 */
export async function enqueue(
  mutation: Omit<QueuedMutation, "id" | "createdAt" | "attempts" | "nextAttemptAt">,
): Promise<number> {
  if (typeof window === "undefined") {
    throw new Error("offlineQueue: enqueue called server-side");
  }
  const now = Date.now();
  const item: QueuedMutation = {
    ...mutation,
    createdAt: now,
    attempts: 0,
    nextAttemptAt: now,
  };
  const id = await tx("readwrite", (store) =>
    new Promise<number>((resolve, reject) => {
      const req = store.add(item);
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    }),
  );
  notify(await count());
  // Piggyback flush — don't await, but don't block either.
  void flush();
  return id;
}

/**
 * Try to push every due-and-not-recently-failed mutation to the server.
 * Items that succeed are removed. Items that fail are retried with
 * exponential backoff (5s → 10s → 20s → … capped at 5 minutes).
 */
export async function flush(): Promise<void> {
  if (typeof window === "undefined") return;
  if (flushInFlight) return flushInFlight;
  flushInFlight = (async () => {
    try {
      const items = await readAll();
      if (items.length === 0) return;
      const now = Date.now();
      for (const item of items) {
        if (!item.id) continue;
        if (item.nextAttemptAt > now) continue;
        try {
          const res = await fetch(item.endpoint, {
            method: item.method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item.body),
          });
          if (res.ok) {
            await remove(item.id);
            continue;
          }
          // 401 (session expired) and 408/429 (transient) WILL succeed once the
          // engineer re-authenticates or the server recovers, so keep retrying
          // with backoff. Other 4xx (validation, permission, not-found) won't
          // fix themselves — park them for a day so the engineer can review and
          // manually retry/discard via the pending list.
          const retryable =
            res.status >= 500 || res.status === 401 || res.status === 408 || res.status === 429;
          if (!retryable) {
            const text = await res.text().catch(() => `HTTP ${res.status}`);
            await update({
              ...item,
              attempts: item.attempts + 1,
              lastError: `HTTP ${res.status}: ${text.slice(0, 200)}`,
              // Long delay so it doesn't spam retries; user can manually retry.
              nextAttemptAt: now + 24 * 60 * 60 * 1000,
            });
          } else {
            await update({
              ...item,
              attempts: item.attempts + 1,
              lastError: `HTTP ${res.status}`,
              nextAttemptAt: now + nextDelay(item.attempts + 1),
            });
          }
        } catch (e) {
          // Network error → offline. Just bump retry time.
          await update({
            ...item,
            attempts: item.attempts + 1,
            lastError: e instanceof Error ? e.message : "network error",
            nextAttemptAt: now + nextDelay(item.attempts + 1),
          });
        }
      }
    } finally {
      notify(await count());
      flushInFlight = null;
    }
  })();
  return flushInFlight;
}

function nextDelay(attempt: number): number {
  // 5s, 10s, 20s, 40s, 80s, 160s, 300s (max)
  return Math.min(300_000, 5_000 * Math.pow(2, attempt - 1));
}

/** Subscribe to count updates. Returns an unsubscribe function. */
export function subscribe(cb: QueueListener): () => void {
  listeners.add(cb);
  void count().then(cb).catch(() => {});
  return () => {
    listeners.delete(cb);
  };
}

/** For UIs that want to render the actual queued items (e.g. a pending list). */
export async function list(): Promise<QueuedMutation[]> {
  return readAll();
}

/** Manually remove a queued item (e.g. user gives up on an entry stuck at 4xx). */
export async function discard(id: number): Promise<void> {
  await remove(id);
  notify(await count());
}

/** Force a retry of every queued item right now (clears the backoff timer). */
export async function retryAll(): Promise<void> {
  const items = await readAll();
  const now = Date.now();
  for (const item of items) {
    if (!item.id) continue;
    await update({ ...item, nextAttemptAt: now });
  }
  await flush();
}

/**
 * Wire up automatic flush triggers. Call once on app start (or on first
 * mobile page mount). Idempotent — safe to call repeatedly.
 */
let wired = false;
export function installAutoFlush(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("online", () => {
    void flush();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flush();
  });
  // Periodic check (every 30s) catches the slow case where neither online
  // event nor visibility change fired.
  setInterval(() => {
    void flush();
  }, 30_000);
  // Initial flush on mount
  void flush();
}
