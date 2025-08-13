"use strict";
const express = require("express");
const cors = require("cors");
const handler = require("./handler");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/* ------------ 小工具：解析查询参数 ------------ */
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

/* ===================== 仅保留的接口 ===================== */

// 1) 表结构（调试）
app.get("/api/db/describe", async (_req, res) => {
  try {
    res.json(await handler.describeSensorTable());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2) AC 1.1：车辆/千人
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

// 3) AC 1.2：CBD 人口
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

// 4) AC 2.1：附近车位（支持 onlyAvailable / near / radius / limit）
app.get("/api/parking", async (req, res) => {
  try {
    const onlyAvailable = toBool(req.query.onlyAvailable, false);
    const near = parseLatLonCsv(req.query.near);
    // 只要给了 near，就给个默认半径 300m；否则走普通列表
    const radius = near ? Number(req.query.radius || 300) : null;
    const limit = Math.max(1, Math.min(20000, Number(req.query.limit || 2000)));

    const rows = await handler.fetchOnce({ limit, onlyAvailable, near, radius });
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Server error", detail: e.message });
  }
});

// 5) AC 2.2：点击某个 Bay（当前状态）
app.get("/api/bays/:bayId", async (req, res) => {
  try {
    const item = await handler.getLatestByBay(req.params.bayId, { enrichWithDb: false });
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: "Server error", detail: e.message });
  }
});

// 6) 采样（调试）
app.get("/api/db/sample/sensors", async (req, res) => {
  try {
    const limit = Number(req.query.limit || 10);
    res.json(await handler.sampleSensors(limit));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ===================== 启动 ===================== */
app.listen(PORT, () => {
  console.log(`🚗 Server is running at http://localhost:${PORT}`);
});
