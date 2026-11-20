#!/usr/bin/env node
/**
 * Independence gate (agent-governance-kit). Decides from GitHub
 * identities — not signatures — whether a PR head has:
 *   1. an APPROVED review on the exact head SHA from a system that took no
 *      part in the implementation (or from a maintainer),
 *   2. no reviewer whose latest review on the head requests changes,
 *   3. when visible files change: `visual-accepted` added by a maintainer
 *      after the head commit, or `no-visual-change` added by the e2e workflow
 *      after the head commit.
 * Identities, visible paths and label names come from .github/agent-identities.json.
 *
 *   node tools/independence-gate.mjs --pr <number> [--publish]
 * Env: GITHUB_TOKEN (gate App installation token when publishing),
 *      GITHUB_REPOSITORY. --publish writes the `independence-gate` check run
 *      on the head SHA; without it the verdict is only printed.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CHECK_NAME = 'independence-gate';

/**
 * Visible-change rule from config.visual = { include: [regex…], exclude: [regex…] }.
 * Exclusions win. Without config.visual the visual check is off.
 */
export function isVisualPath(file, config) {
  const visual = config.visual;
  if (!visual) return false;
  const any = (patterns) => (patterns ?? []).some((p) => new RegExp(p).test(file));
  return any(visual.include) && !any(visual.exclude);
}

/** Map a GitHub login (or, failing that, a commit email) to a system key. */
export function systemOf(identity, config) {
  const login = identity?.login ?? null;
  const email = (identity?.email ?? '').toLowerCase();
  if (login) {
    if (config.maintainers.includes(login)) return 'maintainer';
    if (config.automation.includes(login)) return 'automation';
    if (login.endsWith('[bot]')) {
      const slug = login.slice(0, -'[bot]'.length);
      for (const [key, system] of Object.entries(config.systems))
        if (system.apps.includes(slug)) return key;
      return 'unknown';
    }
    return 'unknown';
  }
  for (const [key, system] of Object.entries(config.systems))
    if (email && system.emails.map((e) => e.toLowerCase()).includes(email)) return key;
  return 'unknown';
}

/**
 * Pure verdict.
 * @param {{
 *   headSha: string, headPushedAt: string | null, sameRepo: boolean,
 *   author: { login: string },
 *   pushers: string[],
 *   commits: { author: { login?: string|null, email?: string }, committer: { login?: string|null, email?: string } }[],
 *   reviews: { user: string, state: string, commitId: string, submittedAt: string }[],
 *   files: string[],
 *   labels: string[],
 *   labelEvents: { label: string, actor: string, createdAt: string }[],
 * }} pr
 * @param {any} config
 */
export function evaluateGate(pr, config) {
  const reasons = [];
  if (!pr.sameRepo) reasons.push('来自 fork 的 PR：无法核实推送者身份，闸门不放行（请在本仓库分支上提交）');
  const implementers = new Set();
  // Verified identities: who opened the PR and who pushed to its branch.
  // Commit author/committer fields are self-declared, so they can only add
  // implementers (which can only make the gate stricter), never vouch.
  for (const who of [pr.author, ...pr.pushers.map((login) => ({ login }))]) {
    const system = systemOf(who, config);
    if (system === 'automation') continue;
    if (system === 'unknown') reasons.push(`身份 ${who.login} 不在 .github/agent-identities.json 里，无法判定实现方体系`);
    implementers.add(system);
  }
  for (const commit of pr.commits)
    for (const who of [commit.author, commit.committer]) {
      const system = systemOf(who, config);
      if (system !== 'automation' && system !== 'unknown') implementers.add(system);
    }
  implementers.delete('unknown');

  const latest = new Map();
  for (const review of [...pr.reviews].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))) {
    if (review.state === 'COMMENTED' || review.state === 'PENDING') continue;
    latest.set(review.user, review);
  }
  const approvers = [];
  for (const review of latest.values()) {
    const system = systemOf({ login: review.user }, config);
    if (review.state === 'CHANGES_REQUESTED')
      reasons.push(`${review.user} 要求修改，尚未撤回或重新批准`);
    if (review.state !== 'APPROVED' || review.commitId !== pr.headSha) continue;
    if (system === 'unknown' || system === 'automation') continue;
    if (system !== 'maintainer' && implementers.has(system)) continue;
    approvers.push(`${review.user}（${system}）`);
  }
  if (approvers.length === 0)
    reasons.push(
      `缺少对当前 head ${pr.headSha.slice(0, 7)} 的非本体系批准（实现方：${[...implementers].join('、') || '无'}）`,
    );

  const visualFiles = pr.files.filter((file) => isVisualPath(file, config));
  const ACCEPTED = config.visual?.acceptedLabel ?? 'visual-accepted';
  const UNCHANGED = config.visual?.unchangedLabel ?? 'no-visual-change';
  let visual = 'not-needed';
  if (visualFiles.length > 0) {
    const lastLabel = (name) =>
      pr.labelEvents
        .filter((e) => e.label === name)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .pop();
    // A label counts only if it was added after the current head was pushed.
    const fresh = (event) => Boolean(event && pr.headPushedAt && event.createdAt >= pr.headPushedAt);
    const accepted = lastLabel(ACCEPTED);
    const unchanged = lastLabel(UNCHANGED);
    if (
      pr.labels.includes(ACCEPTED) &&
      fresh(accepted) &&
      systemOf({ login: accepted.actor }, config) === 'maintainer'
    )
      visual = `${ACCEPTED}（${accepted.actor}）`;
    else if (config.visual?.unchangedLabeler && pr.labels.includes(UNCHANGED) && fresh(unchanged) && unchanged.actor === config.visual.unchangedLabeler)
      visual = `${UNCHANGED}（${unchanged.actor}）`;
    else if (!pr.headPushedAt)
      reasons.push('查不到当前 head 的推送时间，无法确认视觉验收针对的是这一版');
    else
      reasons.push(
        `改了可见文件（${visualFiles.slice(0, 3).join(', ')}${visualFiles.length > 3 ? ' …' : ''}），需维护者在当前 head 推送后打 ${ACCEPTED}${config.visual?.unchangedLabeler ? `，或 ${config.visual.unchangedLabeler} 打 ${UNCHANGED}` : ''}`,
      );
  }
  return { pass: reasons.length === 0, reasons, implementers: [...implementers], approvers, visual };
}

export function renderGate(result, pr) {
  return [
    `### 独立性闸门：${result.pass ? '通过' : '未通过'}`,
    '',
    `- head：\`${pr.headSha}\``,
    `- 实现方体系：${result.implementers.join('、') || '无'}`,
    `- 有效批准：${result.approvers.join('、') || '无'}`,
    `- 视觉验收：${result.visual}`,
    ...(result.reasons.length ? ['', '未通过原因：', ...result.reasons.map((r) => `- ${r}`)] : []),
  ].join('\n');
}

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}`);
  return res.json();
}

/** GET every page of a list endpoint (per_page=100) so nothing past page 1 is missed. */
async function ghAll(path) {
  const items = [];
  for (let page = 1; page <= 50; page += 1) {
    const sep = path.includes('?') ? '&' : '?';
    const batch = await gh('GET', `${path}${sep}per_page=100&page=${page}`);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
  throw new Error(`${path}: more than 5000 items, refusing to judge an incomplete list`);
}

async function collect(repo, number) {
  const pr = await gh('GET', `/repos/${repo}/pulls/${number}`);
  const commits = await ghAll(`/repos/${repo}/pulls/${number}/commits`);
  const reviews = await ghAll(`/repos/${repo}/pulls/${number}/reviews`);
  const files = await ghAll(`/repos/${repo}/pulls/${number}/files`);
  const events = await ghAll(`/repos/${repo}/issues/${number}/events`);
  const sameRepo = pr.head.repo?.full_name === repo;
  const activity = sameRepo
    ? await ghAll(`/repos/${repo}/activity?ref=${encodeURIComponent(`refs/heads/${pr.head.ref}`)}`)
    : [];
  const who = (user, git) => ({ login: user?.login ?? null, email: git?.email ?? '' });
  return {
    headSha: pr.head.sha,
    sameRepo,
    // Server-side time the current head reached the branch (not the Git commit date).
    headPushedAt:
      activity
        .filter((a) => a.after === pr.head.sha)
        .map((a) => a.timestamp)
        .sort()
        .pop() ?? null,
    author: { login: pr.user.login },
    pushers: [...new Set(activity.map((a) => a.actor?.login).filter(Boolean))],
    commits: commits.map((c) => ({ author: who(c.author, c.commit.author), committer: who(c.committer, c.commit.committer) })),
    reviews: reviews.map((r) => ({ user: r.user.login, state: r.state, commitId: r.commit_id, submittedAt: r.submitted_at ?? '' })),
    files: files.map((f) => f.filename),
    labels: pr.labels.map((l) => l.name),
    labelEvents: events
      .filter((e) => e.event === 'labeled')
      .map((e) => ({ label: e.label.name, actor: e.actor.login, createdAt: e.created_at })),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const number = Number(argv[argv.indexOf('--pr') + 1]);
  if (!Number.isInteger(number) || number <= 0) throw new Error('--pr <number> required');
  const repo = process.env.GITHUB_REPOSITORY;
  const config = JSON.parse(fs.readFileSync('.github/agent-identities.json', 'utf8'));
  const pr = await collect(repo, number);
  const result = evaluateGate(pr, config);
  const summary = renderGate(result, pr);
  console.log(summary);
  if (argv.includes('--publish')) {
    await gh('POST', `/repos/${repo}/check-runs`, {
      name: CHECK_NAME,
      head_sha: pr.headSha,
      status: 'completed',
      conclusion: result.pass ? 'success' : 'failure',
      output: { title: result.pass ? '通过' : '未通过', summary },
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`independence-gate: ${error.message}`);
    process.exit(1);
  }
}
