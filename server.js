"use strict";
const express = require("express");
const cors = require("cors");
const handler = require("./handler");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/* ------------ 哈弗辛距离（米） ------------ */
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
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

// AC 1.1：车辆/千人（Victoria 基于 DB）
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

/* ===================== 停车（数据库解析坐标版） ===================== */

// 实时：只读最新 N 条（默认 2000），不做 near/radius 过滤
app.get("/api/parking", async (req, res) => {
  try {
    const limit = Number(req.query.limit || 2000);
    const data = await handler.fetchLiveLatest({ limit });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "Server error", detail: e.message });
  }
});





// 历史
app.get("/api/parking-history", async (req, res) => {
  try {
    const { start, end, date } = req.query;
    if (date) return res.json(await handler.fetchAllForDate(date));
    res.json(await handler.getRange(start, end));
  } catch (e) {
    res.status(500).json({ error: "Server error", detail: e.message });
  }
});

// 平均空位率（按日）——DB 无状态字段，这里只给模板（返回 0/1 比例会无意义），保留接口不强依赖
app.get("/api/vacancy-stats", async (req, res) => {
  try {
    const { start, end } = req.query;
    const data = await handler.getRange(start, end);
    const grouped = {};
    data.forEach((e) => {
      const d = (e.lastupdated || "").slice(0, 10);
      (grouped[d] ||= []).push(e.unoccupied === true); // 一律 false/null
    });
    const result = Object.entries(grouped).map(([date, list]) => {
      const vacancyRate = list.filter(Boolean).length / list.length;
      return { date, averageVacancyRate: Number(vacancyRate.toFixed(3)) };
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "Server error", detail: e.message });
  }
});

// 单 bay（KerbsideID 基本为 NULL，这里保留接口）
app.get("/api/bays/:bayId", async (req, res) => {
  try {
    const item = await handler.getLatestByBay(req.params.bayId);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: "Server error", detail: e.message });
  }
});

app.get("/api/bays/:bayId/history", async (req, res) => {
  try {
    const { start, end } = req.query;
    const data = await handler.getHistoryByBay(req.params.bayId, { start, end });
    const series = data.map((d) => ({
      timestamp: d.lastupdated,
      occupiedPercent: d.unoccupied ? 0 : 100,
      unoccupied: d.unoccupied,
    }));
    res.json(series);
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
