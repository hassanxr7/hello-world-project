export type MsgMode = 'send' | 'draft' | 'read_back' | 'unspecified';

export type Intent =
  | { type: 'greet_sit' }
  | { type: 'stop'; scope: 'auto' | 'media' }
  | { type: 'open_app'; app: string }
  | { type: 'open_folder'; folder: string }
  | { type: 'find_file'; query: string; folder?: string }
  | { type: 'open_url'; target: string }
  | { type: 'web_search'; query: string; engine?: 'google' | 'bing' | 'duckduckgo' }
  | { type: 'youtube_play'; query: string; kind: 'song' | 'video' | 'any' }
  | { type: 'media_control'; action: 'pause' | 'resume' | 'next' | 'previous' }
  | { type: 'volume'; action: 'up' | 'down' | 'set' | 'mute' | 'unmute'; amount?: number }
  | { type: 'screenshot' }
  | { type: 'read_screen'; question?: string }
  | {
      type: 'whatsapp_message';
      contact: string;
      message: string;
      mode: MsgMode;
      openFirst: boolean;
    }
  | { type: 'message_followup'; action: 'draft_pending' | 'send_pending' | 'read_pending' | 'cancel_pending' }
  | { type: 'open_whatsapp' }
  | { type: 'draft_text'; kind: 'email' | 'message' | 'text'; language: 'en' | 'so' | 'ar' | null; topic: string }
  | { type: 'paste_text'; target?: string }
  | { type: 'visitor_report' }
  | { type: 'remember'; text: string }
  | { type: 'set_language'; language: 'so' | 'en' }
  | { type: 'agent_task'; goal: string }
  | { type: 'confirm'; yes: boolean }
  | { type: 'chat'; text: string };

export interface ParseResult {
  intent: Intent;
  /** 0..1. Below ~0.6 the orchestrator asks the planner / a clarification question. */
  confidence: number;
  /** Matched by deterministic rules (true) or merely defaulted to chat (false). */
  rule: boolean;
}
