import { describe, expect, it } from 'vitest';
import type { AirportEntry } from './types';
import { estimateFlightCo2Kg, findNearestAirport } from './airports';
import { haversineDist } from './util';

describe('findNearestAirport', () => {
  // A synthetic query point and two synthetic fields near it (obviously fake
  // coordinates, not real airports).
  const query: [number, number] = [10, 10];
  const near: AirportEntry = { iata: 'NER', name: 'Near Field', lat: 10.01, lng: 10, municipality: 'X', size: 'medium' };
  const far: AirportEntry = { iata: 'FAR', name: 'Far Field', lat: 10.2, lng: 10, municipality: 'Y', size: 'medium' };

  it('picks the nearest airport among several within range', () => {
    expect(findNearestAirport(query[0], query[1], [far, near])?.iata).toBe('NER');
  });

  it('returns null when nothing is within 40 km', () => {
    // 0.5 degrees of latitude is ~55.6 km away.
    const distant: AirportEntry = { iata: 'OOR', name: 'Out of Range', lat: 10.5, lng: 10, municipality: 'Z', size: 'large' };
    expect(haversineDist(query[0], query[1], distant.lat, distant.lng)).toBeGreaterThan(40);
    expect(findNearestAirport(query[0], query[1], [distant])).toBeNull();
  });

  it('matches a field right at the query point', () => {
    const here: AirportEntry = { iata: 'HER', name: 'Here Field', lat: 10, lng: 10, municipality: 'X', size: 'medium' };
    expect(findNearestAirport(query[0], query[1], [here])?.iata).toBe('HER');
  });

  it('a large airport wins a near-tie against a closer medium one (5 km discount)', () => {
    const medium: AirportEntry = { iata: 'MED', name: 'Medium Field', lat: 10.03, lng: 10, municipality: 'X', size: 'medium' };
    const large: AirportEntry = { iata: 'LRG', name: 'Large Hub', lat: 10.07, lng: 10, municipality: 'Y', size: 'large' };
    const dMedium = haversineDist(query[0], query[1], medium.lat, medium.lng);
    const dLarge = haversineDist(query[0], query[1], large.lat, large.lng);
    // Sanity-check the fixture is actually a near-tie under the 5 km discount:
    // medium is physically closer, but large's discounted score should win.
    expect(dMedium).toBeLessThan(dLarge);
    expect(dLarge - 5).toBeLessThan(dMedium);

    expect(findNearestAirport(query[0], query[1], [medium, large])?.iata).toBe('LRG');
  });

  it('does not let the large-airport discount win beyond the 40 km radius', () => {
    // A large airport 45 km away (discounted to an effective 40 km) is still
    // outside the hard 40 km match radius, discount or not.
    const large: AirportEntry = { iata: 'LRG', name: 'Distant Hub', lat: 10.405, lng: 10, municipality: 'Y', size: 'large' };
    expect(haversineDist(query[0], query[1], large.lat, large.lng)).toBeGreaterThan(40);
    expect(findNearestAirport(query[0], query[1], [large])).toBeNull();
  });

  it('returns null for an empty airport list', () => {
    expect(findNearestAirport(query[0], query[1], [])).toBeNull();
  });
});

describe('estimateFlightCo2Kg', () => {
  // Hand-computed against the documented formula: (greatCircleKm + 95) *
  // factor(haul bucket) * 1.9, rounded to one decimal.
  it('short haul (< 1500 km): factor 0.151', () => {
    expect(estimateFlightCo2Kg(500)).toBeCloseTo(170.7, 1);
  });

  it('medium haul (1500-4000 km): factor 0.13402', () => {
    expect(estimateFlightCo2Kg(2000)).toBeCloseTo(533.5, 1);
  });

  it('long haul (> 4000 km): factor 0.11704', () => {
    expect(estimateFlightCo2Kg(5000)).toBeCloseTo(1133.0, 1);
  });

  it('buckets on the raw great-circle distance, producing a cliff at each boundary', () => {
    // Just under the short/medium boundary is short-haul (higher factor),
    // just at it is medium-haul (lower factor) despite the greater distance.
    const justShort = estimateFlightCo2Kg(1499);
    const atMedium = estimateFlightCo2Kg(1500);
    expect(justShort).toBeCloseTo(457.3, 1);
    expect(atMedium).toBeCloseTo(406.1, 1);
    expect(atMedium).toBeLessThan(justShort);

    // Same shape at the medium/long boundary.
    const atMediumTop = estimateFlightCo2Kg(4000);
    const justLong = estimateFlightCo2Kg(4001);
    expect(atMediumTop).toBeCloseTo(1042.7, 1);
    expect(justLong).toBeCloseTo(910.9, 1);
    expect(justLong).toBeLessThan(atMediumTop);
  });

  it('is zero-distance-safe (detour + RF still apply)', () => {
    // 0 km great-circle still flies the 95 km detour.
    expect(estimateFlightCo2Kg(0)).toBeCloseTo((95 * 0.151 * 1.9 * 10) / 10, 1);
  });
});
