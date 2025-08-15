"use strict";
const mysql = require("mysql2/promise");
const fetch = require("node-fetch");
const cron = require("node-cron");

/* ========= 连接池（仅用于 ABS 指标 & 富化用 BAYS_TABLE 查询） ========= */
const pool = mysql.createPool({
  host: "city-data-mysql.cjk4ce8mi0r6.ap-southeast-2.rds.amazonaws.com",
  port: 3306,
  user: "admin",
  password: "Himanshu2000",
  database: "city_data",
  waitForConnections: true,
  connectionLimit: 10,
});

/* ========= 常量：表名 ========= */
// SENSOR_TABLE/BAYS_TABLE 只用于读；不做写入
const SENSOR_TABLE = "city_data.stg_bay_sensors_raw";   // 可用于调试/健康检查
const BAYS_TABLE   = "city_data.stg_parking_bays_raw";  // 用于 KerbsideID 富化
const ABS_PLACE    = "city_data.stg_abs_place_wide";
const ABS_VIC      = "city_data.stg_abs_vic_wide";
const ABS_CHANGE   = "city_data.stg_abs_state_change_raw";

/* ========= 小工具 ========= */
function toNum(x) {
  if (x === null || x === undefined) return null;
  const n = Number(String(x).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
}
const r6 = (x) => Number(x).toFixed(6);
function makePseudoId(lat, lon) {
  if (lat == null || lon == null) return null;
  return `${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`;
}
function parsePseudoId(id) {
  if (!id) return null;
  const m = String(id).match(/^\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  return { lat: Number(m[1]), lon: Number(m[2]) };
}

/* ========= 时间解析（去掉 +10:00 等时区后再解析） ========= */
function parseLastupdated(ts) {
  if (!ts) return null;
  const base = String(ts).split("+")[0].trim(); // "YYYY-MM-DDTHH:mm:ss"
  const d = new Date(base.replace("T", " ") + "Z"); // 作为 UTC 解析
  return isNaN(d.getTime()) ? null : d;
}

/* ========= 占用状态映射 ========= */
function normalizeUnoccupied(raw) {
  if (raw == null) return null;
  const t = String(raw).trim().toLowerCase();
  if (!t) return null;
  if (t.includes("unoccupied") || t.includes("free") || t.includes("vacant")) return true;   // 空位
  if (t.includes("present") || t.includes("occupied")) return false;                          // 有车
  return null;                                                                                // 未知
}

/* ========= 统一从记录里取经纬度 ========= */
function extractLatLon(r) {
  const firstOf = (obj, keys) => {
    for (const k of keys) if (obj?.[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== "") return obj[k];
    return null;
  };

  // 1) 明确字段
  let lat = firstOf(r, ["lat", "latitude", "Latitude"]);
  let lon = firstOf(r, ["lon", "longitude", "Longitude"]);

  // 2) Location 字段（字符串 "lat, lon" 或对象）
  if ((lat == null || lon == null) && (r.Location || r.location)) {
    const loc = r.Location ?? r.location;
    if (typeof loc === "string") {
      const m = loc.match(/-?\d+(?:\.\d+)?/g) || [];
      if (m.length >= 2) { lat = Number(m[0]); lon = Number(m[1]); }
    } else if (typeof loc === "object") {
      lat = lat ?? Number(loc.lat ?? loc.latitude);
      lon = lon ?? Number(loc.lon ?? loc.longitude);
    }
  }

  // 3) 兜底：从 Status_Description 里正则提取
  if ((lat == null || lon == null) && r.Status_Description) {
    const m = String(r.Status_Description).match(/-?\d+(?:\.\d+)?/g) || [];
    if (m.length >= 2) { lat = Number(m[0]); lon = Number(m[1]); }
  }

  return {
    lat: lat != null && isFinite(Number(lat)) ? Number(lat) : null,
    lon: lon != null && isFinite(Number(lon)) ? Number(lon) : null,
  };
}

/* ===================================================================================
 * 实时抓取（政府数据源）
 * =================================================================================== */
async function fetchLiveLatest({ limit = 2000, url, token } = {}) {
  const endpoint = url || process.env.LIVE_PARKING_API_URL;
  if (!endpoint) throw new Error("LIVE_PARKING_API_URL 未配置，且未通过参数提供 url");

  const headers = token ? { "X-App-Token": token } : undefined;

  const firstOf = (obj, keys, fb = null) => {
    for (const k of keys) {
      if (obj && obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== "") return obj[k];
    }
    return fb;
  };

  const rows = [];
  const isSocrata = /\/resource\//i.test(endpoint);
  const isExplore = /\/api\/explore\/v2\.1\/.+\/records/i.test(endpoint);

  if (isSocrata) {
    const q = new URL(endpoint);
    q.searchParams.set("$order", q.searchParams.get("$order") || "lastupdated DESC");
    q.searchParams.set("$limit", String(Math.max(1, Math.min(50000, limit))));

    const res = await fetch(q.toString(), { headers, timeout: 15000 });
    if (!res.ok) throw new Error(`实时接口请求失败：${res.status} ${res.statusText}`);
    const arr = await res.json();

    for (const r of (Array.isArray(arr) ? arr : (arr.results || arr.data || []))) {
      const { lat, lon } = extractLatLon(r);
      if (lat == null || lon == null) continue;

      const STATUS_KEYS = ["Status_Description", "status_description", "Status", "status", "Zone_Number", "zone_number"];
      const rawStatus = firstOf(r, STATUS_KEYS);

      const unocc = normalizeUnoccupied(rawStatus);
      const occ = unocc == null ? null : !unocc;

      rows.push({
        bayId: String(firstOf(r, ["KerbsideID", "kerbsideid", "bay_id", "bayId"]) || makePseudoId(lat, lon)),
        unoccupied: unocc,
        occupied: occ,
        lat, lon,
        lastupdated: firstOf(r, ["Lastupdated", "lastupdated", "status_timestamp", "status_time", "updated", "update_time"]) || null,
        timestamp: new Date().toISOString(),
      });
      if (rows.length >= limit) break;
    }
    return rows;
  }

  if (isExplore) {
    const perPage = 100;
    let offset = 0;

    while (rows.length < limit) {
      const q = new URL(endpoint);
      q.searchParams.set("order_by", q.searchParams.get("order_by") || "lastupdated DESC");
      q.searchParams.set("limit", String(Math.min(perPage, limit - rows.length)));
      q.searchParams.set("offset", String(offset));

      const res = await fetch(q.toString(), { headers, timeout: 15000 });
      if (!res.ok) throw new Error(`实时接口请求失败：${res.status} ${res.statusText}`);
      const raw = await res.json();

      const list = Array.isArray(raw?.results)
        ? raw.results.map(x => x?.record?.fields || x?.fields || x)
        : (Array.isArray(raw) ? raw : []);

      if (!list.length) break;

      for (const r of list) {
        const { lat, lon } = extractLatLon(r);
        if (lat == null || lon == null) continue;

        const STATUS_KEYS = ["Status_Description", "status_description", "Status", "status", "Zone_Number", "zone_number"];
        const rawStatus = firstOf(r, STATUS_KEYS);

        const unocc = normalizeUnoccupied(rawStatus);
        const occ = unocc == null ? null : !unocc;

        rows.push({
          bayId: String(firstOf(r, ["KerbsideID", "kerbsideid", "bay_id", "bayId"]) || makePseudoId(lat, lon)),
          unoccupied: unocc,
          occupied: occ,
          lat, lon,
          lastupdated: firstOf(r, ["Lastupdated", "lastupdated", "status_timestamp", "status_time", "updated", "update_time"]) || null,
          timestamp: new Date().toISOString(),
        });
        if (rows.length >= limit) break;
      }

      offset += perPage;
      if (list.length < perPage) break;
    }
    return rows;
  }

  // 兜底：按 Socrata 风格参数
  const q = new URL(endpoint);
  q.searchParams.set("$order", q.searchParams.get("$order") || "lastupdated DESC");
  q.searchParams.set("$limit", String(Math.max(1, Math.min(50000, limit))));
  const res = await fetch(q.toString(), { headers, timeout: 15000 });
  if (!res.ok) throw new Error(`实时接口请求失败：${res.status} ${res.statusText}`);
  const arr = await res.json();

  for (const r of (Array.isArray(arr) ? arr : (arr.results || arr.data || []))) {
    const { lat, lon } = extractLatLon(r);
    if (lat == null || lon == null) continue;
    const STATUS_KEYS = ["Status_Description", "status_description", "Status", "status", "Zone_Number", "zone_number"];
    const rawStatus = firstOf(r, STATUS_KEYS);

    const unocc = normalizeUnoccupied(rawStatus);
    const occ = unocc == null ? null : !unocc;

    rows.push({
      bayId: String(firstOf(r, ["KerbsideID", "kerbsideid", "bay_id", "bayId"]) || makePseudoId(lat, lon)),
      unoccupied: unocc,
      occupied: occ,
      lat, lon,
      lastupdated: firstOf(r, ["Lastupdated", "lastupdated", "status_timestamp", "status_time", "updated", "update_time"]) || null,
      timestamp: new Date().toISOString(),
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

/* ===================================================================================
 * 进程内缓存（TTL + SWR）并累计历史（环形缓冲）
 * =================================================================================== */
const DEFAULT_TTL_MS = Number(process.env.CACHE_TTL_MS || 60_000);     // 新鲜度
const DEFAULT_SWR_MS = Number(process.env.CACHE_SWR_MS || 5 * 60_000); // SWR 窗口
const MAX_HISTORY    = Number(process.env.CACHE_MAX_HISTORY || 500_000);

const _cache = {
  latestBatchTime: 0,   // 最近一次成功拉取时刻（ms）
  refreshing: false,
  items: [],            // 历史累计记录（环形缓冲）
  keyset: new Set(),    // 去重：key = bayId + "|" + lastupdated
};

// 去重 key
function _recKey(r) {
  const lu = r.lastupdated || "";
  return `${r.bayId}|${lu}`;
}

// 批量合并到历史缓存（去重 & 控制容量）
function _mergeIntoHistory(list) {
  for (const r of list) {
    if (!r || !r.bayId) continue;
    const k = _recKey(r);
    if (_cache.keyset.has(k)) continue;
    _cache.items.push(r);
    _cache.keyset.add(k);
  }
  // 控制容量
  if (_cache.items.length > MAX_HISTORY) {
    const overflow = _cache.items.length - MAX_HISTORY;
    const removed = _cache.items.splice(0, overflow);
    for (const r of removed) _cache.keyset.delete(_recKey(r));
  }
}

// 主动刷新（可 force）
async function refreshLiveCache({ limit = 2000, url, token, force = false } = {}) {
  const now = Date.now();
  const isFresh = (now - _cache.latestBatchTime) <= DEFAULT_TTL_MS;
  const withinSWR = (now - _cache.latestBatchTime) <= DEFAULT_SWR_MS;

  if (!force && (isFresh || (withinSWR && _cache.refreshing))) {
    return { refreshed: false, items: _cache.items.length };
  }
  if (_cache.refreshing) {
    return { refreshed: false, items: _cache.items.length };
  }

  _cache.refreshing = true;
  try {
    const batch = await fetchLiveLatest({ limit, url, token });
    _mergeIntoHistory(batch);
    _cache.latestBatchTime = Date.now();
    return { refreshed: true, batch: batch.length, total: _cache.items.length };
  } finally {
    _cache.refreshing = false;
  }
}

// 清缓存
function clearParkingCache() {
  _cache.items = [];
  _cache.keyset.clear();
  _cache.latestBatchTime = 0;
  _cache.refreshing = false;
  return true;
}

// 确保在 TTL 内，如不新鲜且超出 SWR 就同步刷新
async function _ensureFreshSync() {
  const now = Date.now();
  const isFresh = (now - _cache.latestBatchTime) <= DEFAULT_TTL_MS;
  const withinSWR = (now - _cache.latestBatchTime) <= DEFAULT_SWR_MS;
  if (isFresh) return;
  if (withinSWR) {
    // SWR 内：先返回旧数据；后台刷新
    refreshLiveCache({}).catch(() => {});
    return;
  }
  // 超过 SWR：同步刷新
  await refreshLiveCache({});
}

/* ===================================================================================
 * 富化：根据 KerbsideID 批量查库并合并到 meta
 * =================================================================================== */
async function getBayMetaMapByKerbsideIds(ids = []) {
  // 过滤掉伪 ID（"lat,lon"）
  const realIds = [...new Set(ids.filter(id => id && !parsePseudoId(id)))];
  if (!realIds.length) return new Map();

  const placeholders = realIds.map(() => "?").join(",");
  const sql = `
    SELECT KerbsideID, Latitude, Longitude, RoadSegmentID
    FROM ${BAYS_TABLE}
    WHERE KerbsideID IN (${placeholders})
  `;
  const [rows] = await pool.query(sql, realIds);
  const m = new Map();
  for (const r of rows) {
    const id = String(r.KerbsideID);
    m.set(id, {
      kerbsideId: id,
      lat: r.Latitude != null ? Number(r.Latitude) : null,
      lon: r.Longitude != null ? Number(r.Longitude) : null,
      roadSegmentId: r.RoadSegmentID != null ? Number(r.RoadSegmentID) : null,
    });
  }
  return m;
}

function mergeBayMeta(rows = [], metaMap = new Map()) {
  return rows.map(r => {
    const meta = r?.bayId ? metaMap.get(String(r.bayId)) : undefined;
    return {
      ...r,
      meta: meta || null,  // { kerbsideId, lat, lon, roadSegmentId } | null
    };
  });
}

/* ===================================================================================
 * 查询接口（全部基于缓存）—— 支持 enrichWithDb
 * =================================================================================== */

// 最新列表（默认 2000）
async function fetchOnce({ limit = 2000, enrichWithDb = false } = {}) {
  await _ensureFreshSync();
  const lim = Number.isFinite(limit) ? Math.max(1, Math.min(10000, limit)) : 2000;

  const sorted = [..._cache.items].sort((a, b) => {
    const da = parseLastupdated(a.lastupdated)?.getTime() ?? 0;
    const db = parseLastupdated(b.lastupdated)?.getTime() ?? 0;
    return db - da;
  });
  let out = sorted.slice(0, lim);

  if (enrichWithDb && out.length) {
    const metas = await getBayMetaMapByKerbsideIds(out.map(x => x.bayId));
    out = mergeBayMeta(out, metas);
  }
  return out;
}

// 单 bay 最新（支持伪 bayId）
async function getLatestByBay(bayId, { enrichWithDb = false } = {}) {
  await _ensureFreshSync();
  const pair = parsePseudoId(bayId);

  let latest = null;
  if (pair) {
    const eps = 0.000005; // 约四米
    const matches = _cache.items.filter(t =>
      t.lat != null && t.lon != null &&
      t.lat >= Number((pair.lat - eps).toFixed(6)) &&
      t.lat <= Number((pair.lat + eps).toFixed(6)) &&
      t.lon >= Number((pair.lon - eps).toFixed(6)) &&
      t.lon <= Number((pair.lon + eps).toFixed(6))
    );
    if (matches.length) {
      matches.sort((a, b) => (parseLastupdated(b.lastupdated)?.getTime() ?? 0) - (parseLastupdated(a.lastupdated)?.getTime() ?? 0));
      latest = matches[0];
    }
  } else {
    const matches = _cache.items.filter(t => t.bayId === String(bayId));
    if (matches.length) {
      matches.sort((a, b) => (parseLastupdated(b.lastupdated)?.getTime() ?? 0) - (parseLastupdated(a.lastupdated)?.getTime() ?? 0));
      latest = matches[0];
    }
  }

  if (!latest) return null;

  if (enrichWithDb && latest.bayId && !parsePseudoId(latest.bayId)) {
    const metas = await getBayMetaMapByKerbsideIds([latest.bayId]);
    return mergeBayMeta([latest], metas)[0];
  }
  return latest;
}

// 单 bay 历史（可加时间窗）
async function getHistoryByBay(bayId, { start, end, limit = 5000, enrichWithDb = false } = {}) {
  await _ensureFreshSync();
  const lim = Number.isFinite(limit) ? Math.max(1, Math.min(100000, limit)) : 5000;
  const pair = parsePseudoId(bayId);

  let list = [];
  if (pair) {
    const eps = 0.000005;
    list = _cache.items.filter(t =>
      t.lat != null && t.lon != null &&
      t.lat >= Number((pair.lat - eps).toFixed(6)) &&
      t.lat <= Number((pair.lat + eps).toFixed(6)) &&
      t.lon >= Number((pair.lon - eps).toFixed(6)) &&
      t.lon <= Number((pair.lon + eps).toFixed(6))
    );
  } else {
    list = _cache.items.filter(t => t.bayId === String(bayId));
  }

  const startMs = start ? (parseLastupdated(start)?.getTime() ?? Date.parse(start)) : null;
  const endMs   = end   ? (parseLastupdated(end)?.getTime()   ?? Date.parse(end))   : null;
  if (startMs != null) list = list.filter(t => (parseLastupdated(t.lastupdated)?.getTime() ?? 0) >= startMs);
  if (endMs   != null) list = list.filter(t => (parseLastupdated(t.lastupdated)?.getTime() ?? 0) <= endMs);

  list.sort((a, b) => (parseLastupdated(a.lastupdated)?.getTime() ?? 0) - (parseLastupdated(b.lastupdated)?.getTime() ?? 0));
  let out = list.slice(0, lim);

  if (enrichWithDb && out.length) {
    const metas = await getBayMetaMapByKerbsideIds(out.map(x => x.bayId));
    out = mergeBayMeta(out, metas);
  }
  return out;
}

/**
 * 时间/范围查询
 * @param {string|null} start
 * @param {string|null} end
 * @param {object} opts
 *   - limit: 默认 100000
 *   - bbox: { minLat, maxLat, minLon, maxLon }
 *   - onlyKnown: 默认 true
 *   - enrichWithDb: 默认 false
 */
async function getRange(start, end, { limit = 100000, bbox, onlyKnown = true, enrichWithDb = false } = {}) {
  await _ensureFreshSync();
  const lim = Number.isFinite(limit) ? Math.max(1, Math.min(200000, limit)) : 100000;

  let list = _cache.items;

  const startMs = start ? (parseLastupdated(start)?.getTime() ?? Date.parse(start)) : null;
  const endMs   = end   ? (parseLastupdated(end)?.getTime()   ?? Date.parse(end))   : null;
  if (startMs != null) list = list.filter(t => (parseLastupdated(t.lastupdated)?.getTime() ?? 0) >= startMs);
  if (endMs   != null) list = list.filter(t => (parseLastupdated(t.lastupdated)?.getTime() ?? 0) <= endMs);

  if (bbox && [bbox.minLat, bbox.maxLat, bbox.minLon, bbox.maxLon].every(v => typeof v === "number")) {
    list = list.filter(t =>
      t.lat != null && t.lon != null &&
      t.lat >= bbox.minLat && t.lat <= bbox.maxLat &&
      t.lon >= bbox.minLon && t.lon <= bbox.maxLon
    );
  } else if (onlyKnown) {
    list = list.filter(t => t.lat != null && t.lon != null);
  }

  list = [...list].sort((a, b) => (parseLastupdated(a.lastupdated)?.getTime() ?? 0) - (parseLastupdated(b.lastupdated)?.getTime() ?? 0));
  let out = list.slice(0, lim);

  if (enrichWithDb && out.length) {
    const metas = await getBayMetaMapByKerbsideIds(out.map(x => x.bayId));
    out = mergeBayMeta(out, metas);
  }
  return out;
}

/* ===================================================================================
 * 定时刷新缓存（取代原“写库”CRON）
 * =================================================================================== */
cron.schedule("*/5 * * * *", async () => {
  try {
    const ret = await refreshLiveCache({ limit: Number(process.env.LIVE_PULL_LIMIT || 2000) });
    if (ret.refreshed) {
      console.log(`⏱ CRON: 刷新缓存 batch=${ret.batch}, total=${ret.total}`);
    } else {
      console.log(`⏱ CRON: 缓存新鲜 / 或已在刷新中, total=${_cache.items.length}`);
    }
  } catch (e) {
    console.error("CRON 刷新失败：", e.message);
  }
});

/* ===================================================================================
 * 健康/调试 & ABS 指标（仍使用数据库）
 * =================================================================================== */
async function dbPing() { const [r] = await pool.query("SELECT 1 AS ok"); return r[0].ok === 1; }
async function describeSensorTable() {
  const [rows] = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = ?
    ORDER BY ordinal_position
  `, [SENSOR_TABLE.split(".").pop()]);
  return rows;
}
async function countSensors() { const [r] = await pool.query(`SELECT COUNT(*) AS c FROM ${SENSOR_TABLE}`); return Number(r[0].c || 0); }
async function maxLastupdated() { const [r] = await pool.query(`SELECT MAX(Lastupdated) AS m FROM ${SENSOR_TABLE}`); return r[0].m || null; }
async function sampleSensors(limit = 10) {
  const lim = Number.isFinite(limit) ? Math.max(1, Math.min(2000, limit)) : 10;
  const [rows] = await pool.query(`
    SELECT KerbsideID AS kerbsideid, Status_Description AS status_description, Lastupdated AS lastupdated, Location
    FROM ${SENSOR_TABLE}
    ORDER BY STR_TO_DATE(SUBSTRING_INDEX(Lastupdated, '+', 1), '%Y-%m-%dT%H:%i:%s') DESC
    LIMIT ${lim};
  `);
  return rows;
}
async function rawMinMaxCount() {
  const [r1] = await pool.query(`SELECT COUNT(*) AS c FROM ${SENSOR_TABLE}`);
  const [r2] = await pool.query(`SELECT MIN(Lastupdated) AS minlu, MAX(Lastupdated) AS maxlu FROM ${SENSOR_TABLE}`);
  return { count: Number(r1[0].c || 0), minLastupdated: r2[0].minlu || null, maxLastupdated: r2[0].maxlu || null };
}

/* ========= ABS 指标 ========= */
async function metricsCbdPopulation({ from = 2001, to = 2021, place = "Melbourne City" } = {}) {
  const years = []; for (let y = Number(from); y <= Number(to); y++) years.push(y);
  const yCols = years.map(y => `y${y}`);
  let row = null;
  for (const col of ["sa3_name", "sa4_name", "gccsa_name"]) {
    const [r] = await pool.query(`SELECT ${yCols.join(", ")} FROM ${ABS_PLACE} WHERE ${col} = ? LIMIT 1`, [place]);
    if (r.length) { row = r[0]; break; }
  }
  if (!row) {
    const [r] = await pool.query(
      `SELECT ${yCols.join(", ")} FROM ${ABS_PLACE}
       WHERE sa3_name LIKE '%Melbourne%' OR sa4_name LIKE '%Melbourne%' OR gccsa_name LIKE '%Melbourne%'
       LIMIT 1`
    );
    if (r.length) row = r[0];
  }
  const series = row ? years.map(y => ({ year: y, population: toNum(row[`y${y}`]) })).filter(d => d.population != null) : [];
  return { title: "Melbourne CBD Resident Population", unit: "persons", source: `${ABS_PLACE}`, series };
}

async function metricsCarOwnership({ from = 2016, to = 2021 } = {}) {
  const years = []; for (let y = Number(from); y <= Number(to); y++) years.push(y);
  const yCols = years.map(y => `y${y}`);
  const [vicRows] = await pool.query(`SELECT ${yCols.join(", ")} FROM ${ABS_VIC} WHERE state_name='Victoria' LIMIT 1`);
  const vic = vicRows.length ? vicRows[0] : null;
  const [chg] = await pool.query(
    `SELECT period_end AS year, change_count
     FROM ${ABS_CHANGE}
     WHERE state_code='VIC' AND period_end BETWEEN ? AND ?
     ORDER BY period_end ASC`,
    [years[0], years[years.length - 1]]
  );
  const byYear = new Map(chg.map(r => [Number(r.year), Number(r.change_count)]));
  const series = [];
  for (const y of years) {
    const pop = vic ? toNum(vic[`y${y}`]) : null;
    const delta = byYear.get(y);
    if (pop && delta != null) series.push({ year: y, value: Number(((delta / pop) * 1000).toFixed(3)) });
  }
  return { title: "Vehicles change per 1,000 residents (Victoria)", unit: "vehicles / 1,000 residents", source: `${ABS_CHANGE} + ${ABS_VIC}`, series };
}

/* ========= 导出 ========= */
module.exports = {
  // 停车（缓存+SWR）
  fetchOnce,
  getLatestByBay,
  getHistoryByBay,
  getRange,

  // 缓存控制
  refreshLiveCache,
  clearParkingCache,

  // 富化工具（可选导出）
  getBayMetaMapByKerbsideIds,
  mergeBayMeta,

  // 健康/调试 & 指标
  dbPing,
  describeSensorTable,
  countSensors,
  maxLastupdated,
  sampleSensors,
  rawMinMaxCount,
  metricsCbdPopulation,
  metricsCarOwnership,

  // 可选对外：底层抓取函数
  fetchLiveLatest,
};
