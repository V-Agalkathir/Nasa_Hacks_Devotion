export default function AboutModal({ onClose }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body" onClick={(e) => e.stopPropagation()}>
        <h2>About this data</h2>
        <ul>
          <li><b>What it shows:</b> how much the ground moved each summer as permafrost thaws, measured by satellite radar (InSAR).</li>
          <li><b>Resolution:</b> neighbourhood/block scale (tens of metres), not individual houses. Flagged areas mean "inspect on the ground".</li>
          <li><b>Accuracy:</b> centimetre-scale per season.</li>
          <li><b>Season:</b> June–September only. Snow and frozen ground block the measurement.</li>
          <li><b>"Lower-risk ground"</b> is not a guarantee of foundation safety.</li>
          <li><b>Data:</b> NASA-ISRO NISAR (2026), ESA Sentinel-1 via ASF HyP3 (history). Imagery © Esri.</li>
          <li>Community knowledge belongs to the Hamlet of Tuktoyaktuk and the Inuvialuit. This tool supports, not replaces, their decisions.</li>
        </ul>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
