import { describe, expect, it } from "vitest";
import { extractExhibit21GridSnapshotFromDocument } from "@/lib/exhibit21GridExtract";

describe("extractExhibit21GridSnapshotFromDocument", () => {
  it("merges continuation tables separated by HR when trailing empty column makes width mismatch", () => {
    const html = `<html><body>
      <table>
        <tr><th>Name</th><th>Jurisdiction</th></tr>
        <tr><td>United Cinemas International (UK) Ltd</td><td>England</td></tr>
        <tr><td>NCG Holding AB</td><td>Sweden</td></tr>
      </table>
      <hr/>
      <table>
        <tr><td>Bio Rex Cinemas Oy (50%)</td><td>Finland</td><td></td></tr>
        <tr><td>Capa Kinoreklame AS (64.45%)</td><td>Norway</td><td></td></tr>
      </table>
    </body></html>`;
    const snap = extractExhibit21GridSnapshotFromDocument(html);
    expect(snap).not.toBeNull();
    const flat = snap!.rows.map((r) => r.join(" | ")).join("\n");
    expect(flat.includes("United Cinemas International (UK) Ltd")).toBe(true);
    expect(flat.includes("Bio Rex Cinemas Oy (50%)")).toBe(true);
    expect(flat.includes("Capa Kinoreklame AS (64.45%)")).toBe(true);
    expect((snap!.hasHeaderRow ? snap!.rows.length - 1 : snap!.rows.length)).toBeGreaterThanOrEqual(4);
  });

  it("merges same-width continuation tables and drops repeated header after first table", () => {
    const html = `<html><body>
      <table>
        <tr><th>Subsidiary</th><th>State or country</th></tr>
        <tr><td>Alpha Co</td><td>Delaware</td></tr>
      </table>
      <table>
        <tr><th>Subsidiary</th><th>State or country</th></tr>
        <tr><td>Beta Holdco LLC</td><td>Texas</td></tr>
        <tr><td>Gamma Ops Ltd</td><td>Ireland</td></tr>
      </table>
    </body></html>`;
    const snap = extractExhibit21GridSnapshotFromDocument(html);
    expect(snap).not.toBeNull();
    expect(snap!.source).toBe("html_table");
    /** Header + Alpha + Beta + Gamma (second table's header row dropped) */
    expect(snap!.rows.length).toBe(4);
    expect(snap!.rows[2]!).toEqual(expect.arrayContaining(["Beta Holdco LLC", "Texas"]));
    expect(snap!.rows.some((r) => r.some((c) => c.includes("Gamma Ops")))).toBe(true);
  });

  it("splits Megacell Meta-style prose into one row per subsidiary and decodes entities", () => {
    const prose = `
      meta-foo.htm
      EXHIBIT&#160;21.1
      LIST OF SUBSIDIARIES META PLATFORMS, INC.
      Facebook Holdings, LLC (Delaware) Facebook Procurement, LLC (Delaware) FCL Tech Limited (Ireland) Instagram, LLC (Delaware) Meta Payments Inc. (Florida) Meta Platforms Ireland Limited (Ireland)
    `;
    const snap = extractExhibit21GridSnapshotFromDocument(prose);
    expect(snap).not.toBeNull();
    const bodies = snap!.hasHeaderRow ? snap!.rows.slice(1) : snap!.rows;
    expect(bodies.length).toBeGreaterThanOrEqual(5);
    expect(bodies.some((r) => r[0]?.includes("Facebook Holdings") && r[1] === "Delaware")).toBe(true);
    expect(bodies.some((r) => r[0]?.includes("Meta Platforms Ireland") && r[1] === "Ireland")).toBe(true);
  });

  it("strips filename / exhibit title preamble from table rows", () => {
    const html = `<html><body><table>
      <tr><td>meta-12312025x10kex211.htm</td></tr>
      <tr><td>EXHIBIT 21.1</td></tr>
      <tr><td>LIST OF SUBSIDIARIES ACME INC</td></tr>
      <tr><th>Name</th><th>Jurisdiction</th></tr>
      <tr><td>Acme One LLC</td><td>Delaware</td></tr>
    </table></body></html>`;
    const snap = extractExhibit21GridSnapshotFromDocument(html);
    expect(snap).not.toBeNull();
    const joined = snap!.rows.map((r) => r.join(" | ")).join("\n");
    expect(joined.includes("meta-123")).toBe(false);
    expect(joined.includes("LIST OF SUBSIDIARIES ACME")).toBe(false);
    expect(joined.includes("Acme One LLC")).toBe(true);
  });
});
