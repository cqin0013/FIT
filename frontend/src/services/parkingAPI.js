const BASE =
  import.meta?.env?.VITE_API_BASE?.trim() || 'https://fit-8mtq.onrender.com';

const toNum = (v) => Number(v);
const isNum = Number.isFinite;
const clampRadius = (r) => Math.max(50, Math.min(5000, Number(r) || 300));

const getRtAvailable = (x) => {
  const hasOcc = typeof x.occupied === 'boolean';
  const hasUnocc = typeof x.unoccupied === 'boolean';

  if (hasOcc && hasUnocc) {
    return x.unoccupied === !x.occupied ? x.unoccupied : null;
  }
  if (hasUnocc) return x.unoccupied;
  if (hasOcc) return !x.occupied;
  return null;
};

/**
 * GET /api/parking?near=lat,lng&radius=R[&onlyAvailable=true]
 * -> [{ bayId, lat, lng, rtAvailable: boolean|null, timestamp }]
 */
export async function fetchAvailableBays({
  lat,
  lng,
  radius = 300,
  onlyAvailable = false,
}) {
  const la = toNum(lat);
  const ln = toNum(lng);
  if (!isNum(la) || !isNum(ln)) throw new Error('invalid lat/lng');

  const qs = new URLSearchParams({
    near: `${la},${ln}`,
    radius: String(clampRadius(radius)),
  });
  if (onlyAvailable) qs.set('onlyAvailable', 'true');

  const res = await fetch(`${BASE}/api/parking?${qs}`, { credentials: 'omit' });
  if (!res.ok) throw new Error(`/api/parking ${res.status}`);

  const arr = await res.json();
  if (!Array.isArray(arr)) throw new Error('bad /api/parking payload');

  return arr
    .map((x) => {
      const bayId = String(x.bayId ?? x.id ?? '');
      const lat = toNum(x.lat);
      const lng = toNum(x.lng ?? x.lon);
      return {
        bayId,
        lat,
        lng,
        rtAvailable: getRtAvailable(x),
        timestamp: x.timestamp ?? null,
      };
    })
    .filter((b) => b.bayId && isNum(b.lat) && isNum(b.lng));
}

/**
 * GET /api/bays/{bayId}
 * -> { pastOccupied: boolean|null, raw }
 */
export async function fetchBayPastOccupied(bayId) {
  if (!bayId) throw new Error('missing bayId');

  const res = await fetch(`${BASE}/api/bays/${encodeURIComponent(bayId)}`, {
    credentials: 'omit',
  });
  if (!res.ok) throw new Error(`/api/bays/${bayId} ${res.status}`);

  const j = await res.json();

  let pastOccupied = null;
  const hasOcc = typeof j.occupied === 'boolean';
  const hasUnocc = typeof j.unoccupied === 'boolean';

  if (hasOcc && hasUnocc) {
    pastOccupied = j.unoccupied === !j.occupied ? j.occupied : null;
  } else if (hasOcc) pastOccupied = j.occupied;
  else if (hasUnocc) pastOccupied = !j.unoccupied;

  return { pastOccupied, raw: j };
}
