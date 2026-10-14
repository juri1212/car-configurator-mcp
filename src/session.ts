import { randomBytes } from "node:crypto";

/** What lists and exports show without asking the backend. */
export interface Snapshot {
  model: string;
  total_price: number | null;
}

export interface Session {
  id: string;
  /** Backend the configuration belongs to; all its requests go there. */
  brand: string;
  label: string;
  /** The backend's own configuration state, handed back to it unchanged. */
  state: unknown;
  snapshot: Snapshot;
  createdAt: Date;
  updatedAt: Date;
  /** Last exported code and its configurator link, if any. */
  code?: { value: string; url: string; expires: string | null; exportedAt: Date };
  importedFrom?: string;
}

export class SessionStore {
  private sessions = new Map<string, Session>();

  create(brand: string, state: unknown, label: string, snapshot: Snapshot, importedFrom?: string): Session {
    let id: string;
    do id = `cfg_${randomBytes(3).toString("hex")}`;
    while (this.sessions.has(id));
    const now = new Date();
    const session: Session = { id, brand, label, state, snapshot, createdAt: now, updatedAt: now, importedFrom };
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

  update(session: Session, state: unknown, snapshot: Snapshot): void {
    session.state = state;
    session.snapshot = snapshot;
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
      model: s.snapshot.model,
      total_price: s.snapshot.total_price,
      configurator_url: s.code?.url ?? null,
      code: s.code?.value ?? null,
      imported_from: s.importedFrom ?? null,
      updated_at: s.updatedAt.toISOString(),
    }));
  }
}
