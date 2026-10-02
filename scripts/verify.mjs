import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run this verifier with npm run verify");
let databaseUrl = process.env.DATABASE_URL;
let container;
try {
  if (!databaseUrl) {
    container = `invoiceops-verify-${randomBytes(8).toString("hex")}`;
    const password = randomBytes(24).toString("hex");
    const docker = (args) =>
      execFileSync("docker", args, { encoding: "utf8", windowsHide: true });
    docker([
      "run",
      "--detach",
      "--name",
      container,
      "--memory=256m",
      "--publish",
      "127.0.0.1::5432",
      "--env",
      "POSTGRES_USER=invoiceops",
      "--env",
      `POSTGRES_PASSWORD=${password}`,
      "--env",
      "POSTGRES_DB=invoiceops",
      "postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24",
    ]);
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const result = spawnSync(
        "docker",
        [
          "exec",
          container,
          "pg_isready",
          "-U",
          "invoiceops",
          "-d",
          "invoiceops",
        ],
        { stdio: "ignore", windowsHide: true },
      );
      if (result.status === 0) {
        ready = true;
        break;
      }
      await new Promise((done) => setTimeout(done, 1000));
    }
    if (!ready) throw new Error("Verification database did not become ready");
    const port = docker(["port", container, "5432/tcp"])
      .trim()
      .split(":")
      .at(-1);
    databaseUrl = `postgres://invoiceops:${password}@127.0.0.1:${port}/invoiceops`;
    console.log(
      "Verification uses an isolated, temporary PostgreSQL instance.",
    );
  }
  const result = spawnSync(process.execPath, [npm, "test"], {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (container)
    execFileSync("docker", ["rm", "--force", "--volumes", container], {
      stdio: "ignore",
      windowsHide: true,
    });
}
