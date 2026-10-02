import { buildApp } from "./app.js";
import { createPool, migrate } from "./database.js";

const pool = createPool(process.env.DATABASE_URL ?? "");
pool.on("error", (error) => {
  console.error(
    JSON.stringify({
      level: "error",
      message: "database pool error",
      code: error.name,
    }),
  );
});
await migrate(pool);
if (process.argv.includes("--migrate")) {
  await pool.end();
  process.exit(0);
}
const app = buildApp(pool, process.env.API_TOKEN ?? "", true, {
  issuer: process.env.API_ISSUER_TOKEN,
  collector: process.env.API_COLLECTOR_TOKEN,
});
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) });
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const deadline = setTimeout(() => process.exit(1), 10000).unref();
    await app.close();
    await pool.end();
    clearTimeout(deadline);
    process.exit(0);
  });
}
