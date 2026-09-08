import { fork } from "node:child_process";
import path from "node:path";
import { openStore } from "./store";
import { createApp } from "./app";
import { sendLink } from "./email";
import { createEvidenceStorage, s3ConfigFromEnv } from "./evidence-storage";
const production = process.env.NODE_ENV === "production";
if (
  production &&
  (!process.env.APP_URL?.startsWith("https://") ||
    !process.env.DATA_DIR ||
    !process.env.SES_FROM_EMAIL)
)
  throw new Error(
    "Production requires HTTPS APP_URL, DATA_DIR and SES_FROM_EMAIL",
  );
const dataDir = process.env.DATA_DIR || "data";
const db = openStore(path.join(dataDir, "atlas.sqlite"));
createApp(db, {
  dataDir,
  evidenceStorage: createEvidenceStorage(dataDir, s3ConfigFromEnv()),
  origin: process.env.APP_URL || "http://localhost:5173",
  production,
  send: sendLink,
}).listen(Number(process.env.PORT || 3100), "127.0.0.1", () =>
  console.log("Injury Atlas is listening"),
);

// Separate process keeps geometry and document work off the HTTP event loop.
// systemd's control group stops both processes during deployments.
let stopping = false;
let worker: ReturnType<typeof fork>;
function startWorker() {
  worker = fork(path.resolve("server/injury-worker.ts"), [], {
    execArgv: ["--import", "tsx", "--max-old-space-size=512"],
    stdio: "inherit",
  });
  worker.once("exit", () => {
    if (!stopping) setTimeout(startWorker, 5000);
  });
}
startWorker();
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    stopping = true;
    worker?.kill(signal);
    process.exit(0);
  });
