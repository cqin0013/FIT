import { useState } from "react";
import { NavLink, Link } from "react-router-dom";
import "./Header.css";

export default function Header() {
  const [open, setOpen] = useState(false); // mobile menu button

  return (
    <header className="header">
      <div className="row">
        <div className="brand">
          <span className="badge">TE17</span>
          <div>
            <h1 className="title">Melbourne CBD Parking Finder</h1>
            <p className="sub">Availability, history & guidance</p>
          </div>
        </div>

        {/* mobile nav button*/}
        <button className="menu-btn" onClick={() => setOpen(!open)}>☰</button>
        <nav className={`nav ${open ? "show" : ""}`}>
          <ul className="menu" onClick={() => setOpen(false)}>
            <li><NavLink to="/"          className={({isActive}) => "nav-link" + (isActive ? " active" : "")}>Home</NavLink></li>
            <li><NavLink to="/search"    className={({isActive}) => "nav-link" + (isActive ? " active" : "")}>Search</NavLink></li>
            <li><NavLink to="/insight"   className={({isActive}) => "nav-link" + (isActive ? " active" : "")}>Insights</NavLink></li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
