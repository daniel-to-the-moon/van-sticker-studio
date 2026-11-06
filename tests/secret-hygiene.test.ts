/**
 * Secret hygiene for issue #7 (clarified by the coordinator comment on
 * 2026-10-25). checkSecretHygiene is a pure function from path → text.
 * A browser-prefix hit fails unless path, line number, and exact line text
 * are on the allowlist. Browser fetch / loadAsync targets must resolve to
 * same-origin /api/ or /model/; anything unresolved fails. Static only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const BROWSER_PREFIX = 'NEXT_' + 'PUBLIC_';
const VENDOR_HOST = 'api.' + 'openai.com';
const KEY_NAME = 'OPENAI_' + 'API_KEY';
const SK_PATTERN = /sk-[A-Za-z0-9_-]{20,}/;

const README_LINE_23 =
  'Configure `' +
  KEY_NAME +
  '` as a Sites server secret. Never use a `' +
  BROWSER_PREFIX +
  '` variable for the key. `OPENAI_IMAGE_MODEL` is optional and defaults to `gpt-image-2`. The browser never receives the key. For local development, copy `.dev.vars.example` to the ignored `.dev.vars` and set values there.';

const DEPLOY_LINE_136 =
  '- **严禁**使用 `' +
  BROWSER_PREFIX +
  '` 前缀变量：带该前缀的变量会被打进前端 bundle，等于公开密钥。';

const DEPLOY_LINE_259 =
  '- [ ] 生产 secret 只存在于服务端（`wrangler secret list` 只见变量名），前端环境变量中无 `' +
  BROWSER_PREFIX +
  '` 形式的 key';

const DEPLOY_LINE_285 =
  '2. **再查 secret 是否存在于正确环境**：确认本地查的是 `.dev.vars`、线上查的是目标 Worker 的 secret（`wrangler secret list` 或控制台），两者互不相通是最常见误配；同时确认变量名拼写为 `' +
  KEY_NAME +
  '`（及可选的 `OPENAI_IMAGE_MODEL`），没有误用 `' +
  BROWSER_PREFIX +
  '` 前缀、没有多余空格。';

export const DOC_SAFETY_ALLOWLIST: readonly {
  path: string;
  lineNumber: number;
  line: string;
  reason: string;
}[] = [
  {
    path: 'README.md',
    lineNumber: 23,
    line: README_LINE_23,
    reason:
      'Verified documentation safety statement: README tells readers not to expose the key with the browser prefix.',
  },
  {
    path: 'DEPLOY.md',
    lineNumber: 129,
    line: DEPLOY_LINE_136,
    reason:
      'Verified documentation safety statement: DEPLOY forbids the browser prefix because it is bundled to the client.',
  },
  {
    path: 'DEPLOY.md',
    lineNumber: 260,
    line: DEPLOY_LINE_259,
    reason:
      'Verified documentation safety statement: deployment checklist says the prefix must not appear as a key.',
  },
  {
    path: 'DEPLOY.md',
    lineNumber: 287,
    line: DEPLOY_LINE_285,
    reason:
      'Verified documentation safety statement: troubleshooting text says not to misuse the prefix.',
  },
];

export type HygieneRule =
  | 'next-public-prefix'
  | 'example-sk-pattern'
  | 'credential-pattern'
  | 'browser-key-name'
  | 'browser-vendor-host'
  | 'network-vendor'
  | 'network-external'
  | 'network-protocol-relative'
  | 'network-unresolved'
  | 'network-not-same-origin'
  | 'gitignore-entry';

export type HygieneFinding = {
  path: string;
  line: number;
  rule: HygieneRule;
  detail: string;
};

const NETWORK_CALLEES = new Set(['fetch', 'loadAsync']);
const REQUIRED_GITIGNORE_LINES = ['.env*', '.dev.vars', '/dist/'] as const;
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.next',
  '.vinext',
  '.wrangler',
  'coverage',
  'out',
]);

type Binding =
  | { kind: 'import'; spec: string; imported: string }
  | { kind: 'init'; initializer: ts.Expression }
  | { kind: 'unresolved' };

type StoredBinding = Binding | 'ambiguous';

type Cache = {
  sourceFiles: Map<string, ts.SourceFile>;
  bindings: Map<string, Map<string, StoredBinding>>;
};

function normalizePath(input: string): string {
  const parts: string[] = [];
  for (const part of input.replaceAll('\\', '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function isBrowserReachable(filePath: string): boolean {
  return (
    filePath === 'app/page.tsx' ||
    filePath === 'app/layout.tsx' ||
    filePath.startsWith('app/body-lab/') ||
    filePath.startsWith('components/') ||
    filePath.startsWith('hooks/')
  );
}

function isExampleEnv(filePath: string): boolean {
  const base = filePath.slice(filePath.lastIndexOf('/') + 1);
  return base === '.env.example' || base === '.dev.vars.example';
}

function isMarkdownDoc(filePath: string): boolean {
  return filePath.endsWith('.md');
}

function isSkippedCredential(filePath: string): boolean {
  const base = filePath.slice(filePath.lastIndexOf('/') + 1);
  if (base === '.env.example' || base === '.dev.vars.example') return false;
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (base === '.dev.vars' || base.startsWith('.dev.vars.')) return true;
  return false;
}

function scriptKind(filePath: string): ts.ScriptKind | null {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.ts')) return ts.ScriptKind.TS;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (
    filePath.endsWith('.js') ||
    filePath.endsWith('.mjs') ||
    filePath.endsWith('.cjs')
  ) {
    return ts.ScriptKind.JS;
  }
  return null;
}

function isAllowlisted(
  filePath: string,
  lineNumber: number,
  lineText: string,
): boolean {
  return DOC_SAFETY_ALLOWLIST.some(
    (entry) =>
      entry.path === filePath &&
      entry.lineNumber === lineNumber &&
      entry.line === lineText,
  );
}

function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function sourceFileOf(
  filePath: string,
  files: ReadonlyMap<string, string>,
  cache: Cache,
): ts.SourceFile | null {
  const cached = cache.sourceFiles.get(filePath);
  if (cached) return cached;
  const text = files.get(filePath);
  const kind = scriptKind(filePath);
  if (text === undefined || !kind) return null;
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.ESNext,
    true,
    kind,
  );
  cache.sourceFiles.set(filePath, sourceFile);
  return sourceFile;
}

function bindingsOf(
  filePath: string,
  files: ReadonlyMap<string, string>,
  cache: Cache,
): Map<string, StoredBinding> {
  const cached = cache.bindings.get(filePath);
  if (cached) return cached;
  const stored = new Map<string, StoredBinding>();
  cache.bindings.set(filePath, stored);
  const sourceFile = sourceFileOf(filePath, files, cache);
  if (!sourceFile) return stored;
  const set = (name: string, binding: Binding) => {
    stored.set(name, stored.has(name) ? 'ambiguous' : binding);
  };
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const spec = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      const clauseIsTypeOnly =
        clause.phaseModifier === ts.SyntaxKind.TypeKeyword;
      if (clause.name && !clauseIsTypeOnly) {
        set(clause.name.text, { kind: 'unresolved' });
      }
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          if (element.isTypeOnly || clauseIsTypeOnly) continue;
          set(element.name.text, {
            kind: 'import',
            spec,
            imported: element.propertyName?.text ?? element.name.text,
          });
        }
      }
    }
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
        continue;
      set(declaration.name.text, {
        kind: 'init',
        initializer: declaration.initializer,
      });
    }
  }
  return stored;
}

function bindingDeclares(name: ts.BindingName, text: string): boolean {
  if (ts.isIdentifier(name)) return name.text === text;
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue;
      if (bindingDeclares(element.name, text)) return true;
    }
  }
  return false;
}

function statementListBinding(
  statements: readonly ts.Statement[],
  text: string,
): ts.Expression | 'reject' | undefined {
  let hit: ts.Expression | 'reject' | undefined;
  let count = 0;
  const take = (next: ts.Expression | 'reject') => {
    count += 1;
    hit = next;
  };
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      const isConst =
        (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const declaration of statement.declarationList.declarations) {
        if (!bindingDeclares(declaration.name, text)) continue;
        if (
          !isConst ||
          !declaration.initializer ||
          !ts.isIdentifier(declaration.name)
        ) {
          take('reject');
        } else {
          take(declaration.initializer);
        }
      }
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name?.text === text
    ) {
      take('reject');
    }
  }
  if (count === 0) return undefined;
  if (count > 1) return 'reject';
  return hit;
}

function isVarDeclarationList(list: ts.VariableDeclarationList): boolean {
  return (
    (list.flags & ts.NodeFlags.Let) === 0 &&
    (list.flags & ts.NodeFlags.Const) === 0
  );
}

function declaresFunctionScopedVar(root: ts.Node, text: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || (node !== root && ts.isFunctionLike(node))) return;
    if (
      ts.isVariableStatement(node) &&
      isVarDeclarationList(node.declarationList)
    ) {
      for (const declaration of node.declarationList.declarations) {
        if (bindingDeclares(declaration.name, text)) found = true;
      }
    }
    if (
      (ts.isForStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isForOfStatement(node)) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.initializer) &&
      isVarDeclarationList(node.initializer)
    ) {
      for (const declaration of node.initializer.declarations) {
        if (bindingDeclares(declaration.name, text)) found = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function caseBlockLexicalShadow(
  caseBlock: ts.CaseBlock,
  text: string,
): 'reject' | undefined {
  const statements: ts.Statement[] = [];
  for (const clause of caseBlock.clauses) {
    statements.push(...clause.statements);
  }
  if (statementListBinding(statements, text) === undefined) return undefined;
  // A CaseBlock is one lexical environment. let/const/class/function in any
  // clause shadows every clause; fall-through and TDZ are not a static URL.
  return 'reject';
}

function functionNameText(node: ts.Node): string | undefined {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    node.name &&
    ts.isIdentifier(node.name)
  ) {
    return node.name.text;
  }
  return undefined;
}

function bindingInNode(
  node: ts.Node,
  text: string,
): ts.Expression | 'reject' | undefined {
  if (ts.isFunctionLike(node)) {
    if (functionNameText(node) === text) return 'reject';
    for (const param of node.parameters) {
      if (bindingDeclares(param.name, text)) return 'reject';
    }
    if (declaresFunctionScopedVar(node, text)) return 'reject';
    return undefined;
  }
  if (ts.isCatchClause(node)) {
    if (
      node.variableDeclaration &&
      bindingDeclares(node.variableDeclaration.name, text)
    ) {
      return 'reject';
    }
    return undefined;
  }
  if (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)
  ) {
    const initializer = node.initializer;
    if (initializer && ts.isVariableDeclarationList(initializer)) {
      for (const declaration of initializer.declarations) {
        if (bindingDeclares(declaration.name, text)) return 'reject';
      }
    }
    return undefined;
  }
  if (ts.isBlock(node) || ts.isModuleBlock(node)) {
    return statementListBinding(node.statements, text);
  }
  if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
    return statementListBinding(node.statements, text);
  }
  if (ts.isCaseBlock(node)) {
    return caseBlockLexicalShadow(node, text);
  }
  return undefined;
}

function nearestLocalBinding(
  ident: ts.Identifier,
  text: string,
): ts.Expression | 'reject' | undefined {
  if (!ident.parent) return 'reject';
  let current: ts.Node | undefined = ident.parent;
  while (current && !ts.isSourceFile(current)) {
    const hit = bindingInNode(current, text);
    if (hit !== undefined) return hit;
    current = current.parent;
  }
  return undefined;
}

function resolveModuleSpecifier(
  fromFile: string,
  spec: string,
  files: ReadonlyMap<string, string>,
): string | null {
  let base: string | null = null;
  if (spec.startsWith('@/')) base = normalizePath(spec.slice(2));
  else if (spec.startsWith('.')) {
    const dir = fromFile.split('/').slice(0, -1);
    base = normalizePath([...dir, spec].join('/'));
  }
  if (base === null) return null;
  const candidates = [base];
  if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(base)) {
    candidates.push(
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.mjs`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
    );
  }
  for (const candidate of candidates) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

function resolveIdent(
  name: string,
  filePath: string,
  files: ReadonlyMap<string, string>,
  cache: Cache,
  stack: readonly string[],
): { ok: true; value: string } | { ok: false } {
  const key = `${filePath}#${name}`;
  if (stack.includes(key)) return { ok: false };
  const binding = bindingsOf(filePath, files, cache).get(name);
  if (!binding || binding === 'ambiguous' || binding.kind === 'unresolved') {
    return { ok: false };
  }
  const next = [...stack, key];
  if (binding.kind === 'import') {
    const target = resolveModuleSpecifier(filePath, binding.spec, files);
    if (!target) return { ok: false };
    return resolveIdent(binding.imported, target, files, cache, next);
  }
  return resolveExpr(binding.initializer, filePath, files, cache, next);
}

function resolveExpr(
  expression: ts.Expression,
  filePath: string,
  files: ReadonlyMap<string, string>,
  cache: Cache,
  stack: readonly string[],
  resolving: readonly ts.Expression[] = [],
): { ok: true; value: string } | { ok: false } {
  const node = unwrap(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { ok: true, value: node.text };
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const part = resolveExpr(
        span.expression,
        filePath,
        files,
        cache,
        stack,
        resolving,
      );
      if (!part.ok) return part;
      value += part.value + span.literal.text;
    }
    return { ok: true, value };
  }
  if (ts.isIdentifier(node)) {
    const local = nearestLocalBinding(node, node.text);
    if (local === 'reject') return { ok: false };
    if (local) {
      if (resolving.includes(local)) return { ok: false };
      return resolveExpr(local, filePath, files, cache, stack, [
        ...resolving,
        local,
      ]);
    }
    return resolveIdent(node.text, filePath, files, cache, stack);
  }
  return { ok: false };
}

const SAME_ORIGIN_BASE = 'https://studio.invalid';

function isAllowedSameOrigin(url: string): boolean {
  if (!url.startsWith('/') || url.startsWith('//')) return false;
  if (
    url.includes('\\') ||
    url.includes('..') ||
    url.includes('//') ||
    /\s/.test(url)
  ) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(url, SAME_ORIGIN_BASE);
  } catch {
    return false;
  }
  if (parsed.origin !== SAME_ORIGIN_BASE) return false;
  const pathname = parsed.pathname;
  if (
    pathname.includes('\\') ||
    pathname.includes('..') ||
    pathname.includes('//')
  ) {
    return false;
  }
  return pathname.startsWith('/api/') || pathname.startsWith('/model/');
}

function classifyTarget(url: string): HygieneRule | null {
  if (url.includes(VENDOR_HOST)) return 'network-vendor';
  if (url.startsWith('//')) return 'network-protocol-relative';
  if (url.includes('://')) return 'network-external';
  if (isAllowedSameOrigin(url)) return null;
  return 'network-not-same-origin';
}

function scanNetworkCalls(
  filePath: string,
  files: ReadonlyMap<string, string>,
  cache: Cache,
  findings: HygieneFinding[],
): void {
  const sourceFile = sourceFileOf(filePath, files, cache);
  if (!sourceFile) return;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name && NETWORK_CALLEES.has(name)) {
        const line =
          ts.getLineAndCharacterOfPosition(
            sourceFile,
            node.getStart(sourceFile),
          ).line + 1;
        const arg = node.arguments[0];
        const resolved = arg
          ? resolveExpr(arg, filePath, files, cache, [])
          : { ok: false as const };
        if (!resolved.ok) {
          findings.push({
            path: filePath,
            line,
            rule: 'network-unresolved',
            detail: `${name} target could not be resolved to a static string`,
          });
        } else {
          const rule = classifyTarget(resolved.value);
          if (rule) {
            findings.push({
              path: filePath,
              line,
              rule,
              detail: `${name} target is not an allowed same-origin /api/ or /model/ path`,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

export function checkSecretHygiene(
  input: ReadonlyMap<string, string>,
): HygieneFinding[] {
  const files = new Map<string, string>();
  for (const [rawPath, content] of input)
    files.set(normalizePath(rawPath), content);
  const findings: HygieneFinding[] = [];
  const cache: Cache = { sourceFiles: new Map(), bindings: new Map() };
  const paths = [...files.keys()].sort();
  for (const filePath of paths) {
    const content = files.get(filePath) ?? '';
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const lineText = lines[index] ?? '';
      const lineNumber = index + 1;
      if (
        lineText.includes(BROWSER_PREFIX) &&
        !isAllowlisted(filePath, lineNumber, lineText)
      ) {
        findings.push({
          path: filePath,
          line: lineNumber,
          rule: 'next-public-prefix',
          detail:
            'browser-prefix marker is not an allowlisted safety statement',
        });
      }
      if (isExampleEnv(filePath) && lineText.search(SK_PATTERN) !== -1) {
        findings.push({
          path: filePath,
          line: lineNumber,
          rule: 'example-sk-pattern',
          detail: 'example env file contains an sk- pattern',
        });
      }
      if (
        (isMarkdownDoc(filePath) || isBrowserReachable(filePath)) &&
        lineText.search(SK_PATTERN) !== -1
      ) {
        findings.push({
          path: filePath,
          line: lineNumber,
          rule: 'credential-pattern',
          detail:
            'credential pattern is checked separately from the wording allowlist',
        });
      }
    }
    if (filePath === '.gitignore') {
      const present = new Set(lines.map((line) => line.trim()));
      for (const required of REQUIRED_GITIGNORE_LINES) {
        if (!present.has(required)) {
          findings.push({
            path: filePath,
            line: 1,
            rule: 'gitignore-entry',
            detail: `gitignore is missing entry ${required}`,
          });
        }
      }
    }
    if (!isBrowserReachable(filePath)) continue;
    for (let index = 0; index < lines.length; index++) {
      const lineText = lines[index] ?? '';
      if (lineText.includes(KEY_NAME)) {
        findings.push({
          path: filePath,
          line: index + 1,
          rule: 'browser-key-name',
          detail: 'browser-reachable file contains the server key name',
        });
      }
      if (lineText.includes(VENDOR_HOST)) {
        findings.push({
          path: filePath,
          line: index + 1,
          rule: 'browser-vendor-host',
          detail: 'browser-reachable file contains the vendor host',
        });
      }
    }
    if (scriptKind(filePath))
      scanNetworkCalls(filePath, files, cache, findings);
  }
  findings.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.line - b.line ||
      a.rule.localeCompare(b.rule),
  );
  return findings;
}

function syntheticKey(): string {
  return 'sk-' + 'synthetic' + 'EXAMPLE' + 'NOTAREAL' + 'KEY000000';
}

let workspaceFiles: Map<string, string> | undefined;

function loadWorkspaceFiles(root = process.cwd()): Map<string, string> {
  if (workspaceFiles) return workspaceFiles;
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = normalizePath(path.relative(root, abs));
      if (isSkippedCredential(rel)) continue;
      const buffer = fs.readFileSync(abs);
      if (buffer.includes(0)) {
        if (buffer.includes(Buffer.from(BROWSER_PREFIX)))
          files.set(rel, `${BROWSER_PREFIX}\n`);
        continue;
      }
      files.set(rel, buffer.toString('utf8'));
    }
  };
  walk(root);
  workspaceFiles = files;
  return files;
}

function allowlistedDocMap(): Map<string, string> {
  const byPath = new Map<string, string[]>();
  for (const entry of DOC_SAFETY_ALLOWLIST) {
    const lines = byPath.get(entry.path) ?? [];
    while (lines.length < entry.lineNumber) lines.push('');
    lines[entry.lineNumber - 1] = entry.line;
    byPath.set(entry.path, lines);
  }
  return new Map(
    [...byPath].map(([filePath, lines]) => [filePath, lines.join('\n')]),
  );
}

function scannerPath(): string {
  return path.resolve('tools/scan-dist-secrets.mjs');
}

function runScanner(dir?: string, cwd = process.cwd()) {
  const args = [scannerPath()];
  if (dir !== undefined) args.push(dir);
  return spawnSync(process.execPath, args, { encoding: 'utf8', cwd });
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vss-secret-scan-'));
}

void test('allowlist text matches the verified lines on disk', () => {
  for (const entry of DOC_SAFETY_ALLOWLIST) {
    const lines = fs.readFileSync(entry.path, 'utf8').split(/\r?\n/);
    const same = (lines[entry.lineNumber - 1] ?? '') === entry.line;
    assert.equal(
      same,
      true,
      `${entry.path}:${entry.lineNumber} allowlist line drifted`,
    );
  }
});

void test('allowlist drift failure output omits the synthetic sample', () => {
  const secret = syntheticKey();
  const dir = makeTempDir();
  const file = path.join(dir, 'drift.mts');
  const source = [
    "import assert from 'node:assert/strict';",
    "const secret = 'sk-' + 'synthetic' + 'EXAMPLE' + 'NOTAREAL' + 'KEY000000';",
    "const actual = 'documented line ' + secret;",
    "const expected = 'documented line';",
    "assert.equal(actual === expected, true, 'README.md:23 allowlist line drifted');",
    '',
  ].join('\n');
  fs.writeFileSync(file, source);
  try {
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', file],
      { encoding: 'utf8' },
    );
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    assert.notEqual(result.status, 0);
    assert.equal(output.includes(secret), false);
    assert.match(output, /README\.md:23/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test('workspace browser-prefix hits are exactly the four verified lines', () => {
  const hits: string[] = [];
  for (const [filePath, content] of loadWorkspaceFiles()) {
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      if ((lines[index] ?? '').includes(BROWSER_PREFIX))
        hits.push(`${filePath}:${index + 1}`);
    }
  }
  hits.sort();
  assert.deepEqual(hits, [
    'DEPLOY.md:129',
    'DEPLOY.md:260',
    'DEPLOY.md:287',
    'README.md:23',
  ]);
});

void test('new hygiene files do not embed contiguous secret markers', () => {
  for (const filePath of [
    'tests/secret-hygiene.test.ts',
    'tools/scan-dist-secrets.mjs',
  ]) {
    const text = fs.readFileSync(filePath, 'utf8');
    assert.equal(text.includes(BROWSER_PREFIX), false, filePath);
    assert.equal(text.includes(VENDOR_HOST), false, filePath);
    assert.equal(text.includes(KEY_NAME), false, filePath);
    assert.equal(SK_PATTERN.test(text), false, filePath);
  }
});

void test('verified documentation safety statements pass', () => {
  assert.deepEqual(checkSecretHygiene(allowlistedDocMap()), []);
});

void test('a documentation line that is not the verified statement fails', () => {
  const files = allowlistedDocMap();
  const lines = (files.get('README.md') ?? '').split('\n');
  lines[22] = `${lines[22] ?? ''} ${BROWSER_PREFIX}OPENAI_${'API_KEY'}=present`;
  files.set('README.md', lines.join('\n'));
  const findings = checkSecretHygiene(files);
  assert.ok(
    findings.some(
      (finding) =>
        finding.path === 'README.md' &&
        finding.line === 23 &&
        finding.rule === 'next-public-prefix',
    ),
  );
});

void test('an unknown markdown mention of the browser prefix fails', () => {
  const files = new Map([
    ['docs/notes.md', `Do not set ${BROWSER_PREFIX}SOMETHING.\n`],
  ]);
  const findings = checkSecretHygiene(files);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.rule, 'next-public-prefix');
  assert.equal(findings[0]?.path, 'docs/notes.md');
});

void test('browser prefix on a key in code fails and the name is not echoed', () => {
  const secretName = `${BROWSER_PREFIX}OPENAI_${'API_KEY'}`;
  const files = new Map([
    ['lib/config.ts', `export const key = process.env.${secretName};\n`],
  ]);
  const findings = checkSecretHygiene(files);
  assert.ok(
    findings.some(
      (finding) =>
        finding.rule === 'next-public-prefix' &&
        finding.path === 'lib/config.ts',
    ),
  );
  assert.equal(JSON.stringify(findings).includes(secretName), false);
});

void test('a browser fetch to the vendor host fails and the url is not echoed', () => {
  const url = `https://${VENDOR_HOST}/v1/images/generations`;
  const files = new Map([
    ['components/Bad.tsx', `fetch(${JSON.stringify(url)});\n`],
  ]);
  const findings = checkSecretHygiene(files);
  assert.ok(findings.some((finding) => finding.rule === 'network-vendor'));
  assert.ok(findings.some((finding) => finding.rule === 'browser-vendor-host'));
  assert.equal(JSON.stringify(findings).includes(url), false);
});

void test('an sk- pattern in an example env file fails and is not echoed', () => {
  const secret = syntheticKey();
  const files = new Map([['.env.example', `${KEY_NAME}=${secret}\n`]]);
  const findings = checkSecretHygiene(files);
  assert.ok(
    findings.some(
      (finding) =>
        finding.rule === 'example-sk-pattern' &&
        finding.path === '.env.example',
    ),
  );
  assert.equal(JSON.stringify(findings).includes(secret), false);
});

void test('a synthetic key without the browser prefix fails in markdown', () => {
  const secret = syntheticKey();
  const files = new Map([
    ['README.md', `Notes about the studio.\n${secret}\n`],
    ['DEPLOY.md', `Deployment notes.\n${secret}\n`],
    ['docs/notes.md', `Extra notes.\n${secret}\n`],
  ]);
  const findings = checkSecretHygiene(files);
  for (const filePath of ['README.md', 'DEPLOY.md', 'docs/notes.md']) {
    assert.ok(
      findings.some(
        (finding) =>
          finding.path === filePath && finding.rule === 'credential-pattern',
      ),
      filePath,
    );
  }
  assert.equal(
    findings.some((finding) => finding.rule === 'next-public-prefix'),
    false,
  );
  assert.equal(JSON.stringify(findings).includes(secret), false);
});

void test('a synthetic key hardcoded in browser code fails and is not echoed', () => {
  const secret = syntheticKey();
  const files = new Map([
    ['components/Bad.tsx', `export const token = ${JSON.stringify(secret)};\n`],
    ['app/page.tsx', `const token = ${JSON.stringify(secret)};\n`],
  ]);
  const findings = checkSecretHygiene(files);
  assert.ok(
    findings.some(
      (finding) =>
        finding.path === 'components/Bad.tsx' &&
        finding.rule === 'credential-pattern',
    ),
  );
  assert.ok(
    findings.some(
      (finding) =>
        finding.path === 'app/page.tsx' &&
        finding.rule === 'credential-pattern',
    ),
  );
  assert.equal(JSON.stringify(findings).includes(secret), false);
});

void test('example env placeholders without an sk- pattern pass', () => {
  const files = new Map<string, string>([
    ['.env.example', fs.readFileSync('.env.example', 'utf8')],
    ['.dev.vars.example', fs.readFileSync('.dev.vars.example', 'utf8')],
  ]);
  assert.deepEqual(checkSecretHygiene(files), []);
});

void test('gitignore must list env files and dist', () => {
  const findings = checkSecretHygiene(
    new Map([['.gitignore', '.env\n.dev.vars.*\n']]),
  );
  const details = findings.map((finding) => finding.detail);
  assert.ok(details.some((detail) => detail.includes('.env*')));
  assert.ok(
    details.some(
      (detail) =>
        detail.includes('.dev.vars') && !detail.includes('.dev.vars.*'),
    ),
  );
  assert.ok(details.some((detail) => detail.includes('/dist/')));
});

void test('a complete gitignore passes', () => {
  assert.deepEqual(
    checkSecretHygiene(new Map([['.gitignore', '.env*\n/dist/\n.dev.vars\n']])),
    [],
  );
});

void test('same-origin /api fetch passes', () => {
  const files = new Map([
    ['app/page.tsx', "fetch('/api/status');\nfetch('/api/generate');\n"],
  ]);
  assert.deepEqual(checkSecretHygiene(files), []);
});

void test('verified same-origin /api and /model reads pass', () => {
  const files = new Map<string, string>([
    ['app/page.tsx', fs.readFileSync('app/page.tsx', 'utf8')],
    [
      'components/studio/scene-engine.ts',
      fs.readFileSync('components/studio/scene-engine.ts', 'utf8'),
    ],
    ['lib/vehicle-assets.ts', fs.readFileSync('lib/vehicle-assets.ts', 'utf8')],
  ]);
  assert.deepEqual(checkSecretHygiene(files), []);
});

void test('loadAsync of an external URL fails', () => {
  const files = new Map([
    [
      'components/studio/scene-engine.ts',
      "new GLTFLoader().loadAsync('https://example.com/model.glb');\n",
    ],
  ]);
  const findings = checkSecretHygiene(files);
  assert.ok(findings.some((finding) => finding.rule === 'network-external'));
});

void test('a fetch target that is not a static string fails closed', () => {
  const findings = checkSecretHygiene(
    new Map([['app/page.tsx', "fetch('/api/' + 'status');\n"]]),
  );
  assert.ok(findings.some((finding) => finding.rule === 'network-unresolved'));
});

void test('a protocol-relative fetch fails', () => {
  const findings = checkSecretHygiene(
    new Map([['hooks/use-remote.ts', "fetch('//cdn.example/lib.js');\n"]]),
  );
  assert.ok(
    findings.some((finding) => finding.rule === 'network-protocol-relative'),
  );
});

void test('a same-origin path outside /api and /model fails', () => {
  const findings = checkSecretHygiene(
    new Map([['app/page.tsx', "fetch('/stickers/coast-club.png');\n"]]),
  );
  assert.ok(
    findings.some((finding) => finding.rule === 'network-not-same-origin'),
  );
});

void test('an unresolved fetch identifier fails', () => {
  const findings = checkSecretHygiene(
    new Map([['components/Bad.tsx', 'fetch(NOT_A_CONSTANT);\n']]),
  );
  assert.ok(findings.some((finding) => finding.rule === 'network-unresolved'));
});

void test('a parameter shadows a safe module fetch target', () => {
  const findings = checkSecretHygiene(
    new Map([
      [
        'app/page.tsx',
        [
          "const target = '/api/status';",
          'function send(target: string) {',
          '  return fetch(target);',
          '}',
          "send('https://example.com/hook');",
          '',
        ].join('\n'),
      ],
    ]),
  );
  assert.ok(findings.some((finding) => finding.rule === 'network-unresolved'));
});

void test('a nested var inside if shadows a safe module fetch target', () => {
  const findings = checkSecretHygiene(
    new Map([
      [
        'app/page.tsx',
        [
          "const target = '/api/status';",
          'function send() {',
          '  if (true) { var target = "https://example.com/hook"; }',
          '  return fetch(target);',
          '}',
          '',
        ].join('\n'),
      ],
    ]),
  );
  assert.ok(findings.some((finding) => finding.rule === 'network-unresolved'));
});

void test('a var declared in a loop shadows a later fetch', () => {
  const findings = checkSecretHygiene(
    new Map([
      [
        'app/page.tsx',
        [
          "const target = '/api/status';",
          'function send() {',
          '  for (let i = 0; i < 1; i++) {',
          '    var target = "https://example.com/hook";',
          '  }',
          '  return fetch(target);',
          '}',
          '',
        ].join('\n'),
      ],
    ]),
  );
  assert.ok(findings.some((finding) => finding.rule === 'network-unresolved'));
});

void test('a var in one switch case shadows a fetch in another case', () => {
  const findings = checkSecretHygiene(
    new Map([
      [
        'app/page.tsx',
        [
          "const target = '/api/status';",
          'function send(kind: string) {',
          '  switch (kind) {',
          "    case 'a':",
          '      var target = "https://example.com/hook";',
          '      break;',
          '    default:',
          '      return fetch(target);',
          '  }',
          '}',
          '',
        ].join('\n'),
      ],
    ]),
  );
  assert.ok(findings.some((finding) => finding.rule === 'network-unresolved'));
});

void test('a switch-scoped let in another case shadows a fetch', () => {
  const findings = checkSecretHygiene(
    new Map([
      [
        'app/page.tsx',
        [
          "const target = '/api/status';",
          'function send(kind: string) {',
          '  switch (kind) {',
          "    case 'a':",
          '      let target = "https://example.com/hook";',
          "    case 'b':",
          '      return fetch(target);',
          '  }',
          '}',
          "send('a');",
          '',
        ].join('\n'),
      ],
    ]),
  );
  assert.ok(findings.some((finding) => finding.rule === 'network-unresolved'));
});

void test('a switch-scoped const in another case shadows a fetch', () => {
  const findings = checkSecretHygiene(
    new Map([
      [
        'app/page.tsx',
        [
          "const target = '/api/status';",
          'function send(kind: string) {',
          '  switch (kind) {',
          "    case 'a':",
          '      const target = "https://example.com/hook";',
          "    case 'b':",
          '      return fetch(target);',
          '  }',
          '}',
          "send('a');",
          '',
        ].join('\n'),
      ],
    ]),
  );
  assert.ok(findings.some((finding) => finding.rule === 'network-unresolved'));
});

void test('a block binding shadows a safe module fetch target', () => {
  const findings = checkSecretHygiene(
    new Map([
      [
        'components/studio/scene-engine.ts',
        [
          "const target = '/api/status';",
          'export function send() {',
          '  const target = "https://example.com/hook";',
          '  return fetch(target);',
          '}',
          '',
        ].join('\n'),
      ],
    ]),
  );
  assert.ok(findings.some((finding) => finding.rule === 'network-external'));
});

void test('an unshadowed imported constant still resolves inside a function', () => {
  const files = new Map<string, string>([
    ['lib/vehicle-assets.ts', fs.readFileSync('lib/vehicle-assets.ts', 'utf8')],
    [
      'components/studio/scene-engine.ts',
      [
        "import { VEHICLE_MOTION_URL } from '../../lib/vehicle-assets.ts';",
        'export function load() {',
        '  return fetch(VEHICLE_MOTION_URL);',
        '}',
        '',
      ].join('\n'),
    ],
  ]);
  assert.deepEqual(checkSecretHygiene(files), []);
});

void test('a parameter shadowing an imported constant fails closed', () => {
  const files = new Map<string, string>([
    ['lib/vehicle-assets.ts', fs.readFileSync('lib/vehicle-assets.ts', 'utf8')],
    [
      'components/studio/scene-engine.ts',
      [
        "import { VEHICLE_MOTION_URL } from '../../lib/vehicle-assets.ts';",
        'export function load(VEHICLE_MOTION_URL: string) {',
        '  return fetch(VEHICLE_MOTION_URL);',
        '}',
        '',
      ].join('\n'),
    ],
  ]);
  const findings = checkSecretHygiene(files);
  assert.ok(findings.some((finding) => finding.rule === 'network-unresolved'));
});

void test('document-relative paths are not root /api or /model fetches', () => {
  for (const url of [
    'api/status',
    './api/status',
    'model/a.glb',
    './model/a.glb',
  ]) {
    const findings = checkSecretHygiene(
      new Map([['app/page.tsx', `fetch(${JSON.stringify(url)});\n`]]),
    );
    assert.ok(
      findings.some((finding) => finding.rule === 'network-not-same-origin'),
      url,
    );
  }
  assert.deepEqual(
    checkSecretHygiene(
      new Map([
        ['app/page.tsx', "fetch('/api/status');\nfetch('/model/a.glb');\n"],
      ]),
    ),
    [],
  );
});

void test('encoded dot-segment traversal is not an allowed same-origin path', () => {
  const segments = ['%2e%2e', '.%2e', '%2e.'];
  for (const prefix of ['/api/', '/model/']) {
    for (const segment of segments) {
      const url = `${prefix}${segment}/private`;
      const findings = checkSecretHygiene(
        new Map([['app/page.tsx', `fetch(${JSON.stringify(url)});\n`]]),
      );
      assert.ok(
        findings.some((finding) => finding.rule === 'network-not-same-origin'),
        url,
      );
    }
  }
});

void test('the server key name in a browser-reachable file fails', () => {
  const findings = checkSecretHygiene(
    new Map([
      ['hooks/use-mobile.ts', `const name = ${JSON.stringify(KEY_NAME)};\n`],
    ]),
  );
  assert.ok(findings.some((finding) => finding.rule === 'browser-key-name'));
});

void test('server generation module is outside the browser scan', () => {
  const files = new Map([
    ['lib/generation.ts', fs.readFileSync('lib/generation.ts', 'utf8')],
  ]);
  assert.deepEqual(checkSecretHygiene(files), []);
});

void test('workspace source passes the clarified secret hygiene rules', () => {
  assert.deepEqual(checkSecretHygiene(loadWorkspaceFiles()), []);
});

void test('dist scanner source pins the default client directory', () => {
  const source = fs.readFileSync('tools/scan-dist-secrets.mjs', 'utf8');
  assert.match(source, /const DEFAULT_CLIENT_DIR = 'dist\/client'/);
});

void test('dist scanner defaults to dist/client relative to the working directory', () => {
  const dir = makeTempDir();
  try {
    const result = runScanner(undefined, dir);
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    assert.notEqual(result.status, 0);
    assert.match(output, /dist\/client/);
    assert.match(output, /does not exist/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test('dist scanner fails when the client directory is missing', () => {
  const missing = path.join(
    os.tmpdir(),
    `vss-missing-${process.pid}-${Date.now()}`,
  );
  const result = runScanner(missing);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr ?? '', /does not exist/);
});

void test('dist scanner fails when the client directory has no files', () => {
  const dir = makeTempDir();
  try {
    fs.mkdirSync(path.join(dir, 'nested'));
    const result = runScanner(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr ?? '', /empty/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test('dist scanner passes a client directory with no secret markers', () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("ok");\n');
    const result = runScanner(dir);
    assert.equal(result.status, 0, result.stderr ?? '');
    assert.match(
      result.stdout ?? '',
      /secret scan passed: 1 file\(s\), 0 hit\(s\)/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test('dist scanner reports an sk- pattern without printing it', () => {
  const secret = syntheticKey();
  const dir = makeTempDir();
  try {
    fs.writeFileSync(
      path.join(dir, 'chunk.js'),
      `const leaked = ${JSON.stringify(secret)};\n`,
    );
    const result = runScanner(dir);
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    assert.notEqual(result.status, 0);
    assert.match(output, /secret scan hit: sk- chunk\.js:1/);
    assert.equal(output.includes(secret), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test('dist scanner reports the server key name and the vendor host', () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(
      path.join(dir, 'key.js'),
      `const name = ${JSON.stringify(KEY_NAME)};\n`,
    );
    fs.writeFileSync(
      path.join(dir, 'host.js'),
      `const url = ${JSON.stringify(`https://${VENDOR_HOST}/v1`)};\n`,
    );
    const result = runScanner(dir);
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    assert.notEqual(result.status, 0);
    assert.match(output, new RegExp(`secret scan hit: ${KEY_NAME} key\\.js:1`));
    assert.match(
      output,
      new RegExp(
        `secret scan hit: ${VENDOR_HOST.replaceAll('.', '\\.')} host\\.js:1`,
      ),
    );
    assert.match(output, /secret scan failed: 2 hit\(s\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
