import { z } from 'zod';
import type { ActionRecord, ToolResult } from '../../shared/types';
import { AbortError, uid } from '../util';
import { type Decision, type PolicyContext, type ToolMeta, type ToolRequest, decide } from '../permissions/policy';
import type { ActionLog } from './actionlog';

export interface ToolRuntime {
  signal: AbortSignal;
  /** Appends a note that is shown as "current task" progress. */
  progress(msg: string): void;
}

export interface ToolDef<I = unknown> {
  meta: ToolMeta;
  /** One line for the AI planner. */
  description: string;
  schema: z.ZodType<I>;
  /** Human readable summary for the action history. */
  describe(input: I): string;
  facts?(input: I): ToolRequest['facts'];
  timeoutMs?: number;
  run(input: I, rt: ToolRuntime): Promise<ToolResult>;
}

export type ExecOutcome =
  | { kind: 'done'; result: ToolResult; record: ActionRecord }
  | { kind: 'confirm'; decision: Extract<Decision, { kind: 'confirm' }>; tool: string; input: unknown }
  | { kind: 'auth'; decision: Extract<Decision, { kind: 'auth' }>; tool: string; input: unknown }
  | { kind: 'denied'; result: ToolResult; record: ActionRecord };

export interface ExecOptions {
  /** the owner has just said yes to the confirmation prompt for this exact call */
  confirmed?: boolean;
  fromPlanner?: boolean;
  onProgress?: (msg: string) => void;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDef<any>>();
  register<I>(t: ToolDef<I>) {
    if (this.tools.has(t.meta.name)) throw new Error('duplicate tool ' + t.meta.name);
    this.tools.set(t.meta.name, t);
  }
  get(name: string) {
    return this.tools.get(name);
  }
  list() {
    return [...this.tools.values()];
  }
}

export class Executor {
  constructor(
    private registry: ToolRegistry,
    private log: ActionLog,
    private policyCtx: () => PolicyContext,
    private hooks: { onStrongUsed?: () => void } = {},
  ) {}

  async execute(name: string, rawInput: unknown, signal: AbortSignal, opts: ExecOptions = {}): Promise<ExecOutcome> {
    const tool = this.registry.get(name);
    const now = Date.now();
    if (!tool) {
      const rec = this.log.begin({ tool: name, summary: `unknown tool ${name}`, risk: 'forbidden', decidedBy: 'denied' });
      const result: ToolResult = { status: 'denied', so: 'Qalabkaas ma jiro.', en: `Unknown tool: ${name}` };
      return { kind: 'denied', result, record: this.log.finish(rec.id, result) };
    }

    const parsed = tool.schema.safeParse(rawInput);
    if (!parsed.success) {
      const rec = this.log.begin({ tool: name, summary: 'invalid input', risk: tool.meta.risk, decidedBy: 'denied' });
      const result: ToolResult = {
        status: 'failed',
        so: 'Macluumaadka amarka ma dhammaystirna.',
        en: 'Invalid tool input: ' + parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '),
      };
      return { kind: 'denied', result, record: this.log.finish(rec.id, result) };
    }
    const input = parsed.data;
    const summary = tool.describe(input);

    const ctx = this.policyCtx();
    const decision = decide(ctx, { meta: tool.meta, facts: tool.facts?.(input), fromPlanner: opts.fromPlanner });

    let decidedBy: ActionRecord['decidedBy'] = 'auto';
    if (decision.kind === 'deny') {
      const rec = this.log.begin({ tool: name, summary, risk: tool.meta.risk, decidedBy: 'denied' });
      const result: ToolResult = { status: 'denied', so: decision.so, en: decision.en };
      return { kind: 'denied', result, record: this.log.finish(rec.id, result) };
    }
    if (decision.kind === 'auth') return { kind: 'auth', decision, tool: name, input };
    if (decision.kind === 'confirm') {
      if (!opts.confirmed) return { kind: 'confirm', decision, tool: name, input };
      decidedBy = decision.strong ? 'strong-auth' : 'owner-confirmation';
      if (decision.strong) this.hooks.onStrongUsed?.();
    } else {
      decidedBy = decision.by === 'standing-permission' ? 'standing-permission' : 'auto';
    }

    const rec = this.log.begin({ tool: name, summary, risk: tool.meta.risk, decidedBy });
    const timeout = AbortSignal.timeout(tool.timeoutMs ?? 60_000);
    const signalAny = AbortSignal.any([signal, timeout]);
    let result: ToolResult;
    try {
      result = await raceAbort(
        tool.run(input, { signal: signalAny, progress: (m) => opts.onProgress?.(m) }),
        signalAny,
      );
    } catch (e) {
      if (e instanceof AbortError || (e as Error).name === 'AbortError') {
        const timedOut = timeout.aborted && !signal.aborted;
        result = timedOut
          ? { status: 'failed', so: 'Waqtigii waa dhammaaday; tallaabada lama dhammaystirin.', en: 'The action timed out.' }
          : { status: 'cancelled', so: 'Waa la joojiyay.', en: 'Cancelled.' };
      } else {
        result = { status: 'failed', so: 'Cilad ayaa dhacday: tallaabada ma guulaysan.', en: 'Tool error: ' + (e as Error).message };
      }
    }
    void now;
    return { kind: 'done', result, record: this.log.finish(rec.id, result) };
  }
}

function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new AbortError());
    const onAbort = () => reject(new AbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

export const ok = (so: string, en: string, method?: string, observed?: string, data?: Record<string, unknown>): ToolResult => ({
  status: 'verified',
  so,
  en,
  verification: method ? { method, observed } : undefined,
  data,
});
export const unverified = (so: string, en: string, why: string, data?: Record<string, unknown>): ToolResult => ({
  status: 'unverified',
  so,
  en,
  verification: { method: 'none', observed: why },
  data,
});
export const failed = (so: string, en: string, data?: Record<string, unknown>): ToolResult => ({ status: 'failed', so, en, data });
export const needsInput = (so: string, en: string, data?: Record<string, unknown>): ToolResult => ({ status: 'needs_input', so, en, data });

export { z, uid };
