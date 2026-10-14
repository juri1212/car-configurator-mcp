export const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/^(der|die|das)\s+/, "")
    .replace(/^neue\s+/, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();

/**
 * Finds a carline by key or (partial) name. Throws with candidates if ambiguous.
 * `describe` names a candidate in error messages.
 */
export function matchCarline<C extends { key: string; name: string }>(
  carlines: C[],
  query: string,
  describe: (c: C) => string = (c) => `${c.name} (${c.key})`,
): C {
  const byKey = carlines.find((c) => c.key === query.trim());
  if (byKey) return byKey;
  const q = normalise(query);
  const exact = carlines.filter((c) => normalise(c.name) === q);
  if (exact.length === 1) return exact[0];
  const partial = carlines.filter((c) => normalise(c.name).includes(q));
  if (partial.length === 1) return partial[0];
  const names = (exact.length ? exact : partial.length ? partial : carlines).map(describe);
  throw new Error(
    partial.length
      ? `"${query}" matches several models: ${names.join(", ")}`
      : `No model matches "${query}". Available: ${names.join(", ")}`,
  );
}
