import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Applies the migration history to a real Postgres running in-process.
 *
 * A migration that does not apply is only discovered at deploy time otherwise,
 * against the production database, which is the worst possible moment. PGlite
 * has no pgvector, so the baseline's vector-specific statements (for a table a
 * later migration drops) are swapped for equivalents — everything else runs
 * exactly as written, which is what catches a malformed or inconsistent migration.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((entry) => !entry.endsWith('.toml'))
    .sort()
    .map((dir) => ({ dir, sql: readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8') }));
}

function toPortableSql(sql: string) {
  return sql
    .replace(/CREATE EXTENSION IF NOT EXISTS "vector";/g, '')
    .replace(/vector\(1536\)/g, 'text')
    .replace(/CREATE INDEX IF NOT EXISTS "dop_embedding_hnsw"[\s\S]*?;/g, '');
}

describe('migration history', () => {
  let db: PGlite;

  before(async () => {
    db = new PGlite();
    for (const { sql } of migrationFiles()) {
      await db.exec(toPortableSql(sql));
    }
  });

  after(async () => {
    await db?.close();
  });

  it('applies every migration in order', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    // Every model in the schema must end up as a table.
    const names = rows.map((row) => row.table_name);
    for (const expected of [
      'User',
      'Project',
      'Script',
      'Scene',
      'Equipment',
      'VendorInventoryItem',
      'ProjectRecommendation',
      'AnalysisState',
      'SupportThread',
      'SupportMessage',
      'ProjectChatMessage',
      'PasswordResetToken',
      'RateLimit',
      'AgentRun',
      'AgentToolCall',
    ]) {
      assert.ok(names.includes(expected), `missing table ${expected}`);
    }
    // The inquiry threads went with the vendor and cinematographer accounts.
    assert.ok(!names.includes('Inquiry'), 'Inquiry should have been dropped');
  });

  it('wires up the foreign keys', async () => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.table_constraints
       WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public'`,
    );
    assert.ok(rows[0].n >= 20, `expected the relation graph, found ${rows[0].n} foreign keys`);
  });

  it('keeps the analysis checkpoint columns the orchestrator resumes from', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'AnalysisState'`,
    );
    const columns = rows.map((row) => row.column_name);
    for (const expected of ['stage', 'sceneCursor', 'leaseOwner', 'leaseUntil', 'locale']) {
      assert.ok(columns.includes(expected), `missing AnalysisState.${expected}`);
    }
  });

  it('cascades a deleted project to its analysis state', async () => {
    const { rows } = await db.query<{ delete_rule: string }>(
      `SELECT rc.delete_rule
       FROM information_schema.referential_constraints rc
       JOIN information_schema.table_constraints tc ON tc.constraint_name = rc.constraint_name
       WHERE tc.table_name = 'AnalysisState'`,
    );
    assert.equal(rows[0]?.delete_rule, 'CASCADE');
  });

  it('leaves nothing of the cinematographers behind', async () => {
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Dop'`,
    );
    assert.equal(tables.rows.length, 0);

    const columns = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name IN ('matchedDops', 'dops', 'userId') AND table_name IN
         ('ProjectRecommendation', 'RecommendationVersion', 'AnalysisState', 'Vendor')`,
    );
    assert.deepEqual(columns.rows, []);

    const labels = await db.query<{ enumlabel: string }>(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname IN ('Role', 'AgentName', 'AnalysisStage')`,
    );
    const names = labels.rows.map((row) => row.enumlabel);
    for (const gone of ['VENDOR', 'DOP', 'DOP_MATCH', 'DOPS']) assert.ok(!names.includes(gone), gone);
    for (const kept of ['ADMIN', 'PRODUCER', 'VENDOR_BUDGET', 'ADVISE']) assert.ok(names.includes(kept), kept);
  });

  it('has a provider lock so a second engine cannot be applied by accident', () => {
    const lock = readFileSync(join(MIGRATIONS_DIR, 'migration_lock.toml'), 'utf8');
    assert.match(lock, /provider = "postgresql"/);
  });
});

describe('incremental migrations', () => {
  it('applies later migrations on top of the baseline', async () => {
    // A fresh database, so the whole history runs in order.
    const db = new PGlite();
    try {
      for (const { sql } of migrationFiles()) {
        await db.exec(toPortableSql(sql));
      }
      const { rows } = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'ProjectRecommendation' AND column_name = 'editedAt'`,
      );
      assert.equal(rows.length, 1, 'editedAt should exist after the package-edits migration');
    } finally {
      await db.close();
    }
  });

  it('keeps migrations in a stable, sortable order', () => {
    const dirs = migrationFiles().map((file) => file.dir);
    assert.deepEqual([...dirs].sort(), dirs, 'migration folders must sort chronologically');
  });
});
