// claude.yml 用到的 ctx.sh / claim.sh / publish.sh 的行为测试：假 gh（记录调用、按子命令返回预设 JSON 并执行真实的 -q 过滤）+ 真 git（本地临时远端）
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'devloop-claude-'));
after(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const SHA = 'a'.repeat(40);
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
/** 默认任务 issue 正文：带冻结文件范围（devloop-scope 代码块） */
const BODY = '需求\n\n```devloop-scope\nb\nc\nlib/*\ndocs/*\n# 注释\n```\n';

/**
 * 假 gh：参数逐行记到 gh.log。按子命令输出环境变量里的 JSON，带 -q / --jq 时用真 jq 过滤（脚本里的过滤表达式真实执行）。
 * issue view → FAKE_ISSUE_JSON；pr view → FAKE_PR_JSON；pr list → FAKE_PR_LIST；
 * issue list → FAKE_ISSUE_LIST；api：POST（建锁标签）退出码 FAKE_LOCK_POST_EXIT，DELETE 成功，
 * 读 labels/devloop-lock → {description: FAKE_LOCK_DESC}（未设则 404），其余 → FAKE_API。issue comment 退出码 FAKE_COMMENT_EXIT。
 */
function fakeGh(dir) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const script = [
    '#!/usr/bin/env bash',
    `echo "$*" >> "${join(dir, 'gh.log')}"`,
    'q=""; prev=""; for a in "$@"; do if [ "$prev" = "-q" ] || [ "$prev" = "--jq" ]; then q="$a"; fi; prev="$a"; done',
    'emit() { if [ -n "$q" ]; then printf "%s" "$1" | jq -r "$q"; else printf "%s" "$1"; fi; }',
    'case "$1 $2" in',
    '  "issue view") emit "$FAKE_ISSUE_JSON" ;;',
    '  "pr view") emit "$FAKE_PR_JSON" ;;',
    '  "pr list") emit "${FAKE_PR_LIST:-[]}" ;;',
    '  "issue list") emit "${FAKE_ISSUE_LIST:-[]}" ;;',
    '  "issue comment") exit "${FAKE_COMMENT_EXIT:-0}" ;;',
    '  api\\ *)',
    '    if printf "%s\\n" "$@" | grep -qx POST; then exit "${FAKE_LOCK_POST_EXIT:-0}"; fi',
    '    if printf "%s\\n" "$@" | grep -qx DELETE; then exit 0; fi',
    '    case "$2" in */labels/devloop-lock) [ -n "${FAKE_LOCK_DESC:-}" ] || exit 1; emit "{\\"description\\":\\"$FAKE_LOCK_DESC\\"}" ;; *) emit "$FAKE_API" ;; esac ;;',
    'esac',
    'exit "${FAKE_GH_EXIT:-0}"',
    '',
  ].join('\n');
  writeFileSync(join(bin, 'gh'), script);
  chmodSync(join(bin, 'gh'), 0o755);
  return { path: `${bin}:${process.env.PATH}`, log: () => { try { return readFileSync(join(dir, 'gh.log'), 'utf8'); } catch { return ''; } } };
}

function runScript(name, env) {
  const dir = join(root, `${name}-${n++}`);
  mkdirSync(dir);
  const gh = fakeGh(dir);
  const out = join(dir, 'out');
  writeFileSync(out, '');
  const r = spawnSync('bash', [join(HERE, name)], { env: { ...process.env, PATH: gh.path, GITHUB_OUTPUT: out, RUNNER_TEMP: dir, REPO: 'o/r', ...env }, encoding: 'utf8' });
  const kv = Object.fromEntries(readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  return { code: r.status, kv, stderr: r.stderr, log: gh.log() };
}
const issueJson = (o = {}) => JSON.stringify({ state: 'OPEN', url: 'https://github.com/o/r/issues/12', labels: [{ name: 'proposal' }, { name: 'devloop' }], body: BODY, comments: [], ...o });
const mainRef = JSON.stringify({ object: { sha: SHA } });
const runCtx = (env) => runScript('ctx.sh', { FAKE_API: mainRef, FAKE_ISSUE_JSON: issueJson(), ...env });

// ---------- ctx.sh ----------
test('ctx：issue 事件与手动触发 → 分支 feature/N-claude-devloop，base 为 main 的完整 SHA', () => {
  for (const EVENT of ['issues', 'workflow_dispatch']) {
    const r = runCtx({ EVENT, N: '12' });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.kv, { branch: 'feature/12-claude-devloop', number: '12', base: SHA });
  }
  assert.notEqual(runCtx({ EVENT: 'issues', N: '12', FAKE_API: JSON.stringify({ object: { sha: 'abc' } }) }).code, 0, '取不到完整 SHA 时拒绝');
});

test('ctx：devloop 只做实现——评论事件、PR 编号都拒绝', () => {
  assert.notEqual(runCtx({ EVENT: 'issue_comment', N: '12' }).code, 0);
  assert.notEqual(runCtx({ EVENT: 'pull_request', N: '12' }).code, 0);
  const pr = runCtx({ EVENT: 'workflow_dispatch', N: '12', FAKE_ISSUE_JSON: issueJson({ url: 'https://github.com/o/r/pull/12' }) });
  assert.notEqual(pr.code, 0);
  assert.match(pr.stderr, /不修复 PR/);
});

test('ctx：编号必须是纯数字（防注入）', () => {
  for (const N of ['', '4; rm -rf /', '4a', '-1', '$(id)']) assert.notEqual(runCtx({ EVENT: 'workflow_dispatch', N }).code, 0, N);
});

test('ctx：issue 筛选（执行真实 jq）：关闭 / 无 devloop / hold 拒绝；needs-user 只在手动触发时放行（显式重试）', () => {
  const run = (EVENT, json) => runCtx({ EVENT, N: '12', FAKE_ISSUE_JSON: json });
  assert.equal(run('issues', issueJson({ labels: [{ name: 'devloop' }] })).code, 0); // devloop 在第 0 位也认
  const needsUser = issueJson({ labels: [{ name: 'devloop' }, { name: 'needs-user' }] });
  assert.equal(run('workflow_dispatch', needsUser).code, 0, '手动重跑应放行 needs-user');
  assert.notEqual(run('issues', needsUser).code, 0, '标签事件不放行 needs-user');
  const bad = {
    关闭: issueJson({ state: 'CLOSED' }),
    无devloop: issueJson({ labels: [{ name: 'proposal' }] }),
    hold: issueJson({ labels: [{ name: 'devloop' }, { name: 'hold' }] }),
  };
  for (const EVENT of ['issues', 'workflow_dispatch']) for (const [k, json] of Object.entries(bad)) assert.notEqual(run(EVENT, json).code, 0, `${EVENT} ${k}`);
});

// ---------- claim.sh ----------
const runClaim = (env) =>
  runScript('claim.sh', { N: '12', BASE: SHA, RUN_ID: '777', RUN_URL: 'https://run', FAKE_ISSUE_JSON: issueJson(), FAKE_API: '[]', ...env });
const otherClaim = { author: { login: 'daniel-to-the-moon' }, url: 'https://c/1', body: '执行者：Muse｜claim #12\n- 实际执行者 …' };
const actionsClaim = (spec = sha256(BODY)) => ({ author: { login: 'github-actions' }, url: 'u', body: `执行者：Claude（devloop 云端）｜claim #3\n<!-- devloop-claim run=1 base=x spec=${spec} -->` });
const stopWhy = (r) => readFileSync(r.log.match(/--body-file (\S+claim-stop\.md)/)[1], 'utf8');

test('claim：无冲突 → 取得全局锁、打 devloop-running、发含 run / 完整 base / spec 哈希 / 冻结范围的 claim，go=true', () => {
  const r = runClaim({});
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.kv.go, 'true');
  assert.equal(r.kv.spec, sha256(BODY));
  assert.equal(Buffer.from(r.kv.scope_b64, 'base64').toString(), 'b\nc\nlib/*\ndocs/*\n');
  assert.match(r.log, /^api -X POST repos\/o\/r\/labels -f name=devloop-lock -f color=\w+ -f description=issue #12 run 777$/m);
  assert.doesNotMatch(r.log, /DELETE/, '成功认领后锁要保持到发布结束');
  assert.match(r.log, /^issue edit 12 -R o\/r --add-label devloop-running$/m);
  assert.doesNotMatch(r.log, /--add-label needs-user/);
  const body = readFileSync(r.log.match(/--body-file (\S+claim\.md)/)[1], 'utf8');
  assert.match(body, new RegExp(`<!-- devloop-claim run=777 base=${SHA} spec=${sha256(BODY)} -->`));
  assert.match(body, /^执行者：Claude（devloop 云端）｜claim #12$/m);
  assert.match(body, /文件锁（冻结范围.*不默认放行任何路径）：`b`、`c`、`lib\/\*`、`docs\/\*`/);
  assert.doesNotMatch(body, /开工前未知|tests\/、\*\.test/);
});

test('claim：不能开工 → 留说明、needs-user、go=false；拿到锁后停下要释放', () => {
  const cases = {
    他人claim: [{ FAKE_ISSUE_JSON: issueJson({ comments: [otherClaim] }) }, /其他执行者的 claim/],
    他人中文认领: [{ FAKE_ISSUE_JSON: issueJson({ comments: [{ ...otherClaim, body: '执行者：Grok｜认领本项' }] }) }, /其他执行者的 claim/],
    他人claim引用devloop标记: [{ FAKE_ISSUE_JSON: issueJson({ comments: [{ ...otherClaim, body: '执行者：Muse｜claim #12\n引用旧的 <!-- devloop-claim run=1 base=x spec=y -->' }] }) }, /其他执行者的 claim/],
    冒用devloop首行但不是Actions发的: [{ FAKE_ISSUE_JSON: issueJson({ comments: [{ author: { login: 'daniel-to-the-moon' }, url: 'u', body: '执行者：Claude（devloop 云端）｜claim #12\n<!-- devloop-claim run=1 base=x spec=y -->' }] }) }, /其他执行者的 claim/],
    开放PR: [{ FAKE_PR_LIST: JSON.stringify([{ number: 31, headRefName: 'feature/12-foo' }]) }, /已有开放 PR/],
    已有分支: [{ FAKE_API: JSON.stringify([{ ref: 'refs/heads/feature/12-claude-devloop' }]) }, /远端已有分支/],
    暂停: [{ FAKE_ISSUE_JSON: issueJson({ labels: [{ name: 'devloop' }, { name: 'hold' }] }) }, /hold/],
    撤回授权: [{ FAKE_ISSUE_JSON: issueJson({ labels: [] }) }, /没有 devloop 标签/],
    没写范围: [{ FAKE_ISSUE_JSON: issueJson({ body: '只有需求，没写范围' }) }, /没有声明冻结文件范围/],
    其他devloopPR: [{ FAKE_PR_LIST: JSON.stringify([{ number: 50, headRefName: 'feature/7-claude-devloop' }]) }, /§10/],
    其他blocked: [{ FAKE_ISSUE_LIST: JSON.stringify([{ number: 7, comments: [actionsClaim()] }]) }, /§10 blocked/],
  };
  for (const [k, [env, re]] of Object.entries(cases)) {
    const r = runClaim({ FAKE_LOCK_DESC: 'issue #12 run 777', ...env });
    assert.equal(r.code, 0, `${k} ${r.stderr}`);
    assert.equal(r.kv.go, 'false', k);
    assert.match(r.log, /^issue edit 12 -R o\/r --add-label needs-user$/m, k);
    assert.doesNotMatch(r.log, /--add-label devloop-running/, k);
    assert.match(stopWhy(r), re, k);
    assert.match(stopWhy(r), /-f issue=12/, k);
    assert.match(r.log, /^api -X DELETE repos\/o\/r\/labels\/devloop-lock$/m, `${k}：拿到锁后停下要释放`);
  }
});

test('claim：不误判——devloop 自己的旧 claim、普通评论、别的 issue 的分支 / PR、从未开工的 needs-user、自己的 blocked 都不算', () => {
  const r = runClaim({
    FAKE_ISSUE_JSON: issueJson({ comments: [
      { author: { login: 'github-actions' }, url: 'u', body: '执行者：Claude（devloop 云端）｜claim #12\n<!-- devloop-claim run=1 base=x spec=y -->' },
      { author: { login: 'o' }, url: 'u', body: '执行者：GPT（dot）；角色：评审\n提到 claim 但首行没有' },
      { author: { login: 'o' }, url: 'u', body: '看起来不错，claim 吧' },
    ] }),
    FAKE_PR_LIST: JSON.stringify([{ number: 2, headRefName: 'feature/120-x' }, { number: 3, headRefName: 'feature/1-x' }]),
    FAKE_API: JSON.stringify([{ ref: 'refs/heads/feature/12-claude-devloop-old' }]),
    FAKE_ISSUE_LIST: JSON.stringify([{ number: 7, comments: [] }, { number: 12, comments: [actionsClaim()] }]),
  });
  assert.equal(r.kv.go, 'true', r.stderr);
});

test('claim：互斥靠原子创建锁标签（不是先读后写）；拿不到锁时说明持有者且不删别人的锁', () => {
  const r = runClaim({ FAKE_LOCK_POST_EXIT: '1', FAKE_LOCK_DESC: 'issue #7 run 9' });
  assert.equal(r.kv.go, 'false');
  assert.match(stopWhy(r), /issue #7 run 9/);
  assert.doesNotMatch(r.log, /DELETE/);
});

test('claim：取得锁之后发 claim 失败 → 非零退出并释放自己的锁（不泄漏）', () => {
  const r = runClaim({ FAKE_COMMENT_EXIT: '1', FAKE_LOCK_DESC: 'issue #12 run 777' });
  assert.notEqual(r.code, 0);
  assert.match(r.log, /^api -X DELETE repos\/o\/r\/labels\/devloop-lock$/m);
  assert.notEqual(r.kv.go, 'true');
});

test('claim：外部认领冲突与允许改动用同一份清单——他人 PR 改了清单里的文件（含清单里的测试）/ 他人 claim 提到清单路径 → 不开工', () => {
  const scoped = issueJson({ body: '需求\n```devloop-scope\nlib/*\ntests/foo.test.ts\n```' });
  const cases = [
    [{ FAKE_PR_LIST: JSON.stringify([{ number: 61, headRefName: 'feature/61-muse-x', files: [{ path: 'lib/foo.ts' }] }]) }, /开放 PR #61 改动了范围内的 lib\/foo\.ts/],
    [{ FAKE_PR_LIST: JSON.stringify([{ number: 62, headRefName: 'feature/62-muse-x', files: [{ path: 'tests/foo.test.ts' }] }]) }, /开放 PR #62 改动了范围内的 tests\/foo\.test\.ts/],
    [{ FAKE_ISSUE_LIST: JSON.stringify([{ number: 70, comments: [{ ...otherClaim, url: 'https://c/70', body: '执行者：Grok｜claim #70\n- 文件锁：tests/foo.test.ts' }] }]) }, /issue #70 上他人的 claim 提到了本任务范围的路径/],
  ];
  for (const [env, re] of cases) {
    const r = runClaim({ FAKE_LOCK_DESC: 'issue #12 run 777', FAKE_ISSUE_JSON: scoped, ...env });
    assert.equal(r.kv.go, 'false', String(re));
    assert.match(stopWhy(r), re);
  }
  // 清单之外的文件（包括没列进清单的测试）既不允许改，也不算冲突；devloop 自己的 PR 不算；不提路径的他人 claim 不算
  const ok = runClaim({
    FAKE_ISSUE_JSON: scoped,
    FAKE_PR_LIST: JSON.stringify([{ number: 63, headRefName: 'feature/63-muse-x', files: [{ path: 'components/z.ts' }, { path: 'tests/other.test.ts' }] }]),
    FAKE_ISSUE_LIST: JSON.stringify([{ number: 71, comments: [{ ...otherClaim, body: '执行者：Grok｜claim #71\n- 文件锁：components/z.ts' }] }]),
  });
  assert.equal(ok.kv.go, 'true', ok.stderr);
});

// ---------- publish.sh ----------
const claimBody = (run = '42', spec = sha256(BODY)) => `执行者：Claude（devloop 云端）｜claim #4\n<!-- devloop-claim run=${run} base=x spec=${spec} -->`;
const implIssue = (o = {}) => issueJson({ comments: [{ author: { login: 'github-actions' }, url: 'u', body: claimBody() }], ...o });
const BRANCH = 'feature/4-claude-devloop';

/** publish 环境：本地临时远端（main 一个提交），work 产物里一个（或给定的）新提交的 bundle */
function publishSetup({ outcome = 'pr', branch = BRANCH, withBundle = true, files = { b: '2' }, message = 'work\n\nExecutor: Claude（devloop 云端）\nIssue: #4' } = {}) {
  const dir = join(root, `pub-${n++}`);
  mkdirSync(dir);
  const remote = join(dir, 'remote.git');
  const g = (args, cwd) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  const wc = join(dir, 'wc');
  execFileSync('git', ['clone', '-q', remote, wc]);
  writeFileSync(join(wc, 'a'), '1');
  g(['add', 'a'], wc);
  g(['commit', '-q', '-m', 'base'], wc);
  g(['push', '-q', 'origin', `HEAD:refs/heads/main`], wc);
  const start = g(['rev-parse', 'HEAD'], wc);
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(wc, p, '..'), { recursive: true });
    if (c === '@link') execFileSync('ln', ['-s', 'a', join(wc, p)]);
    else writeFileSync(join(wc, p), c);
  }
  g(['add', '-A'], wc);
  g(['commit', '-q', '-m', message], wc);
  const out = join(dir, 'out');
  mkdirSync(out);
  if (outcome !== null) writeFileSync(join(out, 'outcome'), `${outcome}\n`);
  writeFileSync(join(out, 'body.md'), '执行者：Claude（devloop）\n\n说明');
  writeFileSync(join(out, 'title.txt'), '标题');
  if (withBundle) g(['bundle', 'create', join(out, 'work.bundle'), `${start}..HEAD`, 'HEAD'], wc);
  const newSha = g(['rev-parse', 'HEAD'], wc);
  const gh = fakeGh(dir);
  const run = (env = {}) =>
    spawnSync('bash', [join(HERE, 'publish.sh')], {
      env: {
        ...process.env, PATH: gh.path, OUT: out, REPO: 'o/r', N: '4', START: start, BRANCH: branch, PUSH_URL: remote, RUN_URL: 'https://run',
        RUN_ID: '42', ENABLED: 'true', SPEC: sha256(BODY), EVENT: 'issues', FAKE_ISSUE_JSON: implIssue(), ...env,
      },
      encoding: 'utf8',
    });
  const rebundle = () => { g(['bundle', 'create', join(out, 'work.bundle'), `${start}..HEAD`, 'HEAD'], wc); return g(['rev-parse', 'HEAD'], wc); };
  return { run, gh, remote, start, newSha, wc, g, rebundle, ref: (r) => { try { return execFileSync('git', ['rev-parse', '-q', '--verify', r], { cwd: remote, encoding: 'utf8' }).trim(); } catch { return ''; } } };
}
/** 在远端 ref 上追加一个提交（模拟 work 运行期间别人推送） */
function advance(remote, ref, file, content) {
  const other = join(root, `adv-${n++}`);
  execFileSync('git', ['clone', '-q', '-b', ref, remote, other]);
  mkdirSync(join(other, file, '..'), { recursive: true });
  writeFileSync(join(other, file), content);
  execFileSync('git', ['-C', other, 'add', '-A']);
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'other'], { cwd: other });
  execFileSync('git', ['push', '-q', 'origin', ref], { cwd: other });
}
const stopped = (t, r, re) => {
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /published=stopped/);
  assert.match(t.gh.log(), /^issue edit 4 -R o\/r --add-label needs-user$/m);
  assert.doesNotMatch(t.gh.log(), /^pr create/m);
  if (re) assert.match(readFileSync(t.gh.log().match(/--body-file (\S+stop\.md)/)[1], 'utf8'), re);
  assert.equal(t.ref(`refs/heads/${BRANCH}`), '', '不应推送');
};
const TRAILER = '\n\nExecutor: Claude（devloop 云端）\nIssue: #4';

test('publish：核对通过 → 推送、开 Draft PR、释放 devloop-running 与自己的锁；手动重跑成功后去掉 needs-user', () => {
  const t = publishSetup();
  const r = t.run({ FAKE_LOCK_DESC: 'issue #4 run 42' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(t.ref(`refs/heads/${BRANCH}`), t.newSha);
  assert.match(t.gh.log(), /^pr create -R o\/r --draft --base main --head feature\/4-claude-devloop --title 标题/m);
  assert.match(t.gh.log(), /^issue edit 4 -R o\/r --remove-label devloop-running$/m);
  assert.match(t.gh.log(), /^api -X DELETE repos\/o\/r\/labels\/devloop-lock$/m);
  assert.doesNotMatch(t.gh.log(), /needs-user/);
  assert.doesNotMatch(t.gh.log(), /^pr comment|^pr edit/m, '不评论、不改已有 PR');
  const d = publishSetup();
  assert.equal(d.run({ EVENT: 'workflow_dispatch' }).status, 0);
  assert.match(d.gh.log(), /^issue edit 4 -R o\/r --remove-label needs-user$/m);
  assert.doesNotMatch(d.gh.log(), /hold/);
});

test('publish：只释放自己持有的锁（核对不通过时也释放）', () => {
  const s = publishSetup({ outcome: 'needs-user', withBundle: false });
  s.run({ FAKE_LOCK_DESC: 'issue #4 run 42' });
  assert.match(s.gh.log(), /^api -X DELETE repos\/o\/r\/labels\/devloop-lock$/m);
  const p = publishSetup();
  p.run({ PAUSED: 'true', FAKE_LOCK_DESC: 'issue #4 run 42' });
  assert.match(p.gh.log(), /^api -X DELETE repos\/o\/r\/labels\/devloop-lock$/m);
  for (const desc of ['issue #5 run 42', 'issue #4 run 41']) {
    const other = publishSetup();
    other.run({ FAKE_LOCK_DESC: desc });
    assert.doesNotMatch(other.gh.log(), /DELETE/, desc);
  }
});

test('publish：运行期间 main 前进或分支出现 → 不 rebase、不推送（受测树就是推送树）', () => {
  const t = publishSetup();
  advance(t.remote, 'main', 'x', 'y');
  stopped(t, t.run(), /main 已从/);
  const b = publishSetup();
  execFileSync('git', ['push', '-q', b.remote, `${b.start}:refs/heads/${BRANCH}`], { cwd: b.wc });
  const r = b.run();
  assert.match(r.stdout, /published=stopped/);
  assert.equal(b.ref(`refs/heads/${BRANCH}`), b.start, '不覆盖已有分支');
});

test('publish：开关、实时标签、认领与冻结 spec 任一不符 → 不推送', () => {
  const cases = [
    [{ ENABLED: '' }, /DEVLOOP_ENABLED/],
    [{ PAUSED: 'true' }, /暂停/],
    [{ FAKE_ISSUE_JSON: implIssue({ labels: [{ name: 'devloop' }, { name: 'hold' }] }) }, /hold/],
    [{ FAKE_ISSUE_JSON: implIssue({ labels: [] }) }, /devloop 标签/],
    [{ FAKE_ISSUE_JSON: implIssue({ state: 'CLOSED' }) }, /关闭/],
    [{ FAKE_ISSUE_JSON: implIssue({ comments: [{ author: { login: 'github-actions' }, url: 'u', body: claimBody('41') }] }) }, /找不到本次运行/],
    [{ FAKE_ISSUE_JSON: implIssue({ comments: [{ author: { login: 'daniel-to-the-moon' }, url: 'u', body: claimBody() }] }) }, /找不到本次运行/],
    [{ FAKE_ISSUE_JSON: implIssue({ comments: [{ author: { login: 'github-actions' }, url: 'u', body: claimBody() }, otherClaim] }) }, /其他执行者的 claim/],
    [{ FAKE_ISSUE_JSON: implIssue({ body: BODY + '（改过）' }) }, /冻结 spec/],
    [{ FAKE_PR_LIST: JSON.stringify([{ number: 61, headRefName: 'feature/61-muse-x', files: [{ path: 'b' }] }]) }, /外部认领冲突/],
  ];
  for (const [env, re] of cases) {
    const t = publishSetup();
    stopped(t, t.run(env), re);
  }
  // github-actions[bot] 这种写法也认
  const t = publishSetup();
  const ok = t.run({ FAKE_ISSUE_JSON: implIssue({ comments: [{ author: { login: 'github-actions[bot]' }, url: 'u', body: claimBody() }] }) });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(t.ref(`refs/heads/${BRANCH}`), t.newSha);
});

test('publish：禁止路径、符号链接、缺 Executor trailer → 不推送（机器强制，不靠提示词）', () => {
  const forbidden = [
    'public/model/mxgarage-rv.glb', 'public/model/motion_metadata.json', 'x/y.glb', 'dist/index.js', '.github/workflows/claude.yml',
    '.openai/hosting.json', '.env', '.env.local', '.dev.vars', 'sub/.dev.vars.x', 'package.json', 'package-lock.json', 'sub/package.json',
    'constitution.md', 'AGENTS.md', 'CLAUDE.md', '.claude/settings.json', 'scripts/devloop/publish.sh', 'wrangler.jsonc',
  ];
  for (const f of forbidden) {
    const t = publishSetup({ files: { [f]: 'x' } });
    stopped(t, t.run(), /禁止路径/);
  }
  // 非 ASCII、空格、换行等路径：必须按 NUL 分隔的原始路径匹配（默认输出会加引号转义导致漏判）
  for (const f of ['.env.生产', 'sub dir/.dev.vars 带空格', '.env\nx', 'public/model/模型.glb', 'docs/"q".glb']) {
    const t = publishSetup({ files: { [f]: 'x' } });
    stopped(t, t.run(), /禁止路径/);
  }
  for (const f of ['lib/链接', 'lib/a b', 'lib/l']) {
    const t = publishSetup({ files: { [f]: '@link' } });
    stopped(t, t.run(), /符号链接/);
  }
  const noTrailer = publishSetup({ message: 'work\n\nIssue: #4' });
  stopped(noTrailer, noTrailer.run(), /trailer/);
  // 清单里的普通路径（含名字相近的）放行
  const ok = publishSetup({ files: { 'lib/package-utils.ts': 'x', 'docs/env.md': 'x', 'lib/agents.test.ts': 'x' } });
  assert.equal(ok.run().status, 0);
  assert.equal(ok.ref(`refs/heads/${BRANCH}`), ok.newSha);
});

test('publish：逐个提交检查——中间提交加入又删除 .env（净改动里看不到）也不推送；中间提交里的符号链接、缺 trailer 的中间提交同样拦下', () => {
  const t = publishSetup();
  writeFileSync(join(t.wc, '.env'), 'PLACEHOLDER=1');
  t.g(['add', '.env'], t.wc);
  t.g(['commit', '-q', '-m', `add${TRAILER}`], t.wc);
  t.g(['rm', '-q', '.env'], t.wc);
  t.g(['commit', '-q', '-m', `rm${TRAILER}`], t.wc);
  t.rebundle();
  stopped(t, t.run(), /禁止路径：\.env/);
  const l = publishSetup();
  execFileSync('ln', ['-s', 'a', join(l.wc, 'lib-link')]);
  mkdirSync(join(l.wc, 'lib'), { recursive: true });
  execFileSync('ln', ['-s', '../a', join(l.wc, 'lib', 'tmp-link')]);
  l.g(['add', '-A'], l.wc);
  l.g(['commit', '-q', '-m', `link${TRAILER}`], l.wc);
  l.g(['rm', '-q', 'lib/tmp-link', 'lib-link'], l.wc);
  l.g(['commit', '-q', '-m', `unlink${TRAILER}`], l.wc);
  l.rebundle();
  stopped(l, l.run(), /符号链接/);
  const m = publishSetup({ message: 'no trailer' });
  writeFileSync(join(m.wc, 'c'), '3');
  m.g(['add', 'c'], m.wc);
  m.g(['commit', '-q', '-m', `ok${TRAILER}`], m.wc); // 最后一个提交合规，中间那个不合规
  m.rebundle();
  stopped(m, m.run(), /trailer/);
});

test('publish：只能改冻结清单里的文件——清单外的文件、没列进清单的测试都不推送', () => {
  for (const f of ['components/x.ts', 'tests/x.test.ts', 'lib2/y.ts']) {
    const t = publishSetup({ files: { b: '2', [f]: 'x' } });
    stopped(t, t.run(), new RegExp(`超出冻结文件范围：${f.replace(/[./]/g, (c) => `\\${c}`)}`));
  }
  const listed = publishSetup({ files: { 'tests/foo.test.ts': 'x' } });
  assert.equal(listed.run({ FAKE_ISSUE_JSON: implIssue({ body: BODY.replace('docs/*', 'docs/*\ntests/foo.test.ts') }), SPEC: sha256(BODY.replace('docs/*', 'docs/*\ntests/foo.test.ts')) }).status, 0);
  assert.equal(listed.ref(`refs/heads/${BRANCH}`), listed.newSha, '列进清单的测试可以改');
});

test('publish：outcome 为 needs-user 或产物缺失 → 评论 + 加 needs-user，不推送，释放 devloop-running', () => {
  for (const outcome of ['needs-user', null]) {
    const t = publishSetup({ outcome, withBundle: false });
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(t.gh.log(), /^issue edit 4 -R o\/r --add-label needs-user$/m);
    assert.match(t.gh.log(), /^issue edit 4 -R o\/r --remove-label devloop-running$/m);
    assert.equal(t.ref(`refs/heads/${BRANCH}`), '');
  }
});

test('publish：拒绝推送到非 feature/*-claude-devloop 分支', () => {
  const bad = publishSetup({ branch: 'main' });
  assert.notEqual(bad.run().status, 0);
  assert.equal(bad.ref('refs/heads/main'), bad.start);
});

/**
 * 读取 claude.yml 里 publish 任务的真实 `if:` 条件，按 GitHub 表达式语义对给定的 work 结果求值。
 * 只支持当前用到的子集（`&&` 连接的 always()/success()/failure()/cancelled() 与 `needs.work.result ==/!= '值'`）；
 * 遇到不认识的写法直接抛错，让测试失败，而不是默默算错。
 */
function publishRuns(workResult) {
  const yml = readFileSync(join(HERE, '../../.github/workflows/claude.yml'), 'utf8');
  const job = yml.match(/^  publish:\n((?:(?: {4,}.*)?\n)*)/m);
  assert.ok(job, 'claude.yml 里找不到 publish 任务');
  const m = job[1].match(/^ {4}if: *(.+)$/m);
  assert.ok(m && !/^[>|]/.test(m[1]), 'publish 的 if 应为单行表达式');
  const expr = m[1].replace(/^\$\{\{\s*|\s*\}\}$/g, '').trim();
  if (/\|\||[()]/.test(expr.replace(/\w+\(\)/g, ''))) throw new Error(`不支持的表达式：${expr}`);
  // 依赖任务结果对状态函数的影响（单一依赖 work）
  const status = { 'always()': true, 'success()': workResult === 'success', 'failure()': workResult === 'failure', 'cancelled()': false };
  let hasStatusFn = false;
  const ok = expr.split('&&').map((s) => s.trim()).every((term) => {
    if (term in status) { hasStatusFn = true; return status[term]; }
    const c = term.match(/^needs\.work\.result *(==|!=) *'([a-z]+)'$/);
    if (!c) throw new Error(`不支持的条件项：${term}`);
    return c[1] === '==' ? workResult === c[2] : workResult !== c[2];
  });
  // 没写状态函数时 GitHub 隐含 success()
  return ok && (hasStatusFn || workResult === 'success');
}

test('claude.yml：work 成功或失败才运行 publish；被取消或跳过不运行（防误报失败、误加 needs-user）', () => {
  assert.equal(publishRuns('success'), true);
  assert.equal(publishRuns('failure'), true);
  assert.equal(publishRuns('cancelled'), false);
  assert.equal(publishRuns('skipped'), false);
});

test('claude.yml：只做实现——没有评论触发、没有 pr 输入、没有修复模式；手动触发只收必填的 issue 编号', () => {
  const yml = readFileSync(join(HERE, '../../.github/workflows/claude.yml'), 'utf8');
  const on = yml.slice(yml.indexOf('\non:'), yml.indexOf('\npermissions:'));
  assert.doesNotMatch(on, /issue_comment|pull_request/);
  assert.match(on, /workflow_dispatch:\n {4}inputs:\n {6}issue:\n {8}description: .*\n {8}required: true\n$/);
  assert.doesNotMatch(yml, /inputs\.pr\b|DEVLOOP_REVIEWER|REVIEW_URL|MODE:|mode ==|allowed_bots: \$/);
  assert.doesNotMatch(yml.replace(/^\s*#.*$/gm, ''), /fix 模式/);
});

/**
 * install-bun.sh 行为测试：假 npm（按 plan 逐次成功 / 失败，成功时在 PATH 里放一个假 bun）、假 sleep（只记录秒数）。
 * plan 例：'fail,ok'；'ok-broken' 表示 npm 成功但装出的 bun 不能运行。
 */
function runInstallBun(plan) {
  const dir = join(root, `bun-${n++}`);
  const bin = join(dir, 'bin');
  const npmBin = join(dir, 'npm-global');
  mkdirSync(bin, { recursive: true });
  mkdirSync(npmBin, { recursive: true });
  writeFileSync(join(dir, 'plan'), plan.split(',').join('\n') + '\n');
  writeFileSync(
    join(bin, 'npm'),
    `#!/usr/bin/env bash
echo "npm $*" >> "${dir}/log"
step=$(head -n 1 "${dir}/plan"); sed -i.bak 1d "${dir}/plan"
case "$step" in
  ok) printf '#!/usr/bin/env bash\\necho 1.4.4\\n' > "${npmBin}/bun"; chmod +x "${npmBin}/bun"; exit 0 ;;
  ok-broken) printf '#!/usr/bin/env bash\\nexit 3\\n' > "${npmBin}/bun"; chmod +x "${npmBin}/bun"; exit 0 ;;
  *) exit 1 ;;
esac
`,
  );
  writeFileSync(join(bin, 'sleep'), `#!/usr/bin/env bash\necho "sleep $1" >> "${dir}/log"\n`);
  chmodSync(join(bin, 'npm'), 0o755);
  chmodSync(join(bin, 'sleep'), 0o755);
  const out = join(dir, 'out');
  writeFileSync(out, '');
  const r = spawnSync('bash', [join(HERE, 'install-bun.sh')], {
    env: { ...process.env, PATH: `${bin}:${npmBin}:/usr/bin:/bin`, GITHUB_OUTPUT: out },
    encoding: 'utf8',
  });
  const log = existsSync(join(dir, 'log')) ? readFileSync(join(dir, 'log'), 'utf8').trim().split('\n') : [];
  return { code: r.status, out: readFileSync(out, 'utf8'), log, npmBin };
}

test('install-bun.sh：首次成功 → 不等待，输出可执行路径', () => {
  const r = runInstallBun('ok');
  assert.equal(r.code, 0);
  assert.deepEqual(r.log, ['npm install -g --no-audit --no-fund bun@1.4.4']);
  assert.equal(r.out, `path=${join(r.npmBin, 'bun')}\n`);
});

test('install-bun.sh：失败后重试成功 → 按 15、30 秒退避，成功即停', () => {
  const r = runInstallBun('fail,fail,ok');
  assert.equal(r.code, 0);
  assert.deepEqual(r.log.filter((l) => l.startsWith('sleep')), ['sleep 15', 'sleep 30']);
  assert.equal(r.log.filter((l) => l.startsWith('npm')).length, 3);
  assert.match(r.out, /^path=.*\/bun\n$/);
});

test('install-bun.sh：连续三次失败（或装出的 bun 不能运行）→ 非零退出、不输出路径（action 不会拿到空路径继续）', () => {
  for (const plan of ['fail,fail,fail', 'ok-broken,ok-broken,ok-broken']) {
    const r = runInstallBun(plan);
    assert.notEqual(r.code, 0, plan);
    assert.equal(r.out, '', plan);
    assert.equal(r.log.filter((l) => l.startsWith('npm')).length, 3, plan);
    assert.deepEqual(r.log.filter((l) => l.startsWith('sleep')), ['sleep 15', 'sleep 30'], plan); // 最后一次失败后不再等待
  }
});

test('claude.yml：action 之前运行 install-bun.sh，并把它输出的路径交给 path_to_bun_executable', () => {
  const yml = readFileSync(join(HERE, '../../.github/workflows/claude.yml'), 'utf8');
  const bunAt = yml.indexOf('id: bun');
  assert.ok(bunAt > 0 && bunAt < yml.indexOf('uses: anthropics/claude-code-action'));
  assert.match(yml, /id: bun\n(?: {8}#.*\n)* {8}run: bash "\$RUNNER_TEMP\/install-bun\.sh"/);
  // 工作区根目录的检出会清空根目录（含 _devloop）：脚本必须在 _devloop 检出之后、根目录检出之前复制到 RUNNER_TEMP
  const steps = yml.slice(yml.indexOf('  work:'), yml.indexOf('uses: anthropics/claude-code-action'));
  const devloopCheckout = steps.indexOf('path: _devloop');
  const copy = steps.indexOf('cp _devloop/scripts/devloop/install-bun.sh "$RUNNER_TEMP/install-bun.sh"');
  const rootCheckout = steps.indexOf('ref: ${{ needs.preflight.outputs.base }}');
  assert.ok(devloopCheckout > 0 && devloopCheckout < copy && copy < rootCheckout && rootCheckout < steps.indexOf('id: bun'), '顺序须为：检出 _devloop → 复制脚本 → 检出根目录 → 运行脚本');
  assert.doesNotMatch(steps.slice(rootCheckout), /_devloop\//, '根目录检出之后不能再引用 _devloop');
  assert.match(yml, /path_to_bun_executable: \$\{\{ steps\.bun\.outputs\.path \}\}/);
});

/**
 * 读取 claude.yml 里 preflight 任务（决定整条链是否运行）的真实 `if:`（多行 `>-`），用一个小型 GitHub 表达式求值器计算。
 * 支持：&& || ! 括号、== !=、'字符串'、属性路径（含 `.*.name` 过滤）、contains()、startsWith()。
 * 不认识的语法直接抛错，测试失败而不是默默算错。
 */
function triggers(ctx) {
  const yml = readFileSync(join(HERE, '../../.github/workflows/claude.yml'), 'utf8');
  const job = yml.match(/^  preflight:\n((?:(?: {4,}.*)?\n)*)/m);
  assert.ok(job, 'claude.yml 里找不到 preflight 任务');
  const m = job[1].match(/^ {4}if: >-\n((?: {6,}.*\n)+)/m);
  assert.ok(m, 'preflight 的 if 应为 >- 多行表达式');
  const src = m[1].split('\n').map((l) => l.trim()).join(' ');
  const tokens = src.match(/'[^']*'|&&|\|\||==|!=|!|\(|\)|,|[A-Za-z_][\w.*-]*/g);
  assert.equal(tokens.join('').replace(/\s/g, ''), src.replace(/\s/g, ''), '表达式里有不认识的字符');
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const lookup = (path) => {
    let cur = [ctx];
    for (const part of path.split('.')) {
      if (part === '*') { cur = cur.flatMap((v) => (Array.isArray(v) ? v : [])); continue; }
      cur = cur.map((v) => (v == null ? null : v[part]));
    }
    return path.includes('*') ? cur.filter((v) => v != null) : cur[0] ?? null;
  };
  const eq = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
  function primary() {
    const t = next();
    if (t === '(') { const v = or(); assert.equal(next(), ')'); return v; }
    if (t === '!') return !primary();
    if (t.startsWith("'")) return t.slice(1, -1);
    if (t === 'contains' || t === 'startsWith') {
      assert.equal(next(), '(');
      const a = or(); assert.equal(next(), ',');
      const b = or(); assert.equal(next(), ')');
      if (t === 'startsWith') return String(a ?? '').startsWith(String(b));
      return Array.isArray(a) ? a.some((x) => eq(x, b)) : String(a ?? '').includes(String(b));
    }
    if (/^[A-Za-z_]/.test(t)) return lookup(t);
    throw new Error(`不支持的记号：${t}`);
  }
  function cmp() {
    let v = primary();
    while (peek() === '==' || peek() === '!=') { const op = next(); const r = primary(); v = op === '==' ? eq(v, r) : !eq(v, r); }
    return v;
  }
  function and() { let v = cmp(); while (peek() === '&&') { next(); const r = cmp(); v = Boolean(v) && Boolean(r); } return v; }
  function or() { let v = and(); while (peek() === '||') { next(); const r = and(); v = Boolean(v) || Boolean(r); } return v; }
  const result = or();
  assert.equal(i, tokens.length, '表达式未完整解析');
  return Boolean(result);
}


const ON = { DEVLOOP_ENABLED: 'true' };
const labelled = (vars = ON, labels = []) => ({
  github: { event_name: 'issues', repository_owner: 'o', event: { label: { name: 'devloop' }, issue: { labels: labels.map((name) => ({ name })) } } },
  vars,
});
const dispatch = (vars = ON) => ({ github: { event_name: 'workflow_dispatch', event: {} }, vars });

test('claude.yml：默认停用——不设 DEVLOOP_ENABLED=true 时任何触发都不运行（合并本 PR 不会启用任何东西）', () => {
  for (const vars of [{}, { DEVLOOP_ENABLED: 'false' }, { DEVLOOP_ENABLED: 'yes' }]) {
    assert.equal(triggers(labelled(vars)), false);
    assert.equal(triggers(dispatch(vars)), false);
  }
});

test('claude.yml：启用后打 devloop 标签触发；DEVLOOP_PAUSED=true 时一切不跑；needs-user / hold 不跑', () => {
  assert.equal(triggers(labelled()), true);
  assert.equal(triggers(labelled({ ...ON, DEVLOOP_PAUSED: 'true' })), false);
  assert.equal(triggers(labelled(ON, ['needs-user'])), false);
  assert.equal(triggers(labelled(ON, ['hold'])), false);
  assert.equal(triggers(dispatch({ ...ON, DEVLOOP_PAUSED: 'true' })), false);
  assert.equal(triggers(dispatch()), true);
});

test('claude.yml：权限与依赖——第三方 action 全部固定完整 SHA；work 只读且无 id-token；只有 preflight 与 publish 能写，且都只运行 main 上的脚本', () => {
  const yml = readFileSync(join(HERE, '../../.github/workflows/claude.yml'), 'utf8');
  const uses = [...yml.matchAll(/^\s*- uses: (\S+)/gm)].map((m) => m[1]);
  assert.ok(uses.length >= 7);
  for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `未固定：${u}`);
  const job = (name) => yml.match(new RegExp(`^  ${name}:\\n((?:(?: {4,}.*)?\\n)*)`, 'm'))[1];
  const perms = (name) => job(name).match(/^ {4}permissions:\n((?: {6}.*\n)+)/m)[1].split('\n').filter((l) => /^ {6}\w/.test(l)).map((l) => l.trim());
  assert.deepEqual(perms('work').sort(), ['actions: read', 'contents: read', 'issues: read', 'pull-requests: read']);
  assert.doesNotMatch(job('work'), /^\s*id-token:/m);
  assert.deepEqual(perms('preflight').sort(), ['contents: read', 'issues: write', 'pull-requests: read']);
  for (const name of ['preflight', 'publish']) {
    const runs = [...job(name).matchAll(/run: (?:\|\n((?: {10,}.*\n)+)|(.*))/g)].map((m) => m[1] ?? m[2]).join('\n');
    assert.doesNotMatch(runs, /\bnpm\b|\bnode\b|npx|bun /, `${name} 不应执行仓库代码`);
    assert.match(job(name), /ref: main\n {10}path: _devloop\n {10}sparse-checkout: scripts\/devloop/);
  }
  // work 检出 preflight 记录的准确基线，publish 用同一基线核对
  assert.match(job('work'), /ref: \$\{\{ needs\.preflight\.outputs\.base \}\}/);
  assert.match(job('publish'), /START: \$\{\{ needs\.preflight\.outputs\.base \}\}/);
  assert.match(job('publish'), /ENABLED: \$\{\{ vars\.DEVLOOP_ENABLED \}\}/);
});

// ---------- pack.sh ----------
function packSetup() {
  const dir = join(root, `pack-${n++}`);
  const wc = join(dir, 'wc');
  mkdirSync(wc, { recursive: true });
  const g = (args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: wc, encoding: 'utf8' }).trim();
  g(['init', '-q', '-b', 'main']);
  writeFileSync(join(wc, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(wc, 'a'), '1');
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'base']);
  const start = g(['rev-parse', 'HEAD']);
  const out = join(dir, 'out'); // Claude 可写的目录（不可信输入）
  const up = join(dir, 'up'); // pack.sh 新建、只放核对过的文件；工作流只上传这里
  const SCOPE_ALL = Buffer.from('*\n').toString('base64');
  const run = (env) => spawnSync('bash', [join(HERE, 'pack.sh')], { cwd: wc, env: { ...process.env, OUT: out, UPLOAD: up, START: start, SCOPE_B64: SCOPE_ALL, RUN_ID: '55', RUN_URL: 'https://run', ...env }, encoding: 'utf8' });
  const read = (f) => (existsSync(join(up, f)) ? readFileSync(join(up, f), 'utf8') : null);
  /** 把 bundle 取回到新仓库，返回其中 HEAD 的文件列表 */
  const filesIn = (bundle, ref = bundle === 'recovery.bundle' ? 'devloop-recovery' : 'HEAD') => {
    const chk = join(dir, `chk-${n++}`);
    execFileSync('git', ['init', '-q', chk]);
    execFileSync('git', ['-C', chk, 'fetch', '-q', join(wc, '.git'), start]);
    execFileSync('git', ['-C', chk, 'fetch', '-q', join(up, bundle), ref]);
    return execFileSync('git', ['-C', chk, 'ls-tree', '-r', '--name-only', 'FETCH_HEAD'], { encoding: 'utf8' }).trim().split('\n');
  };
  return { wc, g, out, up, start, run, read, filesIn };
}

test('pack：Claude 步骤失败 → needs-user，不产出 work.bundle；已有提交与未提交改动保全进 recovery.bundle（忽略文件不带），说明里写取回方法', () => {
  for (const CLAUDE_OUTCOME of ['failure', 'cancelled', '']) {
    const t = packSetup();
    writeFileSync(join(t.wc, 'b'), '2');
    t.g(['add', 'b']);
    t.g(['commit', '-q', '-m', 'done part\n\nExecutor: Claude（devloop 云端）']);
    writeFileSync(join(t.wc, 'c'), 'wip');
    mkdirSync(join(t.wc, 'node_modules'));
    writeFileSync(join(t.wc, 'node_modules', 'x'), 'dep');
    writeFileSync(join(t.out + '-pre'), ''); // 无关
    mkdirSync(t.out, { recursive: true });
    writeFileSync(join(t.out, 'work.bundle'), 'stale'); // Claude 在 OUT 里放的不算
    mkdirSync(t.up, { recursive: true });
    writeFileSync(join(t.up, 'work.bundle'), 'planted'); // 预先放进上传目录的也会被清掉
    const r = t.run({ CLAUDE_OUTCOME });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(t.read('outcome').trim(), 'needs-user');
    assert.equal(t.read('work.bundle'), null);
    assert.deepEqual(t.filesIn('recovery.bundle').sort(), ['.gitignore', 'a', 'b', 'c']);
    assert.match(t.read('body.md'), /已保全成果[\s\S]*gh run download 55 -n devloop-55/);
  }
});

test('pack：成功且 outcome=pr → 只产出 work.bundle（不含未提交改动），无 recovery；outcome=needs-user 但有提交 → 保全', () => {
  const t = packSetup();
  writeFileSync(join(t.wc, 'b'), '2');
  t.g(['add', 'b']);
  t.g(['commit', '-q', '-m', 'feat\n\nExecutor: Claude（devloop 云端）']);
  writeFileSync(join(t.wc, 'stray'), 'x');
  mkdirSync(t.out, { recursive: true });
  writeFileSync(join(t.out, 'outcome'), 'pr\n');
  writeFileSync(join(t.out, 'body.md'), 'PR 正文');
  assert.equal(t.run({ CLAUDE_OUTCOME: 'success' }).status, 0);
  assert.equal(t.read('outcome').trim(), 'pr');
  assert.deepEqual(t.filesIn('work.bundle').sort(), ['.gitignore', 'a', 'b']);
  assert.equal(t.read('recovery.bundle'), null);
  assert.equal(t.read('body.md'), 'PR 正文');

  const u = packSetup();
  writeFileSync(join(u.wc, 'b'), '2');
  u.g(['add', 'b']);
  u.g(['commit', '-q', '-m', 'partial\n\nExecutor: Claude（devloop 云端）']);
  mkdirSync(u.out, { recursive: true });
  writeFileSync(join(u.out, 'outcome'), 'needs-user\n');
  writeFileSync(join(u.out, 'body.md'), '停下的原因');
  assert.equal(u.run({ CLAUDE_OUTCOME: 'success' }).status, 0);
  assert.equal(u.read('outcome').trim(), 'needs-user');
  assert.equal(u.read('work.bundle'), null);
  assert.deepEqual(u.filesIn('recovery.bundle').sort(), ['.gitignore', 'a', 'b']);
  assert.match(u.read('body.md'), /^停下的原因[\s\S]*已保全成果/);

  // 没有任何改动：不产出恢复快照
  const z = packSetup();
  assert.equal(z.run({ CLAUDE_OUTCOME: 'failure' }).status, 0);
  assert.equal(z.read('recovery.bundle'), null);
  assert.doesNotMatch(z.read('body.md'), /已保全/);
});

test('claude.yml：打包步骤运行 main 上复制出来的 pack.sh（不用 PR 分支里的版本）', () => {
  const yml = readFileSync(join(HERE, '../../.github/workflows/claude.yml'), 'utf8');
  const work = yml.slice(yml.indexOf('  work:'), yml.indexOf('  publish:'));
  const copy = work.indexOf('cp _devloop/scripts/devloop/pack.sh "$RUNNER_TEMP/pack.sh"');
  const rootCheckout = work.indexOf('ref: ${{ needs.preflight.outputs.base }}');
  assert.ok(copy > 0 && copy < rootCheckout);
  assert.match(work, /if: always\(\)\n(?: {8}.*\n)*? {8}run: bash "\$RUNNER_TEMP\/pack\.sh"/);
});

test('pack：上传边界——待推送提交越界（中间提交加入又删除 .env）→ 不产出 work.bundle；恢复快照只含批准范围的净工作树，禁止路径与符号链接不纳入', () => {
  const t = packSetup();
  writeFileSync(join(t.wc, '.env'), 'PLACEHOLDER=1');
  t.g(['add', '.env']);
  t.g(['commit', '-q', '-m', 'add\n\nExecutor: Claude（devloop 云端）']);
  t.g(['rm', '-q', '.env']);
  writeFileSync(join(t.wc, 'b'), '2');
  t.g(['add', 'b']);
  t.g(['commit', '-q', '-m', 'rm\n\nExecutor: Claude（devloop 云端）']);
  // 未提交：又一个禁止文件、一个符号链接、一个普通文件
  writeFileSync(join(t.wc, '.dev.vars'), 'PLACEHOLDER=2');
  execFileSync('ln', ['-s', 'a', join(t.wc, 'lnk')]);
  writeFileSync(join(t.wc, 'c'), 'wip');
  mkdirSync(t.out, { recursive: true });
  writeFileSync(join(t.out, 'outcome'), 'pr\n');
  writeFileSync(join(t.out, 'body.md'), 'PR 正文');
  assert.equal(t.run({ CLAUDE_OUTCOME: 'success' }).status, 0);
  assert.equal(t.read('outcome').trim(), 'needs-user');
  assert.equal(t.read('work.bundle'), null);
  assert.match(t.read('body.md'), /未打包、不发布：待推送提交越界——禁止路径：\.env/);
  assert.deepEqual(t.filesIn('recovery.bundle').sort(), ['.gitignore', 'a', 'b', 'c']);
  assert.match(t.read('body.md'), /未纳入恢复快照、不上传：.*\.dev\.vars/);
  assert.match(t.read('body.md'), /lnk/);
  // 快照是单个提交，不带中间历史（.env 不在 bundle 的任何对象里）
  const chk = join(root, `chk-${n++}`);
  execFileSync('git', ['init', '-q', chk]);
  execFileSync('git', ['-C', chk, 'fetch', '-q', join(t.wc, '.git'), t.start]);
  execFileSync('git', ['-C', chk, 'fetch', '-q', join(t.up, 'recovery.bundle'), 'devloop-recovery']);
  assert.equal(execFileSync('git', ['-C', chk, 'rev-list', '--count', `${t.start}..FETCH_HEAD`], { encoding: 'utf8' }).trim(), '1');
  assert.doesNotMatch(execFileSync('git', ['-C', chk, 'log', '--all', '--name-only', '--format='], { encoding: 'utf8' }), /\.env|\.dev\.vars/);
});

test('pack：密钥扫描——说明文字或提交内容出现本任务的密钥值 → 丢弃对应产物、只留状态；上传目录里任何文件都不含该值', () => {
  const SECRET = 'sk-ant-oat01-PLACEHOLDERVALUE';
  const scan = (t) => {
    for (const f of ['outcome', 'body.md', 'title.txt', 'work.bundle', 'recovery.bundle']) {
      const c = t.read(f);
      if (c !== null) assert.ok(!c.includes(SECRET), `${f} 含密钥值`);
    }
  };
  // 1) 说明文字里有
  const a = packSetup();
  writeFileSync(join(a.wc, 'b'), '2');
  a.g(['add', 'b']);
  a.g(['commit', '-q', '-m', 'feat\n\nExecutor: Claude（devloop 云端）']);
  mkdirSync(a.out, { recursive: true });
  writeFileSync(join(a.out, 'outcome'), 'pr\n');
  writeFileSync(join(a.out, 'body.md'), `调试：${SECRET}`);
  writeFileSync(join(a.out, 'title.txt'), '标题');
  assert.equal(a.run({ CLAUDE_OUTCOME: 'success', DEVLOOP_SCAN_1: SECRET }).status, 0);
  assert.equal(a.read('outcome').trim(), 'needs-user');
  assert.match(a.read('body.md'), /本任务的密钥值，已整份丢弃/);
  assert.equal(a.read('title.txt'), null);
  assert.equal(a.read('work.bundle'), null);
  scan(a);
  // 2) 提交内容里有：不打包，恢复快照也含该值 → 不上传快照
  const b = packSetup();
  writeFileSync(join(b.wc, 'cfg.ts'), `export const k = '${SECRET}';`);
  b.g(['add', 'cfg.ts']);
  b.g(['commit', '-q', '-m', 'feat\n\nExecutor: Claude（devloop 云端）']);
  mkdirSync(b.out, { recursive: true });
  writeFileSync(join(b.out, 'outcome'), 'pr\n');
  writeFileSync(join(b.out, 'body.md'), '正文');
  assert.equal(b.run({ CLAUDE_OUTCOME: 'success', DEVLOOP_SCAN_2: SECRET }).status, 0);
  assert.equal(b.read('outcome').trim(), 'needs-user');
  assert.equal(b.read('work.bundle'), null);
  assert.equal(b.read('recovery.bundle'), null);
  assert.match(b.read('body.md'), /含本任务的密钥值[\s\S]*保全失败/);
  scan(b);
  // 3) 太短的值不参与扫描（避免误判）；没有密钥值时正常打包
  const c = packSetup();
  writeFileSync(join(c.wc, 'b'), 'abc');
  c.g(['add', 'b']);
  c.g(['commit', '-q', '-m', 'feat\n\nExecutor: Claude（devloop 云端）']);
  mkdirSync(c.out, { recursive: true });
  writeFileSync(join(c.out, 'outcome'), 'pr\n');
  writeFileSync(join(c.out, 'body.md'), 'abc');
  assert.equal(c.run({ CLAUDE_OUTCOME: 'success', DEVLOOP_SCAN_3: 'abc' }).status, 0);
  assert.equal(c.read('outcome').trim(), 'pr');
});

test('claude.yml：上传只列明确文件；pack 步骤拿到扫描用的密钥值；lib.sh 也从 main 复制', () => {
  const yml = readFileSync(join(HERE, '../../.github/workflows/claude.yml'), 'utf8');
  const work = yml.slice(yml.indexOf('  work:'), yml.indexOf('  publish:'));
  const up = work.match(/uses: actions\/upload-artifact@\w+.*\n {8}if: (.*)\n(?: {8}.*\n)*? {10}path: \|\n((?: {12}.*\n)+)/);
  assert.ok(up, '上传 path 应为明确文件列表');
  assert.equal(up[1], "always() && steps.pack.outcome == 'success'", '只在 pack.sh 成功时上传');
  assert.deepEqual(up[2].trim().split('\n').map((l) => l.trim().replace('${{ runner.temp }}/devloop-upload/', '')), ['outcome', 'body.md', 'title.txt', 'work.bundle', 'recovery.bundle']);
  assert.match(work, /id: pack\n {8}if: always\(\)\n {8}env:\n {10}OUT: \$\{\{ runner\.temp \}\}\/devloop\n {10}UPLOAD: \$\{\{ runner\.temp \}\}\/devloop-upload/);
  for (const k of ['DEVLOOP_SCAN_1: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}', 'DEVLOOP_SCAN_2: ${{ secrets.ANTHROPIC_API_KEY }}', 'DEVLOOP_SCAN_3: ${{ github.token }}']) assert.ok(work.includes(k), k);
  assert.ok(work.indexOf('cp _devloop/scripts/devloop/lib.sh "$RUNNER_TEMP/lib.sh"') < work.indexOf('ref: ${{ needs.preflight.outputs.base }}'));
});

test('pack：密钥扫描不受 SIGPIPE 影响（大提交、密钥靠前）；合并提交解决冲突时写入的密钥、二进制文件里的密钥都能扫到', () => {
  const SECRET = 'ghs_PLACEHOLDERTOKENVALUE123';
  const prep = (t) => {
    mkdirSync(t.out, { recursive: true });
    writeFileSync(join(t.out, 'outcome'), 'pr\n');
    writeFileSync(join(t.out, 'body.md'), '正文');
  };
  const TR = '\n\nExecutor: Claude（devloop 云端）';
  // 1) 约 2 MB 文本，密钥在开头
  const a = packSetup();
  writeFileSync(join(a.wc, 'big.txt'), `${SECRET}\n${'x'.repeat(80)}\n`.repeat(25000));
  a.g(['add', 'big.txt']);
  a.g(['commit', '-q', '-m', `big${TR}`]);
  prep(a);
  assert.equal(a.run({ CLAUDE_OUTCOME: 'success', DEVLOOP_SCAN_3: SECRET }).status, 0);
  assert.equal(a.read('outcome').trim(), 'needs-user');
  assert.equal(a.read('work.bundle'), null);
  assert.equal(a.read('recovery.bundle'), null);
  // 2) 只在合并提交里引入（两个父提交都不含）
  const b = packSetup();
  b.g(['checkout', '-q', '-b', 'side']);
  writeFileSync(join(b.wc, 's'), 'side');
  b.g(['add', 's']);
  b.g(['commit', '-q', '-m', `side${TR}`]);
  b.g(['checkout', '-q', 'main']);
  writeFileSync(join(b.wc, 'm'), 'main');
  b.g(['add', 'm']);
  b.g(['commit', '-q', '-m', `main${TR}`]);
  b.g(['merge', '-q', '--no-ff', '--no-commit', 'side']);
  writeFileSync(join(b.wc, 'cfg.ts'), `export const k = '${SECRET}';`);
  b.g(['add', 'cfg.ts']);
  b.g(['commit', '-q', '-m', `merge${TR}`]);
  assert.doesNotMatch(execFileSync('git', ['log', '-p', '--format=%B', `${b.start}..HEAD`], { cwd: b.wc, encoding: 'utf8' }), new RegExp(SECRET), '前提：git log -p 看不到合并提交引入的内容');
  prep(b);
  assert.equal(b.run({ CLAUDE_OUTCOME: 'success', DEVLOOP_SCAN_1: SECRET }).status, 0);
  assert.equal(b.read('outcome').trim(), 'needs-user');
  assert.equal(b.read('work.bundle'), null);
  // 3) 二进制文件里
  const c = packSetup();
  writeFileSync(join(c.wc, 'blob.bin'), Buffer.concat([Buffer.from([0, 1, 2, 0, 255]), Buffer.from(SECRET), Buffer.from([0, 0])]));
  c.g(['add', 'blob.bin']);
  c.g(['commit', '-q', '-m', `bin${TR}`]);
  prep(c);
  assert.equal(c.run({ CLAUDE_OUTCOME: 'success', DEVLOOP_SCAN_2: SECRET }).status, 0);
  assert.equal(c.read('work.bundle'), null);
  for (const t of [a, b, c]) for (const f of ['outcome', 'body.md', 'title.txt', 'work.bundle', 'recovery.bundle']) {
    const v = t.read(f);
    if (v !== null) assert.ok(!v.includes(SECRET), `${f} 含密钥值`);
  }
});

test('pack：扫描本身出错（grep 退出码 2）按命中处理，不当作安全通过', () => {
  const t = packSetup();
  writeFileSync(join(t.wc, 'b'), '2');
  t.g(['add', 'b']);
  t.g(['commit', '-q', '-m', 'feat\n\nExecutor: Claude（devloop 云端）']);
  mkdirSync(t.out, { recursive: true });
  writeFileSync(join(t.out, 'outcome'), 'pr\n');
  writeFileSync(join(t.out, 'body.md'), '正文');
  const bin = join(t.out, '..', 'fakebin');
  mkdirSync(bin, { recursive: true });
  const realGrep = execFileSync('bash', ['-c', 'command -v grep'], { encoding: 'utf8' }).trim();
  writeFileSync(join(bin, 'grep'), `#!/usr/bin/env bash\ncase " $* " in *" -qaF "*) exit 2 ;; esac\nexec ${realGrep} "$@"\n`);
  chmodSync(join(bin, 'grep'), 0o755);
  assert.equal(t.run({ CLAUDE_OUTCOME: 'success', DEVLOOP_SCAN_1: 'PLACEHOLDER-SECRET', PATH: `${bin}:${process.env.PATH}` }).status, 0);
  assert.equal(t.read('outcome').trim(), 'needs-user');
  assert.equal(t.read('work.bundle'), null);
  // 对照：同样内容、扫描正常 → 打包
  const u = packSetup();
  writeFileSync(join(u.wc, 'b'), '2');
  u.g(['add', 'b']);
  u.g(['commit', '-q', '-m', 'feat\n\nExecutor: Claude（devloop 云端）']);
  mkdirSync(u.out, { recursive: true });
  writeFileSync(join(u.out, 'outcome'), 'pr\n');
  writeFileSync(join(u.out, 'body.md'), '正文');
  assert.equal(u.run({ CLAUDE_OUTCOME: 'success', DEVLOOP_SCAN_1: 'PLACEHOLDER-SECRET' }).status, 0);
  assert.equal(u.read('outcome').trim(), 'pr');
});

test('pack：恢复快照只纳入冻结清单（不默认放行测试）', () => {
  const t = packSetup();
  writeFileSync(join(t.wc, 'b'), '2');
  mkdirSync(join(t.wc, 'tests'));
  writeFileSync(join(t.wc, 'tests', 'x.test.ts'), 't');
  writeFileSync(join(t.wc, 'outside.ts'), 'o');
  assert.equal(t.run({ CLAUDE_OUTCOME: 'failure', SCOPE_B64: Buffer.from('b\n').toString('base64') }).status, 0);
  assert.deepEqual(t.filesIn('recovery.bundle').sort(), ['.gitignore', 'a', 'b']);
  assert.match(t.read('body.md'), /以下 2 个路径不在冻结范围内.*outside\.ts.*tests\/x\.test\.ts/);
});

test('pack：最终扫描在所有说明写完之后——被拦下的路径名里含密钥值时，正文换成不含路径的状态说明', () => {
  const SECRET = 'PLACEHOLDER0SECRET0VALUE';
  const t = packSetup();
  writeFileSync(join(t.wc, `.env.${SECRET}`), 'x');
  writeFileSync(join(t.wc, 'b'), '2');
  assert.equal(t.run({ CLAUDE_OUTCOME: 'failure', DEVLOOP_SCAN_1: SECRET }).status, 0);
  assert.ok(!t.read('body.md').includes(SECRET));
  assert.match(t.read('body.md'), /说明文字（含核对与保全说明）出现了本任务的密钥值/);
  // outcome=pr 但越界说明里带出密钥值：同样替换
  const u = packSetup();
  writeFileSync(join(u.wc, `.env.${SECRET}`), 'x');
  u.g(['add', '-A']);
  u.g(['commit', '-q', '-m', 'x\n\nExecutor: Claude（devloop 云端）']);
  mkdirSync(u.out, { recursive: true });
  writeFileSync(join(u.out, 'outcome'), 'pr\n');
  writeFileSync(join(u.out, 'body.md'), '正文');
  assert.equal(u.run({ CLAUDE_OUTCOME: 'success', DEVLOOP_SCAN_1: SECRET }).status, 0);
  for (const f of ['outcome', 'body.md', 'title.txt', 'work.bundle', 'recovery.bundle']) {
    const v = u.read(f);
    if (v !== null) assert.ok(!v.includes(SECRET), f);
  }
  assert.equal(u.read('outcome').trim(), 'needs-user');
});

test('pack：失败即停——核对过程出错（基线不存在）→ 非零退出（工作流不上传任何产物）', () => {
  const t = packSetup();
  writeFileSync(join(t.wc, 'b'), '2');
  t.g(['add', 'b']);
  t.g(['commit', '-q', '-m', 'x\n\nExecutor: Claude（devloop 云端）']);
  mkdirSync(t.out, { recursive: true });
  writeFileSync(join(t.out, 'outcome'), 'pr\n');
  writeFileSync(join(t.out, 'body.md'), '正文');
  const r = t.run({ CLAUDE_OUTCOME: 'success', START: 'b'.repeat(40) });
  assert.notEqual(r.status, 0);
  assert.equal(t.read('work.bundle'), null);
});

test('pack：待推送提交越出冻结范围 → 不产出 work.bundle（上传前就按范围核对）', () => {
  const t = packSetup();
  writeFileSync(join(t.wc, 'z.ts'), 'z');
  t.g(['add', 'z.ts']);
  t.g(['commit', '-q', '-m', 'x\n\nExecutor: Claude（devloop 云端）']);
  mkdirSync(t.out, { recursive: true });
  writeFileSync(join(t.out, 'outcome'), 'pr\n');
  writeFileSync(join(t.out, 'body.md'), '正文');
  assert.equal(t.run({ CLAUDE_OUTCOME: 'success', SCOPE_B64: Buffer.from('b\n').toString('base64') }).status, 0);
  assert.equal(t.read('outcome').trim(), 'needs-user');
  assert.equal(t.read('work.bundle'), null);
  assert.match(t.read('body.md'), /超出冻结文件范围：z\.ts/);
});
