// src/App.jsx
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import MainLayout from "./layouts/MainLayout";

import Home from "./pages/Home/Home.jsx";
import SearchPage from "./pages/Search/SearchPage.jsx";
import Insight from "./pages/Insight/Insight.jsx";
import InsightChart from "./pages/Insight/InsightChart/InsightChart.jsx";

import "./App.css";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route element={<MainLayout />}>
          <Route index element={<Home />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="insight" element={<Insight />} />
          <Route path="insight/:type" element={<InsightChart />} />
        </Route>
      </Routes>
    </Router>
  );
}
