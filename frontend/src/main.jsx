import React, { Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import App from "./App.jsx";

// #nisar opens the researcher view; it loads on demand so the main page's first load stays small.
const NisarView = lazy(() => import("./components/NisarView.jsx"));

function Root() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => { setHash(window.location.hash); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  if (hash === "#nisar") {
    return <Suspense fallback={<div className="loading" role="status">Loading the NISAR diagnostics…</div>}><NisarView /></Suspense>;
  }
  return <App />;
}

createRoot(document.getElementById("root")).render(<Root />);
