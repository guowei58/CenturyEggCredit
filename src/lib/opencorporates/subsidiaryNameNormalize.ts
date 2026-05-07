/**
 * Conservative normalization for OpenCorporates search variants — does not collapse distinct legal entities.
 */
export function normalizeSubsidiaryNameForOpenCorporates(legalName: string): string {
  let s = legalName.trim().toLowerCase();
  s = s.replace(/,/g, "");
  s = s.replace(/\./g, "");
  s = s.replace(/\s+/g, " ");

  const tails: [RegExp, string][] = [
    [/\bincorporated\b/gi, "inc"],
    [/\binc\b(?!\w)/gi, "inc"],
    [/\bcorporation\b/gi, "corp"],
    [/\bcorp\b(?!\w)/gi, "corp"],
    [/\bcompany\b/gi, "co"],
    [/\blimited liability company\b/gi, "llc"],
    [/\bl\.l\.c\.\b/gi, "llc"],
    [/\bllc\b/gi, "llc"],
    [/\blimited partnership\b/gi, "lp"],
    [/\bl\.p\.\b/gi, "lp"],
    [/\blp\b(?!\w)/gi, "lp"],
    [/\blimited\b/gi, "ltd"],
    [/\bltd\b(?!\w)/gi, "ltd"],
    [/\bplc\b/gi, "plc"],
    [/\bp\.c\.\b/gi, "pc"],
    [/\band\b/gi, "&"],
    [/\s*&\s*/g, "&"],
  ];

  for (const [re, rep] of tails) {
    s = s.replace(re, rep);
  }

  return s.replace(/\s+/g, " ").trim();
}
