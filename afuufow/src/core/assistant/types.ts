import type { AssistantState, ChatTurn } from '../../shared/types';

export interface SpeechOut {
  /** Queue text for speech; resolves when this utterance has finished playing (or was stopped). */
  speak(text: string, signal?: AbortSignal, lang?: 'so' | 'en'): Promise<void>;
  /** Immediately stop and flush the queue. */
  stop(): void;
}

export interface TaskInfo {
  id: string;
  label: string;
  startedAt: number;
  steps: string[];
}

export interface PendingInfo {
  kind: 'confirm' | 'choose' | 'text';
  promptSo: string;
  promptEn: string;
  options?: string[];
  expiresAt: number;
}

export type AssistantEvent =
  | { type: 'state'; state: AssistantState }
  | { type: 'turn'; turn: ChatTurn }
  | { type: 'task'; task: TaskInfo | null }
  | { type: 'pending'; pending: PendingInfo | null }
  | { type: 'draft'; text: string }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; so: string; en: string }
  | { type: 'visitors-changed' }
  /** Keep the microphone open for a reply (no wake word) for this many seconds. */
  | { type: 'listen'; seconds: number };

export type SpeakerMatch = 'owner' | 'uncertain' | 'other' | 'unknown';

export interface UtteranceMeta {
  source: 'voice' | 'text';
  speaker?: SpeakerMatch;
}
