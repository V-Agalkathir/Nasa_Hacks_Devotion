import React, { Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

// Views: #simple, #advanced (default) and #nisar (Research). Research loads on demand so the first load stays small.
const NisarView = lazy(() => import("./components/NisarView.jsx"));

function Root() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => { setHash(window.location.hash); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  if (hash === "#nisar") {
    return <Suspense fallback={<div className="gk"><div className="gk-wait" role="status"><p>Loading the NISAR view…</p></div></div>}><NisarView /></Suspense>;
  }
  // #simple and #advanced share one App, so rules and the open place carry over between them
  return <App view={hash === "#simple" ? "simple" : "advanced"} />;
}

createRoot(document.getElementById("root")).render(<Root />);
