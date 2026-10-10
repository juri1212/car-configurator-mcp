import { randomBytes } from "node:crypto";
import type { BrandKey } from "./brand.js";
import type { VehicleCatalogue, VehicleConfiguration } from "./victor/types.js";
import { totalPrice } from "./configuration.js";

export interface Session {
  id: string;
  /** Configurator the configuration belongs to; all its requests go there. */
  brand: BrandKey;
  label: string;
  vehicleConfiguration: VehicleConfiguration;
  catalogue: VehicleCatalogue;
  createdAt: Date;
  updatedAt: Date;
  /** Last exported VW Code, if any. */
  code?: { value: string; exportedAt: Date };
  importedFrom?: string;
}

/** "Der Golf Style", but "Der Golf GTI" rather than "Der Golf GTI GTI". */
function defaultLabel(vc: VehicleConfiguration): string {
  const base = (vc.salesgroupName ?? vc.carlineName ?? "").trim();
  const trim = vc.equipmentLine?.trim();
  return trim && !base.toLowerCase().endsWith(trim.toLowerCase()) ? `${base} ${trim}` : base;
}

export class SessionStore {
  private sessions = new Map<string, Session>();

  create(
    brand: BrandKey,
    vc: VehicleConfiguration,
    catalogue: VehicleCatalogue,
    label?: string,
    importedFrom?: string,
  ): Session {
    let id: string;
    do id = `cfg_${randomBytes(3).toString("hex")}`;
    while (this.sessions.has(id));
    const now = new Date();
    const session: Session = {
      id,
      brand,
      label: label?.trim() || defaultLabel(vc),
      vehicleConfiguration: vc,
      catalogue,
      createdAt: now,
      updatedAt: now,
      importedFrom,
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): Session {
    const session = this.sessions.get(id.trim());
    if (!session) {
      const known = [...this.sessions.keys()];
      throw new Error(
        `Unknown config_id "${id}". ${known.length ? `Known: ${known.join(", ")}` : "Start one with start_configuration or import_code."}`,
      );
    }
    return session;
  }

  update(session: Session, vc: VehicleConfiguration, catalogue: VehicleCatalogue): void {
    session.vehicleConfiguration = vc;
    session.catalogue = catalogue;
    session.updatedAt = new Date();
    // A code describes the state it was exported from.
    session.code = undefined;
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }

  list() {
    return [...this.sessions.values()].map((s) => ({
      config_id: s.id,
      brand: s.brand,
      label: s.label,
      model: (s.vehicleConfiguration.modelLongName ?? s.vehicleConfiguration.modelName)?.trim(),
      total_price: totalPrice(s.vehicleConfiguration),
      vw_code: s.code?.value ?? null,
      imported_from: s.importedFrom ?? null,
      updated_at: s.updatedAt.toISOString(),
    }));
  }
}
