import type { AgentOutcome, AgentQuestion } from './session';

/** What the assistant needs from the Open Interpreter integration (implemented in the main process). */
export interface AgentRunner {
  /** Is the engine installed and does it have what it needs to run? */
  status(): Promise<{ ready: boolean; detail: string }>;
  run(goal: string, o: { signal: AbortSignal; onProgress: (msg: string) => void; ask: (q: AgentQuestion, signal: AbortSignal) => Promise<boolean> }): Promise<AgentOutcome>;
}
