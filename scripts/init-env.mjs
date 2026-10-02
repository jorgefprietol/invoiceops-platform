import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

if (existsSync(".env")) {
  console.log("Existing .env preserved.");
} else {
  const secret = () => randomBytes(32).toString("hex");
  writeFileSync(
    ".env",
    `POSTGRES_PASSWORD=${secret()}\nPOSTGRES_APP_PASSWORD=${secret()}\nAPI_TOKEN=${secret()}\nGRAFANA_PASSWORD=${secret()}\nWEB_PORT=18100\nGRAFANA_PORT=13100\nPROMETHEUS_PORT=19100\n`,
    { mode: 0o600 },
  );
  console.log(
    "Installation credentials generated in .env (excluded from Git).",
  );
}
mkdirSync(".secrets", { recursive: true });
const token = readFileSync(".env", "utf8").match(/^API_TOKEN=(.+)$/m)?.[1];
if (!token || token.length < 32) throw new Error("Invalid API_TOKEN in .env");
writeFileSync(".secrets/api-token", token, { mode: 0o600 });
