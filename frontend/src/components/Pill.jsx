import { TIER, STATUS } from "../lib/data.js";

const PILLS = {
  measured: { label: "Measured", cls: "pill-measured", title: "From satellite or survey data" },
  predicted: { label: "Predicted", cls: "pill-predicted", title: "Model output, tested on unseen data" },
  demo: { label: "Demo", cls: "pill-demo", title: "Simulated for the demo" },
  untested: { label: "Unconfirmed", cls: "pill-untested", title: "The year-to-year radar test failed, so treat this as unconfirmed" },
};

export function Pill({ kind }) {
  const p = PILLS[kind] ?? PILLS.measured;
  return <span className={`pill ${p.cls}`} title={p.title}>{p.label}</span>;
}

export function TierBadge({ tier }) {
  const t = TIER[tier] ?? TIER.not_enough_data;
  return (
    <span className={`tier ${tier === "not_enough_data" ? "tier-na" : ""}`} style={{ background: t.color, color: t.text }}>
      {t.label} risk
    </span>
  );
}

export function StatusPill({ status }) {
  const s = STATUS[status] ?? STATUS.not_available;
  return <span className={`status ${s.cls}`}>{s.label}</span>;
}
