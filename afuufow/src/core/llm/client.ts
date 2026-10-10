import type { Settings } from '../config/settings';
import type { LlmClient } from '../platform';
import { type ChatMessage, type ChatOptions, CloudDisabledError, type LlmProvider } from './providers';

/** Wraps the configured provider and enforces the owner's cloud-privacy switch on every call. */
export class LlmRouter implements LlmClient {
  constructor(
    private settings: () => Settings,
    private provider: () => LlmProvider,
  ) {}

  isCloud(): boolean {
    return this.provider().isCloud;
  }

  private guard() {
    const p = this.provider();
    if (p.isCloud && !this.settings().privacy.allowCloudLlm) throw new CloudDisabledError('Cloud AI');
    return p;
  }

  async *stream(messages: ChatMessage[], opts?: ChatOptions): AsyncGenerator<string> {
    const p = this.guard();
    yield* p.stream(messages, { temperature: this.settings().providers.llm.temperature, ...opts });
  }

  async complete(system: string, user: string, opts: { signal?: AbortSignal; json?: boolean } = {}): Promise<string> {
    let out = '';
    for await (const t of this.stream([{ role: 'system', content: system }, { role: 'user', content: user }], { signal: opts.signal, jsonSchema: opts.json ? {} : undefined })) out += t;
    return out;
  }

  /** Structured output (planner). Falls back to plain text parsing when the provider ignores the schema. */
  async completeJson(system: string, user: string, schema: object, signal?: AbortSignal): Promise<string> {
    let out = '';
    for await (const t of this.stream([{ role: 'system', content: system }, { role: 'user', content: user }], { signal, jsonSchema: schema, temperature: 0.1, maxTokens: 400 })) out += t;
    return out;
  }

  ping(signal?: AbortSignal) {
    return this.provider().ping(signal);
  }

  /** Load the local model in the background so the first answer is not slow. */
  warm(): Promise<void> {
    return this.provider().warm?.() ?? Promise.resolve();
  }
}

/** Splits a token stream into speakable sentences (so speech can start before the answer is complete). */
export async function* sentences(tokens: AsyncIterable<string>): AsyncGenerator<string> {
  let buf = '';
  for await (const t of tokens) {
    buf += t;
    for (;;) {
      // wait for whitespace after the terminator, so "3.5" or "e.g." are not split mid-token
      const m = /^([\s\S]*?[.!?؟…]+["”')\]]*)\s+/.exec(buf);
      if (!m) break;
      const s = m[1]!.trim();
      buf = buf.slice(m[0].length);
      if (s.length >= 2) yield s;
    }
    // long run without punctuation: flush at a comma/space to keep latency low
    if (buf.length > 220) {
      const cut = Math.max(buf.lastIndexOf(', '), buf.lastIndexOf(' '));
      if (cut > 80) {
        yield buf.slice(0, cut + 1).trim();
        buf = buf.slice(cut + 1);
      }
    }
  }
  const rest = buf.trim();
  if (rest) yield rest;
}
