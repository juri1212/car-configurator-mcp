/** Every brand the server knows, in the order tools list them. */
export const ALL_BRANDS = ["vw", "vwn", "porsche"] as const;

export type BrandKey = (typeof ALL_BRANDS)[number];

/**
 * The brands to serve: all unless BRANDS names some, e.g. "vw" or "vw,porsche".
 * VW_BRAND is the old name and still works.
 */
export function enabledBrands(env: Record<string, string | undefined> = process.env): BrandKey[] {
  const name = env.BRANDS !== undefined ? "BRANDS" : "VW_BRAND";
  const raw = env[name]?.trim().toLowerCase();
  if (!raw || raw === "all") return [...ALL_BRANDS];
  const keys = [...new Set(raw.split(/[\s,]+/).filter(Boolean))];
  for (const k of keys) {
    if (!ALL_BRANDS.includes(k as BrandKey)) {
      throw new Error(`Unknown ${name} "${env[name]}" (use ${ALL_BRANDS.map((b) => `"${b}"`).join(", ")}, a comma-separated list, or leave it unset for all)`);
    }
  }
  return ALL_BRANDS.filter((b) => keys.includes(b));
}
