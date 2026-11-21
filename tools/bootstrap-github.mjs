#!/usr/bin/env node
/**
 * One-shot setup of agent Apps and repository rules (repo-bootstrap skill, #114).
 *
 * GitHub has no API that creates a GitHub App outright: the manifest flow is
 * the only programmatic path and it needs one browser confirmation per App.
 * This script keeps that to two clicks per App (Create, Install) and does
 * everything else through the GitHub CLI.
 *
 *   gh auth login                      # once, as the maintainer
 *   node tools/bootstrap-github.mjs --repo OWNER/REPO --prefix mxgarage-vss \
 *     --systems gpt,muse,grok [--org ORG] [--existing gpt,muse,grok] [--require-gate]
 *
 * Phases:
 *   1. Apps: a local page walks through Create → Install for each App that
 *      does not exist yet (agent systems + "<prefix>-gate"). Private keys are
 *      written to ~/.config/agent-apps/<slug>.pem (mode 600) and never printed.
 *   2. Repo: labels, Environment `independence-gate` (default branch only),
 *      gate App secrets, `.github/agent-identities.json` App slugs (when run
 *      inside the repo), and a ruleset "agent-governance".
 * The ruleset requires `gates`; add --require-gate after the gate has published
 * one `independence-gate` check (GitHub only lets a required check be bound to
 * an App that has already reported it).
 * Flags: --apps-only, --repo-only, --no-open, --port N, --dry-run.
 */
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WEB = process.env.BOOTSTRAP_GITHUB_WEB ?? 'https://github.com';
const API = process.env.BOOTSTRAP_GITHUB_API ?? 'https://api.github.com';
export const KEY_DIR = process.env.BOOTSTRAP_KEY_DIR ?? path.join(os.homedir(), '.config', 'agent-apps');
export const RULESET_NAME = 'agent-governance';
export const LABELS = [
  ['visual-accepted', '0e8a16', '维护者/体验官已看过当前 head 的画面变化'],
  ['no-visual-change', 'c5def5', 'e2e 判定画面无变化'],
  ['stale', 'ededed', 'Draft 7 天无推送；再 7 天自动关闭'],
  ['hygiene-exempt', 'bfd4f2', '维护者豁免 PR 格式检查'],
];
export const AGENT_PERMISSIONS = {
  contents: 'write', pull_requests: 'write', issues: 'write', checks: 'write',
  statuses: 'write', workflows: 'write', actions: 'read', metadata: 'read',
};
export const GATE_PERMISSIONS = {
  checks: 'write', statuses: 'write', contents: 'read', pull_requests: 'read', issues: 'read', metadata: 'read',
};

/** @param {string[]} argv */
export function parseArgs(argv) {
  const out = { systems: [], existing: [], port: 8765, open: true, apps: true, rules: true, requireGate: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${key} needs a value`);
      i += 1;
      return v;
    };
    const list = () => value().split(',').map((s) => s.trim()).filter(Boolean);
    if (key === '--repo') out.repo = value();
    else if (key === '--prefix') out.prefix = value();
    else if (key === '--systems') out.systems = list();
    else if (key === '--existing') out.existing = list();
    else if (key === '--org') out.org = value();
    else if (key === '--port') out.port = Number(value());
    else if (key === '--no-open') out.open = false;
    else if (key === '--apps-only') out.rules = false;
    else if (key === '--repo-only') out.apps = false;
    else if (key === '--require-gate') out.requireGate = true;
    else if (key === '--dry-run') out.dryRun = true;
    else throw new Error(`unknown argument ${key}`);
  }
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(out.repo ?? '')) throw new Error('--repo OWNER/REPO is required');
  if (!/^[a-z0-9][a-z0-9-]{0,24}$/.test(out.prefix ?? '')) throw new Error('--prefix must be lowercase letters, digits, dashes');
  for (const s of [...out.systems, ...out.existing])
    if (!/^[a-z0-9-]+$/.test(s)) throw new Error(`bad system key ${s}`);
  if (out.existing.some((s) => !out.systems.includes(s) && s !== 'gate'))
    throw new Error('--existing must name systems from --systems (or gate)');
  return out;
}

/** Apps to create, in order: agent systems not marked existing, then the gate App. */
export function plannedApps(opts) {
  const apps = opts.systems
    .filter((s) => !opts.existing.includes(s))
    .map((s) => ({ key: s, name: `${opts.prefix}-${s}`, permissions: AGENT_PERMISSIONS, gate: false }));
  if (!opts.existing.includes('gate'))
    apps.push({ key: 'gate', name: `${opts.prefix}-gate`, permissions: GATE_PERMISSIONS, gate: true });
  return apps;
}

export function buildManifest(app, { repo, base }) {
  return {
    name: app.name,
    url: `https://github.com/${repo}`,
    description: app.gate
      ? '独立性闸门：只发 independence-gate 检查。私钥只放仓库 Environment。'
      : `agent 身份：${app.key} 体系。由维护者创建并负责。`,
    public: false,
    hook_attributes: { url: `https://github.com/${repo}`, active: false },
    redirect_url: `${base}/callback`,
    setup_url: `${base}/installed`,
    setup_on_update: false,
    default_permissions: app.permissions,
    default_events: [],
  };
}

export function rulesetBody({ gateAppId, requireGate }) {
  const checks = [{ context: 'gates' }];
  if (requireGate) {
    if (!Number.isInteger(gateAppId)) throw new Error('--require-gate needs the gate App id');
    checks.push({ context: 'independence-gate', integration_id: gateAppId });
  }
  return {
    name: RULESET_NAME,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      {
        type: 'pull_request',
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
        },
      },
      { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, required_status_checks: checks } },
    ],
  };
}

/** Put the real App slugs into agent-identities.json; returns the new text. */
export function updateIdentities(text, prefix, slugs) {
  const config = JSON.parse(text);
  for (const [key, slug] of Object.entries(slugs)) {
    if (key === 'gate') continue;
    config.systems[key] ??= { members: [], apps: [], emails: [] };
    config.systems[key].apps = [slug];
  }
  const gate = slugs.gate ?? `${prefix}-gate`;
  config.automation = [...new Set([...(config.automation ?? []).filter((a) => !a.endsWith('-gate[bot]')), `${gate}[bot]`])];
  return `${JSON.stringify(config, null, 2)}\n`;
}

// ---------- phase 1: Apps (local server + manifest flow) ----------

function page(state) {
  const next = state.apps.find((a) => !a.created);
  const pendingInstall = state.apps.find((a) => a.created && !a.installed);
  const rows = state.apps
    .map((a) => `<li>${a.name}：${a.installed ? '已创建并安装' : a.created ? '已创建，待安装' : '待创建'}</li>`)
    .join('');
  let action = '<p><b>全部完成</b>，可以关掉这个页面，回到终端。</p>';
  if (pendingInstall)
    action = `<p>下一步：安装 <b>${pendingInstall.name}</b>，只选仓库 <code>${state.repo}</code>。</p>
      <p><a href="${WEB}/apps/${pendingInstall.slug}/installations/new">去安装</a></p>`;
  else if (next) {
    const manifest = JSON.stringify(buildManifest(next, { repo: state.repo, base: state.base }));
    const target = state.org ? `${WEB}/organizations/${state.org}/settings/apps/new` : `${WEB}/settings/apps/new`;
    action = `<form id="f" method="post" action="${target}?state=${state.nonce}">
        <input type="hidden" name="manifest" value="${manifest.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">
        <p>下一步：在 GitHub 创建 <b>${next.name}</b>（页面会自动跳转；没跳就点按钮）。</p>
        <button type="submit">去 GitHub 创建</button></form>
      <script>setTimeout(() => document.getElementById('f').submit(), 800)</script>`;
  }
  return `<!DOCTYPE html><meta charset="utf-8"><title>创建 agent App</title>
    <body style="font:15px/1.6 system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px">
    <h1 style="font-size:20px">创建 agent App（${state.repo}）</h1><ol>${rows}</ol>${action}
    <p style="color:#666;font-size:13px">每个 App 两步：Create GitHub App → Install（只选本仓库）。私钥由本机脚本直接保存，不显示。</p></body>`;
}

async function convert(code) {
  const res = await fetch(`${API}/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST',
    headers: { accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`manifest conversion → HTTP ${res.status}`);
  return res.json();
}

function saveKey(slug, pem) {
  fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(KEY_DIR, `${slug}.pem`);
  fs.writeFileSync(file, pem, { mode: 0o600 });
  return file;
}

function recordApp(app) {
  const file = path.join(KEY_DIR, 'apps.json');
  const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  all[app.slug] = { id: app.id, slug: app.slug, key: app.key, installationId: app.installationId ?? null, keyFile: app.keyFile };
  fs.writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
}

export function runAppsFlow(opts, planned) {
  const base = `http://127.0.0.1:${opts.port}`;
  const state = { repo: opts.repo, org: opts.org, base, nonce: crypto.randomBytes(16).toString('hex'), apps: planned.map((a) => ({ ...a })) };
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', base);
      const send = (status, body, headers = {}) => {
        res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
        res.end(body);
      };
      try {
        if (url.pathname === '/callback') {
          if (url.searchParams.get('state') !== state.nonce) return send(400, 'state mismatch');
          const app = state.apps.find((a) => !a.created);
          if (!app) return send(400, 'no App pending');
          const result = await convert(url.searchParams.get('code') ?? '');
          app.created = true;
          app.id = result.id;
          app.slug = result.slug;
          app.keyFile = saveKey(result.slug, result.pem);
          recordApp(app);
          console.log(`created ${app.slug} (App ID ${app.id}); key saved to ${app.keyFile}`);
          return send(302, '', { location: `${WEB}/apps/${app.slug}/installations/new` });
        }
        if (url.pathname === '/installed') {
          const app = state.apps.find((a) => a.created && !a.installed);
          if (app) {
            app.installed = true;
            app.installationId = Number(url.searchParams.get('installation_id')) || null;
            recordApp(app);
            console.log(`installed ${app.slug}`);
          }
          return send(302, '', { location: '/' });
        }
        if (url.pathname === '/') {
          send(200, page(state));
          if (state.apps.every((a) => a.installed)) {
            setTimeout(() => {
              server.close();
              resolve(state.apps);
            }, 300);
          }
          return undefined;
        }
        return send(404, 'not found');
      } catch (error) {
        console.error(`bootstrap: ${error.message}`);
        return send(500, `出错了：${String(error.message).replace(/</g, '&lt;')}。回到终端看日志。`);
      }
    });
    server.on('error', reject);
    server.listen(opts.port, '127.0.0.1', () => {
      console.log(`open ${base}/ in the browser where the maintainer is signed in to GitHub`);
      if (opts.open) {
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
        try {
          spawn(opener, [`${base}/`], { stdio: 'ignore', detached: true }).unref();
        } catch {
          /* printed URL is enough */
        }
      }
    });
  });
}

// ---------- phase 2: repository settings via gh ----------

function gh(args, input) {
  return execFileSync('gh', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function ghApi(method, apiPath, body) {
  const args = ['api', '-X', method, apiPath, '-H', 'Accept: application/vnd.github+json'];
  if (body) args.push('--input', '-');
  const out = gh(args, body ? JSON.stringify(body) : undefined);
  return out.trim() ? JSON.parse(out) : null;
}

function tryApi(method, apiPath, body) {
  try {
    return { ok: true, data: ghApi(method, apiPath, body) };
  } catch (error) {
    return { ok: false, error: String(error.stderr || error.message).trim() };
  }
}

function knownApps() {
  const file = path.join(KEY_DIR, 'apps.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

export function configureRepo(opts, log = console.log) {
  const { repo } = opts;
  const meta = ghApi('GET', `/repos/${repo}`);
  if (!meta.permissions?.admin) throw new Error(`gh is not signed in as an admin of ${repo}`);
  const branch = meta.default_branch;
  const gate = knownApps()[`${opts.prefix}-gate`];

  const existing = new Set(ghApi('GET', `/repos/${repo}/labels?per_page=100`).map((l) => l.name));
  for (const [name, color, description] of LABELS)
    if (!existing.has(name) && !opts.dryRun) ghApi('POST', `/repos/${repo}/labels`, { name, color, description });
  log(`labels: ${LABELS.map(([n]) => n).join(', ')}`);

  if (!opts.dryRun) {
    ghApi('PUT', `/repos/${repo}/environments/independence-gate`, {
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    });
    const policies = ghApi('GET', `/repos/${repo}/environments/independence-gate/deployment-branch-policies`);
    if (!policies.branch_policies.some((p) => p.name === branch))
      ghApi('POST', `/repos/${repo}/environments/independence-gate/deployment-branch-policies`, { name: branch, type: 'branch' });
  }
  log(`environment independence-gate: deployments only from ${branch}`);

  if (gate && !opts.dryRun) {
    gh(['secret', 'set', 'GATE_APP_ID', '--env', 'independence-gate', '--repo', repo, '--body', String(gate.id)]);
    gh(['secret', 'set', 'GATE_APP_PRIVATE_KEY', '--env', 'independence-gate', '--repo', repo], fs.readFileSync(gate.keyFile, 'utf8'));
    log('environment secrets: GATE_APP_ID, GATE_APP_PRIVATE_KEY (from the saved key file, not printed)');
  } else if (!gate) log(`gate App ${opts.prefix}-gate not found in ${KEY_DIR}/apps.json; secrets not set`);

  const identities = path.resolve('.github/agent-identities.json');
  if (fs.existsSync(identities)) {
    const slugs = Object.fromEntries(
      Object.values(knownApps())
        .filter((a) => a.slug.startsWith(`${opts.prefix}-`))
        .map((a) => [a.key, a.slug]),
    );
    if (!opts.dryRun) fs.writeFileSync(identities, updateIdentities(fs.readFileSync(identities, 'utf8'), opts.prefix, slugs));
    log('updated .github/agent-identities.json with App slugs (commit it in a PR)');
  }

  const body = rulesetBody({ gateAppId: gate?.id, requireGate: opts.requireGate });
  const rulesets = ghApi('GET', `/repos/${repo}/rulesets?per_page=100`);
  const found = rulesets.find((r) => r.name === RULESET_NAME);
  if (!opts.dryRun) {
    const result = found
      ? tryApi('PUT', `/repos/${repo}/rulesets/${found.id}`, body)
      : tryApi('POST', `/repos/${repo}/rulesets`, body);
    if (!result.ok) throw new Error(`ruleset: ${result.error}`);
  }
  log(`ruleset ${RULESET_NAME}: required checks ${body.rules[3].parameters.required_status_checks.map((c) => c.context).join(', ')}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  gh(['auth', 'status']);
  if (opts.apps) {
    const planned = plannedApps(opts);
    if (planned.length) {
      if (opts.dryRun) planned.forEach((a) => console.log(`would create ${a.name}`));
      else await runAppsFlow(opts, planned);
    }
  }
  if (opts.rules) configureRepo(opts);
  const apps = Object.values(knownApps()).filter((a) => a.slug.startsWith(`${opts.prefix}-`));
  console.log('\nApps:');
  for (const a of apps) console.log(`  ${a.slug}  App ID ${a.id}  key ${a.keyFile}`);
  console.log('\nNext:');
  console.log('  1. Give each agent platform its own App ID + key file; keep the gate key only in the Environment.');
  console.log('  2. Commit .github/agent-identities.json in a PR; once merged, comment /gate on any PR.');
  console.log(`  3. Re-run with --repo-only --require-gate to make independence-gate required from ${opts.prefix}-gate.`);
  console.log('  4. Revoke personal tokens the agents used before.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`bootstrap: ${error.stderr ? String(error.stderr).trim() : error.message}`);
    process.exit(1);
  });
}
