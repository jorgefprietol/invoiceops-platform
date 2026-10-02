import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const base = process.env.BASE_URL ?? "http://127.0.0.1:18100";
const token =
  process.env.API_TOKEN ??
  readFileSync(".env", "utf8").match(/^API_TOKEN=(.+)$/m)?.[1];
const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};
async function call(path, body, key = randomUUID()) {
  const response = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: { ...headers, "idempotency-key": key },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const value = await response.json();
  assert.ok(
    response.ok,
    `${path}: ${response.status} ${JSON.stringify(value)}`,
  );
  return { value, response };
}
await call("/health/ready");
const body = {
  customer: "Operational Verification",
  reference: "SMOKE",
  lines: [
    { description: "Platform engineering", quantity: 2, unitPriceCents: 12000 },
  ],
  taxBasisPoints: 1500,
};
const key = randomUUID();
const created = await call("/api/v1/invoices", body, key);
assert.equal(created.value.totalCents, 27600);
const replay = await call("/api/v1/invoices", body, key);
assert.equal(replay.value.id, created.value.id);
assert.equal(replay.response.headers.get("idempotency-replayed"), "true");
await call(`/api/v1/invoices/${created.value.id}/issue`, {
  expectedVersion: 1,
});
const paid = await call(`/api/v1/invoices/${created.value.id}/pay`, {
  expectedVersion: 2,
});
assert.equal(paid.value.status, "paid");
assert.equal(
  (await call(`/api/v1/invoices/${created.value.id}/events`)).value.items
    .length,
  3,
);
console.log(
  `Smoke passed: readiness, exact money, durable retry, issue, payment and audit (${created.value.id}).`,
);
