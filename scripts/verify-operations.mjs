import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const values = Object.fromEntries(
  readFileSync(".env", "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);
const base = process.env.BASE_URL ?? `http://127.0.0.1:${values.WEB_PORT}`;
const headers = {
  connection: "close",
  authorization: `Bearer ${values.API_TOKEN}`,
  "content-type": "application/json",
  "idempotency-key": randomUUID(),
};
const body = {
  customer: "Durability verification",
  reference: "OPERATIONS",
  lines: [{ description: "Infrastructure", quantity: 1, unitPriceCents: 9900 }],
  taxBasisPoints: 0,
};
const response = await fetch(`${base}/api/v1/invoices`, {
  method: "POST",
  headers,
  body: JSON.stringify(body),
});
assert.equal(response.status, 201);
const invoice = await response.json();
const compose = (args) =>
  execFileSync("docker", ["compose", "--profile", "observability", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
compose(["stop", "postgres"]);
try {
  assert.equal(
    (await fetch(`${base}/health/live`, { signal: AbortSignal.timeout(10000) }))
      .status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/health/ready`, {
        signal: AbortSignal.timeout(10000),
      })
    ).status,
    503,
  );
} finally {
  compose(["start", "postgres"]);
}
for (let attempt = 0; attempt < 60; attempt++) {
  const ready = await fetch(`${base}/health/ready`, {
    signal: AbortSignal.timeout(10000),
  });
  if (ready.ok) break;
  await new Promise((done) => setTimeout(done, 1000));
}
compose(["up", "-d", "--no-build", "--force-recreate", "--wait", "api", "web"]);
const persisted = await fetch(`${base}/api/v1/invoices/${invoice.id}`, {
  headers,
});
assert.equal(persisted.status, 200);
assert.equal((await persisted.json()).totalCents, 9900);
const replay = await fetch(`${base}/api/v1/invoices`, {
  method: "POST",
  headers,
  body: JSON.stringify(body),
});
assert.equal(replay.headers.get("idempotency-replayed"), "true");
assert.equal((await replay.json()).id, invoice.id);
const prometheus = `http://127.0.0.1:${values.PROMETHEUS_PORT}`;
let healthy = false;
for (let attempt = 0; attempt < 30; attempt++) {
  const result = await (
    await fetch(`${prometheus}/api/v1/query?query=up`)
  ).json();
  healthy = result.data.result.some(
    (series) =>
      series.metric.job === "invoiceops-api" && series.value[1] === "1",
  );
  if (healthy) break;
  await new Promise((done) => setTimeout(done, 1000));
}
assert.ok(healthy, "Prometheus must scrape the API");
mkdirSync(".artifacts", { recursive: true });
writeFileSync(
  ".artifacts/operations-verification.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      invoice: invoice.id,
      tests: [
        "database-outage",
        "liveness-independent",
        "readiness-unavailable",
        "durable-invoice",
        "durable-idempotency",
        "prometheus-scrape",
      ],
    },
    null,
    2,
  ),
);
console.log(
  "Operations passed: database outage, recovery, container recreation, persistence, deduplication and Prometheus scrape.",
);
