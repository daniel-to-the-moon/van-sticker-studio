#!/usr/bin/env node
/**
 * Production promotion helpers for .github/workflows/release-acceptance.yml.
 * No dependencies: talks to the GitHub REST API and the Cloudflare Workers
 * Deployments API with fetch.
 *
 *   node tools/production-deploy.mjs gate --target <sha> [--prod-url <url>]
 *       Release gate (constitution §4/§5): target is the current main head, its
 *       `gates` check succeeded, production's commit is readable at
 *       /api/version, and every PR between production and target that touches
 *       a visual path carries `visual-accepted` or `no-visual-change`.
 *       Env: GITHUB_TOKEN, GITHUB_REPOSITORY. Exit 0 = pass, 1 = blocked.
 *
 *   node tools/production-deploy.mjs current
 *       Print the version ID serving the largest traffic share right now.
 *
 *   node tools/production-deploy.mjs promote --version <uuid> --message <text>
 *       Send 100% of traffic to one version (also used for rollback).
 *       Env (both): CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, WORKER_NAME.
 */
import { pathToFileURL } from 'node:url';

export const ACCEPT_LABELS = ['visual-accepted', 'no-visual-change'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/i;

/** Paths whose change can alter what a visitor sees. Conservative on purpose. */
export function isVisualPath(file) {
  if (/\.(md|txt)$/i.test(file)) return false;
  if (/^(docs|tests|tools|ops|\.github)\//.test(file)) return false;
  if (file.startsWith('app/api/')) return false;
  return /^(app|components|hooks|lib|public)\//.test(file) || /\.(css|tsx)$/.test(file);
}

/**
 * Pick the version with the largest share from the newest deployment.
 * @param {{ created_on?: string, versions?: { version_id: string, percentage: number }[] }[]} deployments
 */
export function pickCurrentVersion(deployments) {
  const sorted = [...(deployments ?? [])].sort((a, b) =>
    String(b.created_on ?? '').localeCompare(String(a.created_on ?? '')),
  );
  const latest = sorted[0];
  if (!latest || !Array.isArray(latest.versions) || latest.versions.length === 0) return null;
  const top = [...latest.versions].sort((a, b) => b.percentage - a.percentage)[0];
  return { versionId: top.version_id, percentage: top.percentage, deployedAt: latest.created_on ?? null };
}

/**
 * @param {string} versionId
 * @param {string} message
 */
export function deploymentBody(versionId, message) {
  if (!UUID.test(versionId)) throw new Error(`not a version UUID: ${versionId}`);
  return {
    strategy: 'percentage',
    versions: [{ version_id: versionId, percentage: 100 }],
    annotations: { 'workers/message': String(message).slice(0, 900) },
  };
}

/**
 * Pure release decision.
 * @param {{ target: string, mainHead: string, gatesConclusion: string | null,
 *   prodCommit: string | null,
 *   prs: { number: number, labels: string[], files: string[] }[] }} input
 */
export function releaseGate(input) {
  const reasons = [];
  if (input.target !== input.mainHead)
    reasons.push(`目标 ${input.target.slice(0, 7)} 不是当前 main head ${input.mainHead.slice(0, 7)}（构建过期，跳过）`);
  if (input.gatesConclusion !== 'success')
    reasons.push(`目标 commit 的 gates 检查不是 success（${input.gatesConclusion ?? '未找到'}）`);
  if (!input.prodCommit || !SHA.test(input.prodCommit))
    reasons.push('生产 /api/version 读不到 commit，无法确定变更区间：首次请手动发版');
  const visual = [];
  for (const pr of input.prs) {
    const files = pr.files.filter(isVisualPath);
    if (files.length === 0) continue;
    const accepted = pr.labels.some((label) => ACCEPT_LABELS.includes(label));
    visual.push({ number: pr.number, accepted, files: files.slice(0, 5) });
    if (!accepted)
      reasons.push(`#${pr.number} 改了可见文件（${files.slice(0, 3).join(', ')}${files.length > 3 ? ' …' : ''}），缺 visual-accepted / no-visual-change 标签`);
  }
  return { pass: reasons.length === 0, reasons, visual };
}

export function renderGate(result, ctx) {
  return [
    `### 自动上线闸门：${result.pass ? '放行' : '拦下'}`,
    '',
    `- 目标 commit：\`${ctx.target}\``,
    `- 生产 commit：\`${ctx.prodCommit ?? 'unknown'}\``,
    `- 区间内 PR：${ctx.prs.length ? ctx.prs.map((p) => `#${p.number}`).join(' ') : '无'}`,
    ...(result.reasons.length ? ['', '拦下原因：', ...result.reasons.map((r) => `- ${r}`)] : []),
  ].join('\n');
}

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} → HTTP ${res.status}`);
  return res.json();
}

async function readProdCommit(prodUrl) {
  try {
    const res = await fetch(`${prodUrl}/api/version`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body.commit === 'string' && SHA.test(body.commit) ? body.commit : null;
  } catch {
    return null;
  }
}

async function collectGateInput(target, prodUrl) {
  const repo = process.env.GITHUB_REPOSITORY;
  const main = await gh(`/repos/${repo}/commits/main`);
  const checks = await gh(`/repos/${repo}/commits/${target}/check-runs?check_name=gates`);
  const gatesConclusion = checks.check_runs?.[0]?.conclusion ?? null;
  const prodCommit = await readProdCommit(prodUrl);
  const prs = [];
  if (prodCommit) {
    const compare = await gh(`/repos/${repo}/compare/${prodCommit}...${target}`);
    const seen = new Set();
    for (const commit of compare.commits ?? []) {
      for (const pr of await gh(`/repos/${repo}/commits/${commit.sha}/pulls`)) {
        if (seen.has(pr.number) || !pr.merged_at) continue;
        seen.add(pr.number);
        const files = await gh(`/repos/${repo}/pulls/${pr.number}/files?per_page=100`);
        prs.push({
          number: pr.number,
          labels: (pr.labels ?? []).map((l) => l.name),
          files: files.map((f) => f.filename),
        });
      }
    }
  }
  return { target, mainHead: main.sha, gatesConclusion, prodCommit, prs };
}

async function cloudflare(method, body) {
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, WORKER_NAME: name } = process.env;
  if (!token || !account || !name) throw new Error('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / WORKER_NAME missing');
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${name}/deployments`,
    {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const msg = (json.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ');
    throw new Error(`Cloudflare ${method} deployments → HTTP ${res.status} ${msg}`);
  }
  return json.result;
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'gate') {
    const target = (arg(rest, '--target') ?? '').toLowerCase();
    if (!SHA.test(target)) throw new Error('--target must be a full 40-char SHA');
    const prodUrl = arg(rest, '--prod-url') ?? 'https://mxgarage-wrap-studio.haburaaashi.workers.dev';
    const input = await collectGateInput(target, prodUrl);
    const result = releaseGate(input);
    console.log(renderGate(result, input));
    process.exit(result.pass ? 0 : 1);
  }
  if (command === 'current') {
    const result = await cloudflare('GET');
    const current = pickCurrentVersion(result?.deployments ?? []);
    if (!current) throw new Error('no current deployment found');
    console.log(JSON.stringify(current));
    return;
  }
  if (command === 'promote') {
    const version = arg(rest, '--version') ?? '';
    const message = arg(rest, '--message') ?? 'release-acceptance workflow';
    const result = await cloudflare('POST', deploymentBody(version, message));
    console.log(JSON.stringify({ deploymentId: result?.id ?? null, versions: result?.versions ?? [] }));
    return;
  }
  console.error('usage: production-deploy.mjs gate|current|promote …');
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`production-deploy: ${error.message}`);
    process.exit(1);
  }
}
