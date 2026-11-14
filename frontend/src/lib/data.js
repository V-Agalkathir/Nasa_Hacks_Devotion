// All data comes from /public/data — see DATA CONTRACT in the root README.
const base = "./data/";
const get = (f) => fetch(base + f).then((r) => r.json());

export async function loadAll() {
  const manifest = await get("manifest.json");
  const [zones, timeseries] = await Promise.all([get(manifest.zones), get(manifest.timeseries)]);
  return { manifest, zones, timeseries, base };
}

// Simple, explainable risk label from cumulative summer subsidence (cm). Tune with the team.
export function riskLabel(meanCm) {
  if (meanCm == null) return { label: "No data", color: "#888" };
  if (meanCm > -3) return { label: "Lower-risk ground", color: "#4b7bec" };
  if (meanCm > -6) return { label: "Moderate", color: "#f7b731" };
  return { label: "Higher risk — inspect on the ground", color: "#e67e22" };
}
