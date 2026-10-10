import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FoundFile } from '../../core/platform';
import { normalizeText } from '../../core/memory/names';

const SKIP_DIRS = new Set(['node_modules', '.git', '$recycle.bin', 'appdata', 'system volume information', '.cache', '__pycache__']);

/**
 * Searches file names under approved roots only. Reads directory entries, never file contents.
 * Multi-word queries must all appear in the name (case/diacritic-insensitive). Cancellable and bounded.
 */
export async function findFiles(query: string, roots: string[], limit: number, signal?: AbortSignal, opts: { maxDepth?: number; maxEntries?: number } = {}): Promise<FoundFile[]> {
  const tokens = normalizeText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return [];
  const maxDepth = opts.maxDepth ?? 8;
  let budget = opts.maxEntries ?? 200_000;
  const hits: FoundFile[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (depth > maxDepth || budget <= 0) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable folder: skip silently
    }
    for (const e of entries) {
      if (--budget <= 0) return;
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name.toLowerCase())) await walk(full, depth + 1);
      } else if (e.isFile()) {
        const n = normalizeText(e.name);
        if (tokens.every((t) => n.includes(t))) {
          try {
            const st = await fs.promises.stat(full);
            hits.push({ path: full, name: e.name, modified: st.mtimeMs, size: st.size });
          } catch {
            /* vanished */
          }
        }
      }
      if (hits.length >= 500) return;
    }
  }

  for (const r of roots) await walk(r, 0);
  return hits.sort((a, b) => b.modified - a.modified).slice(0, limit);
}
