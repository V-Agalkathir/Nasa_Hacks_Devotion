// Sources: every dataset and method the tool and the NISAR view rely on, with links.
// Shown inside both "About the data" dialogs.

const DATA = [
  ["Height", "Natural Resources Canada, High Resolution Digital Elevation Model (HRDEM, built from ArcticDEM), via the NRCan Data Cube", null],
  ["Lakes and wet ground", "European Commission JRC Global Surface Water v1.4, 1984–2021 (Pekel et al. 2016)", "https://global-surface-water.appspot.com/"],
  ["Highway, roads, town outlines", "© OpenStreetMap contributors", "https://www.openstreetmap.org/copyright"],
  ["Shorelines, 1985–2025", "Landsat (USGS) and Sentinel-2 (Copernicus) imagery, via Microsoft Planetary Computer", "https://planetarycomputer.microsoft.com/"],
  ["Sentinel-1 radar", "Copernicus Sentinel-1 (ESA), interferograms made with ASF HyP3", "https://hyp3-docs.asf.alaska.edu/"],
  ["NISAR radar", "NASA–ISRO NISAR Level-2 GUNW products, via the ASF DAAC", "https://nisar-docs.asf.alaska.edu/"],
  ["NISAR data schedule", "ASF NISAR availability overview", "https://nisar-docs.asf.alaska.edu/availability-overview/"],
  ["Air temperature", "Environment and Climate Change Canada, daily climate data for the Tuktoyaktuk stations", "https://api.weather.gc.ca/"],
  ["Boreholes", "NWT Permafrost Database (NWT Geological Survey): highway drilling 2013, NWT Open Report 2019-014", "https://doi.org/10.46887/2019-014"],
  ["Boreholes", "NWT Permafrost Database: highway embankment drilling 2017, NWT Open Report 2019-016", "https://doi.org/10.46887/2019-016"],
  ["Storm-surge levels", "Baird (2019), Tuktoyaktuk Coastal Erosion Study for the GNWT, as published by Future Tuktoyaktuk", "https://futuretuktoyaktuk.org/flooding"],
  ["Residents’ site criteria", "Nuna Community Voices report (February 2025), 21 interviews", "https://myleneriva.ca/wp-content/uploads/2025/03/Nuna-Interviews_-Report-_-Digital-FINAL.pdf"],
];

const METHODS = [
  ["Rules (pass only if all are met)", "Boolean overlay in GIS suitability analysis: Malczewski (2004)", "https://doi.org/10.1016/j.progress.2003.09.002"],
  ["Storm flood: connected to the sea", "Poulter & Halpin (2008)", "https://doi.org/10.1080/13658810701371858"],
  ["Storm flood: computing it", "Priority-Flood algorithm: Barnes, Lehman & Mulla (2014)", "https://doi.org/10.1016/j.cageo.2013.04.024"],
  ["Radar time series", "Small-baseline (SBAS) approach: Berardino et al. (2002)", "https://doi.org/10.1109/TGRS.2002.803792"],
  ["Radar basics", "Hanssen (2001), Radar Interferometry: Data Interpretation and Error Analysis", null],
  ["Thaw settlement model", "Stefan relation, as used for InSAR over permafrost: Liu et al. (2010)", null],
  ["Shoreline change", "USGS Digital Shoreline Analysis System v5: Himmelstoss et al. (2018)", "https://doi.org/10.3133/ofr20181179"],
  ["Checks: skill score", "Murphy (1988)", "https://doi.org/10.1175/1520-0493(1988)116%3C2417:SSBOTM%3E2.0.CO;2"],
];

const Row = ({ r }) => (
  <li><b>{r[0]}:</b> {r[2] ? <a href={r[2]} target="_blank" rel="noreferrer">{r[1]}</a> : r[1]}</li>
);

export default function Sources() {
  return (
    <section className="gk-src" id="gk-sources" aria-labelledby="gk-src-h">
      <h3 id="gk-src-h">Sources</h3>
      <div className="gk-src-cols">
        <div><h4>Data</h4><ul>{DATA.map((r, i) => <Row key={"d" + i} r={r} />)}</ul></div>
        <div><h4>Methods</h4><ul>{METHODS.map((r, i) => <Row key={"m" + i} r={r} />)}</ul>
          <p>Thresholds, the 240 m squares and the 2 km grouping are our own choices, set before we ran the checks. Code: <a href="https://github.com/V-Agalkathir/Nasa_Hacks_Devotion" target="_blank" rel="noreferrer">github.com/V-Agalkathir/Nasa_Hacks_Devotion</a>.</p>
        </div>
      </div>
    </section>
  );
}
