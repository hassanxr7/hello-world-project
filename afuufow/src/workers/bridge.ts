/** Typed access to the worker preload bridge. */
export interface WorkerBridge {
  send(channel: string, payload?: unknown): void;
  on(channel: string, cb: (payload: any) => void): void;
}
declare global {
  interface Window {
    worker: WorkerBridge;
  }
}
export const bridge = () => window.worker;
