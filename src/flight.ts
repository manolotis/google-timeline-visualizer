/**
 * Flight drawing and formatting helpers shared by the Flights page and the
 * trip detail view.
 */

/**
 * Points along the great circle between two coordinates, for curved flight
 * arcs on a Mercator map (intermediate-point formula on the unit sphere).
 */
export function greatCircleArc(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
  numPoints = 50,
): [number, number][] {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(lat1), λ1 = toRad(lng1);
  const φ2 = toRad(lat2), λ2 = toRad(lng2);
  const d = 2 * Math.asin(
    Math.sqrt(
      Math.sin((φ2 - φ1) / 2) ** 2 +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2
    ),
  );
  if (d < 0.001) return [[lat1, lng1], [lat2, lng2]];

  const points: [number, number][] = [];
  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    points.push([toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))]);
  }
  return points;
}

/** 95 → '1h 35m', 50 → '50m' */
export function formatDuration(minutes: number): string {
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}
