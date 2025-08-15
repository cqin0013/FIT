import "./Insight.css";
import ChartThumb from "./ChartThumb";
import DataInsight from "./DataInsight/DataInsight";

export default function Insight() {
  return (
    <main className="insight-page">
      <div className="insight-wrap">
        <header className="insight-header">
          <h1>Insights</h1>
          <p>Preview the charts below. Tap a card to view the full chart.</p>
        </header>

        <section className="insight-gallery" aria-label="Insight previews">
          <ChartThumb
            type="ownership"
            title="Car ownership"
            sub="Passenger vehicles per 1,000 residents."
            to="/insight/ownership"
          />
          <ChartThumb
            type="population"
            title="CBD population"
            sub="Resident population in Melbourne CBD."
            to="/insight/population"
          />
        </section>

        <h2 className="insight-subheading">Data sources</h2>
        <DataInsight />
      </div>
    </main>
  );
}
