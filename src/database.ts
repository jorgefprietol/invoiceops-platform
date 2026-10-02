import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import {
  type Command,
  DomainError,
  type Invoice,
  type InvoiceInput,
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
    const sql = await readFile(
      new URL("../../db/001-invoices.sql", import.meta.url),
      "utf8",
    );
    await client.query(sql);
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
    async list() {
      const result = await pool.query<{ document: Invoice }>(
        "SELECT document FROM invoices ORDER BY created_at DESC, id DESC LIMIT 100",
      );
      return result.rows.map((row) => row.document);
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
        'SELECT event_type AS type, version, occurred_at AS "occurredAt" FROM invoice_events WHERE invoice_id=$1 ORDER BY version',
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
    async create(client: pg.PoolClient, input: InvoiceInput) {
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
        "INSERT INTO invoice_events(invoice_id, version, event_type) VALUES ($1,1,'created')",
        [invoice.id],
      );
      return invoice;
    },
    async command(
      client: pg.PoolClient,
      id: string,
      command: Command,
      version: number,
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
        "INSERT INTO invoice_events(invoice_id, version, event_type) VALUES ($1,$2,$3)",
        [id, invoice.version, command],
      );
      return invoice;
    },
  };
}
