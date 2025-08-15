import "./DataInsight.css";


export default function DataInsight({ sources }) {
  const defaultSources = [
    {
      title: "ABS Motor Vehicle Census — Methodology (31 Jan 2021)",
      desc:
        "Methodology behind vehicle counts & ownership indicators (definitions, scope, collection).",
      href:
        "https://www.abs.gov.au/methodologies/motor-vehicle-census-australia-methodology/31-jan-2021",
    },
    {
      title: "ABS Regional Population (2021)",
      desc:
        "Regional population estimates used for CBD trends & per-capita comparisons.",
      href:
        "https://www.abs.gov.au/statistics/people/population/regional-population/2021",
    },
  ];

  const rows = Array.isArray(sources) && sources.length ? sources : defaultSources;

  return (
    <div className="ds-table-wrapper">
      <table className="ds-table" role="table">
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">What it covers</th>
            <th scope="col">Link</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={i}>
              <td>{s.title}</td>
              <td>{s.desc}</td>
              <td>
                <a
                  className="ds-link"
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
