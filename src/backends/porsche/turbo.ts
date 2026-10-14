// Decoder for React Router's single-fetch format (turbo-stream), as served by
// `<page>.data` on configurator.porsche.com. The first line is a flat table
// of values that refer to each other by index; see SPEC.md.

const SPECIAL: Record<number, unknown> = {
  [-1]: undefined,
  [-2]: NaN,
  [-3]: -Infinity,
  [-4]: -0,
  [-5]: null,
  [-6]: Infinity,
  [-7]: undefined,
};

/** A `.data` response that tells the client to navigate elsewhere. */
export interface Redirect {
  redirect: string;
  status: number;
}

export function decodeTable(table: unknown[]): unknown {
  const memo = new Map<number, unknown>();

  const at = (i: number): unknown => {
    if (i < 0) return SPECIAL[i];
    if (memo.has(i)) return memo.get(i);
    const v = table[i];
    if (Array.isArray(v)) {
      if (typeof v[0] === "string") return typed(i, v[0], v.slice(1) as number[]);
      const out: unknown[] = [];
      memo.set(i, out);
      for (const x of v as number[]) out.push(at(x));
      return out;
    }
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      memo.set(i, out);
      fill(out, v as Record<string, number>);
      return out;
    }
    memo.set(i, v);
    return v;
  };

  /** `{"_<key index>": <value index>}` → `{ key: value }` */
  const fill = (out: Record<string, unknown>, entries: Record<string, number>) => {
    for (const [k, x] of Object.entries(entries)) out[table[Number(k.slice(1))] as string] = at(x);
  };

  const typed = (i: number, tag: string, rest: number[]): unknown => {
    let out: unknown;
    switch (tag) {
      case "D":
      case "U":
      case "B":
        out = rest[0];
        break;
      case "Y":
        out = Symbol.for(String(rest[0]));
        break;
      case "R":
        out = new RegExp(String(rest[0]), String(rest[1] ?? ""));
        break;
      case "S": {
        const set = new Set<unknown>();
        memo.set(i, set);
        for (const x of rest) set.add(at(x));
        return set;
      }
      case "M": {
        const map = new Map<unknown, unknown>();
        memo.set(i, map);
        for (let k = 0; k < rest.length; k += 2) map.set(at(rest[k]), at(rest[k + 1]));
        return map;
      }
      case "N": {
        const obj: Record<string, unknown> = Object.create(null);
        memo.set(i, obj);
        fill(obj, rest[0] as unknown as Record<string, number>);
        return obj;
      }
      case "Z":
        out = at(rest[0]);
        break;
      case "E":
        out = new Error(String(rest[0]));
        break;
      case "SingleFetchRedirect":
        out = { singleFetchRedirect: at(rest[0]) };
        break;
      default:
        // Promises ("P") and plugin types: none of the routes used here send them.
        out = undefined;
    }
    memo.set(i, out);
    return out;
  };

  return at(0);
}

/** Decodes a `.data` body: route id → loader data, or a redirect. */
export function decodeData(body: string): { routes: Record<string, { data?: unknown }> } | Redirect {
  const line = body.split("\n", 1)[0];
  let table: unknown;
  try {
    table = JSON.parse(line);
  } catch {
    throw new Error(`Invalid response from the Porsche configurator: ${body.slice(0, 120)}`);
  }
  if (!Array.isArray(table)) throw new Error("Unexpected response from the Porsche configurator");
  const root = decodeTable(table) as Record<string, unknown> | undefined;
  const redirect = (root as { singleFetchRedirect?: { redirect?: string; status?: number } })?.singleFetchRedirect;
  if (redirect?.redirect) return { redirect: redirect.redirect, status: redirect.status ?? 302 };
  return { routes: (root ?? {}) as Record<string, { data?: unknown }> };
}

export const isRedirect = (x: unknown): x is Redirect => !!x && typeof (x as Redirect).redirect === "string";
