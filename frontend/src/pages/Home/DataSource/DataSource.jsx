import "./DataSource.css";

export default function DataSource() {
  return (
    <main className="data-source-page">
      <header className="data-source-header">
        <h1 className="ds-title">Data Sources</h1>
        <p className="ds-sub">
          Explore the official data sources powering our parking availability features.
        </p>
      </header>

      <section className="data-source-card" aria-label="External data sources">
        <div className="data-source-list">
          <a
            href="https://data.melbourne.vic.gov.au/explore/dataset/on-street-parking-bay-sensors/information/"
            target="_blank"
            rel="noopener noreferrer"
            className="data-source-item"
          >
            <h3>Melbourne Parking Bay Sensor Data</h3>
            <p>Real-time and historical on-street parking bay sensor data.</p>
          </a>

          <a
            href="https://www.melbourne.vic.gov.au/where-to-park#:~:text=Find%20out%20where%20to%20park%20in%20the%20City,for%20short%20stays%20of%20up%20to%20two%20hours."
            target="_blank"
            rel="noopener noreferrer"
            className="data-source-item"
          >
            <h3>City of Melbourne Parking Information</h3>
            <p>Official info about where to park in the City of Melbourne.</p>
          </a>
        </div>
      </section>
    </main>
  );
}
