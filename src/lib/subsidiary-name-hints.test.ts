import { describe, expect, it } from "vitest";
import { extractSubsidiaryNamesFromStandaloneExhibitBody } from "@/lib/subsidiary-name-hints";
import { pairedSubsidiariesFromLines } from "@/lib/exhibit21SubsidiaryRows";

function workivaStyleEx21(): string {
  return `
  <html><body>
  <p>Exhibit 21</p>
  <table>
  <tr><td>Subsidiary</td><td>State or Country of Incorporation</td><td>% of Ownership</td><td>Name Doing Business As</td></tr>
  <tr><td>DISH Network Corporation</td><td>Nevada</td><td>100%</td><td>DISH</td></tr>
  <tr><td>DISH DBS Corporation</td><td>Colorado</td><td>100%</td><td>(1) DDBS</td></tr>
  <tr><td>DISH Network L.L.C.</td><td>Colorado</td><td>100%</td><td>(2) DNLLC</td></tr>
  </table>
  <p>(1) This is a subsidiary of DISH Network Corporation</p>
  </body></html>
  `;
}

describe("extractSubsidiaryNamesFromStandaloneExhibitBody (Exhibit 21)", () => {
  it("maps domicile from column before 100%, not DBA", () => {
    const lines = extractSubsidiaryNamesFromStandaloneExhibitBody(workivaStyleEx21(), 50, true, true);
    const { names, domiciles } = pairedSubsidiariesFromLines(lines);
    expect(names).toContain("DISH Network Corporation");
    const i = names.indexOf("DISH Network Corporation");
    expect(domiciles[i]).toBe("Nevada");
    const j = names.indexOf("DISH Network L.L.C.");
    expect(domiciles[j]).toBe("Colorado");
  });

  it("skips header row and footnote line", () => {
    const lines = extractSubsidiaryNamesFromStandaloneExhibitBody(workivaStyleEx21(), 50, true, true);
    const joined = lines.join(" ").toLowerCase();
    expect(joined).not.toContain("state or country of incorporation");
    expect(joined).not.toMatch(/this is a subsidiary of/i);
  });

  it("does not treat DBA-only cell as domicile for 3-column tables without %", () => {
    const html = `
    <table>
    <tr><td>DISH Network Corporation</td><td>Nevada</td><td>DISH</td></tr>
    </table>`;
    const lines = extractSubsidiaryNamesFromStandaloneExhibitBody(html, 50, true, true);
    const { names, domiciles } = pairedSubsidiariesFromLines(lines);
    expect(names[0]).toBe("DISH Network Corporation");
    expect(domiciles[0]).toBe("Nevada");
  });
});
