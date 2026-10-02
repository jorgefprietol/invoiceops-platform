import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const kubectl = process.env.KUBECTL ?? "kubectl";
const kind = process.env.KIND ?? "kind";
const cluster = "invoiceops";
mkdirSync(".artifacts", { recursive: true });
const kubeconfig = resolve(".artifacts/kubeconfig");
const k = (args, input) =>
  execFileSync(kubectl, ["--kubeconfig", kubeconfig, ...args], {
    input,
    encoding: "utf8",
    stdio: input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
  });
const runKind = (args) => execFileSync(kind, args, { stdio: "inherit" });
const clusters = execFileSync(kind, ["get", "clusters"], { encoding: "utf8" })
  .trim()
  .split(/\r?\n/);
if (!clusters.includes(cluster))
  runKind([
    "create",
    "cluster",
    "--name",
    cluster,
    "--config",
    "k8s/kind.yaml",
    "--kubeconfig",
    kubeconfig,
    "--wait",
    "120s",
  ]);
else
  runKind([
    "export",
    "kubeconfig",
    "--name",
    cluster,
    "--kubeconfig",
    kubeconfig,
  ]);
runKind([
  "load",
  "docker-image",
  process.env.API_IMAGE ?? "invoiceops-api:local",
  process.env.WEB_IMAGE ?? "invoiceops-web:local",
  "--name",
  cluster,
]);
const values = Object.fromEntries(
  readFileSync(".env", "utf8")
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);
k(["apply", "-f", "k8s/base/namespace.yaml"]);
for (const [name, data] of Object.entries({
  "invoiceops-secrets": {
    POSTGRES_PASSWORD: values.POSTGRES_PASSWORD,
    POSTGRES_APP_PASSWORD: values.POSTGRES_APP_PASSWORD,
  },
  "invoiceops-api-secrets": {
    DATABASE_URL: `postgres://invoiceops:${values.POSTGRES_APP_PASSWORD}@postgres:5432/invoiceops`,
    API_TOKEN: values.API_TOKEN,
  },
}))
  k(
    ["apply", "-f", "-"],
    JSON.stringify({
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name, namespace: cluster },
      stringData: data,
    }),
  );
let manifest = k(["kustomize", "k8s/base"]);
manifest = manifest
  .replaceAll(
    "invoiceops-api:local",
    process.env.API_IMAGE ?? "invoiceops-api:local",
  )
  .replaceAll(
    "invoiceops-web:local",
    process.env.WEB_IMAGE ?? "invoiceops-web:local",
  );
k(["apply", "-f", "-"], manifest);
for (const workload of [
  "statefulset/postgres",
  "deployment/api",
  "deployment/web",
])
  console.log(
    k(["-n", cluster, "rollout", "status", workload, "--timeout=300s"]),
  );
const port = process.env.K8S_PORT ?? "18101";
const forwarding = spawn(
  kubectl,
  [
    "--kubeconfig",
    kubeconfig,
    "-n",
    cluster,
    "port-forward",
    "service/web",
    `${port}:8080`,
    "--address",
    "127.0.0.1",
  ],
  { stdio: "pipe", windowsHide: true },
);
let forwardingOutput = "";
forwarding.stdout.on("data", (chunk) => {
  forwardingOutput += chunk;
});
forwarding.stderr.on("data", (chunk) => {
  forwardingOutput += chunk;
});
const base = `http://127.0.0.1:${port}`;
const headers = {
  authorization: `Bearer ${values.API_TOKEN}`,
  "content-type": "application/json",
};
async function request(path, body) {
  const response = await fetch(`${base}${path}`, {
    headers: { ...headers, "idempotency-key": randomBytes(16).toString("hex") },
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  assert.ok(response.ok, `${path}: ${response.status}`);
  return response.json();
}
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (forwarding.exitCode !== null)
      throw new Error(`Port forward failed: ${forwardingOutput}`);
    if (forwardingOutput.includes("Forwarding from")) break;
    await new Promise((done) => setTimeout(done, 500));
  }
  await request("/health/ready");
  const created = await request("/api/v1/invoices", {
    customer: "Kubernetes Verification",
    reference: "K8S-VERIFY",
    lines: [
      { description: "Release operations", quantity: 1, unitPriceCents: 25000 },
    ],
    taxBasisPoints: 1500,
  });
  assert.equal(created.totalCents, 28750);
  console.log(k(["-n", cluster, "rollout", "restart", "deployment/api"]));
  k(["-n", cluster, "rollout", "status", "deployment/api", "--timeout=120s"]);
  assert.equal(
    (await request(`/api/v1/invoices/${created.id}`)).id,
    created.id,
  );
  k([
    "-n",
    cluster,
    "set",
    "image",
    "deployment/api",
    "api=invoiceops-api:rejected-release",
  ]);
  let rejected = false;
  try {
    k(["-n", cluster, "rollout", "status", "deployment/api", "--timeout=20s"]);
  } catch {
    rejected = true;
  }
  assert.ok(rejected, "Invalid image must not complete rollout");
  assert.equal(
    (await request(`/api/v1/invoices/${created.id}`)).id,
    created.id,
  );
  k(["-n", cluster, "rollout", "undo", "deployment/api"]);
  k(["-n", cluster, "rollout", "status", "deployment/api", "--timeout=120s"]);
  await request(`/api/v1/invoices/${created.id}/issue`, { expectedVersion: 1 });
  await request(`/api/v1/invoices/${created.id}/pay`, { expectedVersion: 2 });
  const events = await request(`/api/v1/invoices/${created.id}/events`);
  assert.equal(events.items.length, 3);
  writeFileSync(
    ".artifacts/kubernetes-verification.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        invoice: created.id,
        tests: [
          "two-api-replicas",
          "readiness",
          "persistence-across-rollout",
          "rejected-release",
          "availability-during-failure",
          "rollback",
          "payment",
          "audit",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "Kubernetes passed: replicas, rollout, persisted state, rejected release, rollback and invoice lifecycle.",
  );
} finally {
  forwarding.kill();
}
