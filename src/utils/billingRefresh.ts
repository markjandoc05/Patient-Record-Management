// Financial changes carry no record data between tabs. Each subscriber rereads
// its own authorized scope; this signal never grants access or clears denials.
const EVENT_NAME = 'vine:billing-refresh';
const CHANNEL_NAME = 'vine-billing-refresh';
const STORAGE_KEY = 'vine.billing-refresh';
const SIGNAL_TYPE = 'financial-change';
const COALESCE_MS = 200;

type Signal = { type: typeof SIGNAL_TYPE; nonce: string };
const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending = false;
let detach: (() => void) | null = null;

function visible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function schedule() {
  pending = true;
  if (!visible() || timer !== undefined) return;
  timer = setTimeout(() => {
    timer = undefined;
    if (!visible() || !pending) return;
    pending = false;
    for (const listener of [...listeners]) listener();
  }, COALESCE_MS);
}

function isSignal(value: unknown): value is Signal {
  return !!value && typeof value === 'object' && (value as Signal).type === SIGNAL_TYPE
    && typeof (value as Signal).nonce === 'string' && (value as Signal).nonce.length <= 128;
}

function start() {
  if (detach || typeof window === 'undefined') return;
  const visibility = () => { if (visible()) schedule(); };
  const storage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try { if (isSignal(JSON.parse(event.newValue))) schedule(); } catch { /* Ignore unrelated or malformed signals. */ }
  };
  const message = (event: MessageEvent) => { if (isSignal(event.data)) schedule(); };
  window.addEventListener(EVENT_NAME, schedule);
  window.addEventListener('focus', visibility);
  window.addEventListener('storage', storage);
  document.addEventListener('visibilitychange', visibility);
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener('message', message);
    }
  } catch { channel = null; }
  detach = () => {
    window.removeEventListener(EVENT_NAME, schedule);
    window.removeEventListener('focus', visibility);
    window.removeEventListener('storage', storage);
    document.removeEventListener('visibilitychange', visibility);
    channel?.close();
    channel = null;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending = false;
    detach = null;
  };
}

/** Refresh financial reads after a local change, another tab's change or return. */
export function subscribeBillingRefresh(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) detach?.();
  };
}

/** Call only after a successful financial mutation; payload is signal-only. */
export function publishBillingRefresh(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(EVENT_NAME));
  const signal: Signal = { type: SIGNAL_TYPE, nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
  let temporary: BroadcastChannel | null = null;
  try {
    if (channel) { channel.postMessage(signal); return; }
    if (typeof BroadcastChannel !== 'undefined') {
      temporary = new BroadcastChannel(CHANNEL_NAME);
      temporary.postMessage(signal);
      return;
    }
  } catch { /* Fall back to a storage notification when channels are unavailable. */ }
  finally { temporary?.close(); }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(signal));
    window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* Same-window and focus refresh still work with storage disabled. */ }
}
