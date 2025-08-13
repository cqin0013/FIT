"use strict";
const mysql = require("mysql2/promise");

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

/* ========= 表名 ========= */
const WRANGLE_TABLE = "city_data.wrangle_sensor_bay_data"; // 快照
const SENSORS_RAW   = "city_data.stg_bay_sensors_raw";     // 历史

// 可选富化 / 指标
const BAYS_TABLE    = "city_data.stg_parking_bays_raw";
const ABS_PLACE     = "city_data.stg_abs_place_wide";
const ABS_VIC       = "city_data.stg_abs_vic_wide";
const ABS_CHANGE    = "city_data.stg_abs_state_change_raw";

/* ========= 小工具 ========= */
function toNum(x){ if(x==null) return null; const n=Number(String(x).replace(/[, ]/g,"")); return Number.isFinite(n)?n:null; }
const r6 = x => Number(x).toFixed(6);
function parseLastupdated(ts){ if(!ts) return null; const base=String(ts).split("+")[0].trim(); const d=new Date(base.replace("T"," ")+"Z"); return isNaN(d.getTime())?null:d; }
function firstOf(obj,keys){ for(const k of keys){ const v=obj?.[k]; if(v!==undefined && v!==null && String(v).trim()!=="") return v; } return null; }
function normalizeUnoccupied(raw){
  if(raw==null) return null;
  const t=String(raw).trim().toLowerCase();
  if(!t) return null;
  if(t.includes("unoccupied")||t.includes("free")||t.includes("vacant")) return true;
  if(t.includes("present")||t.includes("occupied")) return false;
  return null;
}

/* —— 经纬度提取 —— */
function extractLatLon(r){
  let lat=null, lon=null;
  const loc = r.location ?? r.Location;
  if(typeof loc==="string"){
    const m = loc.match(/-?\d+(?:\.\d+)?/g) || [];
    if(m.length>=2){ lat=Number(m[0]); lon=Number(m[1]); }
  }else if(typeof loc==="object" && loc){
    lat = Number(loc.lat ?? loc.latitude ?? null);
    lon = Number(loc.lon ?? loc.longitude ?? null);
  }
  if((lat==null||lon==null) && (r.status_description||r.Status_Description)){
    const s=String(r.status_description ?? r.Status_Description);
    const m=s.match(/-?\d+(?:\.\d+)?/g)||[];
    if(m.length>=2){ lat=Number(m[0]); lon=Number(m[1]); }
  }
  if((lat==null||lon==null) && (r.lat_parsed!=null || r.lon_parsed!=null)){
    if(r.lat_parsed!=null) lat=Number(r.lat_parsed);
    if(r.lon_parsed!=null) lon=Number(r.lon_parsed);
  }
  return {
    lat: lat!=null && isFinite(Number(lat)) ? Number(lat) : null,
    lon: lon!=null && isFinite(Number(lon)) ? Number(lon) : null,
  };
}

/* —— 从 Location 文本提数（加 TRIM） —— */
const LAT_FROM_LOC = `CAST(TRIM(SUBSTRING_INDEX(Location, ',', 1)) AS DECIMAL(12,6))`;
const LON_FROM_LOC = `CAST(TRIM(SUBSTRING_INDEX(Location, ',', -1)) AS DECIMAL(13,6))`;
const LAT_ANY = `COALESCE(${LAT_FROM_LOC}, CAST(TRIM(SUBSTRING_INDEX(Status_Description, ',', 1)) AS DECIMAL(12,6)))`;
const LON_ANY = `COALESCE(${LON_FROM_LOC}, CAST(TRIM(SUBSTRING_INDEX(Status_Description, ',', -1)) AS DECIMAL(13,6)))`;

/* —— Haversine 距离表达式（把 lat/lon 数值内联，避免 HAVING/LIMIT 占位符问题） —— */
function haversineExprInline(LAT, LON, latExpr = LAT_FROM_LOC, lonExpr = LON_FROM_LOC){
  return `
    2 * 6371000 * ASIN(
      SQRT(
        POWER(SIN(RADIANS(${latExpr} - ${LAT})/2), 2) +
        COS(RADIANS(${LAT})) * COS(RADIANS(${latExpr})) *
        POWER(SIN(RADIANS(${lonExpr} - ${LON})/2), 2)
      )
    )
  `;
}

/* ========= 统一输出结构 ========= */
function rowToRecord(r){
  const {lat,lon} = extractLatLon(r);
  const statusCandidate = firstOf(r, ["status_description","zone_number","Status","status","Status_Description","Zone_Number"]);
  const unocc = normalizeUnoccupied(statusCandidate);
  const out = {
    bayId: String(r.kerbsideid ?? r.KerbsideID ?? r.bayId ?? (lat!=null && lon!=null ? `${r6(lat)},${r6(lon)}` : "")),
    unoccupied: unocc,
    occupied: unocc==null ? null : !unocc,
    lat, lon,
    lastupdated: r.lastupdated ?? r.Lastupdated ?? null,
    timestamp: new Date().toISOString(),
  };
  if(r.distance_m != null) out.distance_m = Number(r.distance_m);
  return out;
}

/* ===================================================================================
 * 快照（wrangle）—— 当前状态 + 可选范围筛选（SQL 下推）
 * =================================================================================== */
async function fetchOnce({ limit=2000, onlyAvailable=false, near=null, radius=null, enrichWithDb=false } = {}){
  if(near && Number.isFinite(Number(near.lat)) && Number.isFinite(Number(near.lon)) && Number.isFinite(Number(radius))){
    return fetchNearby({
      lat: Number(near.lat),
      lon: Number(near.lon),
      radius: Number(radius) || 300,
      onlyAvailable: !!onlyAvailable,
      limit: Number.isFinite(limit) ? Math.max(1, Math.min(10000, limit)) : 2000,
      enrichWithDb,
    });
  }

  const lim = Number.isFinite(limit) ? Math.max(1, Math.min(10000, limit)) : 2000;
  const where = onlyAvailable
    ? `WHERE (LOWER(Status_Description) LIKE '%unoccupied%' OR LOWER(Status_Description) LIKE '%free%' OR LOWER(Status_Description) LIKE '%vacant%')`
    : "";

  const [rows] = await pool.query(
    `
    SELECT
      KerbsideID AS kerbsideid,
      Status_Description AS status_description,
      Location,
      ${LAT_FROM_LOC} AS lat_parsed,
      ${LON_FROM_LOC} AS lon_parsed
    FROM ${WRANGLE_TABLE}
    ${where}
    ORDER BY KerbsideID ASC
    LIMIT ?
    `,
    [lim]
  );

  let out = rows.map(rowToRecord);
  if(enrichWithDb && out.length){
    const metas = await getBayMetaMapByKerbsideIds(out.map(x=>x.bayId));
    out = mergeBayMeta(out, metas);
  }
  return out;
}

/* —— 附近（SQL 距离在 WHERE 里筛选 + 距离升序） —— */
async function fetchNearby({ lat, lon, radius=300, onlyAvailable=false, limit=2000, enrichWithDb=false } = {}){
  if(!Number.isFinite(lat) || !Number.isFinite(lon)) return [];

  const LAT = Number(lat);
  const LON = Number(lon);
  const RAD = Number.isFinite(Number(radius)) ? Math.max(1, Number(radius)) : 300;
  const LIM = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(10000, Number(limit))) : 2000;

  const statusFilter = onlyAvailable
    ? "AND (LOWER(Status_Description) LIKE '%unoccupied%' OR LOWER(Status_Description) LIKE '%free%' OR LOWER(Status_Description) LIKE '%vacant%')"
    : "";

  const distExpr = haversineExprInline(LAT, LON, LAT_FROM_LOC, LON_FROM_LOC);

  const sql = `
    SELECT
      KerbsideID AS kerbsideid,
      Status_Description AS status_description,
      Location,
      ${LAT_FROM_LOC} AS lat_parsed,
      ${LON_FROM_LOC} AS lon_parsed,
      ${distExpr} AS distance_m
    FROM ${WRANGLE_TABLE}
    WHERE ${distExpr} <= ${RAD}
    ${statusFilter}
    ORDER BY distance_m ASC
    LIMIT ${LIM}
  `;

  const [rows] = await pool.query(sql);

  let out = rows.map(rowToRecord);
  if(enrichWithDb && out.length){
    const metas = await getBayMetaMapByKerbsideIds(out.map(x=>x.bayId));
    out = mergeBayMeta(out, metas);
  }
  return out;
}

/* ===================================================================================
 * 历史（sensors_raw）—— 单 bay / 时间窗 / 范围
 * =================================================================================== */
async function getLatestByBay(bayId, { enrichWithDb=false } = {}){
  const [w] = await pool.query(
    `
    SELECT KerbsideID AS kerbsideid, Status_Description AS status_description, Location,
           ${LAT_FROM_LOC} AS lat_parsed, ${LON_FROM_LOC} AS lon_parsed
    FROM ${WRANGLE_TABLE}
    WHERE KerbsideID = ?
    LIMIT 1
    `,
    [String(bayId)]
  );
  if(w.length){
    let rec = rowToRecord(w[0]);
    if(enrichWithDb && rec.bayId){
      const metas = await getBayMetaMapByKerbsideIds([rec.bayId]);
      rec = mergeBayMeta([rec], metas)[0];
    }
    return rec;
  }

  const [rows] = await pool.query(
    `
    SELECT
      KerbsideID AS kerbsideid,
      Zone_Number AS zone_number,
      Status_Description AS status_description,
      Location,
      Lastupdated AS lastupdated,
      ${LAT_ANY} AS lat_parsed,
      ${LON_ANY} AS lon_parsed
    FROM ${SENSORS_RAW}
    WHERE KerbsideID = ?
    ORDER BY STR_TO_DATE(SUBSTRING_INDEX(Lastupdated, '+', 1), '%Y-%m-%dT%H:%i:%s') DESC
    LIMIT 1
    `,
    [String(bayId)]
  );
  if(!rows.length) return null;

  let rec = rowToRecord(rows[0]);
  if(enrichWithDb && rec.bayId){
    const metas = await getBayMetaMapByKerbsideIds([rec.bayId]);
    rec = mergeBayMeta([rec], metas)[0];
  }
  return rec;
}

async function getHistoryByBay(bayId, { start, end, limit=5000, enrichWithDb=false } = {}){
  const lim = Number.isFinite(limit) ? Math.max(1, Math.min(100000, limit)) : 5000;

  const timeFilter = [];
  const params = [String(bayId)];
  if(start){ timeFilter.push(`STR_TO_DATE(SUBSTRING_INDEX(Lastupdated, '+', 1), '%Y-%m-%dT%H:%i:%s') >= STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s')`); params.push(String(start).replace("T"," ").split("+")[0]); }
  if(end){   timeFilter.push(`STR_TO_DATE(SUBSTRING_INDEX(Lastupdated, '+', 1), '%Y-%m-%dT%H:%i:%s') <= STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s')`);   params.push(String(end).replace("T"," ").split("+")[0]); }
  const timeSql = timeFilter.length ? `AND ${timeFilter.join(" AND ")}` : "";

  const [rows] = await pool.query(
    `
    SELECT
      KerbsideID AS kerbsideid,
      Zone_Number AS zone_number,
      Status_Description AS status_description,
      Location,
      Lastupdated AS lastupdated,
      ${LAT_ANY} AS lat_parsed,
      ${LON_ANY} AS lon_parsed
    FROM ${SENSORS_RAW}
    WHERE KerbsideID = ?
      ${timeSql}
    ORDER BY STR_TO_DATE(SUBSTRING_INDEX(Lastupdated, '+', 1), '%Y-%m-%dT%H:%i:%s') ASC
    LIMIT ${lim}
    `,
    params
  );

  let out = rows.map(rowToRecord);
  if(enrichWithDb && out.length){
    const metas = await getBayMetaMapByKerbsideIds(out.map(x=>x.bayId));
    out = mergeBayMeta(out, metas);
  }
  return out;
}

async function getRange(start, end, { limit=100000, bbox, onlyKnown=true, enrichWithDb=false } = {}){
  const lim = Number.isFinite(limit) ? Math.max(1, Math.min(200000, limit)) : 100000;

  const where = [];
  const params = [];

  if(start){ where.push(`STR_TO_DATE(SUBSTRING_INDEX(Lastupdated, '+', 1), '%Y-%m-%dT%H:%i:%s') >= STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s')`); params.push(String(start).replace("T"," ").split("+")[0]); }
  if(end){   where.push(`STR_TO_DATE(SUBSTRING_INDEX(Lastupdated, '+', 1), '%Y-%m-%dT%H:%i:%s') <= STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s')`);   params.push(String(end).replace("T"," ").split("+")[0]); }

  if(bbox && [bbox.minLat,bbox.maxLat,bbox.minLon,bbox.maxLon].every(v=>typeof v==="number")){
    where.push(`${LAT_ANY} BETWEEN ? AND ?`);
    where.push(`${LON_ANY} BETWEEN ? AND ?`);
    params.push(bbox.minLat,bbox.maxLat,bbox.minLon,bbox.maxLon);
  }else if(onlyKnown){
    where.push(`(Location REGEXP '^-?[0-9]+(\\.[0-9]+)?,\\s*-?[0-9]+(\\.[0-9]+)?$' OR Status_Description REGEXP '^-?[0-9]+(\\.[0-9]+)?,\\s*-?[0-9]+(\\.[0-9]+)?$')`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [rows] = await pool.query(
    `
    SELECT
      KerbsideID AS kerbsideid,
      Zone_Number AS zone_number,
      Status_Description AS status_description,
      Location,
      Lastupdated AS lastupdated,
      ${LAT_ANY} AS lat_parsed,
      ${LON_ANY} AS lon_parsed
    FROM ${SENSORS_RAW}
    ${whereSql}
    ORDER BY STR_TO_DATE(SUBSTRING_INDEX(Lastupdated, '+', 1), '%Y-%m-%dT%H:%i:%s') ASC
    LIMIT ${lim}
    `,
    params
  );

  let out = rows.map(rowToRecord);
  if(enrichWithDb && out.length){
    const metas = await getBayMetaMapByKerbsideIds(out.map(x=>x.bayId));
    out = mergeBayMeta(out, metas);
  }
  return out;
}

/* ========= 富化 ========= */
async function getBayMetaMapByKerbsideIds(ids = []){
  const realIds=[...new Set(ids.filter(id=>id))];
  if(!realIds.length) return new Map();
  const placeholders=realIds.map(()=>"?").join(",");
  const [rows]=await pool.query(
    `
    SELECT KerbsideID, Latitude, Longitude, RoadSegmentID
    FROM ${BAYS_TABLE}
    WHERE KerbsideID IN (${placeholders})
    `,
    realIds
  );
  const m=new Map();
  for(const r of rows){
    const id=String(r.KerbsideID);
    m.set(id,{ kerbsideId:id, lat:r.Latitude!=null?Number(r.Latitude):null, lon:r.Longitude!=null?Number(r.Longitude):null, roadSegmentId:r.RoadSegmentID!=null?Number(r.RoadSegmentID):null });
  }
  return m;
}
function mergeBayMeta(rows=[], metaMap=new Map()){
  return rows.map(r=>({ ...r, meta: (r?.bayId ? metaMap.get(String(r.bayId)) : null) || null }));
}

/* ========= 健康/调试 & ABS 指标 ========= */
async function dbPing(){ const [r]=await pool.query("SELECT 1 AS ok"); return r[0].ok===1; }
async function describeSensorTable(){
  const [rows]=await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name IN (?, ?)
    ORDER BY table_name, ordinal_position
  `,[WRANGLE_TABLE.split(".").pop(), SENSORS_RAW.split(".").pop()]);
  return rows;
}
async function countSensors(){ const [r]=await pool.query(`SELECT COUNT(*) AS c FROM ${SENSORS_RAW}`); return Number(r[0].c||0); }
async function maxLastupdated(){ const [r]=await pool.query(`SELECT MAX(Lastupdated) AS m FROM ${SENSORS_RAW}`); return r[0].m||null; }
async function sampleSensors(limit=10){
  const lim=Number.isFinite(limit)?Math.max(1,Math.min(2000,limit)):10;
  const [rows]=await pool.query(`
    SELECT KerbsideID AS kerbsideid, Zone_Number AS zone_number, Status_Description AS status_description, Lastupdated AS lastupdated, Location
    FROM ${SENSORS_RAW}
    ORDER BY STR_TO_DATE(SUBSTRING_INDEX(Lastupdated, '+', 1), '%Y-%m-%dT%H:%i:%s') DESC
    LIMIT ${lim};
  `);
  return rows;
}
async function rawMinMaxCount(){
  const [r1]=await pool.query(`SELECT COUNT(*) AS c FROM ${SENSORS_RAW}`);
  const [r2]=await pool.query(`SELECT MIN(Lastupdated) AS minlu, MAX(Lastupdated) AS maxlu FROM ${SENSORS_RAW}`);
  return { count:Number(r1[0].c||0), minLastupdated:r2[0].minlu||null, maxLastupdated:r2[0].maxlu||null };
}

/* ========= ABS 指标 ========= */
async function metricsCbdPopulation({ from=2001, to=2021, place="Melbourne City" } = {}){
  const years=[]; for(let y=Number(from); y<=Number(to); y++) years.push(y);
  const yCols=years.map(y=>`y${y}`);
  let row=null;
  for(const col of ["sa3_name","sa4_name","gccsa_name"]){
    const [r]=await pool.query(`SELECT ${yCols.join(", ")} FROM ${ABS_PLACE} WHERE ${col} = ? LIMIT 1`,[place]);
    if(r.length){ row=r[0]; break; }
  }
  if(!row){
    const [r]=await pool.query(
      `SELECT ${yCols.join(", ")} FROM ${ABS_PLACE}
       WHERE sa3_name LIKE '%Melbourne%' OR sa4_name LIKE '%Melbourne%' OR gccsa_name LIKE '%Melbourne%'
       LIMIT 1`
    );
    if(r.length) row=r[0];
  }
  const series=row ? years.map(y=>({year:y, population:toNum(row[`y${y}`])})).filter(d=>d.population!=null):[];
  return { title:"Melbourne CBD Resident Population", unit:"persons", source:`${ABS_PLACE}`, series };
}
async function metricsCarOwnership({ from=2016, to=2021 } = {}){
  const years=[]; for(let y=Number(from); y<=Number(to); y++) years.push(y);
  const yCols=years.map(y=>`y${y}`);
  const [vicRows]=await pool.query(`SELECT ${yCols.join(", ")} FROM ${ABS_VIC} WHERE state_name='Victoria' LIMIT 1`);
  const vic=vicRows.length ? vicRows[0] : null;
  const [chg]=await pool.query(
    `SELECT period_end AS year, change_count
     FROM ${ABS_CHANGE}
     WHERE state_code='VIC' AND period_end BETWEEN ? AND ?
     ORDER BY period_end ASC`,
    [years[0], years[years.length-1]]
  );
  const byYear=new Map(chg.map(r=>[Number(r.year), Number(r.change_count)]));
  const series=[];
  for(const y of years){
    const pop = vic ? toNum(vic[`y${y}`]) : null;
    const delta = byYear.get(y);
    if(pop && delta!=null) series.push({ year:y, value:Number(((delta/pop)*1000).toFixed(3)) });
  }
  return { title:"Vehicles change per 1,000 residents (Victoria)", unit:"vehicles / 1,000 residents", source:`${ABS_CHANGE} + ${ABS_VIC}`, series };
}

/* ========= 导出 ========= */
module.exports = {
  fetchOnce,
  fetchNearby,
  getLatestByBay,
  getHistoryByBay,
  getRange,
  getBayMetaMapByKerbsideIds,
  mergeBayMeta,
  dbPing,
  describeSensorTable,
  countSensors,
  maxLastupdated,
  sampleSensors,
  rawMinMaxCount,
  metricsCbdPopulation,
  metricsCarOwnership,
};
