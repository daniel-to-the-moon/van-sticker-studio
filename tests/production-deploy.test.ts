import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deploymentBody,
  isVisualPath,
  pickCurrentVersion,
  releaseGate,
  renderGate,
} from '../tools/production-deploy.mjs';

const MAIN = 'a'.repeat(40);
const PROD = 'b'.repeat(40);
const V1 = '39a469bf-0000-4000-8000-000000000001';
const V2 = '9b1eabf7-d805-484d-ae73-976f7bf59ec2';

void test('visual paths are product surfaces, not docs, tests, tools or API routes', () => {
  for (const file of [
    'components/studio/VehicleScene.tsx',
    'app/page.tsx',
    'app/model-lab/page.tsx',
    'lib/wrap-layout.ts',
    'public/model/mxgarage-rv.glb',
    'hooks/use-mobile.ts',
    'app/globals.css',
  ])
    assert.equal(isVisualPath(file), true, file);
  for (const file of [
    'docs/opc/demand-pool.md',
    'tests/wrap-lock.test.ts',
    'tools/release-acceptance.mjs',
    '.github/workflows/ci.yml',
    'app/api/version/route.ts',
    'AGENTS.md',
    'lib/README.md',
  ])
    assert.equal(isVisualPath(file), false, file);
});

void test('current version is the largest share of the newest deployment', () => {
  assert.deepEqual(
    pickCurrentVersion([
      { created_on: '2026-10-20T00:00:00Z', versions: [{ version_id: 'old', percentage: 100 }] },
      {
        created_on: '2026-10-26T00:00:00Z',
        versions: [
          { version_id: V2, percentage: 10 },
          { version_id: V1, percentage: 90 },
        ],
      },
    ]),
    { versionId: V1, percentage: 90, deployedAt: '2026-10-26T00:00:00Z' },
  );
  assert.equal(pickCurrentVersion([]), null);
});

void test('deployment body sends 100% to one version and rejects non-UUIDs', () => {
  assert.deepEqual(deploymentBody(V2, 'auto'), {
    strategy: 'percentage',
    versions: [{ version_id: V2, percentage: 100 }],
    annotations: { 'workers/message': 'auto' },
  });
  assert.throws(() => deploymentBody('9b1eabf7', 'x'), /UUID/);
});

const base = { target: MAIN, mainHead: MAIN, gatesConclusion: 'success', prodCommit: PROD, prs: [] };

void test('a docs-only range with green gates passes the gate', () => {
  const result = releaseGate({
    ...base,
    prs: [{ number: 103, labels: [], files: ['docs/opc/demand-pool.md'] }],
  });
  assert.equal(result.pass, true);
  assert.deepEqual(result.reasons, []);
});

void test('an unlabelled visual PR blocks; either accept label clears it', () => {
  const pr = { number: 98, labels: [] as string[], files: ['components/studio/VehicleScene.tsx'] };
  const blocked = releaseGate({ ...base, prs: [pr] });
  assert.equal(blocked.pass, false);
  assert.match(blocked.reasons[0] ?? '', /#98/);
  assert.equal(releaseGate({ ...base, prs: [{ ...pr, labels: ['visual-accepted'] }] }).pass, true);
  assert.equal(releaseGate({ ...base, prs: [{ ...pr, labels: ['no-visual-change'] }] }).pass, true);
  assert.equal(releaseGate({ ...base, prs: [{ ...pr, labels: ['enhancement'] }] }).pass, false);
});

void test('stale build, red gates, or unknown production commit each block', () => {
  assert.equal(releaseGate({ ...base, mainHead: 'c'.repeat(40) }).pass, false);
  assert.equal(releaseGate({ ...base, gatesConclusion: 'failure' }).pass, false);
  assert.equal(releaseGate({ ...base, gatesConclusion: null }).pass, false);
  const unknown = releaseGate({ ...base, prodCommit: null });
  assert.equal(unknown.pass, false);
  assert.match(unknown.reasons.join('\n'), /手动发版/);
});

void test('gate report names verdict, both commits and the reasons', () => {
  const ctx = { ...base, prs: [{ number: 98, labels: [], files: ['app/page.tsx'] }] };
  const md = renderGate(releaseGate(ctx), ctx);
  assert.match(md, /拦下/);
  assert.match(md, new RegExp(MAIN));
  assert.match(md, new RegExp(PROD));
  assert.match(md, /#98/);
});
