import type { Settings } from '../config/settings';
import { AbortError, redact } from '../util';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  signal?: AbortSignal;
  temperature?: number;
  /** JSON schema object -> constrained JSON output (Ollama `format`, OpenAI json mode). */
  jsonSchema?: object;
  maxTokens?: number;
}

export interface LlmProvider {
  readonly id: 'ollama' | 'openai' | 'anthropic';
  readonly isCloud: boolean;
  stream(messages: ChatMessage[], opts?: ChatOptions): AsyncGenerator<string>;
  ping(signal?: AbortSignal): Promise<{ ok: boolean; detail: string }>;
  /** Optional: load the model into memory ahead of the first request. */
  warm?(): Promise<void>;
}

export class CloudDisabledError extends Error {
  constructor(what: string) {
    super(`${what} is disabled in privacy settings`);
    this.name = 'CloudDisabledError';
  }
}

async function* readLines(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  if (!res.body) throw new Error('empty response body');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      if (signal?.aborted) throw new AbortError();
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        yield line;
      }
    }
    if (buf.trim()) yield buf;
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

async function failIfBad(res: Response, who: string): Promise<void> {
  if (res.ok) return;
  let body = '';
  try {
    body = (await res.text()).slice(0, 300);
  } catch {
    /* ignore */
  }
  throw new Error(`${who} HTTP ${res.status}${body ? ': ' + redact(body) : ''}`);
}

export class OllamaProvider implements LlmProvider {
  readonly id = 'ollama' as const;
  readonly isCloud = false;
  constructor(
    private baseUrl: string,
    private model: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async *stream(messages: ChatMessage[], opts: ChatOptions = {}): AsyncGenerator<string> {
    const res = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: opts.signal,
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        keep_alive: '30m', // Ollama unloads the model after 5 min by default; reloading a 3 GB model costs 10-30 s per reply
        ...(opts.jsonSchema ? { format: opts.jsonSchema } : {}),
        options: { temperature: opts.temperature ?? 0.4, ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}) },
      }),
    });
    await failIfBad(res, 'Ollama');
    for await (const line of readLines(res, opts.signal)) {
      if (!line.trim()) continue;
      let j: { message?: { content?: string }; done?: boolean; error?: string };
      try {
        j = JSON.parse(line);
      } catch {
        continue;
      }
      if (j.error) throw new Error('Ollama: ' + j.error);
      if (j.message?.content) yield j.message.content;
      if (j.done) return;
    }
  }

  async warm(): Promise<void> {
    try {
      await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, keep_alive: '30m' }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      /* Ollama not running: the first real request reports it */
    }
  }

  async ping(signal?: AbortSignal) {
    try {
      const res = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/api/tags`, { signal: signal ?? AbortSignal.timeout(4000) });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      const j = (await res.json()) as { models?: Array<{ name: string }> };
      const names = (j.models ?? []).map((m) => m.name);
      const has = names.some((n) => n === this.model || n === this.model + ':latest' || (!this.model.includes(':') && n.split(':')[0] === this.model));
      return has ? { ok: true, detail: `model ${this.model} available` } : { ok: false, detail: `Ollama is running but model "${this.model}" is not installed (installed: ${names.join(', ') || 'none'}). Run: ollama pull ${this.model}` };
    } catch (e) {
      return { ok: false, detail: `Ollama is not reachable at ${this.baseUrl}: ${(e as Error).message}` };
    }
  }
}

export class OpenAICompatProvider implements LlmProvider {
  readonly id = 'openai' as const;
  readonly isCloud: boolean;
  constructor(
    private baseUrl: string,
    private model: string,
    private getKey: () => string | null,
    private fetchFn: typeof fetch = fetch,
  ) {
    // Anything that is not a loopback address is treated as a cloud service for privacy gating.
    this.isCloud = !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(baseUrl);
  }

  async *stream(messages: ChatMessage[], opts: ChatOptions = {}): AsyncGenerator<string> {
    const key = this.getKey();
    const res = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      signal: opts.signal,
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        temperature: opts.temperature ?? 0.4,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        ...(opts.jsonSchema ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    await failIfBad(res, 'OpenAI-compatible API');
    for await (const line of readLines(res, opts.signal)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const j = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        const t = j.choices?.[0]?.delta?.content;
        if (t) yield t;
      } catch {
        /* keep-alive or partial */
      }
    }
  }

  async ping(signal?: AbortSignal) {
    try {
      const key = this.getKey();
      const res = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: signal ?? AbortSignal.timeout(6000) });
      return res.ok ? { ok: true, detail: 'reachable' } : { ok: false, detail: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}

export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic' as const;
  readonly isCloud = true;
  constructor(
    private model: string,
    private getKey: () => string | null,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async *stream(messages: ChatMessage[], opts: ChatOptions = {}): AsyncGenerator<string> {
    const key = this.getKey();
    if (!key) throw new Error('Anthropic API key is not set');
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system');
    const res = await this.fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: opts.signal,
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.4,
        stream: true,
        ...(system ? { system: opts.jsonSchema ? system + '\nRespond with a single JSON object only.' : system } : {}),
        messages: rest,
      }),
    });
    await failIfBad(res, 'Anthropic API');
    for await (const line of readLines(res, opts.signal)) {
      if (!line.startsWith('data:')) continue;
      try {
        const j = JSON.parse(line.slice(5).trim()) as { type?: string; delta?: { type?: string; text?: string } };
        if (j.type === 'content_block_delta' && j.delta?.text) yield j.delta.text;
        if (j.type === 'message_stop') return;
      } catch {
        /* ignore */
      }
    }
  }

  async ping() {
    return this.getKey() ? { ok: true, detail: 'API key present (not validated until first request)' } : { ok: false, detail: 'API key is not set' };
  }
}

export function buildProvider(settings: Settings, getSecret: (name: string) => string | null, fetchFn: typeof fetch = fetch): LlmProvider {
  const l = settings.providers.llm;
  switch (l.primary) {
    case 'ollama':
      return new OllamaProvider(l.ollamaBaseUrl, l.ollamaModel, fetchFn);
    case 'openai':
      return new OpenAICompatProvider(l.openaiBaseUrl, l.openaiModel, () => getSecret('openai.key'), fetchFn);
    case 'anthropic':
      return new AnthropicProvider(l.anthropicModel, () => getSecret('anthropic.key'), fetchFn);
  }
}
