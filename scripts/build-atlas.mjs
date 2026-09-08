import { build } from "esbuild";
import {
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
  existsSync,
  statSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "..");
const lock = JSON.parse(
  readFileSync(path.join(root, "atlas.lock.json"), "utf8"),
);
assert.equal(lock.repository, "raygalvan/human-atlas");
assert.match(lock.commit, /^[0-9a-f]{40}$/);
const source = path.join(root, ".atlas-source");
function run(cmd, args, cwd = root, capture = false) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    timeout: 600000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (r.status !== 0)
    throw new Error(`${cmd} failed: ${r.stderr || r.error || r.status}`);
  return r.stdout?.trim();
}
if (!existsSync(source))
  run("git", [
    "clone",
    "--no-checkout",
    `https://github.com/${lock.repository}.git`,
    source,
  ]);
run("git", ["fetch", "origin", lock.commit], source);
run("git", ["checkout", "--detach", lock.commit], source);
assert.equal(run("git", ["rev-parse", "HEAD"], source, true), lock.commit);
assert.equal(
  run("git", ["status", "--porcelain", "--untracked-files=no"], source, true),
  "",
  "Atlas source must be unmodified",
);
run("npm", ["ci", "--no-audit", "--no-fund"], source);
run("npm", ["run", "check"], source);
for (const f of [
  "validate-atlas.mjs",
  "validate-base-path.mjs",
  "validate-injurybot-bridge.mjs",
])
  run("node", [`scripts/${f}`], source);
run("npm", ["run", "build"], source);
const output = path.join(source, "dist");
const model = JSON.parse(
  readFileSync(path.join(output, "models/atlas.json"), "utf8"),
);
assert.ok(model.parts.length > 2000);
for (const c of model.chunks) {
  assert.equal(statSync(path.join(output, c.url)).size, c.bytes);
}
const target = path.join(root, ".atlas-build");
rmSync(target, { recursive: true, force: true });
cpSync(output, target, { recursive: true });
await build({
  entryPoints: [path.join(source, "app/production-worker.ts")],
  outfile: path.join(target, "injury-generator.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
});
cpSync(path.join(source, "LICENSE"), path.join(target, "LICENSE.txt"));
writeFileSync(path.join(target, "release.json"), JSON.stringify(lock, null, 2));
console.log(
  `Packaged ${model.parts.length} anatomy structures from ${lock.commit}`,
);
