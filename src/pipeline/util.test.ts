import { describe, expect, it } from 'vitest';
import type { RawSegment } from './types';
import {
  dateStr,
  dayNumber,
  dayString,
  durationMin,
  durationSec,
  endOffsetMinutes,
  haversineDist,
  isoOffsetMinutes,
  localEnd,
  localStart,
  median,
  parseLatLng,
  startOffsetMinutes,
  withOffset,
} from './util';

describe('parseLatLng', () => {
  it('parses a "lat°, lng°" string', () => {
    expect(parseLatLng('10.00°, 20.00°')).toEqual([10, 20]);
  });

  it('parses negative coordinates', () => {
    expect(parseLatLng('-10.50°, -20.25°')).toEqual([-10.5, -20.25]);
  });

  it('tolerates extra precision and whitespace', () => {
    expect(parseLatLng('10.1234567°,  20.7654321°')).toEqual([10.1234567, 20.7654321]);
  });
});

describe('haversineDist', () => {
  it('is zero for identical points', () => {
    expect(haversineDist(10, 20, 10, 20)).toBe(0);
  });

  it('matches the known quarter-circumference distance from the equator to the pole', () => {
    // A quarter of Earth's circumference (2 * pi * 6371 km / 4), a textbook value.
    expect(haversineDist(0, 0, 90, 0)).toBeCloseTo(10007.54, 1);
  });

  it('matches the known ~111.2 km for one degree of latitude', () => {
    expect(haversineDist(0, 0, 1, 0)).toBeCloseTo(111.19, 1);
  });

  it('is symmetric', () => {
    const a = haversineDist(10, 20, 30, 40);
    const b = haversineDist(30, 40, 10, 20);
    expect(a).toBeCloseTo(b, 9);
  });
});

describe('durationMin / durationSec', () => {
  it('computes minutes between two ISO instants', () => {
    expect(durationMin('2021-01-01T00:00:00.000Z', '2021-01-01T01:30:00.000Z')).toBe(90);
  });

  it('computes seconds between two ISO instants', () => {
    expect(durationSec('2021-01-01T00:00:00.000Z', '2021-01-01T01:30:00.000Z')).toBe(5400);
  });
});

describe('median', () => {
  it('picks the middle value of an odd-length list', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('does not mutate its input', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe('dayNumber / dayString', () => {
  it('is 0 for the epoch date', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
  });

  it('round-trips through dayString', () => {
    expect(dayString(dayNumber('2024-02-29'))).toBe('2024-02-29');
  });

  it('counts 29 days across the February leap-day boundary', () => {
    expect(dayNumber('2024-03-01') - dayNumber('2024-02-01')).toBe(29);
  });

  it('counts 28 days across February in a non-leap year', () => {
    expect(dayNumber('2023-03-01') - dayNumber('2023-02-01')).toBe(28);
  });
});

describe('isoOffsetMinutes', () => {
  it('reads a positive offset', () => {
    expect(isoOffsetMinutes('2021-01-01T10:00:00.000+01:00')).toBe(60);
  });

  it('reads a negative offset', () => {
    expect(isoOffsetMinutes('2021-01-01T10:00:00.000-08:00')).toBe(-480);
  });

  it('reads a half-hour offset', () => {
    expect(isoOffsetMinutes('2021-01-01T10:00:00.000-05:30')).toBe(-330);
  });

  it('treats "Z" as zero offset', () => {
    expect(isoOffsetMinutes('2021-01-01T10:00:00.000Z')).toBe(0);
  });
});

describe('withOffset (local-time re-expression)', () => {
  // The documented example (CLAUDE.md "Local time" gotcha): a phone set to
  // CET writes an SF departure as 22:35 local-to-the-phone; re-expressed in
  // the departure's real offset (-480 min) it reads 13:35.
  it('re-expresses an instant in another UTC offset', () => {
    expect(withOffset('2021-01-01T22:35:57.000+01:00', -480)).toBe('2021-01-01T13:35:57.000-08:00');
  });

  it('re-expresses into a positive offset, rolling the date forward', () => {
    // 23:00 UTC + 2h = 01:00 the next day, at +02:00
    expect(withOffset('2021-01-01T23:00:00.000Z', 120)).toBe('2021-01-02T01:00:00.000+02:00');
  });

  it('is the identity when the target offset matches the source', () => {
    expect(withOffset('2021-06-01T12:00:00.000+02:00', 120)).toBe('2021-06-01T12:00:00.000+02:00');
  });
});

describe('localStart / localEnd / startOffsetMinutes / endOffsetMinutes', () => {
  const seg = (over: Partial<RawSegment>): RawSegment => ({
    startTime: '2021-06-01T22:35:57.000+01:00',
    endTime: '2021-06-02T00:35:57.000+01:00',
    ...over,
  });

  it('prefers the explicit offset fields over the timestamp\'s own offset', () => {
    const s = seg({ startTimeTimezoneUtcOffsetMinutes: -480, endTimeTimezoneUtcOffsetMinutes: -480 });
    expect(startOffsetMinutes(s)).toBe(-480);
    expect(localStart(s)).toBe('2021-06-01T13:35:57.000-08:00');
  });

  it('falls back to the timestamp\'s own offset when the fields are absent (timelinePath-only segments)', () => {
    const s = seg({});
    expect(startOffsetMinutes(s)).toBe(60);
    expect(localStart(s)).toBe('2021-06-01T22:35:57.000+01:00');
  });

  it('localEnd uses the end offset, independently of the start offset', () => {
    const s = seg({ startTimeTimezoneUtcOffsetMinutes: -480, endTimeTimezoneUtcOffsetMinutes: 60 });
    expect(endOffsetMinutes(s)).toBe(60);
    expect(localEnd(s)).toBe('2021-06-02T00:35:57.000+01:00');
  });
});

describe('dateStr', () => {
  it('takes the YYYY-MM-DD prefix', () => {
    expect(dateStr('2021-06-01T13:35:57.000-08:00')).toBe('2021-06-01');
  });
});
