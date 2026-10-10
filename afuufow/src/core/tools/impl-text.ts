import { z, ok, unverified, failed, type ToolDef } from './framework';
import type { Services } from './services';

const LANG_NAME = { en: 'English', so: 'Somali', ar: 'Arabic' } as const;

export function makeTextTools(s: Services): ToolDef<any>[] {
  const tools: ToolDef<any>[] = [];

  tools.push({
    meta: { name: 'text.draft', risk: 'routine', readOnly: false, permissionKey: 'text.draft' },
    description: 'Write a draft (email, message, text) with the AI, keep it, and copy it to the clipboard.',
    schema: z.object({
      kind: z.enum(['email', 'message', 'text']),
      language: z.enum(['en', 'so', 'ar']).nullable().optional(),
      topic: z.string().max(1500).default(''),
    }),
    describe: (i: { kind: string }) => `Draft a ${i.kind}`,
    timeoutMs: 90_000,
    async run(input: { kind: 'email' | 'message' | 'text'; language?: 'en' | 'so' | 'ar' | null; topic: string }, rt) {
      const lang = LANG_NAME[input.language ?? 'so'];
      const owner = s.memory.owner;
      const system =
        `You are Afuufow, writing on behalf of ${owner.fullName}. Write a ${input.kind} in ${lang}. ` +
        `Output only the text of the ${input.kind}${input.kind === 'email' ? ' (start with "Subject:")' : ''}, no commentary. ` +
        `Do not invent facts, names, dates or numbers that were not given. Sign off as ${owner.fullName} when appropriate.`;
      const user = input.topic.trim() ? `Topic / content: ${input.topic}` : `Write a short, polite ${input.kind}. The owner did not give a topic; use clear placeholders like [name] and [topic].`;
      let text: string;
      try {
        text = (await s.llm.complete(system, user, { signal: rt.signal })).trim();
      } catch (e) {
        return failed('AI-ga ma jawaabin; hubi Ollama ama internetka.', 'The AI model did not respond: ' + (e as Error).message);
      }
      if (!text) return failed('AI-ga wax qoraal ah ma soo saarin.', 'The AI returned an empty draft.');
      s.state.lastDraft = text;
      await s.platform.clipboardWrite(text);
      const back = await s.platform.clipboardRead();
      if (back.trim() !== text.trim()) {
        return unverified('Qoraalka waa diyaar, laakiin clipboard-ka ma xaqiijin karo.', 'Draft ready, but the clipboard did not contain it when read back.', 'clipboard mismatch', { text });
      }
      return ok(`Qoraalka waa diyaar oo clipboard-ka waa lagu koobiyeeyay. Ma ku dhejiyaa meel?`, 'The draft is ready and copied to the clipboard.', 'clipboard-read-back', `${text.length} chars`, { text });
    },
  });

  tools.push({
    meta: { name: 'text.paste', risk: 'routine', readOnly: false, permissionKey: 'text.paste' },
    description: 'Paste the latest draft into a target application window (or the current window).',
    schema: z.object({ target: z.string().max(80).optional() }),
    describe: (i: { target?: string }) => `Paste draft into ${i.target ?? 'current window'}`,
    async run(input: { target?: string }) {
      if (!s.state.lastDraft) return failed('Ma jiro qoraal la diyaariyay.', 'There is no draft to paste.');
      await s.platform.clipboardWrite(s.state.lastDraft);
      if (input.target) {
        const focused = await s.platform.focusWindow([input.target]);
        if (!focused) return failed(`Daaqadda "${input.target}" ma helin.`, `No window matching "${input.target}" is open.`);
      }
      await s.platform.sendPaste();
      const probe = s.state.lastDraft.slice(0, 20).trim();
      const got = await s.platform.focusedText();
      if (probe && got.includes(probe)) return ok('Qoraalka waan ku dhejiyay.', 'Pasted the draft.', 'focused-control-text', 'draft text found in focused control');
      return unverified('Waan riixay Ctrl+V, laakiin ma xaqiijin karo in qoraalku galay.', 'Pressed Ctrl+V but could not confirm the text arrived (the target may not expose its text).', 'focused control text unavailable');
    },
  });

  return tools;
}
