import { timingSafeEqual } from "node:crypto";
import {
  Counter,
  collectDefaultMetrics,
  Histogram,
  Registry,
} from "@prometheus-io/client";
import Fastify from "fastify";
import type pg from "pg";
import { z } from "zod";
import { repository } from "./database.js";
import {
  authorize,
  DomainError,
  invoiceInput,
  pageQuery,
  type Role,
} from "./domain.js";
import { invoicePdf } from "./pdf.js";

declare module "fastify" {
  interface FastifyRequest {
    role: Role | null;
  }
}

export function buildApp(
  pool: pg.Pool,
  token: string,
  logging = true,
  roleTokens: { issuer?: string; collector?: string } = {},
) {
  if (token.length < 32)
    throw new Error("API_TOKEN must contain at least 32 characters");
  const app = Fastify({
    logger: logging
      ? {
          level: "info",
          redact: ["req.headers.authorization", "req.headers.cookie"],
        }
      : false,
    bodyLimit: 65536,
    requestTimeout: 15000,
    connectionTimeout: 10000,
  });
  const credentials: Array<{ role: Role; value: string }> = [
    { role: "admin", value: token },
  ];
  for (const role of ["issuer", "collector"] as const) {
    const value = roleTokens[role];
    if (!value) continue;
    if (
      value.length < 32 ||
      credentials.some((credential) => credential.value === value)
    )
      throw new Error(
        "Role tokens must be unique and contain at least 32 characters",
      );
    credentials.push({ role, value });
  }
  app.decorateRequest("role", null);
  const store = repository(pool);
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  const requests = new Counter({
    name: "invoiceops_http_requests_total",
    help: "HTTP responses",
    labelNames: ["route", "method", "status"],
    registers: [registry],
  });
  const latency = new Histogram({
    name: "invoiceops_http_duration_seconds",
    help: "HTTP request duration",
    labelNames: ["route"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });
  const changes = new Counter({
    name: "invoiceops_mutations_total",
    help: "Committed invoice mutations",
    labelNames: ["operation"],
    registers: [registry],
  });
  const replays = new Counter({
    name: "invoiceops_idempotency_replays_total",
    help: "Deduplicated requests",
    registers: [registry],
  });
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    reply.header("Cache-Control", "no-store");
    const actual = Buffer.from(request.headers.authorization ?? "");
    for (const credential of credentials) {
      const expected = Buffer.from(`Bearer ${credential.value}`);
      if (
        actual.length === expected.length &&
        timingSafeEqual(actual, expected)
      )
        request.role = credential.role;
    }
    if (!request.role) {
      return reply
        .code(401)
        .send({ code: "unauthorized", requestId: request.id });
    }
  });
  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url ?? "unmatched";
    if (route === "/metrics" || route.startsWith("/health/")) return;
    requests.inc({ route, method: request.method, status: reply.statusCode });
    latency.observe({ route }, reply.elapsedTime / 1000);
  });
  app.addHook("onClose", async () => {
    registry.clear();
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ code: "invalid_request", requestId: request.id });
    if (error instanceof DomainError)
      return reply
        .code(error.status)
        .send({ code: error.code, requestId: request.id });
    const status =
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode < 500
        ? error.statusCode
        : 500;
    if (status === 500) request.log.error({ err: error }, "request failed");
    return reply.code(status).send({
      code: status === 500 ? "internal_error" : "invalid_request",
      requestId: request.id,
    });
  });
  app.get("/health/live", async () => ({
    status: "alive",
    revision: process.env.APP_REVISION ?? "development",
  }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      await store.ready();
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });
  app.get("/metrics", async (_request, reply) =>
    reply.type(registry.contentType).send(await registry.metrics()),
  );
  app.get("/api/v1/session", async (request) => ({ role: request.role }));
  app.get("/api/v1/invoices", async (request) => {
    const { limit, cursor } = pageQuery.parse(request.query);
    return store.list(limit, cursor);
  });
  app.get("/api/v1/invoices/:id/pdf", async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const invoice = await store.get(id);
    return reply
      .type("application/pdf")
      .header("Cache-Control", "no-store")
      .header("Content-Disposition", `attachment; filename="invoice-${id}.pdf"`)
      .send(await invoicePdf(invoice));
  });
  app.get("/api/v1/invoices/:id", async (request) =>
    store.get(z.object({ id: z.uuid() }).parse(request.params).id),
  );
  app.get("/api/v1/invoices/:id/events", async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    await store.get(id);
    return { items: await store.events(id) };
  });
  app.post("/api/v1/invoices", async (request, reply) => {
    authorize(request.role ?? "collector", "create");
    const input = invoiceInput.parse(request.body);
    const key = z
      .string()
      .min(8)
      .max(128)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .parse(request.headers["idempotency-key"]);
    const result = await store.mutate(key, "create", input, (client) =>
      store.create(client, input, request.role ?? "collector"),
    );
    if (result.replayed) replays.inc();
    else changes.inc({ operation: "create" });
    return reply
      .code(201)
      .header("Idempotency-Replayed", String(result.replayed))
      .send(result.invoice);
  });
  app.post("/api/v1/invoices/:id/:command", async (request, reply) => {
    const { id, command } = z
      .object({ id: z.uuid(), command: z.enum(["issue", "pay", "void"]) })
      .parse(request.params);
    authorize(request.role ?? "collector", command);
    const body = z
      .object({ expectedVersion: z.number().int().min(1).max(2147483646) })
      .strict()
      .parse(request.body);
    const key = z
      .string()
      .min(8)
      .max(128)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .parse(request.headers["idempotency-key"]);
    const result = await store.mutate(key, `${id}/${command}`, body, (client) =>
      store.command(
        client,
        id,
        command,
        body.expectedVersion,
        request.role ?? "collector",
      ),
    );
    if (result.replayed) replays.inc();
    else changes.inc({ operation: command });
    return reply
      .header("Idempotency-Replayed", String(result.replayed))
      .send(result.invoice);
  });
  return app;
}
