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
const issueJson = (o = {}) => JSON.stringify({ state: 'OPEN', url: 'https://github.com/o/r/issues/12', labels: [{ name: 'proposal' }, { name: 'devloop' }], body: '需求', comments: [], ...o });
const prJson = (o = {}) => JSON.stringify({ headRefName: 'feature/3-m1-claude-devloop', headRefOid: SHA, isCrossRepository: false, state: 'OPEN', labels: [], ...o });
const mainRef = JSON.stringify({ object: { sha: SHA } });
const runCtx = (env) => runScript('ctx.sh', { FAKE_API: mainRef, FAKE_ISSUE_JSON: issueJson(), FAKE_PR_JSON: prJson(), ...env });

test('ctx：issue 事件 → implement，分支 feature/N-claude-devloop，base 为 main 的完整 SHA', () => {
  const r = runCtx({ EVENT: 'issues', N: '12' });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.kv, { mode: 'implement', branch: 'feature/12-claude-devloop', number: '12', base: SHA });
  assert.match(r.log, /^api repos\/o\/r\/git\/ref\/heads\/main/m);
  // 取不到完整 SHA 时拒绝
  assert.notEqual(runCtx({ EVENT: 'issues', N: '12', FAKE_API: JSON.stringify({ object: { sha: 'abc' } }) }).code, 0);
});

test('ctx：评论与手动触发 → fix，base 为 PR head；只接受本仓库、打开、feature/*-claude-devloop、不带 hold 的 PR', () => {
  for (const EVENT of ['issue_comment', 'workflow_dispatch']) {
    assert.deepEqual(runCtx({ EVENT, N: '4' }).kv, { mode: 'fix', branch: 'feature/3-m1-claude-devloop', number: '4', base: SHA });
    const bad = {
      main: prJson({ headRefName: 'main' }),
      他人分支: prJson({ headRefName: 'feature/110-slim-agents' }),
      旧前缀: prJson({ headRefName: 'claude/issue-4' }),
      跨仓库: prJson({ isCrossRepository: true }),
      已关闭: prJson({ state: 'CLOSED' }),
      hold: prJson({ labels: [{ name: 'hold' }] }),
    };
    for (const [k, FAKE_PR_JSON] of Object.entries(bad)) assert.notEqual(runCtx({ EVENT, N: '4', FAKE_PR_JSON }).code, 0, `${EVENT} ${k}`);
  }
  // needs-user 的 PR 可以手动重跑修复
  assert.equal(runCtx({ EVENT: 'workflow_dispatch', N: '4', FAKE_PR_JSON: prJson({ labels: [{ name: 'needs-user' }] }) }).code, 0);
});

test('ctx：编号必须是纯数字（防注入）', () => {
  for (const N of ['', '4; rm -rf /', '4a', '-1', '$(id)']) assert.notEqual(runCtx({ EVENT: 'workflow_dispatch', N }).code, 0, N);
});

test('ctx：实现 issue 的筛选（执行真实 jq）：关闭 / 无 devloop / hold / 是 PR 拒绝；needs-user 只在手动触发时放行（显式重试）', () => {
  const run = (EVENT, json, N = '12') => runCtx({ EVENT, KIND: EVENT === 'workflow_dispatch' ? 'issue' : '', N, FAKE_ISSUE_JSON: json });
  const ok = run('workflow_dispatch', issueJson());
  assert.equal(ok.code, 0, ok.stderr);
  assert.deepEqual(ok.kv, { mode: 'implement', branch: 'feature/12-claude-devloop', number: '12', base: SHA });
  assert.equal(run('issues', issueJson({ labels: [{ name: 'devloop' }] })).code, 0); // devloop 在第 0 位也认
  const needsUser = issueJson({ labels: [{ name: 'devloop' }, { name: 'needs-user' }] });
  assert.equal(run('workflow_dispatch', needsUser).code, 0, '手动重跑应放行 needs-user');
  assert.notEqual(run('issues', needsUser).code, 0, '标签事件不放行 needs-user');
  const bad = {
    关闭: issueJson({ state: 'CLOSED' }),
    无devloop: issueJson({ labels: [{ name: 'proposal' }] }),
    hold: issueJson({ labels: [{ name: 'devloop' }, { name: 'hold' }] }),
    是PR: issueJson({ url: 'https://github.com/o/r/pull/12' }),
  };
  for (const EVENT of ['issues', 'workflow_dispatch']) for (const [k, json] of Object.entries(bad)) assert.notEqual(run(EVENT, json).code, 0, `${EVENT} ${k}`);
  assert.notEqual(run('workflow_dispatch', issueJson(), '12; id').code, 0);
  // 不带 KIND 的手动触发仍是修复 PR
  assert.equal(runCtx({ EVENT: 'workflow_dispatch', N: '4' }).kv.mode, 'fix');
});

// ---------- claim.sh ----------
const runClaim = (env) =>
  runScript('claim.sh', { N: '12', BASE: SHA, RUN_ID: '777', RUN_URL: 'https://run', FAKE_ISSUE_JSON: issueJson(), FAKE_API: '[]', ...env });
const otherClaim = { author: { login: 'daniel-to-the-moon' }, url: 'https://c/1', body: '执行者：Muse｜claim #12\n- 实际执行者 …' };

test('claim：无冲突 → 取得全局锁、打 devloop-running、发含 run / 完整 base / spec 哈希的 claim，go=true', () => {
  const r = runClaim({});
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.kv.go, 'true');
  assert.match(r.log, /^api -X POST repos\/o\/r\/labels -f name=devloop-lock -f color=\w+ -f description=issue #12 run 777$/m);
  assert.doesNotMatch(r.log, /DELETE/, '成功认领后锁要保持到发布结束');
  assert.equal(r.kv.spec, sha256('需求'));
  assert.match(r.log, /^issue edit 12 -R o\/r --add-label devloop-running$/m);
  assert.match(r.log, /^issue comment 12 -R o\/r --body-file /m);
  assert.doesNotMatch(r.log, /needs-user/);
  const body = readFileSync(r.log.match(/--body-file (\S+)/)[1], 'utf8');
  assert.match(body, new RegExp(`<!-- devloop-claim run=777 base=${SHA} spec=${sha256('需求')} -->`));
  assert.match(body, /^执行者：Claude（devloop 云端）｜claim #12$/m);
});

test('claim：已有他人 claim / 本任务已有开放 PR / 远端已有分支 / 已有 devloop 实现在运行 → 不开工：留说明、needs-user、go=false', () => {
  const cases = {
    他人claim: { FAKE_ISSUE_JSON: issueJson({ comments: [otherClaim] }) },
    他人中文认领: { FAKE_ISSUE_JSON: issueJson({ comments: [{ ...otherClaim, body: '执行者：Grok｜认领本项' }] }) },
    开放PR: { FAKE_PR_LIST: JSON.stringify([{ number: 31, headRefName: 'feature/12-foo' }]) },
    已有分支: { FAKE_API: JSON.stringify([{ ref: 'refs/heads/feature/12-claude-devloop' }]) },
    锁被别的实现持有: { FAKE_LOCK_POST_EXIT: '1', FAKE_LOCK_DESC: 'issue #5 run 1' },
    同一issue上次运行未释放: { FAKE_LOCK_POST_EXIT: '1', FAKE_LOCK_DESC: 'issue #12 run 1' },
  };
  for (const [k, env] of Object.entries(cases)) {
    const r = runClaim(env);
    assert.equal(r.code, 0, `${k} ${r.stderr}`);
    assert.equal(r.kv.go, 'false', k);
    assert.match(r.log, /^issue edit 12 -R o\/r --add-label needs-user$/m, k);
    assert.doesNotMatch(r.log, /--add-label devloop-running/, k);
  }
});

test('claim：不误判——devloop 自己的旧 claim、普通评论、别的 issue 的分支 / PR 不算冲突', () => {
  const r = runClaim({
    FAKE_ISSUE_JSON: issueJson({ comments: [
      { author: { login: 'github-actions' }, url: 'u', body: '执行者：Claude（devloop 云端）｜claim #12\n<!-- devloop-claim run=1 base=x spec=y -->' },
      { author: { login: 'o' }, url: 'u', body: '执行者：GPT（dot）；角色：评审\n提到 claim 但首行没有' },
      { author: { login: 'o' }, url: 'u', body: '看起来不错，claim 吧' },
    ] }),
    FAKE_PR_LIST: JSON.stringify([{ number: 2, headRefName: 'feature/120-x' }, { number: 3, headRefName: 'feature/1-x' }]),
    FAKE_API: JSON.stringify([{ ref: 'refs/heads/feature/12-claude-devloop-old' }]),
  });
  assert.equal(r.kv.go, 'true', r.stderr);
});

test('claim：互斥靠原子创建锁标签（不是先读后写）；拿不到锁时说明持有者且不删别人的锁', () => {
  const r = runClaim({ FAKE_LOCK_POST_EXIT: '1', FAKE_LOCK_DESC: 'issue #7 run 9' });
  assert.equal(r.kv.go, 'false');
  assert.match(readFileSync(r.log.match(/--body-file (\S+claim-stop\.md)/)[1], 'utf8'), /issue #7 run 9/);
  assert.doesNotMatch(r.log, /DELETE/);
  assert.doesNotMatch(r.log, /^issue list/m, '不再依赖非原子的标签列表');
});

test('claim：取得锁之后发 claim 失败 → 非零退出并释放自己的锁（不泄漏）', () => {
  const r = runClaim({ FAKE_COMMENT_EXIT: '1', FAKE_LOCK_DESC: 'issue #12 run 777' });
  assert.notEqual(r.code, 0);
  assert.match(r.log, /^api -X DELETE repos\/o\/r\/labels\/devloop-lock$/m);
  assert.notEqual(r.kv.go, 'true');
});

// ---------- publish.sh ----------
const claimBody = (run = '42', spec = sha256('需求')) => `执行者：Claude（devloop 云端）｜claim #4\n<!-- devloop-claim run=${run} base=x spec=${spec} -->`;
const implIssue = (o = {}) => issueJson({ comments: [{ author: { login: 'github-actions' }, url: 'u', body: claimBody() }], ...o });

/** publish 环境：本地临时远端（main 一个提交 + 分支），work 产物里一个（或给定的）新提交的 bundle */
function publishSetup({ outcome = 'pr', branch = 'feature/9-x-claude-devloop', withBundle = true, files = { b: '2' }, message = 'work\n\nExecutor: Claude（devloop 云端）\nIssue: #4', createBranch = true } = {}) {
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
  if (createBranch) g(['push', '-q', 'origin', `HEAD:refs/heads/${branch}`], wc);
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
  const run = (env) =>
    spawnSync('bash', [join(HERE, 'publish.sh')], {
      env: {
        ...process.env, PATH: gh.path, OUT: out, REPO: 'o/r', N: '4', START: start, BRANCH: branch, PUSH_URL: remote, RUN_URL: 'https://run',
        RUN_ID: '42', ENABLED: 'true', SPEC: sha256('需求'), FAKE_ISSUE_JSON: implIssue(), FAKE_PR_JSON: prJson({ headRefName: branch }), ...env,
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
};

test('publish：fix 推送到分支并评论；评论触发不动标签', () => {
  const t = publishSetup();
  const r = t.run({ MODE: 'fix', EVENT: 'issue_comment' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(t.ref('refs/heads/feature/9-x-claude-devloop'), t.newSha);
  assert.match(t.gh.log(), /^pr comment 4/m);
  assert.doesNotMatch(t.gh.log(), /remove-label/);
});

test('publish：手动重跑成功后只移除 needs-user（不动 hold）', () => {
  const t = publishSetup();
  const r = t.run({ MODE: 'fix', EVENT: 'workflow_dispatch' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(t.gh.log(), /^pr edit 4 -R o\/r --remove-label needs-user$/m);
  assert.doesNotMatch(t.gh.log(), /hold/);
});

test('publish：implement 核对通过 → 推送、开 Draft PR、释放 devloop-running', () => {
  const t = publishSetup({ branch: 'feature/4-claude-devloop', createBranch: false });
  const r = t.run({ MODE: 'implement', EVENT: 'issues' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(t.ref('refs/heads/feature/4-claude-devloop'), t.newSha);
  assert.match(t.gh.log(), /^pr create -R o\/r --draft --base main --head feature\/4-claude-devloop --title 标题/m);
  assert.match(t.gh.log(), /^issue edit 4 -R o\/r --remove-label devloop-running$/m);
  assert.doesNotMatch(t.gh.log(), /needs-user/);
});

test('publish：implement 结束只释放自己持有的锁', () => {
  const mine = publishSetup({ branch: 'feature/4-claude-devloop', createBranch: false });
  assert.equal(mine.run({ MODE: 'implement', EVENT: 'issues', FAKE_LOCK_DESC: 'issue #4 run 42' }).status, 0);
  assert.match(mine.gh.log(), /^api -X DELETE repos\/o\/r\/labels\/devloop-lock$/m);
  const stoppedRun = publishSetup({ outcome: 'needs-user', withBundle: false, branch: 'feature/4-claude-devloop', createBranch: false });
  stoppedRun.run({ MODE: 'implement', EVENT: 'issues', FAKE_LOCK_DESC: 'issue #4 run 42' });
  assert.match(stoppedRun.gh.log(), /^api -X DELETE repos\/o\/r\/labels\/devloop-lock$/m);
  for (const desc of ['issue #5 run 42', 'issue #4 run 41']) {
    const other = publishSetup({ branch: 'feature/4-claude-devloop', createBranch: false });
    other.run({ MODE: 'implement', EVENT: 'issues', FAKE_LOCK_DESC: desc });
    assert.doesNotMatch(other.gh.log(), /DELETE/, desc);
  }
  const fix = publishSetup();
  fix.run({ MODE: 'fix', EVENT: 'issue_comment', FAKE_LOCK_DESC: 'issue #4 run 42' });
  assert.doesNotMatch(fix.gh.log(), /DELETE/, 'fix 模式不持有锁');
});

test('publish：implement 期间 main 前进 → 不 rebase、不推送（受测树就是推送树）', () => {
  const t = publishSetup({ branch: 'feature/7-claude-devloop', createBranch: false });
  advance(t.remote, 'main', '.github/workflows/x.yml', 'on: push');
  stopped(t, t.run({ MODE: 'implement', EVENT: 'issues' }), /main 已从/);
  assert.equal(t.ref('refs/heads/feature/7-claude-devloop'), '');
});

test('publish：fix 期间分支被别人更新 → 不覆盖', () => {
  const t = publishSetup();
  advance(t.remote, 'feature/9-x-claude-devloop', 'c', '3');
  const theirs = t.ref('refs/heads/feature/9-x-claude-devloop');
  stopped(t, t.run({ MODE: 'fix', EVENT: 'issue_comment' }), /被更新/);
  assert.equal(t.ref('refs/heads/feature/9-x-claude-devloop'), theirs);
});

test('publish：开关与实时标签——已停用 / 已暂停 / 加了 hold / devloop 被移除 / issue 关闭 / PR 关闭 → 不推送', () => {
  const impl = { MODE: 'implement', EVENT: 'issues', BRANCH: 'feature/4-claude-devloop' };
  const cases = [
    [{ MODE: 'fix', EVENT: 'issue_comment', ENABLED: '' }, /DEVLOOP_ENABLED/],
    [{ MODE: 'fix', EVENT: 'issue_comment', PAUSED: 'true' }, /暂停/],
    [{ MODE: 'fix', EVENT: 'workflow_dispatch', FAKE_PR_JSON: prJson({ headRefName: 'feature/9-x-claude-devloop', labels: [{ name: 'hold' }] }) }, /hold/],
    [{ MODE: 'fix', EVENT: 'issue_comment', FAKE_PR_JSON: prJson({ headRefName: 'feature/9-x-claude-devloop', state: 'CLOSED' }) }, /关闭/],
    [{ ...impl, FAKE_ISSUE_JSON: implIssue({ labels: [{ name: 'devloop' }, { name: 'hold' }] }) }, /hold/],
    [{ ...impl, FAKE_ISSUE_JSON: implIssue({ labels: [] }) }, /devloop 标签/],
    [{ ...impl, FAKE_ISSUE_JSON: implIssue({ state: 'CLOSED' }) }, /关闭/],
  ];
  for (const [env, re] of cases) {
    const t = publishSetup({ branch: env.BRANCH ?? 'feature/9-x-claude-devloop', createBranch: env.MODE === 'fix' });
    stopped(t, t.run(env), re);
    assert.equal(t.ref(`refs/heads/${env.BRANCH ?? 'feature/9-x-claude-devloop'}`), env.MODE === 'fix' ? t.start : '');
  }
});

test('publish：implement 的 claim 与冻结 spec——找不到本 run 的 claim / claim 不是 Actions 发的 / 出现他人 claim / 正文被改 → 不推送', () => {
  const cases = [
    [implIssue({ comments: [{ author: { login: 'github-actions' }, url: 'u', body: claimBody('41') }] }), /找不到本次运行/],
    [implIssue({ comments: [{ author: { login: 'daniel-to-the-moon' }, url: 'u', body: claimBody() }] }), /找不到本次运行/],
    [implIssue({ comments: [{ author: { login: 'github-actions' }, url: 'u', body: claimBody() }, otherClaim] }), /其他执行者的 claim/],
    [implIssue({ body: '需求（改过）' }), /冻结 spec/],
  ];
  for (const [FAKE_ISSUE_JSON, re] of cases) {
    const t = publishSetup({ branch: 'feature/4-claude-devloop', createBranch: false });
    stopped(t, t.run({ MODE: 'implement', EVENT: 'issues', FAKE_ISSUE_JSON }), re);
    assert.equal(t.ref('refs/heads/feature/4-claude-devloop'), '');
  }
  // github-actions[bot] 这种写法也认
  const t = publishSetup({ branch: 'feature/4-claude-devloop', createBranch: false });
  const ok = t.run({ MODE: 'implement', EVENT: 'issues', FAKE_ISSUE_JSON: implIssue({ comments: [{ author: { login: 'github-actions[bot]' }, url: 'u', body: claimBody() }] }) });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(t.ref('refs/heads/feature/4-claude-devloop'), t.newSha);
});

test('publish：禁止路径、符号链接、缺 Executor trailer → 不推送（机器强制，不靠提示词）', () => {
  const forbidden = [
    'public/model/mxgarage-rv.glb', 'public/model/motion_metadata.json', 'x/y.glb', 'dist/index.js', '.github/workflows/claude.yml',
    '.openai/hosting.json', '.env', '.env.local', '.dev.vars', 'sub/.dev.vars.x', 'package.json', 'package-lock.json', 'sub/package.json',
    'constitution.md', 'AGENTS.md', 'CLAUDE.md', '.claude/settings.json', 'scripts/devloop/publish.sh', 'wrangler.jsonc',
  ];
  for (const f of forbidden) {
    const t = publishSetup({ files: { [f]: 'x' } });
    stopped(t, t.run({ MODE: 'fix', EVENT: 'issue_comment' }), /禁止路径/);
    assert.equal(t.ref('refs/heads/feature/9-x-claude-devloop'), t.start, f);
  }
  const link = publishSetup({ files: { 'lib/l': '@link' } });
  stopped(link, link.run({ MODE: 'fix', EVENT: 'issue_comment' }), /符号链接/);
  const noTrailer = publishSetup({ message: 'work\n\nIssue: #4' });
  stopped(noTrailer, noTrailer.run({ MODE: 'fix', EVENT: 'issue_comment' }), /trailer/);
  // 普通路径（含名字相近的）放行
  const ok = publishSetup({ files: { 'lib/package-utils.ts': 'x', 'docs/env.md': 'x', 'tests/agents.test.ts': 'x' } });
  assert.equal(ok.run({ MODE: 'fix', EVENT: 'issue_comment' }).status, 0);
  assert.equal(ok.ref('refs/heads/feature/9-x-claude-devloop'), ok.newSha);
});

const TRAILER = '\n\nExecutor: Claude（devloop 云端）\nIssue: #4';
test('publish：逐个提交检查——中间提交加入又删除 .env（净改动里看不到）也不推送；中间提交里的符号链接、缺 trailer 的中间提交同样拦下', () => {
  const t = publishSetup();
  writeFileSync(join(t.wc, '.env'), 'PLACEHOLDER=1');
  t.g(['add', '.env'], t.wc);
  t.g(['commit', '-q', '-m', `add${TRAILER}`], t.wc);
  t.g(['rm', '-q', '.env'], t.wc);
  t.g(['commit', '-q', '-m', `rm${TRAILER}`], t.wc);
  t.rebundle();
  stopped(t, t.run({ MODE: 'fix', EVENT: 'issue_comment' }), /禁止路径：\.env/);
  assert.equal(t.ref('refs/heads/feature/9-x-claude-devloop'), t.start);

  const l = publishSetup();
  execFileSync('ln', ['-s', 'a', join(l.wc, 'tmp-link')]);
  l.g(['add', 'tmp-link'], l.wc);
  l.g(['commit', '-q', '-m', `link${TRAILER}`], l.wc);
  l.g(['rm', '-q', 'tmp-link'], l.wc);
  l.g(['commit', '-q', '-m', `unlink${TRAILER}`], l.wc);
  l.rebundle();
  stopped(l, l.run({ MODE: 'fix', EVENT: 'issue_comment' }), /符号链接/);

  const m = publishSetup({ message: 'no trailer' });
  writeFileSync(join(m.wc, 'c'), '3');
  m.g(['add', 'c'], m.wc);
  m.g(['commit', '-q', '-m', `ok${TRAILER}`], m.wc); // 最后一个提交合规，中间那个不合规
  m.rebundle();
  stopped(m, m.run({ MODE: 'fix', EVENT: 'issue_comment' }), /trailer/);
});

test('publish：fix 合并了 main（main 带 .github 改动）不算越界——只看待推送提交自己引入的改动', () => {
  const t = publishSetup();
  advance(t.remote, 'main', '.github/workflows/x.yml', 'on: push');
  t.g(['fetch', '-q', 'origin', 'main'], t.wc);
  t.g(['merge', '-q', '--no-ff', 'origin/main', '-m', `merge main${TRAILER}`], t.wc);
  const tip = t.rebundle();
  const r = t.run({ MODE: 'fix', EVENT: 'issue_comment' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /published=/);
  assert.doesNotMatch(r.stdout, /stopped/);
  assert.equal(t.ref('refs/heads/feature/9-x-claude-devloop'), tip);
  // 合并提交自己夹带的禁止路径改动仍拦下
  const e = publishSetup();
  advance(e.remote, 'main', 'm', '1');
  e.g(['fetch', '-q', 'origin', 'main'], e.wc);
  e.g(['merge', '-q', '--no-ff', '--no-commit', 'origin/main'], e.wc);
  writeFileSync(join(e.wc, 'AGENTS.md'), 'x');
  e.g(['add', 'AGENTS.md'], e.wc);
  e.g(['commit', '-q', '-m', `merge${TRAILER}`], e.wc);
  e.rebundle();
  stopped(e, e.run({ MODE: 'fix', EVENT: 'issue_comment' }), /禁止路径：AGENTS\.md/);
});

test('publish：outcome 为 needs-user 或产物缺失 → 评论 + 加 needs-user，不推送；implement 时释放 devloop-running', () => {
  for (const outcome of ['needs-user', null]) {
    const t = publishSetup({ outcome, withBundle: false });
    const r = t.run({ MODE: 'fix', EVENT: 'issue_comment' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(t.gh.log(), /^issue edit 4 -R o\/r --add-label needs-user$/m);
    assert.equal(t.ref('refs/heads/feature/9-x-claude-devloop'), t.start);
  }
  const t = publishSetup({ outcome: 'needs-user', withBundle: false, branch: 'feature/4-claude-devloop', createBranch: false });
  t.run({ MODE: 'implement', EVENT: 'issues' });
  assert.match(t.gh.log(), /^issue edit 4 -R o\/r --remove-label devloop-running$/m);
});

test('publish：拒绝推送到非 feature/*-claude-devloop 分支', () => {
  const bad = publishSetup({ branch: 'main', createBranch: false });
  assert.notEqual(bad.run({ MODE: 'fix', EVENT: 'issue_comment' }).status, 0);
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

test('claude.yml：手动触发有 pr / issue 两个可选输入，二选一；编号表达式都含 inputs.issue', () => {
  const yml = readFileSync(join(HERE, '../../.github/workflows/claude.yml'), 'utf8');
  assert.match(yml, /issue:\n {8}description: .*\n {8}required: false/);
  assert.match(yml, /pr:\n {8}description: .*\n {8}required: false/);
  assert.match(yml, /KIND: \$\{\{ inputs\.issue && 'issue' \|\| '' \}\}/);
  assert.match(yml, /pr 与 issue 只能填一个/);
  assert.doesNotMatch(yml, /github\.event\.issue\.number \|\| inputs\.pr \}\}/);
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
const reviewComment = (vars = ON) => ({
  github: {
    event_name: 'issue_comment',
    repository_owner: 'o',
    event: { issue: { pull_request: { url: 'x' }, labels: [] }, comment: { user: { login: 'o' }, body: '执行者：GPT 审核 <!-- devloop state=changes:f2 sig=x -->' } },
  },
  vars,
});
const dispatch = (vars = ON) => ({ github: { event_name: 'workflow_dispatch', event: {} }, vars });

test('claude.yml：默认停用——不设 DEVLOOP_ENABLED=true 时任何触发都不运行（合并本 PR 不会启用任何东西）', () => {
  for (const vars of [{}, { DEVLOOP_ENABLED: 'false' }, { DEVLOOP_ENABLED: 'yes' }]) {
    assert.equal(triggers(labelled(vars)), false);
    assert.equal(triggers(dispatch(vars)), false);
    assert.equal(triggers(reviewComment({ ...vars, DEVLOOP_REVIEWER: 'on' })), false);
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

test('claude.yml：审核方评论触发修复默认关闭，DEVLOOP_REVIEWER=on 才开', () => {
  assert.equal(triggers(reviewComment()), false);
  assert.equal(triggers(reviewComment({ ...ON, DEVLOOP_REVIEWER: 'on' })), true);
  assert.equal(triggers(reviewComment({ ...ON, DEVLOOP_REVIEWER: 'on', DEVLOOP_PAUSED: 'true' })), false);
  const ordinary = reviewComment({ ...ON, DEVLOOP_REVIEWER: 'on' });
  ordinary.github.event.comment.body = '执行者：GPT（dot）；角色：独立评审 暂不建议合并';
  assert.equal(triggers(ordinary), false);
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
  const out = join(dir, 'out');
  const run = (env) => spawnSync('bash', [join(HERE, 'pack.sh')], { cwd: wc, env: { ...process.env, OUT: out, START: start, RUN_ID: '55', RUN_URL: 'https://run', ...env }, encoding: 'utf8' });
  const read = (f) => (existsSync(join(out, f)) ? readFileSync(join(out, f), 'utf8') : null);
  /** 把 bundle 取回到新仓库，返回其中 HEAD 的文件列表 */
  const filesIn = (bundle) => {
    const chk = join(dir, `chk-${n++}`);
    execFileSync('git', ['init', '-q', chk]);
    execFileSync('git', ['-C', chk, 'fetch', '-q', join(wc, '.git'), start]);
    execFileSync('git', ['-C', chk, 'fetch', '-q', join(out, bundle), 'HEAD']);
    return execFileSync('git', ['-C', chk, 'ls-tree', '-r', '--name-only', 'FETCH_HEAD'], { encoding: 'utf8' }).trim().split('\n');
  };
  return { wc, g, out, start, run, read, filesIn };
}

test('pack：Claude 步骤失败 → needs-user，不产出 work.bundle；已有提交与未提交改动保全进 recovery.bundle（忽略文件不带），说明里写取回方法', () => {
  for (const CLAUDE_OUTCOME of ['failure', 'cancelled', '']) {
    const t = packSetup();
    writeFileSync(join(t.wc, 'b'), '2');
    t.g(['add', 'b']);
    t.g(['commit', '-q', '-m', 'done part']);
    writeFileSync(join(t.wc, 'c'), 'wip');
    mkdirSync(join(t.wc, 'node_modules'));
    writeFileSync(join(t.wc, 'node_modules', 'x'), 'dep');
    writeFileSync(join(t.out + '-pre'), ''); // 无关
    mkdirSync(t.out, { recursive: true });
    writeFileSync(join(t.out, 'work.bundle'), 'stale'); // 不应残留
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
  t.g(['commit', '-q', '-m', 'feat']);
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
  u.g(['commit', '-q', '-m', 'partial']);
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
