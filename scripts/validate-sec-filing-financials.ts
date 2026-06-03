import { runSecFilingFinancialsDiagnostics } from "@/lib/sec-filing-financials-diagnostics";

async function main() {
  const ticker = (process.argv[2] ?? "TSLA").trim().toUpperCase();
  const maxFilings = Math.max(1, Number.parseInt(process.argv[3] ?? "80", 10) || 80);
  const result = await runSecFilingFinancialsDiagnostics(ticker, maxFilings);
  if (result.failures.length === 0) {
    console.log(`Validated ${result.checked} ${ticker} filings with no suspicious statement picks.`);
    return;
  }

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 1;
}

void main();
