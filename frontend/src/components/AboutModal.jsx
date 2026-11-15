import { useEffect, useRef } from "react";

export default function AboutModal({ manifest, onClose }) {
  const closeBtn = useRef(null);
  const body = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    closeBtn.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {      // simple focus trap
        const f = body.current.querySelectorAll("button, a[href]");
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onClose]);

  return (
    <div className="modal" onClick={onClose}>
      <div ref={body} className="modal-body" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="about-title">About Ground Check</h2>
        <p>Free radar from Sentinel-1 (2021–2025) and NISAR (2026) was tested for whether it can tell stable from degrading ground around Tuktoyaktuk. At 80 m it can't yet: relative to the airport gravel pad, almost all land moves within about 1 cm per summer, and the patterns didn't repeat between years.</p>
        <p>What the screen does use is measured directly: height above sea, distance to the 2025 shoreline, measured shoreline change, wetness and distance to the highway. Select land, set what you need, and the check returns a second-move risk tier with its drivers. It never gives a percentage or names a best site.</p>
        <p>Squares that meet all five needs, with nothing flagged by radar, are marked promising, unconfirmed.</p>
        <p>Community knowledge belongs to the Hamlet of Tuktoyaktuk and the Inuvialuit. This tool supports their decisions; it doesn't replace them.</p>
        <h3>Data credits</h3>
        <ul className="credits">
          {(manifest.credits ?? []).map((c) => <li key={c}>{c}</li>)}
          <li>Landsat (USGS) and Sentinel-2 waterlines</li>
          <li>Imagery © Esri (World Imagery basemap). Map rendering: MapLibre GL JS.</li>
        </ul>
        <div className="modal-actions"><button ref={closeBtn} onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
