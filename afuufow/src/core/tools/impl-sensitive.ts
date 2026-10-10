import * as path from 'node:path';
import { z, ok, failed, type ToolDef } from './framework';
import type { Services } from './services';
import { approvedRoots, isInside } from './impl-basic';

/**
 * Sensitive and forbidden tools.
 *  - files.recycle and software.install require Windows Hello / PIN AND an explicit yes (see policy.ts).
 *  - payments.make, security.change and shell.run exist only so that any attempt (e.g. an AI plan, or text
 *    injected from a web page) is explicitly denied and recorded in the action log.
 */
export function makeSensitiveTools(s: Services): ToolDef<any>[] {
  const tools: ToolDef<any>[] = [];

  tools.push({
    meta: { name: 'files.recycle', risk: 'sensitive', readOnly: false, permissionKey: 'files.recycle' },
    description: 'Move a file in an approved folder to the Recycle Bin (never permanent deletion).',
    schema: z.object({ path: z.string().min(3).max(500) }),
    describe: (i: { path: string }) => `Move to Recycle Bin: ${i.path}`,
    async run(input: { path: string }) {
      if (!approvedRoots(s).some((r) => isInside(r.path, input.path))) {
        return failed('File-kaas ma ku jiro goob la oggolaaday.', 'The file is outside the approved folders.');
      }
      if (/^[a-z]:\\?$/i.test(input.path) || approvedRoots(s).some((r) => path.win32.resolve(r.path).toLowerCase() === path.win32.resolve(input.path).toLowerCase())) {
        return failed('Ma tirtiri karo galka oggolaanshaha laftiisa.', 'Refusing to delete an approved root folder.');
      }
      if (!s.platform.pathExists(input.path)) return failed('File-ka ma jiro.', 'File does not exist.');
      await s.platform.recycle(input.path);
      return !s.platform.pathExists(input.path)
        ? ok('File-ka waxaa loo wareejiyay Recycle Bin.', 'Moved to the Recycle Bin.', 'path-missing', input.path)
        : failed('File-ka weli wuu jiraa; lama tirtirin.', 'The file still exists; it was not removed.');
    },
  });

  tools.push({
    meta: { name: 'software.install', risk: 'sensitive', readOnly: false, permissionKey: 'software.install' },
    description: 'Install a program with winget by exact package id (e.g. "Ollama.Ollama").',
    schema: z.object({ id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.+_-]{1,100}$/, 'invalid winget id') }),
    describe: (i: { id: string }) => `winget install ${i.id}`,
    timeoutMs: 600_000,
    async run(input: { id: string }, rt) {
      const r = await s.platform.wingetInstall(input.id, rt.signal);
      if (!r.ok) return failed('Rakibaadda way fashilantay.', 'winget reported a failure: ' + r.output.slice(-300));
      return (await s.platform.wingetHas(input.id))
        ? ok(`${input.id} waa la rakibay.`, `${input.id} installed.`, 'winget-list', input.id)
        : failed('Rakibaadda lama xaqiijin.', 'winget finished but the package is not listed.');
    },
  });

  for (const [name, d] of [
    ['payments.make', 'Make a payment or purchase.'],
    ['security.change', 'Change Windows security settings or disable protection.'],
    ['shell.run', 'Run an arbitrary shell command.'],
  ] as const) {
    tools.push({
      meta: { name, risk: 'forbidden', readOnly: false, permissionKey: name },
      description: d + ' (always refused)',
      schema: z.object({}).passthrough(),
      describe: () => d,
      async run() {
        return failed('Tan ma samayn karo.', 'Forbidden.');
      },
    });
  }
  return tools;
}
