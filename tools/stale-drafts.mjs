#!/usr/bin/env node
/**
 * Stale Draft handling for .github/workflows/stale-drafts.yml (AGENTS §10).
 * A Draft PR whose head has not received a commit for STALE_DAYS gets the
 * `stale` label and a comment; after another CLOSE_DAYS without a commit it is
 * closed (the branch is kept). A new commit removes the label.
 *
 *   node tools/stale-drafts.mjs [--dry-run]
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY.
 */
import { pathToFileURL } from 'node:url';

export const STALE_DAYS = 7;
export const CLOSE_DAYS = 7;
export const STALE_LABEL = 'stale';
const DAY = 24 * 60 * 60 * 1000;

/**
 * @param {{ draft: boolean, labels: string[], lastCommitAt: string, staleSince: string | null }} pr
 * @param {Date} now
 * @returns {'none' | 'mark' | 'unmark' | 'close'}
 */
export function decide(pr, now) {
  const hasLabel = pr.labels.includes(STALE_LABEL);
  const lastCommit = Date.parse(pr.lastCommitAt);
  if (!pr.draft) return hasLabel ? 'unmark' : 'none';
  if (hasLabel && pr.staleSince && lastCommit > Date.parse(pr.staleSince)) return 'unmark';
  const idle = now.getTime() - lastCommit;
  if (!hasLabel) return idle >= STALE_DAYS * DAY ? 'mark' : 'none';
  const since = pr.staleSince ? Date.parse(pr.staleSince) : lastCommit + STALE_DAYS * DAY;
  return now.getTime() - since >= CLOSE_DAYS * DAY ? 'close' : 'none';
}

export function markComment(pr) {
  return [
    `执行者：stale-drafts 工作流｜本 Draft 已 ${STALE_DAYS} 天没有新提交（最后一次 ${pr.lastCommitAt}）。`,
    '',
    `- 原执行者：推一次提交即可撤销 \`${STALE_LABEL}\`。`,
    `- 其他人：可按 AGENTS §10 从本分支切 \`<分支名>-takeover\` 接手，新 PR 链接本 PR 并保留 Co-authored-by。`,
    `- 再 ${CLOSE_DAYS} 天仍无提交，本 PR 会被自动关闭，分支保留。`,
  ].join('\n');
}

export function closeComment() {
  return `执行者：stale-drafts 工作流｜标记 \`${STALE_LABEL}\` 后 ${CLOSE_DAYS} 天仍无新提交，关闭本 Draft。分支保留，可随时重开或按 AGENTS §10 接手。`;
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
  if (!res.ok && res.status !== 404) throw new Error(`${method} ${path} → HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const repo = process.env.GITHUB_REPOSITORY;
  const now = new Date();
  const prs = await gh('GET', `/repos/${repo}/pulls?state=open&per_page=100`);
  for (const pr of prs) {
    const commit = await gh('GET', `/repos/${repo}/commits/${pr.head.sha}`);
    const lastCommitAt = commit.commit.committer.date;
    const labels = pr.labels.map((l) => l.name);
    let staleSince = null;
    if (labels.includes(STALE_LABEL)) {
      const events = await gh('GET', `/repos/${repo}/issues/${pr.number}/events?per_page=100`);
      const labeled = events.filter((e) => e.event === 'labeled' && e.label?.name === STALE_LABEL).pop();
      staleSince = labeled?.created_at ?? null;
    }
    const action = decide({ draft: pr.draft, labels, lastCommitAt, staleSince }, now);
    console.log(`#${pr.number} draft=${pr.draft} lastCommit=${lastCommitAt} → ${action}`);
    if (dry || action === 'none') continue;
    if (action === 'mark') {
      await gh('POST', `/repos/${repo}/issues/${pr.number}/labels`, { labels: [STALE_LABEL] });
      await gh('POST', `/repos/${repo}/issues/${pr.number}/comments`, { body: markComment({ lastCommitAt }) });
    } else if (action === 'unmark') {
      await gh('DELETE', `/repos/${repo}/issues/${pr.number}/labels/${STALE_LABEL}`);
    } else if (action === 'close') {
      await gh('POST', `/repos/${repo}/issues/${pr.number}/comments`, { body: closeComment() });
      await gh('PATCH', `/repos/${repo}/pulls/${pr.number}`, { state: 'closed' });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`stale-drafts: ${error.message}`);
    process.exit(1);
  }
}
