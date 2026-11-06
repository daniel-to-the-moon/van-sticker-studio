/**
 * Scan a vinext client build directory for secret markers.
 *
 * Default directory is dist/client. On this repo's vinext build
 * (base 62f9318accac151544060f2cbfceaec72beda0d0) browser assets land in
 * dist/client (favicon, _next, model, stickers). dist/server is the Worker
 * bundle and is not the default: it legitimately contains the server-side
 * upstream call. Pass one directory argument to override.
 *
 * A missing path, a non-directory, or a directory with no files exits 1.
 * A marker hit exits 1. Matched text is never printed.
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_CLIENT_DIR = 'dist/client';

const usage = 'usage: node tools/scan-dist-secrets.mjs [client-dir]';

function patternList() {
  return [
    { rule: 'sk-', re: /sk-[A-Za-z0-9_-]{20,}/g },
    {
      rule: 'OPENAI_' + 'API_KEY',
      re: new RegExp('OPENAI_' + 'API_KEY', 'g'),
    },
    {
      rule: 'api.' + 'openai.com',
      re: new RegExp('api\\.' + 'openai\\.com', 'g'),
    },
  ];
}

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(abs));
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

function scanFile(abs, root) {
  const text = fs.readFileSync(abs).toString('latin1');
  const rel = path.relative(root, abs).split(path.sep).join('/');
  const hits = [];
  for (const { rule, re } of patternList()) {
    for (let match = re.exec(text); match; match = re.exec(text)) {
      const line = text.slice(0, match.index).split('\n').length;
      hits.push({ rule, rel, line });
    }
  }
  return hits;
}

const arg = process.argv[2];
if (process.argv.length > 3 || arg === '') {
  console.error(usage);
  process.exit(1);
}

const target = path.resolve(arg ?? DEFAULT_CLIENT_DIR);
if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
  console.error(
    `secret scan failed: client output directory does not exist or is not a directory: ${target}`,
  );
  process.exit(1);
}

const files = walkFiles(target);
if (files.length === 0) {
  console.error(
    `secret scan failed: client output directory is empty (no files to scan): ${target}`,
  );
  process.exit(1);
}

const hits = [];
for (const file of files) hits.push(...scanFile(file, target));
hits.sort(
  (a, b) =>
    a.rel.localeCompare(b.rel) ||
    a.line - b.line ||
    a.rule.localeCompare(b.rule),
);

const unique = [];
const seen = new Set();
for (const hit of hits) {
  const key = `${hit.rule}\0${hit.rel}\0${hit.line}`;
  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(hit);
}

if (unique.length > 0) {
  for (const hit of unique) {
    console.error(`secret scan hit: ${hit.rule} ${hit.rel}:${hit.line}`);
  }
  console.error(`secret scan failed: ${unique.length} hit(s) in ${target}`);
  process.exit(1);
}

console.log(
  `secret scan passed: ${files.length} file(s), 0 hit(s) in ${target}`,
);
