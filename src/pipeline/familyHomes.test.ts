import { describe, expect, it, vi } from 'vitest';
import type { FamilyHome } from './types';
import { familyHomeAt, parseTimelineConfig } from './familyHomes';

describe('parseTimelineConfig', () => {
  it('parses an empty config to no family homes', () => {
    expect(parseTimelineConfig('{}')).toEqual([]);
  });

  it('parses a valid family home, defaults omitted', () => {
    const config = JSON.stringify({ familyHomes: [{ lat: 10, lng: 20 }] });
    expect(parseTimelineConfig(config)).toEqual([{ lat: 10, lng: 20, label: undefined, radiusKm: undefined }]);
  });

  it('parses a fully specified family home', () => {
    const config = JSON.stringify({ familyHomes: [{ lat: 10, lng: 20, label: 'Parents', radiusKm: 2 }] });
    expect(parseTimelineConfig(config)).toEqual([{ lat: 10, lng: 20, label: 'Parents', radiusKm: 2 }]);
  });

  it('parses several family homes in order', () => {
    const config = JSON.stringify({
      familyHomes: [
        { lat: 10, lng: 20, label: 'A' },
        { lat: 30, lng: 40, label: 'B' },
      ],
    });
    expect(parseTimelineConfig(config)).toEqual([
      { lat: 10, lng: 20, label: 'A', radiusKm: undefined },
      { lat: 30, lng: 40, label: 'B', radiusKm: undefined },
    ]);
  });

  it('throws on unparseable JSON, naming the file', () => {
    expect(() => parseTimelineConfig('{not json', 'my-config.json')).toThrow(/my-config\.json/);
  });

  it('throws when the top level is not an object', () => {
    expect(() => parseTimelineConfig('[]')).toThrow(/must hold a JSON object/);
    expect(() => parseTimelineConfig('"hello"')).toThrow(/must hold a JSON object/);
  });

  it('throws when familyHomes is not an array', () => {
    expect(() => parseTimelineConfig('{"familyHomes": "nope"}')).toThrow(/must be an array/);
  });

  it('throws on a missing or out-of-range lat/lng', () => {
    expect(() => parseTimelineConfig('{"familyHomes": [{"lng": 20}]}')).toThrow(/numeric "lat" and "lng"/);
    expect(() => parseTimelineConfig('{"familyHomes": [{"lat": 200, "lng": 20}]}')).toThrow(/numeric "lat" and "lng"/);
  });

  it('throws on a non-positive radiusKm', () => {
    expect(() => parseTimelineConfig('{"familyHomes": [{"lat": 1, "lng": 1, "radiusKm": 0}]}')).toThrow(
      /radiusKm/,
    );
    expect(() => parseTimelineConfig('{"familyHomes": [{"lat": 1, "lng": 1, "radiusKm": -1}]}')).toThrow(
      /radiusKm/,
    );
  });

  it('throws on a non-string label', () => {
    expect(() => parseTimelineConfig('{"familyHomes": [{"lat": 1, "lng": 1, "label": 5}]}')).toThrow(
      /"label"/,
    );
  });

  it('warns on an unknown top-level key but still parses', () => {
    const warn = vi.fn();
    const result = parseTimelineConfig('{"familyHomes": [], "typo": true}', 'timeline-config.json', warn);
    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('typo'));
  });

  it('does not warn when every key is known', () => {
    const warn = vi.fn();
    parseTimelineConfig('{"familyHomes": []}', 'timeline-config.json', warn);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('familyHomeAt', () => {
  const homeA: FamilyHome = { label: 'A', lat: 10, lng: 10, radiusKm: 1 };
  const homeB: FamilyHome = { label: 'B', lat: 10.05, lng: 10, radiusKm: 1 };

  it('returns null when no family home is configured', () => {
    expect(familyHomeAt([], 10, 10)).toBeNull();
  });

  it('returns the home when the point is within its radius', () => {
    expect(familyHomeAt([homeA], 10, 10)).toBe(homeA);
  });

  it('returns null when the point is outside every radius', () => {
    // ~0.5 degrees of latitude is far beyond a 1 km radius.
    expect(familyHomeAt([homeA], 10.5, 10)).toBeNull();
  });

  it('returns the nearest home when several are in range', () => {
    // A generous radius on both so they overlap; the point sits closer to A.
    const wideA: FamilyHome = { ...homeA, radiusKm: 10 };
    const wideB: FamilyHome = { ...homeB, radiusKm: 10 };
    expect(familyHomeAt([wideB, wideA], 10, 10)?.label).toBe('A');
  });

  it('respects each home\'s own radius', () => {
    const tinyA: FamilyHome = { ...homeA, radiusKm: 0.1 };
    expect(familyHomeAt([tinyA], 10.001, 10)).toBeNull();
  });
});
