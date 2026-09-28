import { describe, expect, it } from 'vitest';
import { addDays, dayNumber, dayOfWeek, inRange, intersectRanges, isValidRange, overlapsRange, yearRange } from './timeRange';

describe('dayNumber / addDays', () => {
  it('is 0 for the epoch date', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
  });

  it('adds days across a month boundary', () => {
    expect(addDays('2024-01-30', 3)).toBe('2024-02-02');
  });

  it('adds days across the February leap-day boundary', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
  });

  it('adds days across February in a non-leap year (no Feb 29)', () => {
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
  });

  it('subtracts days (negative) across a year boundary', () => {
    expect(addDays('2024-01-01', -1)).toBe('2023-12-31');
  });

  it('addDays(date, 0) is the identity', () => {
    expect(addDays('2024-06-15', 0)).toBe('2024-06-15');
  });
});

describe('dayOfWeek', () => {
  it('1970-01-01 was a Thursday (4)', () => {
    expect(dayOfWeek('1970-01-01')).toBe(4);
  });

  it('cycles from Saturday (6) back to Sunday (0)', () => {
    expect(dayOfWeek('2024-01-06')).toBe(6); // a Saturday
    expect(dayOfWeek('2024-01-07')).toBe(0); // the following Sunday
  });
});

describe('inRange', () => {
  it('an open range (All time) excludes nothing', () => {
    expect(inRange('1900-01-01', { start: null, end: null })).toBe(true);
    expect(inRange('2999-12-31', { start: null, end: null })).toBe(true);
  });

  it('respects a lower bound only', () => {
    expect(inRange('2024-01-01', { start: '2024-01-01', end: null })).toBe(true);
    expect(inRange('2023-12-31', { start: '2024-01-01', end: null })).toBe(false);
  });

  it('respects an upper bound only', () => {
    expect(inRange('2024-01-01', { start: null, end: '2024-01-01' })).toBe(true);
    expect(inRange('2024-01-02', { start: null, end: '2024-01-01' })).toBe(false);
  });

  it('is inclusive of both bounds', () => {
    const range = { start: '2024-01-01', end: '2024-01-31' };
    expect(inRange('2024-01-01', range)).toBe(true);
    expect(inRange('2024-01-31', range)).toBe(true);
    expect(inRange('2024-02-01', range)).toBe(false);
  });
});

describe('overlapsRange', () => {
  it('an open range always overlaps a valid span', () => {
    expect(overlapsRange('2024-01-01', '2024-01-05', { start: null, end: null })).toBe(true);
  });

  it('detects a span entirely inside the range', () => {
    expect(overlapsRange('2024-01-10', '2024-01-15', { start: '2024-01-01', end: '2024-01-31' })).toBe(true);
  });

  it('detects a span that only partially overlaps', () => {
    expect(overlapsRange('2023-12-25', '2024-01-05', { start: '2024-01-01', end: '2024-01-31' })).toBe(true);
  });

  it('rejects a span entirely before or after the range', () => {
    expect(overlapsRange('2023-01-01', '2023-01-05', { start: '2024-01-01', end: '2024-01-31' })).toBe(false);
    expect(overlapsRange('2024-02-01', '2024-02-05', { start: '2024-01-01', end: '2024-01-31' })).toBe(false);
  });

  it('rejects an invalid range (start after end)', () => {
    expect(overlapsRange('2024-01-01', '2024-01-05', { start: '2024-06-01', end: '2024-01-01' })).toBe(false);
  });
});

describe('intersectRanges', () => {
  it('an open bound defers to the other range', () => {
    expect(intersectRanges({ start: null, end: null }, { start: '2024-01-01', end: '2024-12-31' })).toEqual({
      start: '2024-01-01',
      end: '2024-12-31',
    });
  });

  it('takes the tighter of two closed bounds on each side', () => {
    const a = { start: '2024-01-01', end: '2024-12-31' };
    const b = { start: '2024-06-01', end: '2025-01-31' };
    expect(intersectRanges(a, b)).toEqual({ start: '2024-06-01', end: '2024-12-31' });
  });
});

describe('isValidRange', () => {
  it('an open range is always valid', () => {
    expect(isValidRange({ start: null, end: null })).toBe(true);
  });

  it('start on or before end is valid', () => {
    expect(isValidRange({ start: '2024-01-01', end: '2024-01-01' })).toBe(true);
    expect(isValidRange({ start: '2024-01-01', end: '2024-06-01' })).toBe(true);
  });

  it('start after end is invalid', () => {
    expect(isValidRange({ start: '2024-06-01', end: '2024-01-01' })).toBe(false);
  });
});

describe('yearRange', () => {
  it('spans exactly the calendar year', () => {
    expect(yearRange(2024)).toEqual({ start: '2024-01-01', end: '2024-12-31' });
  });
});
