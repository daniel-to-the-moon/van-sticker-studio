import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_PERMISSIONS,
  GATE_PERMISSIONS,
  buildManifest,
  parseArgs,
  plannedApps,
  rulesetBody,
  updateIdentities,
} from '../tools/bootstrap-github.mjs';

const base = ['--repo', 'daniel-to-the-moon/van-sticker-studio', '--prefix', 'mxgarage-vss'];

void test('arguments are validated and lists are parsed', () => {
  const opts = parseArgs([...base, '--systems', 'gpt, muse,grok', '--existing', 'gpt,muse,grok', '--no-open']);
  assert.deepEqual(opts.systems, ['gpt', 'muse', 'grok']);
  assert.equal(opts.open, false);
  assert.throws(() => parseArgs(['--prefix', 'x']), /--repo/);
  assert.throws(() => parseArgs([...base.slice(0, 2), '--prefix', 'Bad Prefix']), /prefix/);
  assert.throws(() => parseArgs([...base, '--systems', 'gpt', '--existing', 'grok']), /existing/);
  assert.throws(() => parseArgs([...base, '--bogus']), /unknown/);
});

void test('existing Apps are skipped and the gate App comes last with narrow permissions', () => {
  const planned = plannedApps(parseArgs([...base, '--systems', 'gpt,muse,grok', '--existing', 'gpt,muse,grok']));
  assert.deepEqual(planned.map((a: { name: string }) => a.name), ['mxgarage-vss-gate']);
  assert.equal(planned[0].permissions, GATE_PERMISSIONS);
  const fresh = plannedApps(parseArgs([...base, '--systems', 'gpt,grok']));
  assert.deepEqual(fresh.map((a: { name: string }) => a.name), ['mxgarage-vss-gpt', 'mxgarage-vss-grok', 'mxgarage-vss-gate']);
  assert.equal(fresh[0].permissions, AGENT_PERMISSIONS);
  assert.equal(GATE_PERMISSIONS.contents, 'read');
});

void test('manifest is private, webhook-less and returns to the local server', () => {
  const [app] = plannedApps(parseArgs([...base, '--systems', 'gpt']));
  const manifest = buildManifest(app, { repo: 'o/r', base: 'http://127.0.0.1:8765' });
  assert.equal(manifest.public, false);
  assert.equal(manifest.hook_attributes.active, false);
  assert.equal(manifest.redirect_url, 'http://127.0.0.1:8765/callback');
  assert.equal(manifest.setup_url, 'http://127.0.0.1:8765/installed');
  assert.deepEqual(manifest.default_events, []);
});

void test('ruleset requires gates, and binds independence-gate to the gate App only when asked', () => {
  const plain = rulesetBody({ gateAppId: undefined, requireGate: false });
  const checks = (b: ReturnType<typeof rulesetBody>) =>
    (b.rules.find((r: { type: string }) => r.type === 'required_status_checks') as { parameters: { required_status_checks: unknown[] } })
      .parameters.required_status_checks;
  assert.deepEqual(checks(plain), [{ context: 'gates' }]);
  assert.deepEqual(plain.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  assert.ok(plain.rules.some((r: { type: string }) => r.type === 'non_fast_forward'));
  assert.deepEqual(checks(rulesetBody({ gateAppId: 42, requireGate: true }))[1], { context: 'independence-gate', integration_id: 42 });
  assert.throws(() => rulesetBody({ gateAppId: undefined, requireGate: true }), /gate App id/);
});

void test('identities get the real slugs and exactly one gate automation identity', () => {
  const before = JSON.stringify({
    systems: { gpt: { members: ['GPT'], apps: ['old'], emails: [] } },
    maintainers: ['m'],
    automation: ['github-actions[bot]', 'old-gate[bot]'],
  });
  const after = JSON.parse(updateIdentities(before, 'mxgarage-vss', { gpt: 'mxgarage-vss-gpt-2', grok: 'mxgarage-vss-grok', gate: 'mxgarage-vss-gate' }));
  assert.deepEqual(after.systems.gpt.apps, ['mxgarage-vss-gpt-2']);
  assert.deepEqual(after.systems.gpt.members, ['GPT']);
  assert.deepEqual(after.systems.grok.apps, ['mxgarage-vss-grok']);
  assert.deepEqual(after.automation, ['github-actions[bot]', 'mxgarage-vss-gate[bot]']);
});
