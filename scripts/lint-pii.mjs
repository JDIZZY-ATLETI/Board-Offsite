// P6 guard: no 9-digit literals (SIN-shaped) may appear in UI source. Tests and fixtures are out of scope.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOTS = ["src/app", "src/components"];
const EXT = new Set([".ts", ".tsx", ".css", ".mdx", ".md"]);
// Nine digits not adjacent to other digits or hex letters (so sha256 fragments do not trip it).
const NINE = /(?<![0-9a-fA-F])\d{9}(?![0-9a-fA-F])/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (/(^|[\\/])(__tests__|fixtures|__fixtures__)$/.test(p)) continue;
      walk(p, out);
    } else if (EXT.has(path.extname(p)) && !/\.(spec|test)\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

let violations = 0;
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(NINE)) {
        violations += 1;
        console.error(`${file}:${i + 1}:${m.index + 1}  nine-digit literal "${m[0]}"`);
      }
    });
  }
}

if (violations > 0) {
  console.error(`\nlint:pii failed: ${violations} nine-digit literal(s) found under ${ROOTS.join(", ")}.`);
  process.exit(1);
}
console.log("lint:pii ok: no nine-digit literals in UI source.");