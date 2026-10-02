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
import { DomainError, invoiceInput } from "./domain.js";

export function buildApp(pool: pg.Pool, token: string, logging = true) {
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
    const expected = Buffer.from(`Bearer ${token}`);
    const actual = Buffer.from(request.headers.authorization ?? "");
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
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
  app.get("/api/v1/invoices", async () => ({
    items: await store.list(),
    limit: 100,
  }));
  app.get("/api/v1/invoices/:id", async (request) =>
    store.get(z.object({ id: z.uuid() }).parse(request.params).id),
  );
  app.get("/api/v1/invoices/:id/events", async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    await store.get(id);
    return { items: await store.events(id) };
  });
  app.post("/api/v1/invoices", async (request, reply) => {
    const input = invoiceInput.parse(request.body);
    const key = z
      .string()
      .min(8)
      .max(128)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .parse(request.headers["idempotency-key"]);
    const result = await store.mutate(key, "create", input, (client) =>
      store.create(client, input),
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
      store.command(client, id, command, body.expectedVersion),
    );
    if (result.replayed) replays.inc();
    else changes.inc({ operation: command });
    return reply
      .header("Idempotency-Replayed", String(result.replayed))
      .send(result.invoice);
  });
  return app;
}
