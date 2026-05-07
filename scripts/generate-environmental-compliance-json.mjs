import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

/** [State name, Abbrev, Primary_State_URL, Secondary_or_Direction_URL] */
const ROWS = [
  ["Alabama", "AL", "https://adem.alabama.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Alaska", "AK", "https://dec.alaska.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Arizona", "AZ", "https://azdeq.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Arkansas", "AR", "https://www.adeq.state.ar.us/", "https://echo.epa.gov/tools/data-downloads"],
  ["California", "CA", "https://calepa.ca.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Colorado", "CO", "https://cdphe.colorado.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Connecticut", "CT", "https://portal.ct.gov/DEEP", "https://echo.epa.gov/tools/data-downloads"],
  ["Delaware", "DE", "https://dnrec.alpha.delaware.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Florida", "FL", "https://floridadep.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Georgia", "GA", "https://epd.georgia.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Hawaii", "HI", "https://health.hawaii.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Idaho", "ID", "https://www.deq.idaho.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Illinois", "IL", "https://epa.illinois.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Indiana", "IN", "https://www.in.gov/idem/", "https://echo.epa.gov/tools/data-downloads"],
  ["Iowa", "IA", "https://www.iowadnr.gov/Environmental-Protection", "https://echo.epa.gov/tools/data-downloads"],
  ["Kansas", "KS", "https://www.kdhe.ks.gov/145/Division-of-Environment", "https://echo.epa.gov/tools/data-downloads"],
  ["Kentucky", "KY", "https://eec.ky.gov/Environmental-Protection/Pages/default.aspx", "https://echo.epa.gov/tools/data-downloads"],
  ["Louisiana", "LA", "https://deq.louisiana.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Maine", "ME", "https://www.maine.gov/dep/", "https://echo.epa.gov/tools/data-downloads"],
  ["Maryland", "MD", "https://mde.maryland.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Massachusetts", "MA", "https://www.mass.gov/orgs/massachusetts-department-of-environmental-protection", "https://echo.epa.gov/tools/data-downloads"],
  ["Michigan", "MI", "https://www.michigan.gov/egle", "https://echo.epa.gov/tools/data-downloads"],
  ["Minnesota", "MN", "https://www.pca.state.mn.us/", "https://echo.epa.gov/tools/data-downloads"],
  ["Mississippi", "MS", "https://www.mdeq.ms.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Missouri", "MO", "https://dnr.mo.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Montana", "MT", "https://deq.mt.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Nebraska", "NE", "https://dee.nebraska.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Nevada", "NV", "https://ndep.nv.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["New Hampshire", "NH", "https://www.des.nh.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["New Jersey", "NJ", "https://dep.nj.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["New Mexico", "NM", "https://www.env.nm.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["New York", "NY", "https://dec.ny.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["North Carolina", "NC", "https://www.deq.nc.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["North Dakota", "ND", "https://deq.nd.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Ohio", "OH", "https://epa.ohio.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Oklahoma", "OK", "https://www.deq.ok.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Oregon", "OR", "https://www.oregon.gov/deq/", "https://echo.epa.gov/tools/data-downloads"],
  ["Pennsylvania", "PA", "https://www.dep.pa.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Rhode Island", "RI", "https://dem.ri.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["South Carolina", "SC", "https://scdhec.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["South Dakota", "SD", "https://danr.sd.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Tennessee", "TN", "https://www.tn.gov/environment.html", "https://echo.epa.gov/tools/data-downloads"],
  ["Texas", "TX", "https://www.tceq.texas.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Utah", "UT", "https://deq.utah.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Vermont", "VT", "https://dec.vermont.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Virginia", "VA", "https://www.deq.virginia.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Washington", "WA", "https://ecology.wa.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["West Virginia", "WV", "https://dep.wv.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Wisconsin", "WI", "https://dnr.wisconsin.gov/", "https://echo.epa.gov/tools/data-downloads"],
  ["Wyoming", "WY", "https://deq.wyoming.gov/", "https://echo.epa.gov/tools/data-downloads"],
];

function twoSteps(stateName, primary, secondary) {
  return [
    {
      step: 1,
      label: "State environmental agency",
      hint: `Official ${stateName} environmental department — permits, inspections, violations, spills.`,
      url: primary,
    },
    {
      step: 2,
      label: "EPA ECHO (national)",
      hint: "Federal Enforcement & Compliance History Online — cross-check facilities and enforcement.",
      url: secondary,
    },
  ];
}

const out = {};
for (const [stateName, abbr, primary, secondary] of ROWS) {
  out[abbr] = {
    stateName,
    primaryUrl: primary,
    secondaryUrl: secondary,
    steps: twoSteps(stateName, primary, secondary),
  };
}

const outPath = path.join(root, "data", "environmental_compliance_matrix_50_states.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log("Wrote", Object.keys(out).length, "states to", outPath);
