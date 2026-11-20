#!/usr/bin/env node
/**
 * Release acceptance smoke for a deployed Worker version (preview or
 * production). Read-only: GET/HEAD requests only, no generation call, no
 * credentials. Produces a Markdown (or JSON) evidence report that a reviewer
 * such as GPT can paste into the release record.
 *
 * Usage:
 *   node tools/release-acceptance.mjs --url https://<version>-mxgarage-wrap-studio.<sub>.workers.dev \
 *     [--expect-commit <sha>] [--expect-glb-sha <sha256>] [--label "main preview"] [--format md|json]
 *
 * Exit code: 0 = every check passed, 1 = at least one check failed,
 * 2 = bad arguments. "unknown" results (e.g. a build older than
 * /api/version) count as failures when --expect-commit is given.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PAGE_ROUTES = ['/', '/design', '/body-lab', '/model-lab'];
export const GLB_PATH = '/model/mxgarage-rv.glb';
const TIMEOUT_MS = 30_000;

/** @param {string[]} argv */
export function parseArgs(argv) {
  const out = { format: 'md' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    const take = () => {
      if (value === undefined || value.startsWith('--'))
        throw new Error(`${key} needs a value`);
      i += 1;
      return value;
    };
    if (key === '--url') out.url = take();
    else if (key === '--expect-commit') out.expectCommit = take().toLowerCase();
    else if (key === '--expect-glb-sha') out.expectGlbSha = take().toLowerCase();
    else if (key === '--label') out.label = take();
    else if (key === '--format') out.format = take();
    else throw new Error(`unknown argument ${key}`);
  }
  if (!out.url) throw new Error('--url is required');
  const parsed = new URL(out.url);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1')
    throw new Error('--url must be https (or localhost)');
  out.url = parsed.origin;
  if (out.format !== 'md' && out.format !== 'json')
    throw new Error('--format must be md or json');
  return out;
}

/** Extract version / preview URLs from a Workers Builds check-run summary. */
export function parseWorkersBuildsSummary(summary) {
  const text = String(summary ?? '');
  const pick = (label) => {
    const match = text.match(new RegExp(`${label}:\\s*\\[?([^\\s\\]\\)]+)`));
    return match ? match[1] : null;
  };
  return {
    versionId: pick('Version ID'),
    previewUrl: pick('Preview URL'),
    aliasUrl: pick('Preview Alias URL'),
  };
}

export function commitMatches(actual, expected) {
  if (!expected) return true;
  if (!actual || actual === 'unknown') return false;
  const a = actual.toLowerCase();
  const e = expected.toLowerCase();
  const shorter = Math.min(a.length, e.length);
  return shorter >= 7 && a.slice(0, shorter) === e.slice(0, shorter);
}

/**
 * Turn raw probe results into pass/fail checks. Pure: no network.
 * raw = { pages: [{route,status}], status: {status, body}, version: {status, body}, glb: {status, sha256} }
 */
/**
 * @param {any} raw
 * @param {{ commit?: string, glbSha?: string }} [expect]
 */
export function evaluate(raw, expect = {}) {
  const checks = [];
  for (const page of raw.pages) {
    checks.push({
      id: `page ${page.route}`,
      pass: page.status === 200,
      detail: `HTTP ${page.status}`,
    });
  }
  const status = raw.status;
  const configured =
    status.body && typeof status.body.configured === 'boolean'
      ? status.body.configured
      : null;
  checks.push({
    id: 'api /api/status',
    pass: status.status === 200 && configured !== null,
    detail:
      configured === null
        ? `HTTP ${status.status}, no boolean "configured"`
        : `HTTP 200, configured=${configured}（只证明服务端是否读到非空密钥，不证明可生成）`,
  });
  const version = raw.version;
  const commit =
    version.status === 200 && version.body && typeof version.body.commit === 'string'
      ? version.body.commit
      : 'unknown';
  checks.push({
    id: 'api /api/version',
    pass: version.status === 200 && commitMatches(commit, expect.commit),
    detail:
      version.status === 200
        ? `commit=${commit} branch=${version.body?.branch ?? 'unknown'} source=${version.body?.source ?? 'unknown'}` +
          (expect.commit ? `，期望 ${expect.commit}` : '')
        : `HTTP ${version.status}（该版本早于 /api/version，构建来源 SHA 未知）`,
  });
  if (expect.glbSha) {
    checks.push({
      id: `asset ${GLB_PATH}`,
      pass: raw.glb.status === 200 && raw.glb.sha256 === expect.glbSha,
      detail: `HTTP ${raw.glb.status}, sha256=${raw.glb.sha256 ?? 'n/a'}，期望 ${expect.glbSha}`,
    });
  }
  return { commit, configured, checks, pass: checks.every((c) => c.pass) };
}

/** @param {any} report */
export function renderMarkdown(report) {
  const lines = [
    `### 发版验收冒烟：${report.label ?? report.url}`,
    '',
    `- 目标：${report.url}`,
    `- 运行时间（UTC）：${report.ranAt}`,
    `- 服务报告的构建 commit：\`${report.commit}\``,
    `- 结论：${report.pass ? '全部通过' : '有失败项'}（${report.checks.filter((c) => c.pass).length}/${report.checks.length}）`,
    '',
    '| 检查 | 结果 | 详情 |',
    '| --- | --- | --- |',
    ...report.checks.map(
      (c) => `| ${c.id} | ${c.pass ? '通过' : '失败'} | ${c.detail.replaceAll('|', '\\|')} |`,
    ),
    '',
    '> 本冒烟只做 GET/HEAD，不调用真实生成，不替代体验官 drawing 目检和关键路径交互验收。',
  ];
  return lines.join('\n');
}

async function probe(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { redirect: 'follow', ...init, signal: controller.signal });
  } catch (error) {
    return { status: 0, error: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response) {
  if (!response.status || response.status !== 200) return { status: response.status, body: null };
  try {
    return { status: 200, body: await response.json() };
  } catch {
    return { status: 200, body: null };
  }
}

/**
 * @param {string} base
 * @param {{ withGlb?: boolean }} [options]
 */
export async function collect(base, { withGlb = false } = {}) {
  const pages = [];
  for (const route of PAGE_ROUTES) {
    const res = await probe(base + route);
    pages.push({ route, status: res.status });
    if (res.body) await res.body.cancel?.();
  }
  const status = await readJson(await probe(`${base}/api/status`));
  const version = await readJson(await probe(`${base}/api/version`));
  let glb = { status: 0, sha256: null };
  if (withGlb) {
    const res = await probe(base + GLB_PATH);
    if (res.status === 200) {
      const buffer = Buffer.from(await res.arrayBuffer());
      glb = { status: 200, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
    } else glb = { status: res.status, sha256: null };
  }
  return { pages, status, version, glb };
}

function defaultGlbSha() {
  try {
    const file = path.resolve('public/model/motion_metadata.json');
    const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof meta.glbSha256 === 'string' ? meta.glbSha256.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`release-acceptance: ${error.message}`);
    process.exit(2);
  }
  const expectGlbSha = args.expectGlbSha ?? defaultGlbSha();
  const raw = await collect(args.url, { withGlb: Boolean(expectGlbSha) });
  const result = evaluate(raw, { commit: args.expectCommit, glbSha: expectGlbSha });
  const report = { url: args.url, label: args.label, ranAt: new Date().toISOString(), ...result };
  console.log(args.format === 'json' ? JSON.stringify(report, null, 2) : renderMarkdown(report));
  process.exit(result.pass ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
