import { useEffect, useMemo, useState } from "react";
import { useSearch } from "../SearchProvider.jsx";
import { fetchBayPastOccupied } from "../../../services/parkingAPI";
import { deriveBayTexts, timeAgo, formatBayName } from "../../../logics/deriveBayTexts";
import "./BayInfo.css";

export default function BayInfo() {
  const { selectedBay } = useSearch(); // { bayId, lat, lng, rtAvailable, timestamp }
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const bayId = selectedBay?.bayId ?? null;

  useEffect(() => {
    setDetail(null);
    setErr("");
    if (!bayId) return;

    let alive = true;
    setLoading(true);

    fetchBayPastOccupied(bayId)
      .then((d) => { if (alive) setDetail(d); })
      .catch(() => alive && setErr("Failed to load bay detail."))
      .finally(() => alive && setLoading(false));

    return () => { alive = false; };
  }, [bayId]);

  const { availability, history, prediction } = useMemo(() => {
    return deriveBayTexts({
      rtAvailable: selectedBay?.rtAvailable ?? null,
      pastOccupied: detail?.pastOccupied ?? null,
    });
  }, [selectedBay, detail]);

  const noSelection = !selectedBay;

  return (
    <section className="bayinfo">
      <h3 className="bayinfo__title">Bay Info</h3>

      {noSelection ? (
        <>
          <div className="bayinfo__name bayinfo__muted">e.g. 12345 bay</div>

          <div className="bayinfo__badges">
            <Badge label="Availability" value="— " tone="muted" />
            <Badge label="Prediction"  value="— " tone="muted" />
            <Badge label="History"     value="—" tone="muted" />
            <span className="bayinfo__updated">Updated —</span>
          </div>

        </>
      ) : (
        <>
          <div className="bayinfo__name">{formatBayName(selectedBay.bayId)}</div>

          <div className="bayinfo__badges">
            <Badge
              label="Availability"
              value={availability ?? "—"}
              tone={availability === "available" ? "ok" : availability === "unavailable" ? "danger" : "muted"}
            />
            <Badge
              label="Prediction"
              value={prediction}
              tone={prediction?.toLowerCase().includes("unavail") ? "danger" : prediction ? "ok" : "muted"}
            />
            {history && (
              <Badge
                label="History"
                value={history}
                tone={history.includes("occupied") ? "danger" : "ok"}
              />
            )}
            <span className="bayinfo__updated">
              {selectedBay.timestamp ? `Updated ${timeAgo(selectedBay.timestamp)}` : "Updated —"}
            </span>
          </div>

          {loading && <p className="bayinfo__placeholder">Loading…</p>}
          {err && <p className="bayinfo__placeholder" style={{ color: "#b45309" }}>{err}</p>}
        </>
      )}
    </section>
  );
}

function Badge({ label, value, tone = "muted" }) {
  return (
    <span className={`bayinfo-badge bayinfo-badge--${tone}`}>
      <strong>{label}:</strong>&nbsp;{value}
    </span>
  );
}
