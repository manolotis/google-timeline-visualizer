import { describe, expect, it } from 'vitest';
import type { WorldCountryNames } from './types';
import { buildCountryIndex, normalizeCountryName } from './countries';

describe('normalizeCountryName', () => {
  it('lowercases and strips accents', () => {
    expect(normalizeCountryName("Côte d'Ivoire")).toBe('cote d ivoire');
  });

  it('drops a leading "The"', () => {
    expect(normalizeCountryName('The Bahamas')).toBe('bahamas');
  });

  it('expands "&" to "and"', () => {
    expect(normalizeCountryName('Bosnia & Herzegovina')).toBe('bosnia and herzegovina');
  });

  it('collapses punctuation and extra whitespace', () => {
    expect(normalizeCountryName('  Trinidad   and  Tobago! ')).toBe('trinidad and tobago');
  });
});

describe('buildCountryIndex', () => {
  const world: WorldCountryNames[] = [
    { iso3: 'TST', name: 'Testland', names: ['Republic of Testland'] },
    { iso3: 'OTH', name: 'Otherland' },
    { iso3: 'GBR', name: 'United Kingdom' },
  ];

  it('resolves a primary name, case-insensitively', () => {
    expect(buildCountryIndex(world).get(normalizeCountryName('testland'))).toEqual({
      iso3: 'TST',
      name: 'Testland',
    });
  });

  it('resolves an alternate name to the same country', () => {
    const match = buildCountryIndex(world).get(normalizeCountryName('Republic of Testland'));
    expect(match).toEqual({ iso3: 'TST', name: 'Testland' });
  });

  it('resolves a known alias (COUNTRY_ALIASES) to its target country', () => {
    const index = buildCountryIndex(world);
    expect(index.get(normalizeCountryName('UK'))).toEqual({ iso3: 'GBR', name: 'United Kingdom' });
    expect(index.get(normalizeCountryName('Great Britain'))).toEqual({ iso3: 'GBR', name: 'United Kingdom' });
  });

  it('merges name variants by ISO code: alias and primary name point at the same entry', () => {
    const index = buildCountryIndex(world);
    const viaAlias = index.get(normalizeCountryName('UK'));
    const viaPrimary = index.get(normalizeCountryName('United Kingdom'));
    expect(viaAlias?.iso3).toBe(viaPrimary?.iso3);
    expect(viaAlias?.name).toBe(viaPrimary?.name);
  });

  it('gives a country\'s own primary name priority over another country\'s alternate name', () => {
    // Two countries whose alternate/primary names collide at a later rank:
    // "Common" is Beta's primary name (rank 0) and Alpha's alternate (rank 1).
    // Alpha's rank-1 registration must not steal the key from Beta's rank-0 one.
    const collidingWorld: WorldCountryNames[] = [
      { iso3: 'ALP', name: 'Alpha', names: ['Common'] },
      { iso3: 'BET', name: 'Common' },
    ];
    const index = buildCountryIndex(collidingWorld);
    expect(index.get('common')).toEqual({ iso3: 'BET', name: 'Common' });
  });

  it('returns undefined for a name with no match', () => {
    expect(buildCountryIndex(world).get(normalizeCountryName('Nowhereland'))).toBeUndefined();
  });

  it('is empty when there is no world geometry', () => {
    expect(buildCountryIndex([]).size).toBe(0);
  });
});
