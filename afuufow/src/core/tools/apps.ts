import * as path from 'node:path';
import type { InstalledApp } from '../platform';
import { nameScore, normalizeText } from '../memory/names';

const ALIASES: Record<string, string[]> = {
  chrome: ['google chrome', 'chrome'],
  krom: ['google chrome'],
  edge: ['microsoft edge'],
  firefox: ['firefox', 'mozilla firefox'],
  'vs code': ['visual studio code'],
  vscode: ['visual studio code'],
  code: ['visual studio code'],
  word: ['word', 'microsoft word'],
  excel: ['excel', 'microsoft excel'],
  powerpoint: ['powerpoint', 'microsoft powerpoint'],
  outlook: ['outlook'],
  notepad: ['notepad'],
  kalkuleetar: ['calculator'],
  calculator: ['calculator'],
  paint: ['paint'],
  explorer: ['file explorer'],
  'file explorer': ['file explorer'],
  settings: ['settings'],
  teams: ['microsoft teams', 'teams'],
  terminal: ['terminal', 'windows terminal'],
  cmd: ['command prompt'],
  spotify: ['spotify'],
  zoom: ['zoom', 'zoom workplace'],
  telegram: ['telegram', 'telegram desktop'],
  vlc: ['vlc media player', 'vlc'],
};

export interface AppMatch {
  app: InstalledApp;
  score: number;
}

export function rankApps(query: string, apps: InstalledApp[]): AppMatch[] {
  const q = normalizeText(query);
  const targets = new Set<string>([q, ...(ALIASES[q] ?? [])]);
  const out: AppMatch[] = [];
  for (const app of apps) {
    const n = normalizeText(app.name);
    let s = 0;
    for (const t of targets) {
      s = Math.max(s, nameScore(t, n));
      if (n.startsWith(t) || n.split(' ').includes(t)) s = Math.max(s, 0.93);
      else if (n.includes(t) && t.length >= 4) s = Math.max(s, 0.86);
    }
    if (s >= 0.7) out.push({ app, score: s });
  }
  return out.sort((a, b) => b.score - a.score || a.app.name.length - b.app.name.length);
}

export type AppResolution =
  | { kind: 'found'; app: InstalledApp }
  | { kind: 'ambiguous'; candidates: InstalledApp[] }
  | { kind: 'missing'; suggestions: InstalledApp[] };

export function resolveApp(query: string, apps: InstalledApp[]): AppResolution {
  const ranked = rankApps(query, apps);
  if (ranked.length === 0) return { kind: 'missing', suggestions: [] };
  const top = ranked[0]!;
  if (top.score < 0.8) return { kind: 'missing', suggestions: ranked.slice(0, 3).map((r) => r.app) };
  const close = ranked.filter((r) => top.score - r.score < 0.04 && normalizeText(r.app.name) !== normalizeText(top.app.name));
  if (close.length > 0) return { kind: 'ambiguous', candidates: [top, ...close].slice(0, 4).map((r) => r.app) };
  return { kind: 'found', app: top.app };
}

/** Needles used to verify that the launched app produced a window. */
export function windowNeedles(app: InstalledApp): string[] {
  const out = new Set<string>();
  out.add(app.name);
  if (app.kind !== 'uwp') {
    const base = path.win32.basename(app.id).replace(/\.(exe|lnk)$/i, '');
    if (base) out.add(base);
  }
  return [...out].filter((x) => x.length >= 3);
}
