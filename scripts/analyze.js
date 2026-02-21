const fs = require("fs");
const path = require("path");

const root = process.cwd();
const skipDirs = new Set([".git", "node_modules"]);

function walk(dir, acc) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
}

function analyze() {
  const files = [];
  walk(root, files);
  const byExt = new Map();

  for (const file of files) {
    const ext = path.extname(file) || "<no-ext>";
    byExt.set(ext, (byExt.get(ext) || 0) + 1);
  }

  console.log("Project analysis");
  console.log(`Total files: ${files.length}`);
  for (const [ext, count] of [...byExt.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${ext}: ${count}`);
  }
}

analyze();
