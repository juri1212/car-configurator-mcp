import { describe, expect, it } from "vitest";
import type { OptionCategory } from "../src/core/types.js";
import {
  diffConfigurations,
  effectiveConfiguration,
  grossPrice,
  listOptions,
  netPrice,
  summarise,
  totalPrice,
} from "../src/backends/victor/configuration.js";
import { id4Start, idBuzzStart, poloStart, poloStepIqDrive } from "./helpers.js";

describe("configuration", () => {
  const start = poloStart();
  const startVc = effectiveConfiguration(start);

  it("uses the solved configuration when the backend resolved a conflict", () => {
    const step = poloStepIqDrive();
    expect(step.validationData.conflicted).toBe(true);
    expect(effectiveConfiguration(step)).toBe(step.solvedVehicleConfiguration);
  });

  it("lists visible options with selection state, excluding standard equipment", () => {
    const options = listOptions(start.vehicleCatalogue, totalPrice(startVc));
    expect(options.some((o) => o.category === "standard")).toBe(false);
    const paint = options.find((o) => o.code === "F14 3Y3Y")!;
    expect(paint).toMatchObject({ name: "Crystal Ice Blue Metallic", price: 690, selected: false, category: "paint" });
    const iq = options.find((o) => o.code === "GPF3PF3")!;
    expect(iq.contains?.map((c) => c.code)).toEqual(["MGRA8T7", "MSRH6I2", "MAWV6K4"]);
    expect(iq.category).toBe("packages");
  });

  it("maps Victor categories onto the shared ones", () => {
    const total = totalPrice(startVc);
    const of = (category: OptionCategory) => listOptions(start.vehicleCatalogue, total, { category });
    expect(of("paint").every((o) => o.category === "paint")).toBe(true);
    expect(of("packages").map((o) => o.code)).toContain("GPF3PF3");
    expect(of("options").map((o) => o.code)).not.toContain("GPF3PF3");
    expect(of("options").every((o) => !o.contains)).toBe(true);
    expect(of("standard").length).toBeGreaterThan(0);
  });

  it("filters options by search, selectability and budget", () => {
    const total = totalPrice(startVc)!;
    expect(listOptions(start.vehicleCatalogue, total, { search: "iq.drive" }).map((o) => o.code)).toEqual(["GPF3PF3"]);
    const selectable = listOptions(start.vehicleCatalogue, total, { onlySelectable: true });
    expect(selectable.every((o) => !o.selected && !o.standard)).toBe(true);
    const budget = listOptions(start.vehicleCatalogue, total, { maxTotalPrice: total + 500 });
    expect(budget.every((o) => o.selected || (o.price ?? 0) <= 500)).toBe(true);
    expect(budget.find((o) => o.code === "GPPNPPN")).toBeUndefined(); // 1,560 €
  });

  it("diffs a step: requested change, side effects and price change", () => {
    const diff = diffConfigurations(start.vehicleCatalogue, startVc, poloStepIqDrive(), ["GPF3PF3"], []);
    expect(diff.applied).toBe(true);
    expect(diff.conflict_resolved).toBe(true);
    expect(diff.price_before).toBe(29525);
    expect(diff.price_after).toBe(29930);
    expect(diff.price_change).toBe(405);
    // Package contents are not reported as side effects.
    expect(diff.side_effects.added.map((o) => o.code)).not.toContain("MGRA8T7");
    // Standard parts superseded by the package are reported separately, not as removals.
    expect(diff.side_effects.removed).toEqual([]);
    expect(diff.side_effects.standard_replaced.length).toBeGreaterThan(0);
    expect(diff.choices_required).toEqual([]);
  });

  it("reports requested changes the backend did not apply", () => {
    const diff = diffConfigurations(start.vehicleCatalogue, startVc, poloStepIqDrive(), ["GPJ9PJ9"], []);
    expect(diff.applied).toBe(false);
    expect(diff.not_applied.add).toEqual(["GPJ9PJ9"]);
  });

  it("summarises prices, colours and efficiency", () => {
    const sum = summarise(startVc, start.vehicleCatalogue);
    expect(sum.model.trim).toBe("EDITION 50");
    expect(sum.exterior?.name).toBe("Ascotgrau");
    expect(sum.prices.total).toBe(29525);
    expect(sum.efficiency?.co2_class).toBe("D");
    expect(sum.prices.currency).toBe("EUR");
    expect(sum.model.variant_id).toBe("30204_37057_AE14AV$MAAUE50$GWS3WS3$GYOSYOS_2027_0");
    expect(sum.performance.power).toBe("70 kW (95 PS)");
    expect(sum.performance.top_speed).toMatch(/km\/h/);
    expect(sum).not.toHaveProperty("technical_data");
  });

  it("includes electric range and technical data for EVs", () => {
    const ev = id4Start();
    const sum = summarise(effectiveConfiguration(ev), ev.vehicleCatalogue, { technical: true });
    expect(sum.efficiency?.engine_type).toBe("PEV");
    expect(sum.efficiency?.electric_range_wltp).toBe("428 km");
    expect(sum.technical_data?.["Batterie / Ladesystem"]?.["Maximale DC Ladeleistung"]).toBe("105 kW");
  });

  describe("commercial vehicle prices", () => {
    const buzz = idBuzzStart();
    const buzzVc = effectiveConfiguration(buzz);

    it("picks gross and net prices from the backend's price list", () => {
      const prices = [
        { currency: "EUR", price: 870, type: "price", vatIncluded: false },
        { currency: "EUR", price: 1035.3, type: "Gross", vatIncluded: false },
        { currency: "EUR", price: 165.3, type: "Gross Delta", vatIncluded: false },
      ];
      expect(grossPrice(prices)).toBe(1035.3);
      expect(netPrice(prices)).toBe(870);
      const car = [{ currency: "EUR", price: 690, type: "price", vatIncluded: true }];
      expect(grossPrice(car)).toBe(690);
      expect(netPrice(car)).toBeNull();
    });

    it("reports gross prices with a net total", () => {
      const sum = summarise(buzzVc, buzz.vehicleCatalogue);
      expect(sum.prices.total).toBe(52270.75);
      expect(sum.prices.net_total).toBe(43925);
      expect(summarise(startVc, start.vehicleCatalogue).prices).not.toHaveProperty("net_total");
      const paint = listOptions(buzz.vehicleCatalogue, totalPrice(buzzVc)).find((o) => o.code === "F14 C4C4")!;
      expect(paint).toMatchObject({ name: "Bay Leaf Green Metallic", price: 1035.3 });
    });
  });
});
