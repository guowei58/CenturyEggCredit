export type GleifPostalAddress = {
  addressLines?: string[] | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  postalCode?: string | null;
};

/** Single-line postal address from GLEIF `legalAddress` / `headquartersAddress`. */
export function formatGleifPostalAddress(addr: GleifPostalAddress | null | undefined): string {
  if (!addr) return "";
  const lines = [...(addr.addressLines ?? [])].map((x) => String(x).trim()).filter(Boolean);
  const tailParts = [addr.city, addr.region, addr.postalCode, addr.country]
    .map((x) => (x != null ? String(x).trim() : ""))
    .filter(Boolean);
  const tail = tailParts.join(", ");
  const combined = [...lines, tail].filter(Boolean).join(", ");
  return combined.replace(/\s+/g, " ").trim();
}
