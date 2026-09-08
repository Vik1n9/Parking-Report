import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

class Stmt {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }
  bind(...args) {
    this.args = args.map((a) => (a === undefined ? null : a));
    return this;
  }
  async first() {
    const row = this.db.prepare(this.sql).get(...this.args);
    return row ? { ...row } : null;
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.args).map((row) => ({ ...row })) };
  }
  async run() {
    const info = this.db.prepare(this.sql).run(...this.args);
    return { meta: { last_row_id: Number(info.lastInsertRowid), changes: Number(info.changes) } };
  }
}

export function createTestDb(options = {}) {
  const { migrations = ['0001_init.sql', '0002_seed.sql', '0003_value_model.sql'] } = options;
  const db = new DatabaseSync(':memory:');
  const api = {
    prepare: (sql) => new Stmt(db, sql),
    batch: async (stmts) => {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const stmt of stmts) out.push(await stmt.run());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    applyMigration: (name) => db.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8')),
    close: () => db.close(),
  };
  for (const name of migrations) api.applyMigration(name);
  return api;
}
