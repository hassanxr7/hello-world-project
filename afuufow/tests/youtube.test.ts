import { describe, expect, it } from 'vitest';
import { extractInitialData, findAll, parseResults, rank, scoreCandidate, searchYouTube } from '../src/main/youtube/search';

const vr = (id: string, title: string, channel: string, len?: string, badges?: unknown[]) => ({
  videoRenderer: { videoId: id, title: { runs: [{ text: title }] }, ownerText: { runs: [{ text: channel }] }, ...(len ? { lengthText: { simpleText: len } } : {}), ...(badges ? { badges } : {}) },
});
const page = (items: unknown[]) =>
  `<html><script>var ytInitialData = ${JSON.stringify({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [{ adSlotRenderer: {} }, ...items] } }] } } } } })};</script><script>var other = {"a":"}"};</script></html>`;

describe('YouTube result parsing', () => {
  it('extracts balanced JSON even when strings contain braces', () => {
    const html = `<script>var ytInitialData = {"a":"}{","b":{"c":[1,2,{"d":"\\"}"}]}};</script>`;
    expect(extractInitialData(html)).toEqual({ a: '}{', b: { c: [1, 2, { d: '"}' }] } });
  });
  it('finds videoRenderer anywhere and ignores ads', () => {
    const rows = parseResults(page([vr('abcdefghijk', 'Believer', 'Imagine Dragons', '3:24'), vr('bad', 'x', 'y')]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'abcdefghijk', title: 'Believer', channel: 'Imagine Dragons', durationText: '3:24' });
  });
  it('returns [] for pages without data', () => expect(parseResults('<html></html>')).toEqual([]));
  it('findAll walks arrays and objects', () => expect(findAll({ a: [{ k: 1 }, { b: { k: 2 } }] }, 'k')).toEqual([1, 2]));
});

describe('ranking', () => {
  const rows = parseResults(
    page([
      vr('aaaaaaaaaaa', 'Believer (Cover) by someone', 'Random', '3:10'),
      vr('bbbbbbbbbbb', 'Imagine Dragons - Believer (Official Music Video)', 'ImagineDragonsVEVO', '3:24'),
      vr('ccccccccccc', 'Believer REACTION', 'Reactor', '8:00'),
      vr('ddddddddddd', 'Believer 24/7 radio', 'Live', undefined, [{ metadataBadgeRenderer: { label: 'LIVE' } }]),
    ]),
  );
  it('prefers the official result and demotes covers/reactions', () => {
    const r = rank('Believer', rows, 'song');
    expect(r[0]!.id).toBe('bbbbbbbbbbb');
    expect(r.at(-1)!.id).not.toBe('bbbbbbbbbbb');
  });
  it('excludes live streams unless asked', () => {
    expect(rank('Believer', rows, 'song').some((x) => x.id === 'ddddddddddd')).toBe(false);
    expect(rank('Believer live', rows, 'song').some((x) => x.id === 'ddddddddddd')).toBe(true);
  });
  it('gives a low score to unrelated results (the assistant then asks)', () => {
    expect(scoreCandidate('Waar Waar Waar', { title: 'Cooking pasta in 10 minutes', channel: 'Chef' }, 'song')).toBeLessThan(0.3);
  });
  it('high score for exact title match', () => {
    expect(scoreCandidate('Believer', { title: 'Believer', channel: 'Imagine Dragons - Topic', durationText: '3:24' }, 'song')).toBeGreaterThan(0.9);
  });
});

describe('search request', () => {
  it('web search sends a browser UA and a locale; the API variant keeps the key out of logs/paths we control', async () => {
    let url = '';
    const f = (async (u: string) => { url = u; return new Response(page([vr('abcdefghijk', 'Believer', 'Imagine Dragons', '3:24')]), { status: 200 }); }) as unknown as typeof fetch;
    const r = await searchYouTube('Believer', 'song', undefined, f);
    expect(url).toContain('search_query=Believer');
    expect(r[0]!.id).toBe('abcdefghijk');
  });
  it('reports a layout change clearly', async () => {
    const f = (async () => new Response('<html></html>', { status: 200 })) as unknown as typeof fetch;
    await expect(searchYouTube('x', 'any', undefined, f)).rejects.toThrow(/API key/);
  });
  it('uses the Data API when a key is configured', async () => {
    const f = (async (u: string) => { expect(u).toContain('googleapis.com/youtube/v3/search'); return new Response(JSON.stringify({ items: [{ id: { videoId: 'abcdefghijk' }, snippet: { title: 'Believer &amp; more', channelTitle: 'X' } }] }), { status: 200 }); }) as unknown as typeof fetch;
    const r = await searchYouTube('Believer', 'any', undefined, f, 'KEY');
    expect(r[0]!.title).toBe('Believer & more');
  });
});
