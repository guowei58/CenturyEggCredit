import fs from "fs";
import path from "path";

function strip(t) {
  let s = t.replace(/const \{ merge, persistLocally \} = useSavedTabPersistence\(\);/g, "const { merge } = useSavedTabPersistence();");
  s = s.replace(/\n\s*if \(persistLocally\) [^;]+;/g, "");
  s = s.replace(/, persistLocally\]/g, "]");
  return s;
}

function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith(".tsx") || f.name.endsWith(".ts")) {
      const t = fs.readFileSync(p, "utf8");
      if (!t.includes("persistLocally")) continue;
      const nt = strip(t);
      if (nt !== t) fs.writeFileSync(p, nt);
    }
  }
}

walk("src");
