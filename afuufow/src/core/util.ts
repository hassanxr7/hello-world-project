export function uid(prefix = ''): string {
  const r = Math.random().toString(36).slice(2, 10);
  return `${prefix}${Date.now().toString(36)}${r}`;
}

export function deepMerge<T>(base: T, over: unknown): T {
  if (over === undefined || over === null) return base;
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over as T;
  if (typeof over !== 'object' || Array.isArray(over)) return over as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new AbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class AbortError extends Error {
  constructor(msg = 'aborted') {
    super(msg);
    this.name = 'AbortError';
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortError();
}

/** Redact likely secrets before anything is logged. */
export function redact(s: string): string {
  return s
    .replace(/(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, '$1…')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1…')
    .replace(/([?&](?:key|api[_-]?key|token|subscription-key)=)[^&\s]+/gi, '$1…');
}
