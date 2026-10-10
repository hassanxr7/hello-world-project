import type { Settings } from '../config/settings';
import type { MemoryStore } from '../memory/memory';
import type { LlmClient, Platform, WhatsAppController, YouTubeController } from '../platform';

export interface Services {
  platform: Platform;
  youtube: YouTubeController;
  whatsapp: WhatsAppController;
  llm: LlmClient;
  memory: MemoryStore;
  settings: () => Settings;
  /** Folder for screenshots (Pictures\Afuufow) */
  screenshotDir: string;
  /** Short-lived per-process state shared by tools. */
  state: {
    lastDraft: string;
    lastSent: { phone: string; text: string; at: number } | null;
  };
}
