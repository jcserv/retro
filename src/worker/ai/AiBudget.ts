import { DurableObject } from "cloudflare:workers";

const RETAIN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export class AiBudget extends DurableObject<Env> {
  readonly #sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#sql = ctx.storage.sql;
    this.#sql.exec(
      "CREATE TABLE IF NOT EXISTS usage (day TEXT PRIMARY KEY, count INTEGER NOT NULL)",
    );
  }

  reserve(day: string, cap: number): boolean {
    return this.ctx.storage.transactionSync(() => {
      const oldest = utcDay(Date.parse(day) - RETAIN_DAYS * DAY_MS);
      this.#sql.exec("DELETE FROM usage WHERE day < ?", oldest);
      const used =
        this.#sql.exec<{ count: number }>("SELECT count FROM usage WHERE day = ?", day).toArray()[0]
          ?.count ?? 0;
      if (used >= cap) return false;
      this.#sql.exec(
        `INSERT INTO usage (day, count) VALUES (?, 1)
         ON CONFLICT (day) DO UPDATE SET count = count + 1`,
        day,
      );
      return true;
    });
  }
}
