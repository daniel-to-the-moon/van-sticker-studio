import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateGate, renderGate, systemOf } from '../tools/independence-gate.mjs';

const config = JSON.parse(fs.readFileSync('.github/agent-identities.json', 'utf8'));
const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const T0 = '2026-11-20T10:00:00Z';
const T1 = '2026-11-20T11:00:00Z';

const bot = (slug: string) => ({ login: `${slug}[bot]`, email: '' });
type Review = { user: string; state: string; commitId: string; submittedAt: string };

function pr(overrides: Record<string, unknown> = {}) {
  return {
    headSha: HEAD,
    headPushedAt: T0,
    sameRepo: true,
    author: { login: 'mxgarage-vss-gpt[bot]' },
    pushers: ['mxgarage-vss-gpt[bot]'],
    commits: [{ author: bot('mxgarage-vss-gpt'), committer: bot('mxgarage-vss-gpt') }],
    reviews: [] as Review[],
    files: ['tools/x.mjs'],
    labels: [] as string[],
    labelEvents: [] as { label: string; actor: string; createdAt: string }[],
    ...overrides,
  };
}

const approve = (user: string, commitId = HEAD, at = T1): Review => ({ user, state: 'APPROVED', commitId, submittedAt: at });

void test('identities map to systems by App slug, maintainer login or commit email', () => {
  assert.equal(systemOf(bot('mxgarage-vss-muse'), config), 'muse');
  assert.equal(systemOf({ login: 'daniel-to-the-moon' }, config), 'maintainer');
  assert.equal(systemOf({ login: 'github-actions[bot]' }, config), 'automation');
  assert.equal(systemOf({ login: null, email: 'NoReply@Anthropic.com' }, config), 'claude');
  assert.equal(systemOf({ login: 'someone-else' }, config), 'unknown');
  assert.equal(systemOf(bot('other-app'), config), 'unknown');
});

void test('a same-system approval does not count; another system does', () => {
  const self = evaluateGate(pr({ reviews: [approve('mxgarage-vss-gpt[bot]')] }), config);
  assert.equal(self.pass, false);
  assert.match(self.reasons.join('\n'), /非本体系批准/);
  const other = evaluateGate(pr({ reviews: [approve('mxgarage-vss-grok[bot]')] }), config);
  assert.equal(other.pass, true);
  assert.deepEqual(other.approvers, ['mxgarage-vss-grok[bot]（grok）']);
});

void test('a push from a second system makes it an implementer, even with spoofed commit authors', () => {
  const spoofed = pr({
    pushers: ['mxgarage-vss-gpt[bot]', 'mxgarage-vss-grok[bot]'],
    commits: [{ author: bot('mxgarage-vss-muse'), committer: bot('mxgarage-vss-muse') }],
    reviews: [approve('mxgarage-vss-grok[bot]')],
  });
  assert.equal(evaluateGate(spoofed, config).pass, false);
});

void test('a commit claiming a second system makes that system an implementer too', () => {
  const mixed = pr({
    commits: [
      { author: bot('mxgarage-vss-gpt'), committer: bot('mxgarage-vss-gpt') },
      { author: bot('mxgarage-vss-grok'), committer: bot('mxgarage-vss-grok') },
    ],
    reviews: [approve('mxgarage-vss-grok[bot]')],
  });
  assert.equal(evaluateGate(mixed, config).pass, false);
  assert.equal(evaluateGate({ ...mixed, reviews: [approve('mxgarage-vss-muse[bot]')] }, config).pass, true);
});

void test('the maintainer can approve anything, and maintainer PRs need any one system', () => {
  assert.equal(evaluateGate(pr({ reviews: [approve('daniel-to-the-moon')] }), config).pass, true);
  const own = pr({
    author: { login: 'daniel-to-the-moon' },
    pushers: ['daniel-to-the-moon'],
    commits: [{ author: { login: null, email: 'noreply@anthropic.com' }, committer: { login: 'web-flow', email: '' } }],
    reviews: [approve('mxgarage-vss-gpt[bot]')],
  });
  const result = evaluateGate(own, config);
  assert.equal(result.pass, true);
  assert.deepEqual([...result.implementers].sort((a, b) => a.localeCompare(b)), ['claude', 'maintainer']);
});

void test('approvals on an older head or later changes-requested do not pass', () => {
  assert.equal(evaluateGate(pr({ reviews: [approve('mxgarage-vss-grok[bot]', OLD)] }), config).pass, false);
  const flipped = pr({
    reviews: [
      approve('mxgarage-vss-grok[bot]', HEAD, T0),
      { user: 'mxgarage-vss-grok[bot]', state: 'CHANGES_REQUESTED', commitId: HEAD, submittedAt: T1 },
    ],
  });
  assert.equal(evaluateGate(flipped, config).pass, false);
  const blocker = pr({
    reviews: [
      approve('mxgarage-vss-grok[bot]'),
      { user: 'mxgarage-vss-muse[bot]', state: 'CHANGES_REQUESTED', commitId: HEAD, submittedAt: T1 },
    ],
  });
  assert.match(evaluateGate(blocker, config).reasons.join('\n'), /要求修改/);
});

void test('an unknown opener or pusher blocks; an unknown commit email does not', () => {
  const approved = { reviews: [approve('mxgarage-vss-grok[bot]')] };
  assert.equal(evaluateGate(pr({ ...approved, author: { login: 'someone-else' } }), config).pass, false);
  assert.equal(evaluateGate(pr({ ...approved, pushers: ['someone-else'] }), config).pass, false);
  const odd = pr({ ...approved, commits: [{ author: { login: null, email: 'x@example.com' }, committer: { login: null, email: 'x@example.com' } }] });
  assert.equal(evaluateGate(odd, config).pass, true);
});

void test('visible changes need a fresh maintainer visual-accepted or e2e no-visual-change', () => {
  const base = { files: ['components/studio/VehicleScene.tsx'], reviews: [approve('mxgarage-vss-grok[bot]')] };
  assert.equal(evaluateGate(pr(base), config).pass, false);
  const byHuman = pr({
    ...base,
    labels: ['visual-accepted'],
    labelEvents: [{ label: 'visual-accepted', actor: 'daniel-to-the-moon', createdAt: T1 }],
  });
  assert.equal(evaluateGate(byHuman, config).pass, true);
  const byAgent = pr({
    ...base,
    labels: ['visual-accepted'],
    labelEvents: [{ label: 'visual-accepted', actor: 'mxgarage-vss-grok[bot]', createdAt: T1 }],
  });
  assert.equal(evaluateGate(byAgent, config).pass, false);
  const stale = pr({
    ...base,
    headPushedAt: T1,
    labels: ['visual-accepted'],
    labelEvents: [{ label: 'visual-accepted', actor: 'daniel-to-the-moon', createdAt: T0 }],
  });
  assert.equal(evaluateGate(stale, config).pass, false);
  const e2e = pr({
    ...base,
    labels: ['no-visual-change'],
    labelEvents: [{ label: 'no-visual-change', actor: 'github-actions[bot]', createdAt: T1 }],
  });
  assert.equal(evaluateGate(e2e, config).pass, true);
  const fakeE2e = pr({
    ...base,
    labels: ['no-visual-change'],
    labelEvents: [{ label: 'no-visual-change', actor: 'mxgarage-vss-gpt[bot]', createdAt: T1 }],
  });
  assert.equal(evaluateGate(fakeE2e, config).pass, false);
});

void test('fork PRs and an unknown head push time fail closed', () => {
  const approved = { reviews: [approve('mxgarage-vss-grok[bot]')] };
  assert.match(evaluateGate(pr({ ...approved, sameRepo: false }), config).reasons.join('\n'), /fork/);
  const visual = {
    ...approved,
    files: ['app/page.tsx'],
    headPushedAt: null,
    labels: ['visual-accepted'],
    labelEvents: [{ label: 'visual-accepted', actor: 'daniel-to-the-moon', createdAt: T1 }],
  };
  assert.match(evaluateGate(pr(visual), config).reasons.join('\n'), /推送时间/);
});

void test('the report names head, implementers, approvers and reasons', () => {
  const p = pr();
  const md = renderGate(evaluateGate(p, config), p);
  assert.match(md, /未通过/);
  assert.match(md, new RegExp(HEAD));
  assert.match(md, /gpt/);
});
