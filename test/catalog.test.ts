import { describe, expect, it } from "vitest";
import {
  listModels,
  listVariants,
  parseModelKey,
  resolveCarline,
  resolveStart,
  startParamsForVariant,
} from "../src/backends/victor/catalog.js";
import { overview } from "./helpers.js";

describe("catalog", () => {
  const ov = overview();

  it("parses model keys", () => {
    expect(parseModelKey("30710_37640_AC83AX$GYOSYOS_2027_0")).toEqual({
      carlineKey: "30710",
      salesgroupKey: "37640",
      modelCode: "AC83AX$GYOSYOS",
      modelYear: "2027",
      modelVersion: "0",
    });
  });

  it("resolves carlines by key, exact name and partial name", () => {
    expect(resolveCarline(ov, "30600").name).toBe("Der Golf");
    expect(resolveCarline(ov, "golf").name).toBe("Der Golf");
    expect(resolveCarline(ov, "ID.7").name).toBe("Der ID.7");
    expect(resolveCarline(ov, "tourer").name).toBe("Der ID.7 Tourer");
    expect(resolveCarline(ov, "Golf Variant").key).toBe("30650");
  });

  it("explains ambiguous or unknown carlines", () => {
    expect(() => resolveCarline(ov, "T-")).toThrow(/several models/);
    expect(() => resolveCarline(ov, "Beetle")).toThrow(/No model matches/);
  });

  it("lists models with from-prices and trims", () => {
    const golf = listModels(ov, "golf").find((m) => m.carline === "30600")!;
    expect(golf.from_price).toBeGreaterThan(20000);
    expect(golf.trims).toContain("GTI");
    expect(listModels(ov)).toHaveLength(ov.carlines.length);
  });

  it("groups engines by trim, cheapest first", () => {
    const trims = listVariants(ov, resolveCarline(ov, "golf"));
    const life = trims.find((t) => t.name === "Life")!;
    expect(life.salesgroup).toBe("37505");
    expect(life.engines.length).toBeGreaterThan(3);
    const prices = life.engines.map((e) => e.price!);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(life.engines[0].power).toMatch(/kW \(\d+ PS\)/);
    expect(parseModelKey(life.engines[0].variant_id)).toMatchObject({ carlineKey: "30600", salesgroupKey: "37505" });
  });

  it("starts from a variant id (the overview model key)", () => {
    const style = listVariants(ov, resolveCarline(ov, "golf")).find((t) => t.name === "Style")!;
    const engine = style.engines[1];
    expect(startParamsForVariant(ov, engine.variant_id)).toEqual({
      carlineKey: "30600",
      salesgroupKey: style.salesgroup,
      trimName: "Style",
      modelCode: engine.model_code,
      modelYear: engine.model_year,
    });
    // A different model version still resolves.
    expect(startParamsForVariant(ov, engine.variant_id.replace(/_\d+$/, "_9")).modelCode).toBe(engine.model_code);
    expect(() => startParamsForVariant(ov, "nope")).toThrow(/Unknown variant_id/);
  });

  it("resolves trim and engine for start_configuration", () => {
    const golf = resolveCarline(ov, "golf");
    const { trim, engine } = resolveStart(ov, golf, "gti");
    expect(trim.name).toBe("GTI");
    expect(engine).toBeUndefined();

    const code = listVariants(ov, golf).find((t) => t.name === "Style")!.engines[1].model_code;
    const picked = resolveStart(ov, golf, "Style", code);
    expect(picked.engine?.model_code).toBe(code);

    expect(() => resolveStart(ov, golf, "Highline")).toThrow(/Available/);
  });
});
