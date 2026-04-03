/**
 * Hosts allowed for POST /api/save-filing-link (SEC / FCC / USPTO / Patents UI links only).
 * Prevents open SSRF while matching URLs surfaced in those tabs.
 */

const EXTRA_HOSTS = new Set(["patents.google.com", "api.data.gov"]);

function underRoot(hostname: string, root: string): boolean {
  const h = hostname.toLowerCase();
  const r = root.toLowerCase();
  return h === r || h.endsWith(`.${r}`);
}

export function isFilingsTabUrlAllowed(urlStr: string): boolean {
  let url: URL;
  try {
    url = new URL(urlStr.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (EXTRA_HOSTS.has(host)) return true;
  if (underRoot(host, "sec.gov")) return true;
  if (underRoot(host, "fcc.gov")) return true;
  if (underRoot(host, "uspto.gov")) return true;
  return false;
}
