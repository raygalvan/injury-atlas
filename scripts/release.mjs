import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const commit =
  process.env.RELEASE_SHA ||
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (!/^[0-9a-f]{40}$/.test(commit))
  throw new Error("Full release commit required");
writeFileSync(
  "dist/release.json",
  JSON.stringify({ commit, builtAt: new Date().toISOString() }),
);
