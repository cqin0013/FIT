"use strict";
const express = require("express");
const cors = require("cors");
const handler = require("./handler");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // 允许前端跨域访问
app.use(express.json());

/* ---------------------------
 * 工具函数：哈弗辛距离（米）
 * --------------------------- */
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

/* ============================================================
 *  A. 指标类接口（模拟数据）—— 用于 AC 1.1 / AC 1.2
 *  你可以以后把这里换成真实的 ABS / VicRoads 数据
 * ============================================================ */

// 模拟：每千人私家车注册量（2011–2021）
function genCarOwnershipSeries(fromYear = 2011, toYear = 2021) {
  const out = [];
  let base = 320; // 2011 基准（每千人），纯模拟
  for (let y = fromYear; y <= toYear; y++) {
    // 简单的缓慢上升 + 轻微波动
    const value = Math.round((base + (y - fromYear) * 3 + (y % 3) - 1));
    out.push({ year: y, value });
  }
  return out;
}

// 模拟：CBD(SA2) 常住人口（2001–2021）
function genCbdPopulationSeries(fromYear = 2001, toYear = 2021) {
  const out = [];
  let base = 9500; // 2001 基准人口，纯模拟
  for (let y = fromYear; y <= toYear; y++) {
    // 随年份增长（含轻微波动）
    const growth = 600 * Math.sin(y) + (y - fromYear) * 1200;
    const population = Math.max(0, Math.round(base + growth));
    out.push({ year: y, population });
  }
  return out;
}

// AC 1.1
app.get("/api/metrics/car-ownership", (req, res) => {
  const from = Number(req.query.from || 2011);
  const to = Number(req.query.to || 2021);
  const series = genCarOwnershipSeries(from, to);
  res.json({
    title: "Car Ownership per 1,000 residents (City of Melbourne)",
    unit: "vehicles / 1,000 residents",
    source: "Mock data (replace with VicRoads/ABS)",
    series,
  });
});

// AC 1.2
app.get("/api/metrics/cbd-population", (req, res) => {
  const from = Number(req.query.from || 2001);
  const to = Number(req.query.to || 2021);
  const series = genCbdPopulationSeries(from, to);
  res.json({
    title: "Melbourne CBD (SA2) Resident Population",
    unit: "persons",
    source: "Mock data (replace with ABS SA2)",
    series,
  });
});

/* ============================================================
 *  B. 停车实时/历史接口（基于内存缓存）
 *  覆盖 AC 2.1 / 2.2 / 2.3
 * ============================================================ */

// ✅ 实时数据：当前最新抓取的一批数据
// 扩展：支持 ?near=lat,lon&radius=米&onlyAvailable=true
app.get("/api/parking", async (req, res) => {
  try {
    const latest = await handler.fetchOnce(); // 拉一批并缓存
    let out = latest;

    // 仅可用
    if (req.query.onlyAvailable === "true") {
      out = out.filter((r) => r.unoccupied);
    }

    // 半径筛选
    const { near, radius } = req.query;
    if (near && radius) {
      const [lat, lon] = near.split(",").map(Number);
      const r = Number(radius);
      out = out.filter((p) => haversine(p.lat, p.lon, lat, lon) <= r);
    }

    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ 历史数据（全量或带时间过滤）
app.get("/api/parking-history", (req, res) => {
  const { start, end } = req.query;
  let data = handler.getHistory();
  if (start || end) {
    data = data.filter(
      (e) =>
        (!start || e.timestamp >= start) && (!end || e.timestamp <= end)
    );
  }
  res.json(data);
});

// ✅ 平均空位率（日期聚合，支持时间过滤）
app.get("/api/vacancy-stats", (req, res) => {
  const { start, end } = req.query;
  const data = handler.getHistory().filter(
    (e) =>
      (!start || e.timestamp >= start) && (!end || e.timestamp <= end)
  );

  const grouped = {};
  data.forEach((e) => {
    const date = e.timestamp.split("T")[0];
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(e.unoccupied);
  });

  const result = Object.entries(grouped).map(([date, list]) => {
    const vacancyRate = list.filter((v) => v).length / list.length;
    return { date, averageVacancyRate: Number(vacancyRate.toFixed(3)) };
  });

  res.json(result);
});

/* ---------------------------
 *  bay 维度接口
 * --------------------------- */

// 当前状态（最新一条）
app.get("/api/bays/:bayId", (req, res) => {
  const item = handler.getLatestByBay(req.params.bayId);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});

// 历史序列（用于画折线图）
app.get("/api/bays/:bayId/history", (req, res) => {
  const { start, end } = req.query;
  const data = handler.getHistoryByBay(req.params.bayId, { start, end });
  // 也可附带百分比，便于前端直接绘制
  const series = data.map((d) => ({
    timestamp: d.timestamp,
    occupiedPercent: d.unoccupied ? 0 : 100,
    unoccupied: d.unoccupied,
  }));
  res.json(series);
});

// 统计：近 N 天平均可用率（默认 365 天）
app.get("/api/bays/:bayId/stats", (req, res) => {
  const days = Number(req.query.days || 365);
  const start = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const data = handler.getHistoryByBay(req.params.bayId, { start });
  const rate = data.length
    ? data.filter((d) => d.unoccupied).length / data.length
    : 0;
  res.json({
    bayId: req.params.bayId,
    days,
    averageAvailability: Number(rate.toFixed(3)),
    samples: data.length,
  });
});

/* --------------------------- */

app.listen(PORT, () => {
  console.log(`🚗 Server is running at http://localhost:${PORT}`);
});



app.get('/api/debug/cache', (req, res) => {
  const all = handler.getHistory();
  const has = all.some(x => String(x.bayId) === '61711');
  res.json({
    total: all.length,
    has61711: has,
    sample: all.slice(-10) // 最后10条
  });
});