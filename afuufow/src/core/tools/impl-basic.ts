import * as path from 'node:path';
import { z, ok, unverified, failed, needsInput, type ToolDef } from './framework';
import type { Services } from './services';
import { resolveApp, windowNeedles } from './apps';
import { normalizeText } from '../memory/names';

const p = path.win32;

/** Folder labels the owner can say, resolved to Windows known folders. */
export const KNOWN_FOLDER_LABELS = ['downloads', 'documents', 'desktop', 'pictures', 'music', 'videos'] as const;

const SAFE_OPEN_EXT = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'rtf', 'csv', 'odt', 'ods', 'odp', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'mp3', 'wav', 'm4a', 'flac', 'mp4', 'mkv', 'avi', 'mov', 'webm']);

export function approvedRoots(s: Services): Array<{ label: string; path: string }> {
  const out: Array<{ label: string; path: string }> = [];
  for (const f of s.settings().permissions.approvedFolders) out.push({ label: normalizeText(f.label), path: f.path });
  return out;
}

export function isInside(root: string, target: string): boolean {
  const r = p.resolve(root).toLowerCase().replace(/[\\/]+$/, '');
  const t = p.resolve(target).toLowerCase();
  return t === r || t.startsWith(r + '\\');
}

export function resolveFolder(s: Services, folder: string): { path: string } | { error: 'not_approved' | 'not_found' } {
  const q = normalizeText(folder);
  const approved = approvedRoots(s);
  // 1. approved folder by label
  const byLabel = approved.find((a) => a.label === q);
  if (byLabel) return { path: byLabel.path };
  // 2. Windows known folder (always openable: opening a folder in Explorer reveals nothing to a third party)
  if ((KNOWN_FOLDER_LABELS as readonly string[]).includes(q)) {
    const k = s.platform.knownFolder(q);
    if (k && s.platform.pathExists(k)) return { path: k };
    return { error: 'not_found' };
  }
  // 3. explicit path must be inside an approved root
  if (/^[a-z]:[\\/]/i.test(folder) || folder.startsWith('\\\\')) {
    if (approved.some((a) => isInside(a.path, folder))) return s.platform.pathExists(folder) ? { path: folder } : { error: 'not_found' };
    return { error: 'not_approved' };
  }
  return { error: 'not_found' };
}

export function makeBasicTools(s: Services): ToolDef<any>[] {
  const tools: ToolDef<any>[] = [];

  tools.push({
    meta: { name: 'apps.open', risk: 'routine', readOnly: false, permissionKey: 'apps.open' },
    description: 'Open an installed Windows application by name.',
    schema: z.object({ app: z.string().min(1).max(80) }),
    describe: (i: { app: string }) => `Open application "${i.app}"`,
    timeoutMs: 25_000,
    async run(input: { app: string }, rt) {
      const settings = s.settings();
      const apps = await s.platform.listApps(rt.signal);
      const res = resolveApp(input.app, apps);
      if (settings.permissions.appPolicy === 'allowlist') {
        // the allow-list is checked against the application that was actually resolved ("wordpad" must not pass for "Word")
        const allowed = settings.permissions.approvedApps.map(normalizeText);
        const okName = (name: string) => {
          const n = normalizeText(name);
          return allowed.some((a) => n === a || n.split(' ').includes(a));
        };
        const candidates = res.kind === 'found' ? [res.app] : res.kind === 'ambiguous' ? res.candidates : [];
        const permitted = candidates.filter((c) => okName(c.name));
        if (candidates.length > 0 && permitted.length === 0) {
          return failed(`${input.app} liiska barnaamijyada la oggolaaday kuma jiro.`, `${input.app} is not on the approved applications list.`);
        }
        if (res.kind === 'found' && permitted.length === 0) return failed(`${input.app} liiska la oggolaaday kuma jiro.`, `${input.app} is not on the approved applications list.`);
        if (res.kind === 'ambiguous') (res as { candidates: typeof candidates }).candidates = permitted;
        if (res.kind === 'missing' && !allowed.some((a) => normalizeText(input.app).split(' ').includes(a))) {
          return failed(`${input.app} liiska barnaamijyada la oggolaaday kuma jiro.`, `${input.app} is not on the approved applications list.`);
        }
      }
      if (res.kind === 'missing') {
        const hint = res.suggestions.map((a) => a.name).join(', ');
        return failed(
          `Barnaamijka "${input.app}" ma helin.${hint ? ' Ma la jeedaa: ' + hint + '?' : ''}`,
          `Could not find an installed application matching "${input.app}".${hint ? ' Did you mean: ' + hint + '?' : ''}`,
        );
      }
      if (res.kind === 'ambiguous') {
        const names = res.candidates.map((a) => a.name);
        return needsInput(`Waxaan helay ${names.length} barnaamij: ${names.join(', ')}. Kee?`, `Several applications match: ${names.join(', ')}. Which one?`, { options: names });
      }
      rt.progress(`Launching ${res.app.name}`);
      await s.platform.launchApp(res.app, rt.signal);
      const win = await s.platform.waitForWindow(windowNeedles(res.app), 12_000, rt.signal);
      if (win) return ok(`Waan furay ${res.app.name}.`, `Opened ${res.app.name}.`, 'window-present', `${win.processName}: ${win.title}`);
      return unverified(
        `Waan bilaabay ${res.app.name}, laakiin ma arko daaqaddiisa. Hubi inuu furmay.`,
        `Launched ${res.app.name} but no window appeared within 12 s.`,
        'launch command returned, window not observed',
      );
    },
  });

  tools.push({
    meta: { name: 'folders.open', risk: 'routine', readOnly: false, permissionKey: 'folders.open' },
    description: 'Open a folder in File Explorer (Downloads, Documents, Desktop, Pictures, Music, Videos or an approved folder).',
    schema: z.object({ folder: z.string().min(1).max(260) }),
    describe: (i: { folder: string }) => `Open folder "${i.folder}"`,
    async run(input: { folder: string }, rt) {
      const r = resolveFolder(s, input.folder);
      if ('error' in r) {
        return r.error === 'not_approved'
          ? failed('Galkaas lama oggolaan; ku dar Settings-ka.', 'That folder is not in the approved list.')
          : failed(`Galka "${input.folder}" ma helin.`, `Folder "${input.folder}" was not found.`);
      }
      await s.platform.openPath(r.path);
      const name = p.basename(r.path) || r.path;
      const win = await s.platform.waitForWindow([name], 6_000, rt.signal);
      if (win) return ok(`Waan furay ${name}.`, `Opened ${name}.`, 'explorer-window', win.title);
      return unverified(`Waan codsaday inuu furmo ${name}, laakiin daaqadda ma arko.`, `Asked Explorer to open ${name} but its window was not observed.`, 'no explorer window with that name');
    },
  });

  tools.push({
    meta: { name: 'files.find', risk: 'routine', readOnly: true, permissionKey: 'files.find' },
    description: 'Search for files by name inside the owner-approved folders.',
    schema: z.object({ query: z.string().min(1).max(120), folder: z.string().optional() }),
    describe: (i: { query: string }) => `Find files matching "${i.query}"`,
    timeoutMs: 45_000,
    async run(input: { query: string; folder?: string }, rt) {
      let roots = approvedRoots(s).map((r) => r.path);
      if (input.folder) {
        const r = resolveFolder(s, input.folder);
        if ('error' in r) return failed('Galkaas lama oggolaan ama ma helin.', 'Folder not approved or not found.');
        roots = [r.path];
      }
      if (roots.length === 0) {
        return needsInput('Weli ma jiraan goobo la oggolaaday. Ku dar galalka Settings → Ogolaansho.', 'No approved folders yet. Add folders under Settings → Permissions.');
      }
      const found = await s.platform.findFiles(input.query, roots, 15, rt.signal);
      const real = found.filter((f) => s.platform.pathExists(f.path)); // verification: each result exists
      if (real.length === 0) return failed(`Ma helin file u dhigma "${input.query}".`, `No file matching "${input.query}" was found in approved folders.`);
      const top = real.slice(0, 5).map((f) => f.name).join(', ');
      return ok(`Waxaan helay ${real.length} file. Kuwa ugu sarreeya: ${top}.`, `Found ${real.length} file(s): ${top}.`, 'path-exists', real[0]!.path, { files: real });
    },
  });

  tools.push({
    meta: { name: 'files.open', risk: 'routine', readOnly: false, permissionKey: 'files.open' },
    description: 'Open a file found in an approved folder with its default application.',
    schema: z.object({ path: z.string().min(3).max(500) }),
    describe: (i: { path: string }) => `Open file ${i.path}`,
    async run(input: { path: string }, rt) {
      const allowed = approvedRoots(s).some((r) => isInside(r.path, input.path));
      if (!allowed) return failed('File-kaas ma ku jiro goob la oggolaaday.', 'File is outside the approved folders.');
      // Windows ignores trailing dots/spaces ("evil.exe." runs as evil.exe), and has many executable-like types, so only
      // an allow-list of document/media types is ever opened automatically.
      const cleaned = input.path.replace(/[.\s]+$/g, '');
      const ext = /\.([A-Za-z0-9]{1,5})$/.exec(cleaned)?.[1]?.toLowerCase() ?? '';
      if (input.path !== cleaned || !SAFE_OPEN_EXT.has(ext)) {
        return failed('Nooca file-kan si toos ah looma furo (kaliya dukumiinti/sawir/muuqaal/cod).', 'Only document, image, audio and video files are opened automatically.');
      }
      if (!s.platform.pathExists(input.path)) return failed('File-ka ma jiro.', 'File does not exist.');
      const real = s.platform.realPath(input.path);
      if (!approvedRoots(s).some((r) => isInside(s.platform.realPath(r.path), real))) {
        return failed('File-kaas wuxuu ka baxsan yahay goobaha la oggolaaday (link/junction).', 'The file resolves outside the approved folders (link or junction).');
      }
      await s.platform.openPath(input.path);
      const win = await s.platform.waitForWindow([p.basename(input.path)], 8_000, rt.signal);
      return win
        ? ok(`Waan furay ${p.basename(input.path)}.`, `Opened ${p.basename(input.path)}.`, 'window-title', win.title)
        : unverified(`Waan codsaday inuu furmo ${p.basename(input.path)}, laakiin daaqadda ma arko.`, 'Open requested; no window with the file name observed.', 'window not observed');
    },
  });

  const SEARCH = {
    google: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    bing: (q: string) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
    duckduckgo: (q: string) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  } as const;

  tools.push({
    meta: { name: 'web.open', risk: 'routine', readOnly: false, permissionKey: 'web.open' },
    description: 'Open an http(s) website in the browser.',
    schema: z.object({ url: z.string().min(3).max(2000) }),
    describe: (i: { url: string }) => `Open ${i.url}`,
    async run(input: { url: string }) {
      let u: URL;
      try {
        u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input.url) ? input.url : 'https://' + input.url);
      } catch {
        return failed('Cinwaanka ma saxna.', 'That is not a valid web address.');
      }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        return failed('Waxaan furi karaa oo keliya boggag http/https ah.', 'Only http(s) addresses can be opened.');
      }
      await s.platform.openUrl(u.toString(), s.settings().integrations.browser);
      return unverified(
        `Waan u diray browser-ka codsiga furitaanka ${u.hostname}. Ma xaqiijin karo inuu bogga si buuxda u furmay.`,
        `Asked the browser to open ${u.hostname}. Page load cannot be verified for an external browser.`,
        'external browser: launch accepted, page load unobservable',
      );
    },
  });

  tools.push({
    meta: { name: 'web.search', risk: 'routine', readOnly: false, permissionKey: 'web.search' },
    description: 'Search the web (Google by default) and open the results page.',
    schema: z.object({ query: z.string().min(1).max(300), engine: z.enum(['google', 'bing', 'duckduckgo']).optional() }),
    describe: (i: { query: string }) => `Web search "${i.query}"`,
    async run(input: { query: string; engine?: 'google' | 'bing' | 'duckduckgo' }) {
      const engine = input.engine ?? s.settings().integrations.searchEngine;
      await s.platform.openUrl(SEARCH[engine](input.query), s.settings().integrations.browser);
      return unverified(
        `Waan raadiyay "${input.query}" ${engine} — natiijooyinka ayaa la codsaday inay furmaan.`,
        `Opened ${engine} results for "${input.query}". Page load is not verifiable in an external browser.`,
        'external browser',
      );
    },
  });

  return tools;
}
