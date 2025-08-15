import SearchProvider from "./SearchProvider.jsx";
import MapSearch from "./MapSearch/MapSearch";
import BayInfo from "./BayInfo/BayInfo";
import "./SearchPage.css"; 

export default function SearchPage() {
  return (
    <SearchProvider>
      <main className="searchpage">
        <MapSearch />
        <BayInfo />
      </main>
    </SearchProvider>
  );
}
