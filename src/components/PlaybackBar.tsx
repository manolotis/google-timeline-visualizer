/**
 * Travel Map playback controls, floating over the bottom of the map: play /
 * pause, the current date, a scrubber over the selected range (with a strip
 * showing when there was movement), and the speed.
 *
 * Keyboard, while focus is anywhere in the bar: Space plays/pauses, ←/→
 * step one day (with Shift: one second's worth of playback at the current
 * speed), Home/End jump to the ends.
 */
import { memo, useMemo, type KeyboardEvent } from 'react';
import {
  DAY_MS,
  PLAYBACK_SPEEDS,
  countUpTo,
  playbackDate,
  usePlaybackState,
  type PlaybackBounds,
  type PlaybackClock,
  type PlaybackSpeed,
} from '../playback';
import { dayOfWeek, periodLabel } from '../timeRange';

interface Props {
  clock: PlaybackClock;
  bounds: PlaybackBounds;
  speed: PlaybackSpeed;
  onSpeedChange: (speed: PlaybackSpeed) => void;
  onClose: () => void;
  /** Start times of the drawn segments, ascending (see RouteSelection) */
  times: Float64Array;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Columns in the activity strip */
const STRIP_BUCKETS = 160;

/**
 * Segments per slice of the span as bars (square-root scale, so quiet
 * stretches still show), with faint year lines, or month lines for spans
 * under two years. Drawn in currentColor.
 */
const ActivityStrip = memo(function ActivityStrip({ times, bounds }: { times: Float64Array; bounds: PlaybackBounds }) {
  const { bars, lines } = useMemo(() => {
    const span = bounds.end - bounds.start + 1;
    const counts = new Array<number>(STRIP_BUCKETS).fill(0);
    for (const t of times) {
      const b = Math.floor(((t - bounds.start) / span) * STRIP_BUCKETS);
      if (b >= 0 && b < STRIP_BUCKETS) counts[b]++;
    }
    const max = Math.max(1, ...counts);
    const bars = counts.map((n) => (n === 0 ? 0 : Math.max(0.12, Math.sqrt(n / max))));

    const lines: number[] = [];
    const first = new Date(bounds.start);
    const yearly = span > 2 * 365 * DAY_MS;
    for (let i = 1; ; i++) {
      const t = yearly
        ? Date.UTC(first.getUTCFullYear() + i, 0, 1)
        : Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1);
      if (t > bounds.end) break;
      lines.push(((t - bounds.start) / span) * STRIP_BUCKETS);
    }
    return { bars, lines };
  }, [times, bounds]);

  return (
    <svg
      viewBox={`0 0 ${STRIP_BUCKETS} 1`}
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full"
      aria-hidden="true"
    >
      {lines.map((x) => (
        <rect key={x} x={x} y={0} width={0.25} height={1} className="fill-gray-700/70" />
      ))}
      {bars.map((h, i) =>
        h > 0 ? <rect key={i} x={i + 0.1} y={1 - h} width={0.8} height={h} fill="currentColor" /> : null,
      )}
    </svg>
  );
});

function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="w-4 h-4" aria-hidden="true" fill="currentColor">
      {playing ? (
        <path d="M4 2.5h2.75v11H4zM9.25 2.5H12v11H9.25z" />
      ) : (
        <path d="M4.5 2.2v11.6a.5.5 0 0 0 .76.43l9.3-5.8a.5.5 0 0 0 0-.86l-9.3-5.8a.5.5 0 0 0-.76.43z" />
      )}
    </svg>
  );
}

export default function PlaybackBar({ clock, bounds, speed, onSpeedChange, onClose, times }: Props) {
  const { time: rawTime, playing } = usePlaybackState(clock);
  const time = Math.min(Math.max(rawTime, bounds.start), bounds.end);
  const date = playbackDate(time);
  const dateLabel = `${+date.slice(8, 10)} ${periodLabel(date.slice(0, 7))}`; // '14 Mar 2024'
  const weekday = WEEKDAYS[dayOfWeek(date)];
  const progress = bounds.end > bounds.start ? (time - bounds.start) / (bounds.end - bounds.start) : 1;
  const drawn = countUpTo(times, time);

  // Dragging the scrubber pauses playback until the pointer is released
  const holdWhileDragging = () => {
    if (!clock.getSnapshot().playing) return;
    clock.pause();
    window.addEventListener(
      'pointerup',
      () => {
        if (clock.getSnapshot().time < bounds.end) clock.play();
      },
      { once: true },
    );
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return; // e.g. Alt+← is the browser's Back
    const now = clock.getSnapshot().time;
    const step = e.shiftKey ? speed.days * DAY_MS : DAY_MS;
    switch (e.key) {
      case ' ':
        clock.toggle();
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        clock.seek(now - step);
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        clock.seek(now + step);
        break;
      case 'Home':
        clock.seek(bounds.start);
        break;
      case 'End':
        clock.seek(bounds.end);
        break;
      default:
        return;
    }
    // Also keeps Space from pressing the focused button and arrows from moving the slider natively
    e.preventDefault();
  };

  return (
    <div
      role="group"
      aria-label="Playback"
      onKeyDown={onKeyDown}
      className="absolute inset-x-2 sm:inset-x-6 bottom-7 z-[1000] mx-auto max-w-5xl flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 rounded-xl border border-gray-700/70 bg-gray-900/90 backdrop-blur shadow-2xl shadow-black/60"
    >
      <button
        type="button"
        onClick={() => clock.toggle()}
        autoFocus
        aria-label={playing ? 'Pause' : 'Play'}
        title={`${playing ? 'Pause' : 'Play'} (Space)`}
        className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-orange-500 text-gray-950 hover:bg-orange-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
      >
        <PlayIcon playing={playing} />
      </button>

      <div className="shrink-0 w-32">
        <div className="text-xl font-semibold leading-tight tabular-nums text-white whitespace-nowrap">
          {dateLabel}
        </div>
        <div className="text-[11px] text-gray-500 whitespace-nowrap">
          {weekday} · {drawn.toLocaleString()}/{times.length.toLocaleString()}
        </div>
      </div>

      <div className="order-last basis-full sm:order-none sm:basis-0 flex-1 min-w-0">
        <div className="relative h-5 mx-2">
          <div className="absolute inset-0 text-gray-600">
            <ActivityStrip times={times} bounds={bounds} />
          </div>
          <div className="absolute inset-0 text-orange-400" style={{ clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)` }}>
            <ActivityStrip times={times} bounds={bounds} />
          </div>
        </div>
        <input
          type="range"
          min={bounds.start}
          max={bounds.end}
          step="any"
          value={time}
          onChange={(e) => clock.seek(e.currentTarget.valueAsNumber)}
          onPointerDown={holdWhileDragging}
          aria-label="Playback date"
          aria-valuetext={`${weekday} ${dateLabel}`}
          className="block w-full h-4 cursor-pointer accent-orange-500 [color-scheme:dark]"
        />
        <div className="flex justify-between mx-2 text-[10px] leading-none text-gray-500 tabular-nums">
          <span>{playbackDate(bounds.start)}</span>
          <span>{playbackDate(bounds.end)}</span>
        </div>
      </div>

      <div className="flex items-center gap-1 ml-auto sm:ml-0" role="group" aria-label="Speed, per second">
        {PLAYBACK_SPEEDS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSpeedChange(s)}
            aria-pressed={s.id === speed.id}
            title={`${s.label} per second`}
            className={`px-1.5 py-1 rounded-md text-xs border tabular-nums transition-colors ${
              s.id === speed.id
                ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white hover:border-gray-600'
            }`}
          >
            {s.short}
          </button>
        ))}
        <span className="text-[11px] text-gray-500 ml-0.5">/s</span>
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close playback"
        title="Close playback"
        className="shrink-0 w-7 h-7 rounded-lg text-xs text-gray-500 hover:text-white hover:bg-gray-800 transition-colors"
      >
        ✕
      </button>
    </div>
  );
}
