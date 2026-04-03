import fs from "fs";
import path from "path";

function replMerge(s) {
  const token = "merge(fromServer,";
  let out = "";
  let i = 0;
  for (;;) {
    const j = s.indexOf(token, i);
    if (j < 0) {
      out += s.slice(i);
      return out;
    }
    out += s.slice(i, j) + "merge(fromServer)";
    let k = j + token.length;
    let depth = 1;
    while (k < s.length && depth) {
      if (s[k] === "(") depth++;
      else if (s[k] === ")") depth--;
      k++;
    }
    i = k;
  }
}

function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith(".tsx") || f.name.endsWith(".ts")) {
      const t = fs.readFileSync(p, "utf8");
      if (!t.includes("merge(fromServer,")) continue;
      const nt = replMerge(t);
      if (nt !== t) {
        fs.writeFileSync(p, nt);
        console.log("updated", p);
      }
    }
  }
}

walk("src");
