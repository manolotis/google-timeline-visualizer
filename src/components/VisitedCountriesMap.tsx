/**
 * World choropleth of visited countries (Overview page).
 *
 * Every country with at least one recorded visit is shaded by days present
 * (home time included) using quantile classes, so a 3-day trip stays clearly
 * visible next to countries lived in for years. Visited countries too small
 * to see at world zoom (e.g. Andorra) also get a dot. Geometry is the
 * vendored public/world-countries.geo.json, joined on the ISO alpha-3 codes
 * that preprocess attaches to geography.json.
 */
import { useMemo, type ReactNode } from 'react';
import { GeoJSON, MapContainer, Pane } from 'react-leaflet';
import { circleMarker, type LatLngBoundsExpression, type Layer, type Path, type PathOptions } from 'leaflet';
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Point, Polygon } from 'geojson';
import 'leaflet/dist/leaflet.css';
import Loader from './Loader';
import { useGeography, useWorldCountries } from '../hooks/useData';
import type { GeographyCountry, WorldCountryProperties } from '../types';

/** Low → high days (Tailwind orange 700/600/400/300/200): brighter = more time on the dark map. */
const RAMP = ['#c2410c', '#ea580c', '#fb923c', '#fdba74', '#fed7aa'];
const NOT_VISITED_COLOR = '#1f2937'; // gray-800
const SEA_COLOR = '#030712'; // gray-950 — also the hairline gap between countries
const HOVER_COLOR = '#f9fafb';
/** Visited countries whose bounding box is smaller than this (degrees) also get a dot. */
const TINY_COUNTRY_DEG = 1;
const TINY_PANE = 'tiny-countries';
const INITIAL_VIEW: LatLngBoundsExpression = [[-56, -168], [74, 180]];
const MAX_BOUNDS: LatLngBoundsExpression = [[-80, -220], [86, 220]];

interface ScaleClass {
  min: number;
  max: number;
  color: string;
}

/**
 * Quantile classes: split the sorted values into up to RAMP.length groups of
 * about equal count, never splitting ties, so skewed totals (years at home vs
 * a weekend away) still use every color. Ranges are contiguous for the legend.
 */
function quantileClasses(values: number[]): ScaleClass[] {
  const sorted = [...values].sort((a, b) => a - b);
  const k = Math.min(RAMP.length, new Set(sorted).size);
  const groups: { min: number; max: number }[] = [];
  let start = 0;
  for (let i = 1; i <= k && start < sorted.length; i++) {
    let end = Math.max(start + 1, Math.round((i * sorted.length) / k));
    while (end < sorted.length && sorted[end] === sorted[end - 1]) end++;
    const min = groups.length > 0 ? groups[groups.length - 1].max + 1 : sorted[start];
    groups.push({ min, max: sorted[end - 1] });
    start = end;
  }
  // With fewer classes than colors, spread them across the ramp
  const step = groups.length > 1 ? (RAMP.length - 1) / (groups.length - 1) : 0;
  return groups.map((g, i) => ({
    ...g,
    color: RAMP[groups.length > 1 ? Math.round(i * step) : RAMP.length - 1],
  }));
}

function classLabel(c: ScaleClass, isLast: boolean): string {
  if (isLast && c.max > c.min) return `${c.min.toLocaleString()}+`;
  return c.min === c.max ? c.min.toLocaleString() : `${c.min}–${c.max}`;
}

function bbox(geometry: Polygon | MultiPolygon): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const ring of polygons.flat()) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return [minX, minY, maxX, maxY];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function tooltipHtml(featureName: string, country: GeographyCountry | undefined): string {
  if (!country) {
    return `<div class="font-semibold text-gray-300">${escapeHtml(featureName)}</div>` +
      '<div class="text-gray-500">Not visited</div>';
  }
  const away = country.days > 0
    ? `<div class="text-gray-500">${plural(country.days, 'night')} away from home</div>`
    : '';
  return `<div class="font-semibold text-white">${escapeHtml(country.country)}</div>` +
    `<div class="text-gray-300">${plural(country.totalDays, 'day')}</div>${away}`;
}

type CountryFeature = Feature<Geometry, WorldCountryProperties>;

function Legend({ classes }: { classes: ScaleClass[] }) {
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2 text-xs text-gray-400">
      <div>
        <div className="mb-1.5">Days present</div>
        <div className="flex gap-0.5">
          {classes.map((c, i) => (
            <div key={c.color} className="w-10 sm:w-12">
              <div className="h-2.5 rounded-sm" style={{ backgroundColor: c.color }} />
              <div className="mt-1 text-center tabular-nums">
                {classLabel(c, i === classes.length - 1)}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="w-16">
        <div
          className="h-2.5 rounded-sm border border-gray-700"
          style={{ backgroundColor: NOT_VISITED_COLOR }}
        />
        <div className="mt-1 text-center">Not visited</div>
      </div>
    </div>
  );
}

export default function VisitedCountriesMap() {
  const { data: geo, loading: geoLoading, error: geoError } = useGeography();
  const { data: world, loading: worldLoading, error: worldError } = useWorldCountries();

  // Older geography.json files (before this feature) lack per-country totals
  const stale = !!geo && geo.countries.some((c) => c.totalDays === undefined);

  const visited = useMemo(() => {
    const byIso = new Map<string, GeographyCountry>();
    for (const c of geo?.countries ?? []) {
      if (c.iso3 && c.totalDays > 0) byIso.set(c.iso3, c);
    }
    return byIso;
  }, [geo]);

  const classes = useMemo(
    () => quantileClasses([...visited.values()].map((c) => c.totalDays)),
    [visited],
  );

  const layers = useMemo(() => {
    const fillFor = (iso3: string | undefined): string => {
      const country = iso3 ? visited.get(iso3) : undefined;
      if (!country) return NOT_VISITED_COLOR;
      return (classes.find((c) => country.totalDays <= c.max) ?? classes[classes.length - 1]).color;
    };

    const style = (feature?: CountryFeature): PathOptions => {
      const isDot = feature?.geometry.type === 'Point';
      return {
        fillColor: fillFor(feature?.properties.iso3),
        fillOpacity: 1,
        color: SEA_COLOR,
        weight: isDot ? 1.5 : 0.6,
      };
    };

    const onEachFeature = (feature: CountryFeature, layer: Layer) => {
      const path = layer as Path;
      const { iso3, name } = feature.properties;
      path.bindTooltip(tooltipHtml(name, visited.get(iso3)), {
        sticky: true,
        direction: 'top',
        offset: [0, -10],
        className: 'country-tooltip',
      });
      path.on({
        mouseover: () => {
          path.setStyle({ color: HOVER_COLOR, weight: 1.5 });
          path.bringToFront();
        },
        mouseout: () => path.setStyle(style(feature)),
      });
    };

    // Dots for visited countries that are sub-pixel at world zoom
    const tinyVisited: FeatureCollection<Point, WorldCountryProperties> = {
      type: 'FeatureCollection',
      features: (world?.features ?? [])
        .filter((f) => visited.has(f.properties.iso3))
        .flatMap((f): Feature<Point, WorldCountryProperties>[] => {
          const [minX, minY, maxX, maxY] = bbox(f.geometry);
          if (maxX - minX >= TINY_COUNTRY_DEG || maxY - minY >= TINY_COUNTRY_DEG) return [];
          const center = [(minX + maxX) / 2, (minY + maxY) / 2];
          return [{ type: 'Feature', properties: f.properties, geometry: { type: 'Point', coordinates: center } }];
        }),
    };

    return { style, onEachFeature, tinyVisited };
  }, [world, visited, classes]);

  // Countries in the data that have no shape to draw (should be empty)
  const unmapped = useMemo(() => {
    if (!geo || !world) return [];
    const drawable = new Set(world.features.map((f) => f.properties.iso3));
    return geo.countries.filter((c) => !c.iso3 || !drawable.has(c.iso3)).map((c) => c.country);
  }, [geo, world]);

  let body: ReactNode;
  if (geoLoading || worldLoading) {
    body = <Loader />;
  } else if (!geo || !world) {
    body = (
      <p className="text-sm text-gray-500 py-10 text-center">
        Map unavailable{geoError || worldError ? ` (${geoError ?? worldError})` : ''}.
      </p>
    );
  } else if (stale) {
    body = (
      <p className="text-sm text-gray-400 py-10 text-center">
        Re-run <code className="bg-gray-800 text-orange-400 px-1.5 py-0.5 rounded">npm run preprocess</code>{' '}
        to generate per-country day totals for this map.
      </p>
    );
  } else {
    body = (
      <>
        <div className="countries-map aspect-[2/1] min-h-64 max-h-[36rem] w-full rounded-lg overflow-hidden border border-gray-800">
          <MapContainer
            bounds={INITIAL_VIEW}
            maxBounds={MAX_BOUNDS}
            maxBoundsViscosity={1}
            zoomSnap={0.1}
            minZoom={0}
            maxZoom={6}
            scrollWheelZoom={false}
            attributionControl={false}
            style={{ height: '100%', width: '100%', background: SEA_COLOR }}
          >
            <GeoJSON data={world} style={layers.style} onEachFeature={layers.onEachFeature} />
            <Pane name={TINY_PANE} style={{ zIndex: 450 }}>
              <GeoJSON
                data={layers.tinyVisited}
                style={layers.style}
                onEachFeature={layers.onEachFeature}
                pointToLayer={(_, latlng) => circleMarker(latlng, { radius: 5, pane: TINY_PANE })}
              />
            </Pane>
          </MapContainer>
        </div>
        {unmapped.length > 0 && (
          <p className="text-xs text-gray-500 mt-3">
            Not shown (no matching country shape): {unmapped.join(', ')}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Countries Visited</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {visited.size > 0 && !stale ? `${visited.size} countries · ` : ''}
            shaded by days present, home included
          </p>
        </div>
        {visited.size > 0 && !stale && <Legend classes={classes} />}
      </div>
      {body}
    </div>
  );
}
