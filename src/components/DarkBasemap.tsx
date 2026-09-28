/**
 * The shared dark basemap for every Leaflet map: Esri's World Dark Gray
 * Canvas base plus its place-label overlay (CARTO dark_all, used before,
 * now serves an "API KEY REQUIRED" placeholder tile to anonymous users).
 * Esri's tile path is {z}/{y}/{x} (y before x) and its native tiles stop at
 * zoom 16, so deeper zooms upscale via maxNativeZoom.
 */
import { TileLayer } from 'react-leaflet';

const BASE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
const LABELS_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}';

export default function DarkBasemap() {
  return (
    <>
      <TileLayer
        attribution='Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, DeLorme, NAVTEQ'
        url={BASE_URL}
        maxNativeZoom={16}
        maxZoom={18}
      />
      <TileLayer url={LABELS_URL} maxNativeZoom={16} maxZoom={18} />
    </>
  );
}
