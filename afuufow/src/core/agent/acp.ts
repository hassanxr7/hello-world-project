/**
 * Minimal Agent Client Protocol (ACP) client.
 * Afuufow starts the Open Interpreter engine as `interpreter acp` and talks JSON-RPC over its stdio.
 * The engine owns the model and the tools; Afuufow owns the user interface and EVERY approval decision:
 * the engine sends `session/request_permission` before it runs a command or changes a file, and nothing runs
 * until this client answers. Protocol: https://agentclientprotocol.com
 *
 * This file is OS-independent and only needs a line transport, so it is unit-tested with an in-memory fake agent
 * and integration-tested against the real engine binary (scripts/test-interpreter.mjs).
 */

export interface AcpTransport {
  /** Write one JSON message (the transport appends the newline). */
  write(line: string): void;
  onLine(cb: (line: string) => void): void;
  onExit(cb: (reason: string) => void): void;
  kill(): void;
}

export interface ToolCallInfo {
  id: string;
  title: string;
  /** read | edit | delete | move | search | execute | think | fetch | switch_mode | other */
  kind: string;
  status: string;
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | string;
}

export interface PermissionRequest {
  /** Text the engine attached to the request (it is generic: "wants to run a command"). */
  title: string;
  text: string;
  /** The most recent tool call the engine announced; this is what is actually about to run. */
  lastTool: ToolCallInfo | null;
  options: PermissionOption[];
}

export type PermissionAnswer = 'allow' | 'deny';

export interface PromptHandlers {
  onMessage?(chunk: string): void;
  onTool?(t: ToolCallInfo): void;
  onPermission(req: PermissionRequest): Promise<PermissionAnswer>;
}

export class AcpError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message);
    this.name = 'AcpError';
  }
}

type Json = Record<string, any>;

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer?: NodeJS.Timeout;
}

export class AcpClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private handlers: PromptHandlers | null = null;
  private lastTool: ToolCallInfo | null = null;
  private msgRun = '';
  private text = '';
  private closed = false;
  private exitReason = '';
  private onPermissionInFlight = new Set<Promise<void>>();

  constructor(private tp: AcpTransport) {
    tp.onLine((l) => this.onLine(l));
    tp.onExit((r) => this.onExit(r));
  }

  // ------------------------------------------------------------------ requests

  private request<T = any>(method: string, params: Json, timeoutMs = 60_000): Promise<T> {
    if (this.closed) return Promise.reject(new AcpError('engine is not running: ' + this.exitReason));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const p: Pending = { resolve, reject };
      if (timeoutMs > 0) {
        p.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new AcpError(`${method} timed out`));
        }, timeoutMs);
      }
      this.pending.set(id, p);
      this.tp.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  private notify(method: string, params: Json) {
    if (!this.closed) this.tp.write(JSON.stringify({ jsonrpc: '2.0', method, params }));
  }

  async initialize(): Promise<{ name: string; version: string }> {
    // We declare NO client capabilities: the engine must not ask us to read/write files or run terminals for it.
    const r = await this.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, 120_000);
    return { name: r?.agentInfo?.name ?? 'unknown', version: r?.agentInfo?.version ?? '?' };
  }

  async newSession(cwd: string): Promise<string> {
    const r = await this.request('session/new', { cwd, mcpServers: [] }, 120_000);
    if (!r?.sessionId) throw new AcpError('engine did not return a session id');
    return r.sessionId as string;
  }

  /** Sends one prompt and resolves when the engine finishes its turn. Approvals are asked through handlers.onPermission. */
  async prompt(sessionId: string, text: string, handlers: PromptHandlers, signal?: AbortSignal): Promise<{ stopReason: string; text: string }> {
    this.handlers = handlers;
    this.lastTool = null;
    this.msgRun = '';
    this.text = '';
    const onAbort = () => this.notify('session/cancel', { sessionId });
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const r = await this.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, 0);
      await Promise.allSettled([...this.onPermissionInFlight]);
      return { stopReason: String(r?.stopReason ?? 'unknown'), text: this.text.trim() };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      this.handlers = null;
    }
  }

  cancel(sessionId: string) {
    this.notify('session/cancel', { sessionId });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.exitReason ||= 'closed';
    this.failAll(new AcpError('closed'));
    this.tp.kill();
  }

  // ------------------------------------------------------------------ incoming

  private onLine(line: string) {
    const s = line.trim();
    if (!s.startsWith('{')) return; // engine log noise
    let m: Json;
    try {
      m = JSON.parse(s);
    } catch {
      return;
    }
    if (m.method && m.id !== undefined) void this.onAgentRequest(m);
    else if (m.method) this.onNotification(m);
    else if (m.id !== undefined) this.onResponse(m);
  }

  private onResponse(m: Json) {
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    if (p.timer) clearTimeout(p.timer);
    if (m.error) p.reject(new AcpError(String(m.error.message ?? 'engine error'), m.error.code));
    else p.resolve(m.result);
  }

  private onNotification(m: Json) {
    if (m.method !== 'session/update') return;
    const u = m.params?.update;
    if (!u) return;
    switch (u.sessionUpdate) {
      case 'agent_message_chunk': {
        const c: string = u.content?.type === 'text' ? String(u.content.text ?? '') : '';
        if (!c) return;
        // The engine repeats the full message after streaming it (observed with the real binary): drop that echo.
        if (this.msgRun && c === this.msgRun) return;
        this.msgRun += c;
        this.text += c;
        this.handlers?.onMessage?.(c);
        return;
      }
      case 'tool_call':
      case 'tool_call_update': {
        const prev = this.lastTool && this.lastTool.id === u.toolCallId ? this.lastTool : null;
        const t: ToolCallInfo = {
          id: String(u.toolCallId ?? ''),
          title: String(u.title ?? prev?.title ?? ''),
          kind: String(u.kind ?? prev?.kind ?? 'other'),
          status: String(u.status ?? prev?.status ?? ''),
        };
        // a new message after a tool call is a new message
        this.msgRun = '';
        if (this.text && !/\s$/.test(this.text)) this.text += ' ';
        this.lastTool = t;
        this.handlers?.onTool?.(t);
        return;
      }
    }
  }

  private async onAgentRequest(m: Json) {
    if (m.method !== 'session/request_permission') {
      this.tp.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Method not supported: ${m.method}` } }));
      return;
    }
    const options: PermissionOption[] = Array.isArray(m.params?.options) ? m.params.options : [];
    const tc = m.params?.toolCall ?? {};
    const text = Array.isArray(tc.content) ? tc.content.map((c: Json) => c?.content?.text ?? '').filter(Boolean).join(' ') : '';
    const req: PermissionRequest = { title: String(tc.title ?? ''), text, lastTool: this.lastTool, options };
    const run = (async () => {
      let answer: PermissionAnswer = 'deny';
      try {
        answer = this.handlers ? await this.handlers.onPermission(req) : 'deny';
      } catch {
        answer = 'deny'; // a failure while asking must never turn into permission
      }
      const pick =
        answer === 'allow'
          ? options.find((o) => o.kind === 'allow_once') // never "allow for session": every action is asked again
          : (options.find((o) => o.kind === 'reject_once') ?? options.find((o) => o.kind === 'reject_always'));
      const outcome = pick ? { outcome: 'selected', optionId: pick.optionId } : { outcome: 'cancelled' };
      if (answer === 'allow' && !pick) {
        this.tp.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { outcome: { outcome: 'cancelled' } } }));
        return;
      }
      this.tp.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { outcome } }));
    })();
    this.onPermissionInFlight.add(run);
    void run.finally(() => this.onPermissionInFlight.delete(run));
  }

  private onExit(reason: string) {
    this.exitReason = reason;
    this.closed = true;
    this.failAll(new AcpError('The Open Interpreter engine stopped: ' + reason));
  }

  private failAll(e: Error) {
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(e);
    }
    this.pending.clear();
  }
}
