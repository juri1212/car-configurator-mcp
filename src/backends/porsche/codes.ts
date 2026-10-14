/**
 * "pvhw ed55", "https://porsche-code.com/PVHWED55" → "PVHWED55", or null if
 * it isn't shaped like a Porsche Code. Plain codes look like VW Codes.
 */
export function parseCode(raw: string): string | null {
  const link = raw.trim().match(/^(?:https?:\/\/)?(?:www\.)?porsche-code\.com\/([A-Za-z0-9]{8})\/?$/);
  const c = (link?.[1] ?? raw).replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9]{8}$/.test(c) ? c : null;
}

export const codeLink = (code: string) => `https://porsche-code.com/${code}`;

/** Order type, model year and options from a configurator URL (e.g. a loaded code's redirect). */
export function parseConfiguratorUrl(url: URL): { orderType: string; modelYear?: string; options: string } | null {
  const m = url.pathname.match(/\/mode\/[^/]+\/(?:(\d{4})\/)?([^/.]+)$/);
  const options = url.searchParams.get("options");
  if (!m || !options) return null;
  return { orderType: decodeURIComponent(m[2]), modelYear: m[1], options };
}
