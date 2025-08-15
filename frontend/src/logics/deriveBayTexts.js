/**
 * @param {{ rtAvailable: boolean|null|undefined, pastOccupied: boolean|null|undefined }}
 * @returns {{ availability: "available"|"unavailable"|undefined, history: string, prediction: string }}
 */


export function deriveBayTexts({ rtAvailable, pastOccupied }) {
  //available: boolean to value
  const availability =
    rtAvailable == null ? undefined : rtAvailable ? 'available' : 'unavailable';

  //history: accept boolean
  const history =
    typeof pastOccupied === 'boolean'
      ? pastOccupied
        ? 'occupied in the past'
        : 'available in the past'
      : 'unknown';

  //prediction
  const prediction =
    rtAvailable === true
      ? 'available'
      : rtAvailable === false
      ? pastOccupied === false
        ? '50% available'
        : pastOccupied === true
        ? 'unavailable'
        : 'unknown'
      : pastOccupied === true
      ? '50% available'
      : pastOccupied === false
      ? 'available'
      : 'unknown';

  return { availability, history, prediction };
}

//bay id
export const formatBayName = (bayId) => (bayId ? `${bayId} bay` : '');

//update time
export function timeAgo(iso) {
  const t = iso ? new Date(iso).getTime() : NaN; //get time
  const ms = Date.now() - t;
  if (!Number.isFinite(ms) || ms < 0) return ''; //negative value return null
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
