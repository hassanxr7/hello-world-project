import type { YtCandidate } from '../../core/platform';
import { normalizeText } from '../../core/memory/names';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Find every object stored under `key` anywhere in a JSON tree (robust to YouTube layout changes). */
export function findAll(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const n of node) findAll(n, key, out);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === key) out.push(v);
      else findAll(v, key, out);
    }
  }
  return out;
}

export function extractInitialData(html: string): unknown | null {
  const marker = 'var ytInitialData = ';
  const i = html.indexOf(marker);
  if (i < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  const start = i + marker.length;
  for (let p = start; p < html.length; p++) {
    const c = html[p]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, p + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

interface VideoRenderer {
  videoId?: string;
  title?: { runs?: Array<{ text: string }>; simpleText?: string };
  ownerText?: { runs?: Array<{ text: string }> };
  longBylineText?: { runs?: Array<{ text: string }> };
  lengthText?: { simpleText?: string };
  badges?: Array<{ metadataBadgeRenderer?: { style?: string; label?: string } }>;
}

export function parseResults(html: string): Array<Omit<YtCandidate, 'score'> & { live: boolean }> {
  const data = extractInitialData(html);
  if (!data) return [];
  return (findAll(data, 'videoRenderer') as VideoRenderer[])
    .filter((v) => v.videoId && /^[A-Za-z0-9_-]{11}$/.test(v.videoId))
    .map((v) => ({
      id: v.videoId!,
      title: v.title?.runs?.map((r) => r.text).join('') ?? v.title?.simpleText ?? '',
      channel: v.ownerText?.runs?.[0]?.text ?? v.longBylineText?.runs?.[0]?.text ?? '',
      durationText: v.lengthText?.simpleText,
      live: !v.lengthText && !!v.badges?.some((b) => /live/i.test(b.metadataBadgeRenderer?.label ?? '')),
    }));
}

function minutes(d?: string): number | null {
  if (!d) return null;
  const parts = d.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((a, p) => a * 60 + p, 0) / 60;
}

const BAD_WORDS = ['reaction', 'karaoke', 'instrumental', 'slowed', 'reverb', 'sped up', '8d', 'nightcore', 'remix', 'cover', 'tutorial', 'how to play', 'status'];

/** 0..1: how well a result matches what was asked. Deliberately conservative: low scores trigger a clarification question. */
export function scoreCandidate(query: string, c: { title: string; channel: string; durationText?: string }, kind: 'song' | 'video' | 'any'): number {
  const q = normalizeText(query).split(' ').filter((w) => w.length > 1);
  if (q.length === 0) return 0;
  const hay = normalizeText(c.title + ' ' + c.channel);
  const titleN = normalizeText(c.title);
  const hit = q.filter((w) => hay.includes(w)).length / q.length;
  let s = hit * 0.75;
  if (titleN.includes(normalizeText(query))) s += 0.15;
  const askedBad = BAD_WORDS.filter((w) => normalizeText(query).includes(w));
  for (const w of BAD_WORDS) if (!askedBad.includes(w) && titleN.includes(w)) s -= 0.12;
  if (kind === 'song') {
    if (/official|vevo|topic|audio/.test(hay)) s += 0.08;
    const m = minutes(c.durationText);
    if (m !== null && (m < 1.2 || m > 12)) s -= 0.15;
  } else if (kind === 'video') {
    const m = minutes(c.durationText);
    if (m !== null && m < 1) s -= 0.1;
  }
  return Math.max(0, Math.min(1, s));
}

export function rank(query: string, rows: ReturnType<typeof parseResults>, kind: 'song' | 'video' | 'any'): YtCandidate[] {
  return rows
    .filter((r) => !r.live || /live|toos/i.test(query))
    .map((r) => ({ id: r.id, title: r.title, channel: r.channel, durationText: r.durationText, score: scoreCandidate(query, r, kind) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

export async function searchYouTube(query: string, kind: 'song' | 'video' | 'any', signal?: AbortSignal, fetchFn: typeof fetch = fetch, apiKey?: string | null): Promise<YtCandidate[]> {
  if (apiKey) {
    const u = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=8&videoEmbeddable=any&q=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}`;
    const res = await fetchFn(u, { signal });
    if (!res.ok) throw new Error(`YouTube Data API HTTP ${res.status}`);
    const j = (await res.json()) as { items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }> };
    const rows = (j.items ?? []).filter((i) => i.id?.videoId).map((i) => ({ id: i.id!.videoId!, title: decode(i.snippet?.title ?? ''), channel: i.snippet?.channelTitle ?? '', live: false }));
    return rank(query, rows, kind);
  }
  const res = await fetchFn(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en&gl=US`, {
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', cookie: 'CONSENT=YES+1; SOCS=CAI' },
    signal,
  });
  if (!res.ok) throw new Error(`YouTube HTTP ${res.status}`);
  const html = await res.text();
  const rows = parseResults(html);
  if (rows.length === 0) throw new Error('YouTube returned no parsable results (page layout may have changed; set a YouTube Data API key in Settings)');
  return rank(query, rows, kind);
}

function decode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
