import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Chart } from "chart.js/auto";
import "./InsightChart.css";

const API_BASE = "https://fit-8mtq.onrender.com";

export default function InsightChart() {
  const { type } = useParams();                 
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  const [labels, setLabels] = useState([]);
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const url =
          type === "ownership"
            ? `${API_BASE}/api/metrics/car-ownership`
            : `${API_BASE}/api/metrics/cbd-population`;
        const r = await fetch(url);
        if (!r.ok) throw new Error("HTTP error");
        const json = await r.json();

        if (!alive) return;
        if (type === "ownership") {
          setLabels(json.series.map((s) => String(s.year)));
          setSeries(json.series.map((s) => Number(s.value)));
        } else {
          setLabels(json.series.map((s) => String(s.year)));
          setSeries(json.series.map((s) => Number(s.population)));
        }
        setErr("");
      } catch {
        setErr("Failed to load data.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, [type]);

  useEffect(() => {
    if (!canvasRef.current || labels.length === 0) return;
    if (chartRef.current) chartRef.current.destroy();

    const isOwnership = type === "ownership";
    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: isOwnership
            ? "Passenger vehicles per 1,000 residents"
            : "CBD resident population",
          data: series,
          borderColor: isOwnership ? "#6366f1" : "#22c55e",
          backgroundColor: isOwnership ? "rgba(99,102,241,.12)" : "rgba(34,197,94,.12)",
          fill: true,
          tension: 0.35,
          pointRadius: 2
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: true, position: "bottom" } },
        scales: {
          x: { title: { display: true, text: "Year" } },
          y: {
            title: { display: true, text: isOwnership ? "per 1,000 residents" : "people" },
            beginAtZero: !isOwnership
          }
        }
      }
    });

    return () => chartRef.current?.destroy();
  }, [labels, series, type]);

  return (
    <main className="insight-chart-page">
      <div className="insight-chart-wrap">
        <div className="insight-actions">
          <Link to="/insight" className="insight-btn">
            Back to list
          </Link>
        </div>

        <h1 className="insight-title">
          {type === "ownership" ? "Car Ownership Growth" : "CBD Population Growth"}
        </h1>

        {loading && <p className="insight-note">Loading…</p>}
        {err && <p className="insight-note insight-error">{err}</p>}

        <canvas ref={canvasRef} className="insight-canvas" />
      </div>
    </main>
  );
}
