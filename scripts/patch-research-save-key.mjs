import fs from "fs";
import path from "path";

const root = path.join(process.cwd(), "src/components");

function walk(d, out) {
  for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith(".tsx")) out.push(p);
  }
}

const files = [];
walk(root, files);

for (const file of files) {
  let src = fs.readFileSync(file, "utf8");
  if (!src.includes("TabPromptApiButtons")) continue;
  if (!src.includes("saveToServer")) continue;
  const m = src.match(/saveToServer\(\s*safeTicker,\s*["']([^"']+)["']/);
  if (!m) continue;
  const key = m[1];
  if (src.includes("researchSaveKey=")) continue;
  const replaced = src.replace(
    /<TabPromptApiButtons\r?\n(\s*)userPrompt=/g,
    `<TabPromptApiButtons\n$1researchSaveKey="${key}"\n$1userPrompt=`
  );
  if (replaced !== src) {
    fs.writeFileSync(file, replaced);
    console.log("patched", path.relative(process.cwd(), file), key);
  }
}
