import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/user-ticker-workspace-store", () => ({
  workspaceReadFile: vi.fn(),
  workspaceWriteFile: vi.fn(),
  workspaceDeleteFile: vi.fn(),
}));

import { parsePublicationUrl, customPublicationInputsFromUrls } from "./custom-publications";
import { resolveTradePublications } from "./industry-source-map";
import {
  readCustomIndustryPublicationsState,
  resetCustomIndustryPublicationsToAuto,
  resolveIndustryPublicationsForDigest,
  writeCustomIndustryPublications,
} from "./custom-publications";
import { workspaceDeleteFile, workspaceReadFile, workspaceWriteFile } from "@/lib/user-ticker-workspace-store";

describe("parsePublicationUrl", () => {
  it("parses full article URLs to domain", () => {
    const r = parsePublicationUrl("https://www.crn.com/news/channel-news/example");
    expect(r).not.toBeNull();
    expect(r!.siteDomain).toBe("crn.com");
    expect(r!.name).toBe("CRN");
  });

  it("parses bare domains", () => {
    const r = parsePublicationUrl("theregister.com");
    expect(r).not.toBeNull();
    expect(r!.siteDomain).toBe("theregister.com");
    expect(r!.name).toBe("The Register");
  });

  it("rejects invalid input", () => {
    expect(parsePublicationUrl("")).toBeNull();
    expect(parsePublicationUrl("not a url")).toBeNull();
  });
});

describe("customPublicationInputsFromUrls", () => {
  it("dedupes by domain and caps at 3", () => {
    const rows = customPublicationInputsFromUrls([
      { url: "https://crn.com/a" },
      { url: "https://www.crn.com/b" },
      { url: "https://theregister.com" },
      { url: "https://techcrunch.com" },
      { url: "https://digiday.com" },
    ]);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.siteDomain)).size).toBe(3);
  });
});

describe("resolveTradePublications", () => {
  it("picks software publications for software SIC", () => {
    const pubs = resolveTradePublications("GEN", "Gen Digital Inc", "7372", "Prepackaged Software", []);
    const domains = pubs.map((p) => p.siteDomain);
    expect(domains.some((d) => d.includes("crn.com") || d.includes("theregister"))).toBe(true);
  });
});

describe("custom industry publication modes", () => {
  beforeEach(() => {
    vi.mocked(workspaceReadFile).mockReset();
    vi.mocked(workspaceWriteFile).mockReset();
    vi.mocked(workspaceDeleteFile).mockReset();
    vi.mocked(workspaceWriteFile).mockResolvedValue({ ok: true });
    vi.mocked(workspaceDeleteFile).mockResolvedValue(undefined);
  });

  it("uses auto mode when no settings file exists", async () => {
    vi.mocked(workspaceReadFile).mockResolvedValue(null);
    const state = await readCustomIndustryPublicationsState("user-1", "GEN");
    expect(state.state).toBe("unset");

    const resolution = await resolveIndustryPublicationsForDigest({
      userId: "user-1",
      ticker: "GEN",
      companyName: "Gen Digital Inc",
      sicRaw: "7372",
      sicDescription: "Prepackaged Software",
    });
    expect(resolution.mode).toBe("auto");
    expect(resolution.publications.length).toBeGreaterThan(0);
  });

  it("uses none mode when settings file has an empty list", async () => {
    vi.mocked(workspaceReadFile).mockResolvedValue(Buffer.from(JSON.stringify({ v: 1, publications: [] })));
    const state = await readCustomIndustryPublicationsState("user-1", "GEN");
    expect(state.state).toBe("empty");

    const resolution = await resolveIndustryPublicationsForDigest({
      userId: "user-1",
      ticker: "GEN",
      companyName: "Gen Digital Inc",
      sicRaw: "7372",
      sicDescription: "Prepackaged Software",
    });
    expect(resolution.mode).toBe("none");
    expect(resolution.publications).toEqual([]);
  });

  it("persists an empty list instead of deleting the settings file", async () => {
    await writeCustomIndustryPublications("user-1", "GEN", []);
    expect(workspaceWriteFile).toHaveBeenCalledWith(
      "user-1",
      "GEN",
      "daily-news/custom-industry-publications.json",
      expect.any(Buffer)
    );
    expect(workspaceDeleteFile).not.toHaveBeenCalled();
  });

  it("reset to automatic deletes the settings file", async () => {
    await resetCustomIndustryPublicationsToAuto("user-1", "GEN");
    expect(workspaceDeleteFile).toHaveBeenCalledWith(
      "user-1",
      "GEN",
      "daily-news/custom-industry-publications.json"
    );
  });
});
