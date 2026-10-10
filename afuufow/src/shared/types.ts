export type AssistantState =
  | 'sleeping' // idle, only wake word / PTT / text can start work
  | 'paused' // microphone (and optionally camera) paused by the owner
  | 'listening'
  | 'thinking'
  | 'executing'
  | 'speaking'
  | 'error';

/** How strongly the current person has been identified as the owner. */
export type AssuranceLevel = 'none' | 'voice' | 'presence' | 'strong';
export const ASSURANCE_ORDER: Record<AssuranceLevel, number> = {
  none: 0,
  voice: 1,
  presence: 2,
  strong: 3,
};

export type ToolRisk = 'routine' | 'messaging' | 'private' | 'sensitive' | 'forbidden';

export type VerifyStatus = 'verified' | 'unverified' | 'failed' | 'cancelled' | 'needs_input' | 'denied';

export interface ToolResult {
  status: VerifyStatus;
  /** Somali message to speak/show. */
  so: string;
  /** English message for the log / English mode. */
  en: string;
  /** How the outcome was (or was not) verified. */
  verification?: { method: string; observed?: string };
  data?: Record<string, unknown>;
}

export interface ChatTurn {
  id: string;
  at: number;
  role: 'owner' | 'assistant' | 'visitor' | 'system';
  text: string;
  lang?: 'so' | 'en' | 'mixed';
  source?: 'voice' | 'text' | 'system';
}

export interface ActionRecord {
  id: string;
  at: number;
  finishedAt?: number;
  tool: string;
  summary: string;
  risk: ToolRisk;
  status: VerifyStatus | 'running';
  message?: string;
  verification?: string;
  decidedBy: 'auto' | 'standing-permission' | 'owner-confirmation' | 'strong-auth' | 'denied';
}

export interface Contact {
  id: string;
  displayName: string;
  aliases: string[];
  /** Digits only, international format without "+", e.g. "252611234567". */
  phone: string;
  /** Owner approved this contact as a messaging recipient. */
  approved: boolean;
  /** Fast-send: a command that names this contact may send without a second confirmation. */
  fastSend: boolean;
  note?: string;
}

export interface FolderEntry {
  label: string;
  path: string;
}

export interface PermissionGrant {
  id: string;
  /** e.g. "messaging.fastSend:contactId", "apps.any", "files.search:folderPath" */
  key: string;
  createdAt: number;
  expiresAt?: number;
  note?: string;
}
