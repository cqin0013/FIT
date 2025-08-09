"use strict";
const fetch = require("node-fetch");
const cron = require("node-cron");

// 内存中的历史缓存（未来可换成数据库）
let historyCache = [];

// 每5分钟定时抓取数据（追加到内存）
cron.schedule("*/5 * * * *", () => {
  console.log("⏱ 每5分钟自动抓取数据...");
  fetchAndStore(); // 不返回结果，只抓取并缓存
});

// 提供给其他模块/路由的导出
module.exports = {
  // 兼容你原有的 /api/parking 实时读取
  read: async function (_event, _context, callback) {
    try {
      const results = await fetchAndStore();
      callback(null, results);
    } catch (err) {
      callback(err, null);
    }
  },

  // 导出历史缓存（全量）
  getHistory: function () {
    return historyCache;
  },

  // 新增：只抓一次并返回（供 /api/parking 带筛选时使用）
  fetchOnce: async function () {
    return await fetchAndStore();
  },

  // 按 bayId 获取最新一条
  getLatestByBay: function (bayId) {
    for (let i = historyCache.length - 1; i >= 0; i--) {
      if (String(historyCache[i].bayId) === String(bayId)) return historyCache[i];
    }
    return null;
  },

  // 按 bayId + 时间范围获取历史
  getHistoryByBay: function (bayId, { start, end } = {}) {
    return historyCache.filter(e =>
      String(e.bayId) === String(bayId) &&
      (!start || e.timestamp >= start) &&
      (!end || e.timestamp <= end)
    );
  }
};
// 抓取数据并缓存历史记录
async function fetchAndStore() {
  try {
    const res = await fetch(
      "https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-parking-bay-sensors/records?limit=100&order_by=lastupdated%20DESC"
    );

    const json = await res.json();

    if (!json.results || !Array.isArray(json.results)) {
      console.error("❌ Invalid API response structure: `results` not found.");
      return [];
    }

    console.log("✅ Fetched", json.results.length, "records.");

    const timestamp = new Date().toISOString();

    // 统一结构
    const enhanced = json.results
      .filter((r) => r.kerbsideid && r.location?.lat && r.location?.lon)
      .map((r) => ({
        bayId: r.kerbsideid,
        unoccupied: r.status_description === "Unoccupied",
        lat: parseFloat(r.location.lat),
        lon: parseFloat(r.location.lon),
        timestamp,
      }));

    // 追加进缓存
    historyCache.push(...enhanced);

    return enhanced;
  } catch (err) {
    console.error("❌ Fetch error:", err);
    return [];
  }
}
