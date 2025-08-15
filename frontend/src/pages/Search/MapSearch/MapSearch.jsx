import { useEffect, useRef, useState } from "react";
import { Loader } from "@googlemaps/js-api-loader";
import { fetchAvailableBays } from "../../../services/parkingAPI";
import { useSearch } from "../SearchProvider";
import "./MapSearch.css";

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

export default function MapSearch() {

  const { selectedBay, setSelectedBay, clearSelectedBay } = useSearch();
  const [bays, setBays] = useState([]);                  // current bay list in panel
  const [loadingMap, setLoadingMap] = useState(true);    // true until Google Map is ready
  const [fetching, setFetching] = useState(false);       // true while /api/parking is in-flight
  const [error, setError] = useState("");                // backend error message
  const [radius, setRadius] = useState(300);             // search radius (meters)
  const [onlyAvailable, setOnlyAvailable] = useState(false); // filter: only show available bays
  const [showOnlySelected, setShowOnlySelected] = useState(false); // focus mode: show only selected bay
  const mapRef = useRef(null);       // google.maps.Map instance
  const destRef = useRef(null);      // destination {lat,lng} from Autocomplete
  const markersRef = useRef([]);     // active google.maps.Marker[] on the map

  const defaultCenter = { lat: -37.8136, lng: 144.9631 }; // Melbourne

  useEffect(() => {
    if (showOnlySelected && !selectedBay) setShowOnlySelected(false);
  }, [showOnlySelected, selectedBay]);

  useEffect(() => {
    const loader = new Loader({
      apiKey: GOOGLE_MAPS_API_KEY,
      version: "beta",             
      libraries: ["places"],
      language: "en",
    });

    loader.load().then((google) => {
      if (mapRef.current) return;

      // 1) Map
      const el = document.getElementById("map");
      if (!el) return;

      const map = new google.maps.Map(el, {
        center: defaultCenter,
        zoom: 14,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      mapRef.current = map;

      // 2) Places Autocomplete on the input
      const input = document.getElementById("search-box");
      const ac = new google.maps.places.Autocomplete(input, {
        fields: ["geometry", "name", "place_id"],
      });

      // When a place is picked, center to it + request nearby bays.
      ac.addListener("place_changed", async () => {
        const p = ac.getPlace();
        if (!p?.geometry?.location) return;
        const loc = p.geometry.location;
        const dest = { lat: loc.lat(), lng: loc.lng() };
        destRef.current = dest;

        clearSelectedBay();         // clear previous selection
        await loadBays(dest);       // fetch + plot new markers
      });

      setLoadingMap(false);
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remove all current markers from the map.
  const clearMarkers = () => {
    markersRef.current.forEach((m) => (m.setMap ? m.setMap(null) : (m.map = null)));
    markersRef.current = [];
  };

  // Select a bay => update global selection + enter focus mode.
  const selectBay = (b) => {
    setSelectedBay(b);
    setShowOnlySelected(true); // focus to the selected one
  };

  // Add a marker with optional click handler.
  // NOTE: google.maps.Marker shows a deprecation warning; AdvancedMarkerElement is the modern API.
  const addMarker = (position, title, onClick) => {
    const google = window.google;
    const map = mapRef.current;
    if (!google || !map) return null;

    const marker = new google.maps.Marker({ map, position, title });
    if (typeof onClick === "function") marker.addListener("click", onClick);
    markersRef.current.push(marker);
    return marker;
  };

  // Draw destination marker + bay markers, then fit bounds.
  const drawMarkers = (list) => {
    const google = window.google;
    const map = mapRef.current;
    const dest = destRef.current;
    if (!google || !map || !dest) return;

    clearMarkers();

    // Destination
    addMarker(dest, "Search destination");

    // Bay markers (click => select & enter focus mode)
    list.forEach((b) => {
      addMarker({ lat: b.lat, lng: b.lng }, `${b.bayId} bay`, () => selectBay(b));
    });

    // Fit bounds to destination + bays
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(new google.maps.LatLng(dest.lat, dest.lng));
    list.forEach((b) => bounds.extend(new google.maps.LatLng(b.lat, b.lng)));
    if (!bounds.isEmpty()) map.fitBounds(bounds);
  };

  useEffect(() => {
    if (!destRef.current) return;
    const filtered =
      showOnlySelected && selectedBay
        ? bays.filter((b) => b.bayId === selectedBay.bayId)
        : bays;
    drawMarkers(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOnlySelected, selectedBay]);

  async function loadBays(dest, forceOnlyAvailable = onlyAvailable) {
    if (!dest) {
      // No destination yet: clear UI quietly.
      setBays([]);
      setError("");
      clearMarkers();
      return;
    }

    setFetching(true);
    setError("");

    try {
      const list = await fetchAvailableBays({
        lat: dest.lat,
        lng: dest.lng,
        radius,
        onlyAvailable: forceOnlyAvailable,
      });

      // Backend may filter when onlyAvailable=true, but ensure on client too.
      const finalList = forceOnlyAvailable ? list.filter((b) => b.rtAvailable === true) : list;
      setBays(finalList);

      // If current selection disappeared from the results, clear it.
      if (selectedBay && !finalList.some((b) => b.bayId === selectedBay.bayId)) {
        clearSelectedBay();
      }

      // Respect focus mode when drawing markers.
      const toRender =
        showOnlySelected && selectedBay
          ? finalList.filter((b) => b.bayId === selectedBay.bayId)
          : finalList;

      drawMarkers(toRender);
    } catch {
      setError("Backend unavailable.");
      clearMarkers();
    } finally {
      setFetching(false);
    }
  }


  const hasDestination = !!destRef.current;
  const visibleBays =
    showOnlySelected && selectedBay
      ? bays.filter((b) => b.bayId === selectedBay.bayId)
      : bays;

  return (
    <div className="search-page">
      {/* Toolbar: search input + radius slider + refresh */}
      <div className="search-toolbar" style={{ gap: 12 }}>
        {/* Autocomplete binds to this input in the effect above */}
        <input
          id="search-box"
          type="text"
          placeholder="Search for a location"
          aria-label="Search for a destination"
          className="search-box"
        />

        {/* Radius slider (300–1000m) */}
        <div className="radius-control" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label htmlFor="radius" style={{ whiteSpace: "nowrap" }}>
            Radius
          </label>
          <input
            id="radius"
            type="range"
            min={300}
            max={1000}
            step={50}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            aria-label="Search radius in meters"
          />
          <span style={{ width: 60, textAlign: "right" }}>{radius} m</span>
        </div>

        {/* Manual refresh (disabled until map + destination are ready) */}
        <button
          onClick={() => loadBays(destRef.current)}
          disabled={loadingMap || fetching || !hasDestination}
          className="refresh-btn"
        >
          {fetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Map loader / backend error */}
      {(loadingMap || error) && (
        <div className={`notice ${error ? "error" : ""}`}>
          {loadingMap ? "Loading map…" : error}
        </div>
      )}

      {/* Map canvas target */}
      <div id="map" className="map" />

      {/* Bays panel (list + filters) */}
      <div className="panel">
        <div className="panel-head">
          <h3 className="panel-title">
            {onlyAvailable ? "Available Parking Bays" : "Parking Bays"}
          </h3>

          {hasDestination && (
            <span className="count-badge">
              {visibleBays.length} result{visibleBays.length !== 1 ? "s" : ""} (±{radius}m)
            </span>
          )}

          {/* Only-available filter (re-fetch when toggled) */}
          <label className="toggle-only-available" style={{ marginLeft: "auto" }}>
            <input
              type="checkbox"
              checked={onlyAvailable}
              onChange={async (e) => {
                const checked = e.target.checked;
                setOnlyAvailable(checked);
                if (destRef.current) await loadBays(destRef.current, checked);
              }}
            />
            <span style={{ marginLeft: 6 }}>Only available</span>
          </label>

          {/* Focus mode: Show all (turn off "show only selected") */}
          <button
            className={`solo-btn ${showOnlySelected ? "active" : ""}`}
            onClick={() => setShowOnlySelected(false)}
            disabled={!showOnlySelected}
            title={showOnlySelected ? "Show all bays" : "Select a bay to focus"}
            style={{ marginLeft: 8 }}
          >
            Show all bays
          </button>
        </div>

        {/* Empty states / loading / list */}
        {!hasDestination ? (
          <div className="muted">Please enter a location.</div>
        ) : fetching && bays.length === 0 ? (
          <div className="muted">Loading nearby bays…</div>
        ) : visibleBays.length === 0 ? (
          <div className="muted">No parking bays.</div>
        ) : (
          <div className="bay-grid">
            {visibleBays.map((b) => {
              const active = selectedBay?.bayId === b.bayId;
              return (
                <button
                  key={b.bayId}
                  onClick={() => selectBay(b)}
                  className={`bay-card ${active ? "active" : ""}`}
                  title={`${b.bayId} bay`}
                >
                  {b.bayId} bay
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
