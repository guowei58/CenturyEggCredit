import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectItem202In8KPrimaryHtml,
  edgarArchivesFolderCikCandidates,
  getAllFilingsByCik,
  hasEarningsAdjacent8KMetadataSignal,
  mergeSuccessorIssuerBundles,
  rankEarningsAdjacent8KFilings,
  rankEarningsAdjacent8KFilingsWithPrimaryItemScan,
  secAccessionDedupeKey,
  secArchivesPrimaryDocumentUrl,
  secCompanyTickerLookupCandidates,
  secFilingIsEarningsPressRelease8K,
  secSubmissionItemsIncludeItem202,
  type SecFiling,
  type SecFilingsResult,
} from "@/lib/sec-edgar";

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("secCompanyTickerLookupCandidates", () => {
  it("maps broker-style class dots to SEC hyphen tickers", () => {
    expect(secCompanyTickerLookupCandidates("BRK.B")).toEqual(["BRK.B", "BRK-B"]);
    expect(secCompanyTickerLookupCandidates("bf.b")).toEqual(["BF.B", "BF-B"]);
  });

  it("passes through ordinary symbols unchanged", () => {
    expect(secCompanyTickerLookupCandidates("MSFT")).toEqual(["MSFT"]);
    expect(secCompanyTickerLookupCandidates(" BRK-B ")).toEqual(["BRK-B"]);
  });

  it("collapses spaces as extra variants", () => {
    expect(secCompanyTickerLookupCandidates("BRK B")).toContain("BRKB");
    expect(secCompanyTickerLookupCandidates("BRK B")).toContain("BRK-B");
  });
});

describe("edgarArchivesFolderCikCandidates", () => {
  it("lists issuer first, then accession filer CIK when they differ (Alphabet ticker vs GOOG-era accession)", () => {
    expect(edgarArchivesFolderCikCandidates("0001652044", "0001288776-14-000088")).toEqual(["0001652044", "0001288776"]);
  });

  it("dedupes when issuer already matches accession prefix", () => {
    expect(edgarArchivesFolderCikCandidates("0001652044", "0001652044-26-000048")).toEqual(["0001652044"]);
  });
});

describe("mergeSuccessorIssuerBundles", () => {
  it("dedupes by accession and sorts newest-first", () => {
    const primary: SecFilingsResult = {
      companyName: "A",
      cik: "0000000001",
      filings: [
        {
          form: "10-Q",
          filingDate: "2016-07-31",
          description: "",
          accessionNumber: "1652044-16-111111",
          primaryDocument: "q.htm",
          docUrl: "",
        },
        {
          form: "8-K",
          filingDate: "2016-01-01",
          description: "",
          accessionNumber: "dup-16-aaa",
          primaryDocument: "f.htm",
          docUrl: "",
        },
      ],
    };
    const pred: SecFilingsResult = {
      companyName: "Old",
      cik: "0000000009",
      filings: [
        {
          form: "10-K",
          filingDate: "2015-02-06",
          description: "",
          accessionNumber: "165204416000012",
          primaryDocument: "k.htm",
          docUrl: "",
        },
        {
          form: "10-Q",
          filingDate: "2014-10-31",
          description: "",
          accessionNumber: "1288776-14-000088",
          primaryDocument: "dup.htm",
          docUrl: "",
        },
      ],
    };
    const merged = mergeSuccessorIssuerBundles(primary, [pred]);
    expect(merged.companyName).toBe("A");
    expect(merged.cik).toBe("0000000001");
    expect(merged.filings.map((f) => f.filingDate)).toEqual([
      "2016-07-31",
      "2016-01-01",
      "2015-02-06",
      "2014-10-31",
    ]);
  });
});

describe("getAllFilingsByCik", () => {
  it("stops after enough matching 10-K and 10-Q filings are collected", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        name: "Example Corp",
        filings: {
          recent: {
            accessionNumber: ["0001-26-000001", "0001-26-000002", "0001-26-000003"],
            filingDate: ["2026-04-30", "2026-04-15", "2026-02-20"],
            form: ["10-Q", "8-K", "10-K"],
            primaryDocument: ["q1.htm", "current.htm", "annual.htm"],
            primaryDocDescription: ["Quarterly report", "Current report", "Annual report"],
          },
          files: [{ name: "CIK0000000001-submissions-001.json" }],
        },
      }),
    }));
    global.fetch = fetchMock as typeof fetch;

    const res = await getAllFilingsByCik("1", { includeForms: ["10-K", "10-Q"], maxFilings: 2 });

    expect(res?.filings.map((filing) => filing.form)).toEqual(["10-Q", "10-K"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("loads older submission chunks only until enough matching filings are found", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: "Example Corp",
          filings: {
            recent: {
              accessionNumber: ["0001-26-000001", "0001-26-000002"],
              filingDate: ["2026-04-30", "2026-04-15"],
              form: ["10-Q", "8-K"],
              primaryDocument: ["q1.htm", "current.htm"],
              primaryDocDescription: ["Quarterly report", "Current report"],
            },
            files: [{ name: "CIK0000000001-submissions-001.json" }, { name: "CIK0000000001-submissions-002.json" }],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessionNumber: ["0001-25-000010", "0001-25-000011"],
          filingDate: ["2025-02-20", "2025-01-15"],
          form: ["10-K", "8-K"],
          primaryDocument: ["annual.htm", "current-older.htm"],
          primaryDocDescription: ["Annual report", "Current report"],
        }),
      });
    global.fetch = fetchMock as typeof fetch;

    const res = await getAllFilingsByCik("1", { includeForms: ["10-K", "10-Q"], maxFilings: 2 });

    expect(res?.filings.map((filing) => filing.form)).toEqual(["10-Q", "10-K"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("secArchivesPrimaryDocumentUrl", () => {
  it("uses the issuer submissions CIK in the /Archives/edgar/data/ path, not the accession-prefix CIK", () => {
    const url = secArchivesPrimaryDocumentUrl("0001142417", {
      accessionNumber: "0001193125-25-260938",
      primaryDocument: "nxst-20251030.htm",
    });
    expect(url).toBe(
      "https://www.sec.gov/Archives/edgar/data/1142417/000119312525260938/nxst-20251030.htm"
    );
  });
});

describe("hasEarningsAdjacent8KMetadataSignal", () => {
  it("is true when primary document looks like an earnings / press HTML sibling name", () => {
    expect(
      hasEarningsAdjacent8KMetadataSignal({
        form: "8-K",
        filingDate: "2014-08-06",
        accessionNumber: "x",
        primaryDocument: "ctl20148-earningsreleasex.htm",
        description: "8-K",
        docUrl: "",
      })
    ).toBe(true);
  });

  it("is false for a bare 8-K shell filename with no Item 2.02 / exhibit hints", () => {
    expect(
      hasEarningsAdjacent8KMetadataSignal({
        form: "8-K",
        filingDate: "2014-08-06",
        accessionNumber: "x",
        primaryDocument: "ctl20148-8k.htm",
        description: "Current report",
        docUrl: "",
      })
    ).toBe(false);
  });
});

describe("detectItem202In8KPrimaryHtml", () => {
  const pad = (s: string) => s + "\n" + ".".repeat(200);

  it("detects Item 2.02 with HTML noise", () => {
    const html = pad(
      `<html><body><div>Item</div> <span>2.02</span> Results of Operations and Financial Condition</body></html>`
    );
    expect(detectItem202In8KPrimaryHtml(html)).toBe(true);
  });

  it("detects Item&#160;2.02 style entities", () => {
    expect(detectItem202In8KPrimaryHtml(pad(`<td>Item&#160;2.02</td><td>Results of Operations`))).toBe(true);
  });

  it("is false for Item 1.01 only (debt / agreement 8-K)", () => {
    const html = pad(`<html><body>Item 1.01 Entry into a Material Definitive Agreement</body></html>`);
    expect(detectItem202In8KPrimaryHtml(html)).toBe(false);
  });
});

describe("secSubmissionItemsIncludeItem202 / secFilingIsEarningsPressRelease8K", () => {
  it("detects Item 2.02 in comma-separated submissions items", () => {
    expect(secSubmissionItemsIncludeItem202("5.02,7.01,9.01")).toBe(false);
    expect(secSubmissionItemsIncludeItem202("2.02,9.01")).toBe(true);
    expect(secSubmissionItemsIncludeItem202("")).toBe(false);
  });

  it("excludes management-only 8-Ks when items omit 2.02", () => {
    const f: SecFiling = {
      form: "8-K",
      filingDate: "2023-05-22",
      items: "5.02,7.01,9.01",
      accessionNumber: "000-23-000001",
      primaryDocument: "d8k.htm",
      description: "8-K",
      docUrl: "",
    };
    expect(secFilingIsEarningsPressRelease8K(f, new Map())).toBe(false);
  });

  it("includes filing when primary scan finds Item 2.02 even if items omit 2.02 in metadata", () => {
    const f: SecFiling = {
      form: "8-K",
      filingDate: "2023-05-22",
      items: "5.02,9.01",
      accessionNumber: "000-23-000099",
      primaryDocument: "x.htm",
      description: "8-K",
      docUrl: "",
    };
    const map = new Map<string, boolean>([[secAccessionDedupeKey(f.accessionNumber), true]]);
    expect(secFilingIsEarningsPressRelease8K(f, map)).toBe(true);
  });
});

describe("rankEarningsAdjacent8KFilingsWithPrimaryItemScan", () => {
  it("uses Item 2.02 in primary HTML when submissions description is generic", async () => {
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      text: async () => {
        const u = String(_url);
        const pad = (inner: string) => `<html><body>${inner}${"<p>.</p>".repeat(80)}</body></html>`;
        if (u.includes("debt8k.htm")) return pad("Item 1.01 Entry into a Material Definitive Agreement");
        if (u.includes("earn8k.htm")) return pad("Item 2.02 Results of Operations and Financial Condition");
        return pad("");
      },
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const filings: SecFiling[] = [
      {
        form: "8-K",
        filingDate: "2026-04-30",
        accessionNumber: "0000000000-26-000001",
        primaryDocument: "debt8k.htm",
        description: "8-K",
        docUrl: "",
      },
      {
        form: "8-K",
        filingDate: "2026-05-05",
        accessionNumber: "0000000000-26-000002",
        primaryDocument: "earn8k.htm",
        description: "8-K",
        docUrl: "",
      },
    ];

    const { ranked } = await rankEarningsAdjacent8KFilingsWithPrimaryItemScan("0000000001", filings, "2026-03-31", {
      anchorIsPeriodEnd: true,
      paceMs: 0,
    });
    expect(ranked.map((f) => f.accessionNumber)).toEqual(["0000000000-26-000002", "0000000000-26-000001"]);
  });
});

describe("rankEarningsAdjacent8KFilings", () => {
  const filing = (
    o: Partial<SecFiling> & Pick<SecFiling, "form" | "filingDate" | "accessionNumber" | "primaryDocument">
  ): SecFiling => ({
    description: "",
    docUrl: "",
    ...o,
  });

  it("ranks in-window 8-Ks and prefers same-day earnings-style items", () => {
    const periodic = "2024-08-05";
    const filings: SecFiling[] = [
      filing({
        form: "8-K",
        filingDate: "2024-07-01",
        accessionNumber: "1-24-000001",
        primaryDocument: "a.htm",
        description: "Other event",
      }),
      filing({
        form: "8-K",
        filingDate: "2024-08-04",
        accessionNumber: "1-24-000002",
        primaryDocument: "ex99.htm",
        description: "Earnings release Exhibit 99",
      }),
      filing({
        form: "8-K",
        filingDate: "2024-08-05",
        accessionNumber: "1-24-000003",
        primaryDocument: "b.htm",
        description: "Results of operations",
      }),
    ];
    const ranked = rankEarningsAdjacent8KFilings(filings, periodic);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.accessionNumber).toBe("1-24-000002");
    expect(ranked[1]!.accessionNumber).toBe("1-24-000003");
  });

  it("drops 8-Ks more than maxDaysBefore before the periodic filing", () => {
    const periodic = "2024-08-05";
    const filings: SecFiling[] = [
      filing({
        form: "8-K",
        filingDate: "2024-07-15",
        accessionNumber: "1-24-000001",
        primaryDocument: "a.htm",
        description: "Earnings",
      }),
    ];
    expect(rankEarningsAdjacent8KFilings(filings, periodic)).toHaveLength(0);
  });

  it("widens the forward window from period end so earnings 8-Ks after quarter-end are candidates", () => {
    const periodEnd = "2012-03-31";
    const filings: SecFiling[] = [
      filing({
        form: "8-K",
        filingDate: "2012-05-15",
        accessionNumber: "1-12-000099",
        primaryDocument: "earnings.htm",
        description: "8-K Item 2.02 Results",
      }),
    ];
    expect(rankEarningsAdjacent8KFilings(filings, periodEnd, { anchorIsPeriodEnd: true })).toHaveLength(1);
    expect(rankEarningsAdjacent8KFilings(filings, periodEnd, { anchorIsPeriodEnd: false })).toHaveLength(0);
  });

  it("from period end, prefers Item 2.02 / earnings signals over unrelated Exhibit-99-shaped filings", () => {
    const periodEnd = "2012-03-31";
    const filings: SecFiling[] = [
      filing({
        form: "8-K",
        filingDate: "2012-04-25",
        accessionNumber: "wrong-12",
        primaryDocument: "d340081dex991.htm",
        description: "Current report",
      }),
      filing({
        form: "8-K",
        filingDate: "2012-05-03",
        accessionNumber: "right-12",
        primaryDocument: "fico-eightk.htm",
        description: "8-K Item 2.02 — Results of Operations",
      }),
    ];
    const ranked = rankEarningsAdjacent8KFilings(filings, periodEnd, { anchorIsPeriodEnd: true });
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.accessionNumber).toBe("right-12");
  });

  it("ranks filings with earnings-style metadata ahead of same-window generic 8-Ks", () => {
    const periodic = "2014-08-06";
    const filings: SecFiling[] = [
      filing({
        form: "8-K",
        filingDate: "2014-08-05",
        accessionNumber: "generic-14",
        primaryDocument: "ctl-offering.htm",
        description: "Entry into a material definitive agreement",
      }),
      filing({
        form: "8-K",
        filingDate: "2014-08-06",
        accessionNumber: "earnings-14",
        primaryDocument: "ctl20148-earningsreleasex.htm",
        description: "8-K",
      }),
    ];
    const ranked = rankEarningsAdjacent8KFilings(filings, periodic);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.accessionNumber).toBe("earnings-14");
  });
});
