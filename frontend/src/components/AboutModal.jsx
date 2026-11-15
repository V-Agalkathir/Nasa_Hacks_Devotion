import { useEffect, useRef } from "react";

export default function AboutModal({ onClose }) {
  const closeBtn = useRef(null);
  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="about-title">About this data</h2>
        <ul>
          <li><b>What it shows:</b> how much the ground moved each summer as permafrost thaws, measured by satellite radar (InSAR).</li>
          <li><b>Resolution:</b> neighbourhood/block scale (tens of metres), not individual houses. Flagged areas mean "inspect on the ground".</li>
          <li><b>Accuracy:</b> centimetre-scale per season.</li>
          <li><b>Season:</b> June–September only. Snow and frozen ground block the measurement.</li>
          <li><b>"Lower-risk ground"</b> is not a guarantee of foundation safety.</li>
          <li>Community knowledge belongs to the Hamlet of Tuktoyaktuk and the Inuvialuit. This tool supports, not replaces, their decisions.</li>
        </ul>
        <h3>Data credits</h3>
        <ul className="credits">
          <li>NASA-ISRO NISAR L-band data, via the Alaska Satellite Facility (ASF DAAC).</li>
          <li>Contains modified Copernicus Sentinel data, processed with ASF HyP3.</li>
          <li>Imagery © Esri (World Imagery basemap).</li>
          <li>Map rendering: MapLibre GL JS.</li>
        </ul>
        <small>Add credits here as each new dataset is used (ECCC/PCIC climate, PGC ArcticDEM, NRCan air photos, © OpenStreetMap contributors, CHS water levels "not for navigation").</small>
        <div className="modal-actions"><button ref={closeBtn} onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
