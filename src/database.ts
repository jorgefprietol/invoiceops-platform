import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import {
  type Command,
  DomainError,
  decodeCursor,
  type Invoice,
  type InvoiceInput,
  type Role,
  totals,
  transition,
} from "./domain.js";

export function createPool(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30000,
    query_timeout: 5000,
    statement_timeout: 5000,
  });
  return pool;
}

export async function migrate(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(8129100)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const directory = new URL("../../db/", import.meta.url);
    for (const version of (await readdir(directory))
      .filter((file) => /^\d{3}-.+\.sql$/.test(file))
      .sort()) {
      const sql = await readFile(new URL(version, directory), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const previous = await client.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE version=$1",
        [version],
      );
      if (previous.rows[0]) {
        if (previous.rows[0].checksum !== checksum)
          throw new Error(`Migration checksum mismatch: ${version}`);
        continue;
      }
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations(version, checksum) VALUES ($1,$2)",
        [version, checksum],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function repository(pool: pg.Pool) {
  return {
    async ready() {
      await pool.query("SELECT 1 FROM invoices LIMIT 1");
    },
    async list(limit: number, cursor?: string) {
      const after = cursor ? decodeCursor(cursor) : undefined;
      const result = await pool.query<{
        document: Invoice;
        cursor_time: string;
      }>(
        `SELECT document, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time FROM invoices
         WHERE ($1::timestamptz IS NULL OR (created_at, id) < ($1::timestamptz, $2::uuid))
         ORDER BY created_at DESC, id DESC LIMIT $3`,
        [after?.createdAt ?? null, after?.id ?? null, limit + 1],
      );
      const rows = result.rows.slice(0, limit);
      const last = rows.at(-1);
      const nextCursor =
        result.rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                createdAt: last.cursor_time,
                id: last.document.id,
              }),
            ).toString("base64url")
          : null;
      return { items: rows.map((row) => row.document), nextCursor, limit };
    },
    async get(id: string) {
      const result = await pool.query<{ document: Invoice }>(
        "SELECT document FROM invoices WHERE id=$1",
        [id],
      );
      const row = result.rows[0];
      if (!row) throw new DomainError(404, "invoice_not_found");
      return row.document;
    },
    async events(id: string) {
      const result = await pool.query(
        'SELECT event_type AS type, version, actor_role AS "actorRole", occurred_at AS "occurredAt" FROM invoice_events WHERE invoice_id=$1 ORDER BY version',
        [id],
      );
      return result.rows;
    },
    async mutate(
      key: string,
      operation: string,
      payload: unknown,
      mutate: (client: pg.PoolClient) => Promise<Invoice>,
    ) {
      const hash = createHash("sha256")
        .update(JSON.stringify({ operation, payload }))
        .digest("hex");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Serialize the same key across API replicas; the response commits with the invoice and audit event.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [key],
        );
        const previous = await client.query<{
          request_hash: string;
          response: Invoice;
        }>("SELECT request_hash, response FROM idempotency WHERE key=$1", [
          key,
        ]);
        if (previous.rows[0]) {
          if (previous.rows[0].request_hash !== hash)
            throw new DomainError(409, "idempotency_conflict");
          await client.query("COMMIT");
          return { invoice: previous.rows[0].response, replayed: true };
        }
        const invoice = await mutate(client);
        await client.query(
          "INSERT INTO idempotency(key, request_hash, response) VALUES ($1,$2,$3)",
          [key, hash, invoice],
        );
        await client.query("COMMIT");
        return { invoice, replayed: false };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async create(
      client: pg.PoolClient,
      input: InvoiceInput,
      role: Role = "admin",
    ) {
      const invoice: Invoice = {
        ...input,
        ...totals(input),
        id: randomUUID(),
        status: "draft",
        version: 1,
        createdAt: new Date().toISOString(),
      };
      await client.query("INSERT INTO invoices(id, document) VALUES ($1,$2)", [
        invoice.id,
        invoice,
      ]);
      await client.query(
        "INSERT INTO invoice_events(invoice_id, version, event_type, actor_role) VALUES ($1,1,'created',$2)",
        [invoice.id, role],
      );
      return invoice;
    },
    async command(
      client: pg.PoolClient,
      id: string,
      command: Command,
      version: number,
      role: Role = "admin",
    ) {
      const result = await client.query<{ document: Invoice }>(
        "SELECT document FROM invoices WHERE id=$1 FOR UPDATE",
        [id],
      );
      const row = result.rows[0];
      if (!row) throw new DomainError(404, "invoice_not_found");
      if (row.document.version !== version)
        throw new DomainError(409, "version_conflict");
      const invoice = {
        ...row.document,
        status: transition(row.document.status, command),
        version: version + 1,
      };
      await client.query("UPDATE invoices SET document=$2 WHERE id=$1", [
        id,
        invoice,
      ]);
      await client.query(
        "INSERT INTO invoice_events(invoice_id, version, event_type, actor_role) VALUES ($1,$2,$3,$4)",
        [id, invoice.version, command, role],
      );
      return invoice;
    },
  };
}
