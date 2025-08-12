"use strict";
const mysql = require("mysql2/promise");
const fetch = require("node-fetch");
const cron = require("node-cron");

/* ========= 连接池 ========= */
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
const SENSOR_TABLE = "city_data.stg_bay_sensors_raw";
const BAYS_TABLE = "city_data.stg_parking_bays_raw";
const ABS_PLACE = "city_data.stg_abs_place_wide";
const ABS_VIC = "city_data.stg_abs_vic_wide";
const ABS_CHANGE = "city_data.stg_abs_state_change_raw";

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

/* ========= 公用 SELECT（join + 正则兜底坐标；正则不含 ?） ========= */
function baseSelect() {
  const LAT_RE = "(-|)[0-9]+\\.[0-9]+";
  const LON_RE = "(-|)[0-9]+\\.[0-9]+";
  return `
    SELECT
      COALESCE(NULLIF(s.KerbsideID,''), b.KerbsideID) AS kerbsideid,
      s.Lastupdated                                    AS lastupdated,
      s.Zone_Number                                    AS raw_status,   -- 占用状态真实来源
      CAST(COALESCE(
        b.Latitude,
        REGEXP_SUBSTR(s.Status_Description, '${LAT_RE}', 1, 1)
      ) AS DECIMAL(12,8))                              AS lat,
      CAST(COALESCE(
        b.Longitude,
        REGEXP_SUBSTR(s.Status_Description, '${LON_RE}', 1, 2)
      ) AS DECIMAL(12,8))                              AS lon
    FROM ${SENSOR_TABLE} s
    LEFT JOIN ${BAYS_TABLE} b
      ON (
        b.KerbsideID = s.KerbsideID
        OR b.RoadSegmentID = CAST(REPLACE(s.Zone_Number, ',', '') AS UNSIGNED)
      )
    WHERE COALESCE(
            b.Latitude, REGEXP_SUBSTR(s.Status_Description, '${LAT_RE}', 1, 1)
          ) IS NOT NULL
      AND COALESCE(
            b.Longitude, REGEXP_SUBSTR(s.Status_Description, '${LON_RE}', 1, 2)
          ) IS NOT NULL
  `;
}

// 去掉 +10:00 再转时间，便于排序/过滤
function tsExpr() {
  return `STR_TO_DATE(SUBSTRING_INDEX(s.Lastupdated, '+', 1), '%Y-%m-%dT%H:%i:%s')`;
}

/* ========= 读数映射 ========= */
function normalizeUnoccupied(raw) {
  if (raw == null) return null;
  const t = String(raw).trim().toLowerCase();
  if (!t) return null;
  // 空位
  if (t.includes("unoccupied") || t.includes("free") || t.includes("vacant")) return true;
  // 有车
  if (t.includes("present") || t.includes("occupied")) return false;
  // 其他未知
  return null;
}

function mapParkingRow(r) {
  const latNum = r.lat != null ? Number(r.lat) : null;
  const lonNum = r.lon != null ? Number(r.lon) : null;
  const realId = r.kerbsideid ? String(r.kerbsideid) : null;
  const pseudo = makePseudoId(latNum, lonNum);

  const unocc = normalizeUnoccupied(r.raw_status);
  const occ = (unocc == null) ? null : !unocc;

  return {
    bayId: realId || pseudo,
    // 注意：两个字段都给，前端可任选其一；你的现有前端在用 unoccupied，就继续用它
    unoccupied: unocc,              // true=空位, false=占用, null=未知
    occupied: occ,                  // true=占用, false=空位, null=未知
    lat: latNum,
    lon: lonNum,
    lastupdated: r.lastupdated || null,
    timestamp: new Date().toISOString(),
  };
}

/* ===================================================================================
 * A. 核心读取：停车（仅读库）
 * =================================================================================== */
async function fetchOnce({ limit = 2000 } = {}) {
  const lim = Number.isFinite(limit) ? Math.max(1, Math.min(10000, limit)) : 2000;
  const sql = `
    ${baseSelect()}
    ORDER BY ${tsExpr()} DESC
    LIMIT ${lim}
  `;
  const [rows] = await pool.query(sql);
  return rows.map(mapParkingRow);
}

async function fetchAllForDate(date, { limitPerDay = 50000 } = {}) {
  const lim = Number.isFinite(limitPerDay) ? Math.max(1, Math.min(200000, limitPerDay)) : 50000;
  const sql = `
    ${baseSelect()}
    AND LEFT(s.Lastupdated, 10) = ?
    ORDER BY ${tsExpr()} ASC
    LIMIT ${lim}
  `;
  const [rows] = await pool.query(sql, [date]);
  return rows.map(mapParkingRow);
}

/* ========= 单 bay（支持伪 bayId 与真实 KerbsideID） ========= */
async function getLatestByBay(bayId) {
  const pair = parsePseudoId(bayId);
  if (pair) {
    const eps = 0.000005; // 约等于四米级别
    const sql = `
      SELECT * FROM (
        ${baseSelect()}
      ) t
      WHERE t.lat BETWEEN ? AND ?
        AND t.lon BETWEEN ? AND ?
      ORDER BY STR_TO_DATE(SUBSTRING_INDEX(t.lastupdated,'+',1), '%Y-%m-%dT%H:%i:%s') DESC
      LIMIT 1
    `;
    const params = [
      Number((pair.lat - eps).toFixed(6)),
      Number((pair.lat + eps).toFixed(6)),
      Number((pair.lon - eps).toFixed(6)),
      Number((pair.lon + eps).toFixed(6)),
    ];
    const [rows] = await pool.query(sql, params);
    return rows.length ? mapParkingRow(rows[0]) : null;
  }

  // 真实 KerbsideID
  const sql = `
    ${baseSelect()}
    AND COALESCE(NULLIF(s.KerbsideID,''), b.KerbsideID) = ?
    ORDER BY ${tsExpr()} DESC
    LIMIT 1
  `;
  const [rows] = await pool.query(sql, [bayId]);
  return rows.length ? mapParkingRow(rows[0]) : null;
}

async function getHistoryByBay(bayId, { start, end, limit = 5000 } = {}) {
  const lim = Number.isFinite(limit) ? Math.max(1, Math.min(100000, limit)) : 5000;
  const pair = parsePseudoId(bayId);

  if (pair) {
    const eps = 0.000005;
    let sql = `
      SELECT * FROM (
        ${baseSelect()}
      ) t
      WHERE t.lat BETWEEN ? AND ?
        AND t.lon BETWEEN ? AND ?
    `;
    const params = [
      Number((pair.lat - eps).toFixed(6)),
      Number((pair.lat + eps).toFixed(6)),
      Number((pair.lon - eps).toFixed(6)),
      Number((pair.lon + eps).toFixed(6)),
    ];
    if (start) { sql += ` AND STR_TO_DATE(SUBSTRING_INDEX(t.lastupdated,'+',1),'%Y-%m-%dT%H:%i:%s') >= ?`; params.push(start); }
    if (end) { sql += ` AND STR_TO_DATE(SUBSTRING_INDEX(t.lastupdated,'+',1),'%Y-%m-%dT%H:%i:%s') <= ?`; params.push(end); }
    sql += ` ORDER BY STR_TO_DATE(SUBSTRING_INDEX(t.lastupdated,'+',1),'%Y-%m-%dT%H:%i:%s') ASC LIMIT ${lim}`;
    const [rows] = await pool.query(sql, params);
    return rows.map(mapParkingRow);
  }

  // 真实 KerbsideID
  let sql = `
    ${baseSelect()}
    AND COALESCE(NULLIF(s.KerbsideID,''), b.KerbsideID) = ?
  `;
  const params = [bayId];
  if (start) { sql += ` AND ${tsExpr()} >= ?`; params.push(start); }
  if (end) { sql += ` AND ${tsExpr()} <= ?`; params.push(end); }
  sql += ` ORDER BY ${tsExpr()} ASC LIMIT ${lim}`;
  const [rows] = await pool.query(sql, params);
  return rows.map(mapParkingRow);
}

/* ========= 时间窗 ========= */
async function getRange(start, end, { limit = 100000 } = {}) {
  const lim = Number.isFinite(limit) ? Math.max(1, Math.min(200000, limit)) : 100000;
  let sql = `${baseSelect()}`;
  const params = [];
  if (start) { sql += ` AND ${tsExpr()} >= ?`; params.push(start); }
  if (end) { sql += ` AND ${tsExpr()} <= ?`; params.push(end); }
  sql += ` ORDER BY ${tsExpr()} ASC LIMIT ${lim}`;
  const [rows] = await pool.query(sql, params);
  return rows.map(mapParkingRow);
}


/* ===================================================================================
 * 实时版（精简）：只取最新 limit 条（默认 2000），不做距离过滤
 * 来源：LIVE_PARKING_API_URL（可用参数 url 覆盖），LIVE_PARKING_API_TOKEN 可选
 * 返回结构与 mapParkingRow 一致：{ bayId, unoccupied, occupied, lat, lon, lastupdated, timestamp }
 * =================================================================================== */
// 兼容 Socrata(/resource) 和 Explore v2.1(/api/explore/v2.1/.../records)
// 自动分页直到拿到 limit 条（默认 2000）

// 统一从记录里取经纬度：字段优先，否则从 Location 或 Status_Description 文本里扒
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

// ===== 覆盖后的 fetchLiveLatest（统一用 extractLatLon） =====
async function fetchLiveLatest({ limit = 2000, url, token } = {}) {
  const endpoint = url || process.env.LIVE_PARKING_API_URL;
  if (!endpoint) throw new Error("LIVE_PARKING_API_URL 未配置，且未通过参数提供 url");

  const headers = token ? { "X-App-Token": token } : undefined;

  // 从多个备选字段取值
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
 * B. 其它保留的辅助
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

/* ========= 摄取相关（no-op） ========= */
const ingestLog = [];
function pushIngestLog(entry) { ingestLog.push({ time: new Date().toISOString(), ...entry }); if (ingestLog.length > 100) ingestLog.shift(); }
function getIngestLog() { return ingestLog; }
async function ingestOnce() { pushIngestLog({ inserted: 0, tookMs: 0, reason: "no-op" }); return { inserted: 0, tookMs: 0 }; }
async function ensureFreshIngest({ ttlSec = 90 } = {}) { return await ingestOnce(); }
cron.schedule("*/5 * * * *", async () => { try { const ret = await ingestOnce(); console.log(`⏱ CRON: 插入 ${ret.inserted} 行`); } catch (e) { console.error("CRON 失败：", e.message); } });

/* ===================================================================================
 * C. AC 指标
 * =================================================================================== */
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
  // 停车
  fetchOnce,
  fetchAllForDate,
  getLatestByBay,
  getHistoryByBay,
  getRange,

  // 健康/调试
  dbPing,
  describeSensorTable,
  countSensors,
  maxLastupdated,
  sampleSensors,
  rawMinMaxCount,
  getIngestLog,

  // 摄取（no-op）
  ingestOnce,
  ensureFreshIngest,

  // 指标
  metricsCbdPopulation,
  metricsCarOwnership,
  // 新增：实时直连，最新 N 条
  fetchLiveLatest,
};
