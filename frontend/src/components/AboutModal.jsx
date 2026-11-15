import { useEffect, useRef } from "react";

export default function AboutModal({ manifest, validation, onClose }) {
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
        <h2 id="about-title">About Ground Check</h2>
        <p>Tuktoyaktuk is choosing where to rebuild on permafrost. Cores describe single points. Ground Check gives the area-wide view from open satellite data and says where the next core would tell the most.</p>
        <ul>
          <li><b>Block scale:</b> radar pixels are 80 m. Results describe areas of land, not houses.</li>
          <li><b>Thaw season only:</b> June to September. Snow blocks the measurement.</li>
          <li><b>Relative motion:</b> numbers are compared with the airport's gravel pad, which may itself settle.</li>
          <li><b>"Lower-risk ground"</b> is not a guarantee of foundation safety. This is a screen, not a sign-off.</li>
          <li>Community knowledge belongs to the Hamlet of Tuktoyaktuk and the Inuvialuit. This tool supports their decisions; it doesn't replace them.</li>
        </ul>
        <h3>What we don't predict</h3>
        <ul>{(validation?.what_we_dont_predict ?? []).map((x) => <li key={x}>{x}</li>)}</ul>
        <h3>Data credits</h3>
        <ul className="credits">
          {(manifest.credits ?? []).map((c) => <li key={c}>{c}</li>)}
          <li>Imagery © Esri (World Imagery basemap). Map rendering: MapLibre GL JS.</li>
        </ul>
        <p className="small muted">Data generated {manifest.generated_at}. Pass/fail thresholds frozen at git tag {validation?.prereg_tag}.</p>
        <div className="modal-actions"><button ref={closeBtn} onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
