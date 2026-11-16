// First-load popup: how to use the tool. "I understand" closes it for the rest of the visit.
import { useEffect, useRef } from "react";

export default function Welcome({ onClose }) {
  const btn = useRef(null);
  useEffect(() => {
    btn.current?.focus();
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <div className="gk-scrim">
      <div className="gk-dlg gk-welcome" role="dialog" aria-modal="true" aria-labelledby="gk-welcome-h" aria-describedby="gk-welcome-lead">
        <h2 id="gk-welcome-h">How to use Ground Check</h2>
        <p id="gk-welcome-lead">Find land near Tuktoyaktuk that fits the rules you choose. Nothing is ranked or recommended: the choice stays with you.</p>
        <ol className="gk-steps">
          <li><b>Set your rules.</b> Move the sliders for height above sea, distance from shore and distance to the highway. “More rules” adds storm flood, distance to town, lakes, radar and place size; each has an on/off switch.</li>
          <li><b>Watch the map.</b> Dark blue land fits every rule and is listed with a letter. Mid blue fits but is too small to list. Hatched land floods in the chosen storm.</li>
          <li><b>Open a place.</b> Tap a letter on the map or a row in the list to see its facts. Point at any square to read its values.</li>
          <li><b>Go further.</b> Use the switch at the top: <b>Advanced</b> has every fact, side-by-side comparison and a printable summary; <b>Research</b> shows how good the NISAR radar data is.</li>
        </ol>
        <p className="gk-wnote">On a phone, use the Places and Rules tabs under the map. Every place still needs a drilled core before anything is built. A student prototype, not endorsed by the Hamlet of Tuktoyaktuk.</p>
        <button type="button" className="gk-btn gk-btn-pri gk-wbtn" ref={btn} onClick={onClose}>I understand</button>
      </div>
    </div>
  );
}
