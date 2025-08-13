"use strict";
const express = require("express");
const cors = require("cors");
const handler = require("./handler");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/* ------------ 参数解析小工具 ------------ */
function parseLatLonCsv(s) {
  if (!s) return null;
  const m = String(s).match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  return { lat: Number(m[1]), lon: Number(m[2]) };
}
function toBool(v, def = false) {
  if (v === undefined || v === null || v === "") return def;
  const t = String(v).toLowerCase();
  return t === "1" || t === "true" || t === "yes";
}

/* ===================== 健康检查 ===================== */
app.get("/api/db-test", async (_req, res) => {
  try {
    const ok = await handler.dbPing();
    res.json({ ok });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ===================== AC 1.1 / AC 1.2（数据库） ===================== */

// AC 1.1：车辆/千人（Victoria）
app.get("/api/metrics/car-ownership", async (req, res) => {
  try {
    const from = Number(req.query.from || 2016);
    const to = Number(req.query.to || 2021);
    const out = await handler.metricsCarOwnership({ from, to });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// AC 1.2：CBD 人口（place 默认 'Melbourne City'）
app.get("/api/metrics/cbd-population", async (req, res) => {
  try {
    const from = Number(req.query.from || 2001);
    const to = Number(req.query.to || 2021);
    const place = (req.query.place || "Melbourne City").trim();
    const out = await handler.metricsCbdPopulation({ from, to, place });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ===================== AC 2.1 / AC 2.2 停车（快照 & 历史） ===================== */

/**
 * AC 2.1：/api/parking
 * 支持：
 *   - onlyAvailable=true|false
 *   - near=lat,lon
 *   - radius=米（默认 300）
 *   - limit=条数（默认 2000）
 *
 * 数据源：handler.fetchOnce()（已在 handler 内部用 SQL 哈弗辛做范围过滤）
 */
app.get("/api/parking", async (req, res) => {
  try {
    const onlyAvailable = toBool(req.query.onlyAvailable, false);
    const near = parseLatLonCsv(req.query.near);          // e.g. "-37.81,144.96"
    const radius = req.query.radius != null ? Number(req.query.radius) : null; // meters
    const limit = Math.max(1, Math.min(20000, Number(req.query.limit || 2000)));

    const rows = await handler.fetchOnce({
      limit,
      onlyAvailable,
      near,     // 传给 handler：有 near+radius 时会在 SQL 中返回 distance_m 并按距离筛选/排序
      radius
    });

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Server error", detail: e.message });
  }
});

/**
 * AC 2.2：/api/bays/:bayId —— 点击某个 Bay（当前状态）
 * 优先 wrangle 快照，回退 sensors_raw 最新记录
 */
app.get("/api/bays/:bayId", async (req, res) => {
  try {
    const item = await handler.getLatestByBay(req.params.bayId, { enrichWithDb: false });
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: "Server error", detail: e.message });
  }
});

/* ========== 历史接口（可用于 AC 2.3：Bay 的过去占用情况） ========== */

// /api/bays/:bayId/history?start=YYYY-MM-DD HH:mm:ss&end=YYYY-MM-DD HH:mm:ss
app.get("/api/bays/:bayId/history", async (req, res) => {
  try {
    const { start, end, limit } = req.query;
    const data = await handler.getHistoryByBay(req.params.bayId, {
      start, end, limit: Number(limit || 5000), enrichWithDb: false
    });
    const series = data.map(d => ({
      timestamp: d.lastupdated,
      occupiedPercent: d.unoccupied === true ? 0 : 100,
      unoccupied: d.unoccupied,
      lat: d.lat, lon: d.lon,
    }));
    res.json(series);
  } catch (e) {
    res.status(500).json({ error: "Server error", detail: e.message });
  }
});

/**
 * （保留）/api/parking-history
 * - 兼容旧调用：?date=YYYY-MM-DD  -> 自动转为 start/end
 * - 或直接传 ?start=...&end=...
 * 数据源：sensors_raw（历史）
 */
app.get("/api/parking-history", async (req, res) => {
  try {
    let { start, end, date, limit } = req.query;
    if (date && !start && !end) {
      const d = String(date).slice(0, 10);
      start = `${d} 00:00:00`;
      end = `${d} 23:59:59`;
    }
    const out = await handler.getRange(start || null, end || null, {
      limit: Number(limit || 100000),
      onlyKnown: true,
      enrichWithDb: false
    });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "Server error", detail: e.message });
  }
});

/* ===================== 调试接口（可留） ===================== */
app.get("/api/db/sample/sensors", async (req, res) => {
  try {
    const limit = Number(req.query.limit || 10);
    res.json(await handler.sampleSensors(limit));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/db/describe", async (_req, res) => {
  try {
    res.json(await handler.describeSensorTable());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/db/raw-max", async (_req, res) => {
  try {
    res.json(await handler.rawMinMaxCount());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ===================== 启动 ===================== */
app.listen(PORT, () => {
  console.log(`🚗 Server is running at http://localhost:${PORT}`);
});
