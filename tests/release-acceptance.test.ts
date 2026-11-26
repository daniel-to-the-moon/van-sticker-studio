import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNKNOWN_BUILD,
  currentBuildInfo,
  resolveBuildInfo,
} from '../lib/build-info.ts';
import {
  PAGE_ROUTES,
  commitMatches,
  evaluate,
  parseArgs,
  parseWorkersBuildsSummary,
  renderMarkdown,
} from '../tools/release-acceptance.mjs';

const NOW = new Date('2026-11-20T00:00:00.000Z');
const SHA = 'd9a719f6950cec0905f325c4cd5329049622385e';

void test('Workers Builds metadata becomes the reported build identity', () => {
  assert.deepEqual(
    resolveBuildInfo(
      { WORKERS_CI: '1', WORKERS_CI_COMMIT_SHA: SHA.toUpperCase(), WORKERS_CI_BRANCH: 'main' },
      NOW,
    ),
    { commit: SHA, branch: 'main', builtAt: NOW.toISOString(), source: 'workers-builds' },
  );
});

void test('GitHub Actions builds report GITHUB_SHA and the PR head branch', () => {
  const info = resolveBuildInfo(
    { GITHUB_ACTIONS: 'true', GITHUB_SHA: SHA, GITHUB_HEAD_REF: 'feature/1-x', GITHUB_REF_NAME: '9/merge' },
    NOW,
  );
  assert.equal(info.source, 'github-actions');
  assert.equal(info.commit, SHA);
  assert.equal(info.branch, 'feature/1-x');
});

void test('local or malformed metadata reports unknown instead of guessing', () => {
  assert.deepEqual(resolveBuildInfo({}, NOW), { ...UNKNOWN_BUILD, builtAt: NOW.toISOString() });
  const bad = resolveBuildInfo(
    { WORKERS_CI: '1', WORKERS_CI_COMMIT_SHA: 'not-a-sha<script>', WORKERS_CI_BRANCH: 'a b' },
    NOW,
  );
  assert.equal(bad.commit, 'unknown');
  assert.equal(bad.branch, 'unknown');
  assert.deepEqual(Object.keys(bad).sort(), ['branch', 'builtAt', 'commit', 'source']);
});

void test('outside a Vite build the current build is unknown', () => {
  assert.deepEqual(currentBuildInfo(), UNKNOWN_BUILD);
});

void test('Workers Builds check summary yields version and preview URLs', () => {
  const summary = [
    'Build ID: [72c4](https://dash.cloudflare.com/x/builds/72c4)',
    'Version ID: 9b1eabf7-d805-484d-ae73-976f7bf59ec2',
    'Preview URL: https://9b1eabf7-mxgarage-wrap-studio.haburaaashi.workers.dev',
    'Preview Alias URL: https://main-mxgarage-wrap-studio.haburaaashi.workers.dev',
  ].join('\n');
  assert.deepEqual(parseWorkersBuildsSummary(summary), {
    versionId: '9b1eabf7-d805-484d-ae73-976f7bf59ec2',
    previewUrl: 'https://9b1eabf7-mxgarage-wrap-studio.haburaaashi.workers.dev',
    aliasUrl: 'https://main-mxgarage-wrap-studio.haburaaashi.workers.dev',
  });
  assert.deepEqual(parseWorkersBuildsSummary(''), { versionId: null, previewUrl: null, aliasUrl: null });
});

void test('commit match needs at least 7 shared leading hex characters', () => {
  assert.equal(commitMatches(SHA, 'd9a719f'), true);
  assert.equal(commitMatches('d9a719f', SHA), true);
  assert.equal(commitMatches(SHA, 'd9a71'), false);
  assert.equal(commitMatches(SHA, '4b893b9'), false);
  assert.equal(commitMatches('unknown', 'd9a719f'), false);
  assert.equal(commitMatches('unknown', undefined), true);
});

type Probe = { status: number; body: Record<string, unknown> | null };
type Raw = {
  pages: { route: string; status: number }[];
  status: Probe;
  version: Probe;
  glb: { status: number; sha256: string | null };
};

function healthy(): Raw {
  return {
    pages: PAGE_ROUTES.map((route) => ({ route, status: 200 })),
    status: { status: 200, body: { configured: false } },
    version: { status: 200, body: { commit: SHA, branch: 'main', source: 'workers-builds' } },
    glb: { status: 200, sha256: 'abc' },
  };
}

void test('a healthy version passes every check, including model-lab', () => {
  const result = evaluate(healthy(), { commit: 'd9a719f', glbSha: 'abc' });
  assert.equal(result.pass, true);
  assert.equal(result.commit, SHA);
  assert.equal(result.configured, false);
  assert.ok(result.checks.some((c) => c.id === 'page /model-lab' && c.pass));
});

void test('a 404 model-lab fails the run (the 2026-11 production symptom)', () => {
  const raw = healthy();
  raw.pages = raw.pages.map((p: { route: string; status: number }) => (p.route === '/model-lab' ? { ...p, status: 404 } : p));
  const result = evaluate(raw, {});
  assert.equal(result.pass, false);
  assert.equal(result.checks.find((c) => c.id === 'page /model-lab')?.pass, false);
});

void test('a build older than /api/version is unknown and fails an expected commit', () => {
  const raw = healthy();
  raw.version = { status: 404, body: null };
  const result = evaluate(raw, { commit: SHA });
  assert.equal(result.commit, 'unknown');
  assert.equal(result.pass, false);
  assert.match(result.checks.find((c) => c.id === 'api /api/version')?.detail ?? '', /SHA 未知/);
});

void test('wrong commit, non-boolean status, or GLB hash drift each fail', () => {
  assert.equal(evaluate(healthy(), { commit: '4b893b9' }).pass, false);
  const status = healthy();
  status.status = { status: 200, body: { configured: 'yes' } };
  assert.equal(evaluate(status, {}).pass, false);
  assert.equal(evaluate(healthy(), { glbSha: 'def' }).pass, false);
});

void test('argument parsing keeps only the origin and rejects plain http', () => {
  assert.deepEqual(parseArgs(['--url', 'https://a.example.dev/model-lab?x=1', '--expect-commit', 'D9A719F']), {
    format: 'md',
    url: 'https://a.example.dev',
    expectCommit: 'd9a719f',
  });
  assert.throws(() => parseArgs(['--url', 'http://a.example.dev']), /https/);
  assert.throws(() => parseArgs([]), /--url is required/);
  assert.throws(() => parseArgs(['--url']), /needs a value/);
});

void test('markdown report states the commit, the verdict and its limits', () => {
  const result = evaluate(healthy(), { commit: SHA });
  const md = renderMarkdown({ url: 'https://x.dev', ranAt: NOW.toISOString(), ...result });
  assert.match(md, new RegExp(`\`${SHA}\``));
  assert.match(md, /全部通过/);
  assert.match(md, /不替代体验官/);
});
