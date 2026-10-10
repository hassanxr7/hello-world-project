import type { Contact } from '../../shared/types';
import { ToolRegistry } from './framework';
import { makeBasicTools } from './impl-basic';
import { makeMediaTools } from './impl-media';
import { makeSensitiveTools } from './impl-sensitive';
import { makeTextTools } from './impl-text';
import { makeWhatsAppTools } from './impl-whatsapp';
import type { Services } from './services';

export function buildRegistry(s: Services, getContact: (id: string) => Contact | undefined): ToolRegistry {
  const r = new ToolRegistry();
  for (const t of [...makeBasicTools(s), ...makeMediaTools(s), ...makeTextTools(s), ...makeWhatsAppTools(s, getContact), ...makeSensitiveTools(s)]) r.register(t);
  return r;
}
