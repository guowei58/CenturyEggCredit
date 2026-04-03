import fs from "fs";
import path from "path";

function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    if (f === "node_modules" || f === ".next") continue;
    const full = path.join(dir, f);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full);
    else if (/\.(tsx|ts)$/.test(f)) {
      let s = fs.readFileSync(full, "utf8");
      if (!s.includes("fetchSavedMigrateLegacy")) continue;
      s = s.split("fetchSavedMigrateLegacy").join("fetchSavedTabContent");
      s = s.replace(
        /fetchSavedTabContent\(\s*([^,]+),\s*([^,]+?)\s*,\s*`[\s\S]*?`\s*\)/gs,
        "fetchSavedTabContent($1, $2)"
      );
      fs.writeFileSync(full, s);
      console.log(full);
    }
  }
}

walk(path.join(process.cwd(), "src"));
