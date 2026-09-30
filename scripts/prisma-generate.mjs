// Generates the Prisma client for a target runtime:
//   node scripts/prisma-generate.mjs node        → default client (next dev, tests, seed, Node scripts)
//   node scripts/prisma-generate.mjs cloudflare  → Workers client (wasm query compiler for workerd)
// Prisma can't read the generator runtime from env, so the Cloudflare variant is generated from a
// temporary copy of the schema (same folder, so the relative output path stays identical).
import { execFileSync } from "node:child_process";
import { delimiter, resolve } from "node:path";

// Local CLIs (prisma, opennextjs-cloudflare) resolve even when run as `node scripts/…` outside pnpm.
process.env.PATH = `${resolve("node_modules/.bin")}${delimiter}${process.env.PATH}`;
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const target = process.argv[2] ?? "node";
if (target === "node") {
  execFileSync("prisma", ["generate"], { stdio: "inherit" });
  process.exit(0);
}
if (target !== "cloudflare") throw new Error(`Unknown target ${target}`);

const src = "prisma/schema.prisma";
const tmp = "prisma/.schema.cloudflare.prisma";
const schema = readFileSync(src, "utf8").replace(/(provider\s*=\s*"prisma-client")/, '$1\n  runtime  = "cloudflare"');
if (!schema.includes('runtime  = "cloudflare"')) throw new Error("Could not set the Cloudflare runtime in the generator block");
writeFileSync(tmp, schema);
try {
  execFileSync("prisma", ["generate", "--schema", tmp], { stdio: "inherit" });
} finally {
  rmSync(tmp, { force: true });
}
