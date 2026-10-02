import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { buildApp } from "../../src/app.js";
import { createPool, migrate } from "../../src/database.js";

const pool = createPool(
  process.env.DATABASE_URL ??
    "postgres://invoiceops:invoiceops@localhost:15434/invoiceops",
);
const token = "integration-test-token-with-32-characters";
const roleTokens = {
  issuer: "issuer-integration-token-at-least-32-chars",
  collector: "collector-integration-token-at-least-32-chars",
};
const app = buildApp(pool, token, false, roleTokens);
const auth = { authorization: `Bearer ${token}` };
const input = {
  customer: "Integration Client",
  reference: "PO-100",
  lines: [{ description: "Service", quantity: 2, unitPriceCents: 12000 }],
  taxBasisPoints: 1500,
};

test("role permissions protect issuance and collection and audit the acting role", async () => {
  const issuer = { authorization: `Bearer ${roleTokens.issuer}` };
  const collector = { authorization: `Bearer ${roleTokens.collector}` };
  assert.equal(
    (await app.inject({ url: "/api/v1/session", headers: issuer })).json().role,
    "issuer",
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/invoices",
        headers: { ...collector, "idempotency-key": randomUUID() },
        payload: input,
      })
    ).statusCode,
    403,
  );
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/invoices",
    headers: { ...issuer, "idempotency-key": randomUUID() },
    payload: input,
  });
  assert.equal(created.statusCode, 201);
  const id = created.json().id;
  const command = (
    operation: string,
    expectedVersion: number,
    principal: typeof issuer,
  ) =>
    app.inject({
      method: "POST",
      url: `/api/v1/invoices/${id}/${operation}`,
      headers: { ...principal, "idempotency-key": randomUUID() },
      payload: { expectedVersion },
    });
  assert.equal((await command("issue", 1, collector)).statusCode, 403);
  assert.equal((await command("issue", 1, issuer)).statusCode, 200);
  assert.equal((await command("pay", 2, issuer)).statusCode, 403);
  assert.equal((await command("pay", 2, collector)).json().status, "paid");
  const events = await app.inject({
    url: `/api/v1/invoices/${id}/events`,
    headers: collector,
  });
  assert.deepEqual(
    events.json().items.map((event: { actorRole: string }) => event.actorRole),
    ["issuer", "issuer", "collector"],
  );
  assert.equal(
    (await app.inject({ url: `/api/v1/invoices/${id}/pdf` })).statusCode,
    401,
  );
  const pdf = await app.inject({
    url: `/api/v1/invoices/${id}/pdf`,
    headers: collector,
  });
  assert.equal(pdf.statusCode, 200);
  assert.equal(pdf.headers["content-type"], "application/pdf");
  assert.equal(pdf.headers["cache-control"], "no-store");
  assert.match(
    String(pdf.headers["content-disposition"]),
    /attachment; filename="invoice-/,
  );
  assert.equal(pdf.rawPayload.subarray(0, 5).toString("ascii"), "%PDF-");
});

test("keyset pagination traverses existing invoices once despite an intervening insertion", async () => {
  for (let index = 0; index < 6; index++)
    await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { ...auth, "idempotency-key": randomUUID() },
      payload: { ...input, reference: `PAGE-${index}` },
    });
  const expected = (
    await pool.query<{ id: string }>(
      "SELECT id FROM invoices ORDER BY created_at DESC, id DESC",
    )
  ).rows.map((row) => row.id);
  let page = (
    await app.inject({ url: "/api/v1/invoices?limit=3", headers: auth })
  ).json();
  const ids: string[] = page.items.map((item: { id: string }) => item.id);
  await app.inject({
    method: "POST",
    url: "/api/v1/invoices",
    headers: { ...auth, "idempotency-key": randomUUID() },
    payload: { ...input, reference: "INSERTED-AFTER-FIRST-PAGE" },
  });
  for (let index = 0; page.nextCursor && index < 100; index++) {
    page = (
      await app.inject({
        url: `/api/v1/invoices?limit=3&cursor=${page.nextCursor}`,
        headers: auth,
      })
    ).json();
    ids.push(...page.items.map((item: { id: string }) => item.id));
  }
  assert.deepEqual(ids, expected);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(
    (
      await app.inject({
        url: "/api/v1/invoices?cursor=not-valid-json",
        headers: auth,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ url: "/api/v1/invoices?limit=101", headers: auth }))
      .statusCode,
    400,
  );
});

test("versioned migrations are safely repeatable", async () => {
  await migrate(pool);
  const applied = await pool.query(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  assert.deepEqual(
    applied.rows.map((row) => row.version),
    ["001-invoices.sql", "002-actor-role.sql"],
  );
});
before(async () => {
  await migrate(pool);
  await app.ready();
});
after(async () => {
  await app.close();
  await pool.end();
});

test("auth, strict input, health and bounded telemetry", async () => {
  assert.equal((await app.inject({ url: "/api/v1/invoices" })).statusCode, 401);
  assert.equal((await app.inject({ url: "/health/ready" })).statusCode, 200);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/invoices",
        headers: auth,
        payload: input,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/invoices",
        headers: { ...auth, "idempotency-key": randomUUID() },
        payload: { ...input, status: "paid" },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ url: "/api/v1/invoices/not-a-uuid", headers: auth }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        url: `/api/v1/invoices/${randomUUID()}`,
        headers: auth,
      })
    ).statusCode,
    404,
  );
  const metrics = await app.inject({ url: "/metrics" });
  assert.match(metrics.body, /invoiceops_http_requests_total/);
  assert.doesNotMatch(metrics.body, /not-a-uuid/);
});

test("concurrent retries create one invoice, conflict on different payload, and survive a new process instance", async () => {
  const key = randomUUID();
  const responses = await Promise.all(
    Array.from({ length: 8 }, () =>
      app.inject({
        method: "POST",
        url: "/api/v1/invoices",
        headers: { ...auth, "idempotency-key": key },
        payload: input,
      }),
    ),
  );
  assert.ok(responses.every((response) => response.statusCode === 201));
  assert.equal(
    new Set(responses.map((response) => response.json().id)).size,
    1,
  );
  assert.equal(
    responses.filter(
      (response) => response.headers["idempotency-replayed"] === "false",
    ).length,
    1,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/invoices",
        headers: { ...auth, "idempotency-key": key },
        payload: { ...input, reference: "changed" },
      })
    ).statusCode,
    409,
  );
  const secondApp = buildApp(pool, token, false);
  try {
    const replay = await secondApp.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { ...auth, "idempotency-key": key },
      payload: input,
    });
    assert.equal(replay.headers["idempotency-replayed"], "true");
    assert.equal(replay.json().id, responses[0]?.json().id);
  } finally {
    await secondApp.close();
  }
});

test("concurrent commands enforce expected version and audit consistency", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/invoices",
    headers: { ...auth, "idempotency-key": randomUUID() },
    payload: input,
  });
  const id = created.json().id;
  const outcomes = await Promise.all(
    ["issue", "void"].map((command) =>
      app.inject({
        method: "POST",
        url: `/api/v1/invoices/${id}/${command}`,
        headers: { ...auth, "idempotency-key": randomUUID() },
        payload: { expectedVersion: 1 },
      }),
    ),
  );
  assert.deepEqual(
    outcomes.map((outcome) => outcome.statusCode).sort(),
    [200, 409],
  );
  const events = await app.inject({
    url: `/api/v1/invoices/${id}/events`,
    headers: auth,
  });
  assert.equal(events.json().items.length, 2);
  assert.deepEqual(
    events.json().items.map((event: { version: number }) => event.version),
    [1, 2],
  );
});

test("failed transitions roll back idempotency and payments are final", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/invoices",
    headers: { ...auth, "idempotency-key": randomUUID() },
    payload: input,
  });
  const id = created.json().id;
  const key = randomUUID();
  const command = (
    action: string,
    version: number,
    requestKey = randomUUID(),
  ) =>
    app.inject({
      method: "POST",
      url: `/api/v1/invoices/${id}/${action}`,
      headers: { ...auth, "idempotency-key": requestKey },
      payload: { expectedVersion: version },
    });
  assert.equal((await command("pay", 1, key)).statusCode, 409);
  assert.equal((await command("issue", 1, key)).statusCode, 200);
  const paid = await command("pay", 2);
  assert.equal(paid.json().status, "paid");
  assert.equal((await command("void", 3)).statusCode, 409);
  const events = await app.inject({
    url: `/api/v1/invoices/${id}/events`,
    headers: auth,
  });
  assert.equal(events.json().items.length, 3);
});
