/** Balance unclosed `{` / `[` after trimming a trailing incomplete value (truncated LLM JSON). */
export function balanceJsonBrackets(raw: string): string {
  let s = raw.trim();
  s = s.replace(/,\s*([}\]])/g, "$1");

  let depthObj = 0;
  let depthArr = 0;
  let inStr = false;
  let esc = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depthObj++;
    else if (c === "}") depthObj = Math.max(0, depthObj - 1);
    else if (c === "[") depthArr++;
    else if (c === "]") depthArr = Math.max(0, depthArr - 1);
  }

  if (inStr) {
    s = s.replace(/,\s*"[^"]*"?$/, "");
    s = s.replace(/:\s*"[^"]*"?$/, ": null");
  }
  s = s.replace(/,\s*$/, "");

  while (depthArr > 0) {
    s += "]";
    depthArr--;
  }
  while (depthObj > 0) {
    s += "}";
    depthObj--;
  }

  return s;
}

/** Try to recover a JSON object from model output that may be truncated or slightly malformed. */
export function parseJsonObjectWithRepair(raw: string): unknown {
  const t = raw.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)```/im.exec(t);
  const inner = (m ? m[1] : t).trim();
  const start = inner.indexOf("{");
  const end = inner.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object found in model output");

  const slice = inner.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (firstErr) {
    const repaired = balanceJsonBrackets(slice);
    try {
      return JSON.parse(repaired);
    } catch {
      let trimmed = slice;
      for (let i = 0; i < 24; i++) {
        const cut = Math.max(trimmed.lastIndexOf("},"), trimmed.lastIndexOf("],"));
        if (cut < 200) break;
        trimmed = trimmed.slice(0, cut + 1);
        const attempt = balanceJsonBrackets(trimmed);
        try {
          return JSON.parse(attempt);
        } catch {
          /* keep trimming */
        }
      }
      throw firstErr instanceof Error ? firstErr : new Error("Failed to parse JSON from model");
    }
  }
}
