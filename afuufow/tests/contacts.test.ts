import { describe, expect, it } from 'vitest';
import { pickFromCandidates, resolveContact } from '../src/core/memory/contacts';
import { nameScore, phoneticKey } from '../src/core/memory/names';
import type { Contact } from '../src/shared/types';

const c = (id: string, displayName: string, o: Partial<Contact> = {}): Contact => ({ id, displayName, aliases: [], phone: '2526' + id.padStart(8, '0'), approved: true, fastSend: false, ...o });

describe('Somali/English name matching', () => {
  it.each([
    ['Ahmed', 'Axmed'], ['Mohamed', 'Maxamed'], ['Abdi', 'Cabdi'], ['Hassan', 'Xasan'], ['Ali', 'Cali'], ['Omar', 'Cumar'], ['Khadija', 'Khadiija'],
  ])('%s ~ %s', (a, b) => expect(nameScore(a, b)).toBeGreaterThanOrEqual(0.78));
  it.each([['Ahmed', 'Mohamed'], ['Hassan', 'Farah'], ['Ali', 'Fadumo']])('%s !~ %s', (a, b) => expect(nameScore(a, b)).toBeLessThan(0.78));
  it('phonetic key ignores vowels and Somali spelling', () => expect(phoneticKey('Axmed')).toBe(phoneticKey('Ahmed')));
});

describe('recipient resolution', () => {
  const book = [c('1', 'Ahmed Ali'), c('2', 'Ahmed Jama'), c('3', 'Hooyo', { aliases: ['Mum'] }), c('4', 'Farah'), c('5', 'Stranger Sam', { approved: false })];
  it('resolves an unambiguous name', () => {
    const r = resolveContact('Farah', book);
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.contact.id).toBe('4');
  });
  it('resolves by alias', () => expect(resolveContact('Mum', book)).toMatchObject({ kind: 'resolved' }));
  it('resolves Somali spelling of an English name', () => {
    expect(resolveContact('Faarax', [c('9', 'Farah')])).toMatchObject({ kind: 'resolved' });
  });
  it('asks when several contacts match', () => {
    const r = resolveContact('Ahmed', book);
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.candidates.map((x) => x.id).sort()).toEqual(['1', '2']);
  });
  it('a full name is not ambiguous', () => expect(resolveContact('Ahmed Jama', book)).toMatchObject({ kind: 'resolved' }));
  it('never invents a recipient', () => expect(resolveContact('Zainab', book).kind).toBe('not_found'));
  it('never resolves an unapproved contact', () => expect(resolveContact('Stranger Sam', book).kind).toBe('not_approved'));
  it('contacts without a phone number cannot be resolved', () => expect(resolveContact('Nobody', [c('7', 'Nobody', { phone: '' })]).kind).toBe('not_found'));
  it('a weak match is "uncertain", not sent blindly', () => {
    const r = resolveContact('Abdirahman', [c('8', 'Abdirashid')]);
    expect(['uncertain', 'not_found']).toContain(r.kind);
  });
  it('follow-up answers choose by position or name', () => {
    const cands = [c('1', 'Ahmed Ali'), c('2', 'Ahmed Jama')];
    expect(pickFromCandidates('midka labaad', cands)?.id).toBe('2');
    expect(pickFromCandidates('kan hore', cands)?.id).toBe('1');
    expect(pickFromCandidates('Ahmed Jama', cands)?.id).toBe('2');
    expect(pickFromCandidates('Ahmed', cands)).toBeNull();
  });
});
