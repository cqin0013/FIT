import { Link } from "react-router-dom";
import "./Hero.css";
import heroBg from "../../../assets/images/Parking.jpg";

export default function Hero() {
  return (
    <section
      className="hero"
      style={{
        backgroundImage:
          `linear-gradient(180deg, rgba(5,7,11,.65) 0%, rgba(5,7,11,.35) 40%, rgba(5,7,11,.75) 100%), url(${heroBg})`,
      }}
      aria-label="Intro section with call-to-action"
    >
      <div className="hero-inner">
        <h1 className="hero-title">Find Parking Smarter</h1>
        <p className="hero-sub">
          Live map search, historical availability and lightweight predictions — all in one place.
        </p>
        <div className="hero-cta">
          <Link to="/search" className="btn btn-primary">Start Searching</Link>
          <Link to="/Insight" className="btn btn-primary">See Insights</Link>
        </div>
      </div>
    </section>
  );
}
