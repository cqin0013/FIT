// fetches and normalizes data based on the type, then uses Chart.js to draw a small line chart on a <canvas> and wraps the whole thing in a <Link> so clicking opens the detail page.
import { useEffect, useRef, useState } from "react";
import { Chart } from "chart.js/auto";
import { Link } from "react-router-dom";

const API_BASE = "https://fit-8mtq.onrender.com";

export default function ChartThumb({ type, title, sub, to }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  const [labels, setLabels] = useState([]);
  const [values, setValues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // 1) get data
  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        setErr("");
        setLabels([]);
        setValues([]);

        const url =
          type === "ownership"
            ? `${API_BASE}/api/metrics/car-ownership`
            : `${API_BASE}/api/metrics/cbd-population`;

        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!alive) return;

        setLabels(j.series.map((s) => String(s.year)));
        setValues(
          type === "ownership"
            ? j.series.map((s) => Number(s.value))
            : j.series.map((s) => Number(s.population))
        );
      } catch {
        if (alive) setErr("Failed to load preview.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [type]);

  // 2) graph
  useEffect(() => {
    if (loading) return;
    if (!canvasRef.current) return;
    if (labels.length === 0 || values.length === 0) return;
    if (chartRef.current) chartRef.current.destroy();

    const id = requestAnimationFrame(() => {
      chartRef.current = new Chart(canvasRef.current, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              data: values,
              borderColor: type === "ownership" ? "#6366f1" : "#22c55e",
              backgroundColor:
                type === "ownership"
                  ? "rgba(99,102,241,.12)"
                  : "rgba(34,197,94,.12)",
              tension: 0.35,
              pointRadius: 0,
              borderWidth: 2,
              fill: true,
            },
          ],
        },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false, 
          plugins: { legend: { display: false } },
          scales: { x: { display: false }, y: { display: false } },
        },
      });
    });

    return () => {
      cancelAnimationFrame(id);
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [loading, labels, values, type]);

  return (
    <Link to={to} className="img-card" aria-label={`Open ${title}`}>
      <div className="thumb-canvas-wrap">
        <canvas ref={canvasRef} className="thumb-canvas" />
        {(loading || err) && (
          <div className="thumb-skeleton">{err || "Loading…"}</div>
        )}
      </div>

      <div className="img-overlay">
        <h3 className="img-title">{title}</h3>
        <p className="img-sub">{sub}</p>
      </div>
    </Link>
  );
}
