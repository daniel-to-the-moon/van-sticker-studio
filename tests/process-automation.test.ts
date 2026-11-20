import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkPr, EXEMPT_LABEL } from '../tools/pr-hygiene.mjs';
import {
  CLOSE_DAYS,
  STALE_DAYS,
  STALE_LABEL,
  closeComment,
  decide,
  markComment,
} from '../tools/stale-drafts.mjs';

const FULL = [
  '<!-- note -->',
  '执行者：Claude；角色：实现者；Issue：#110',
  '',
  '## 改了什么',
  '## 按什么规格',
  '## 跑了什么',
  '## 没改什么 / 已知局限',
  '## 下一步',
].join('\n');

void test('a ready PR with signature, issue and five sections passes', () => {
  assert.deepEqual(checkPr({ body: FULL, title: 'x', draft: false }), []);
});

void test('the repository PR template passes once placeholders are filled', () => {
  const template = fs.readFileSync('.github/pull_request_template.md', 'utf8');
  assert.match(checkPr({ body: template, title: 't', draft: false }).join('\n'), /占位符/);
  const filled = template.replace('<实际执行者>', 'Claude').replace('#<编号>', '#110');
  assert.deepEqual(checkPr({ body: filled, title: 't', draft: false }), []);
});

void test('missing signature, issue or sections are each reported', () => {
  const unsigned = checkPr({ body: FULL.replace('执行者：Claude', 'Claude'), title: 'x', draft: false });
  assert.match(unsigned.join('\n'), /执行者/);
  const noIssue = checkPr({ body: FULL.replace('#110', ''), title: 'x', draft: false });
  assert.match(noIssue.join('\n'), /Issue/);
  const noRun = checkPr({ body: FULL.replace('## 跑了什么', ''), title: '#1', draft: false });
  assert.deepEqual(noRun, ['缺少「## 跑了什么」小节']);
});

void test('drafts only need signature and issue; the exempt label skips all', () => {
  assert.deepEqual(checkPr({ body: '执行者：Muse\n见 #99', title: 'x', draft: true }), []);
  assert.equal(checkPr({ body: '', title: 'x', draft: false }).length > 0, true);
  assert.deepEqual(checkPr({ body: '', title: 'x', draft: false, labels: [EXEMPT_LABEL] }), []);
});

const NOW = new Date('2026-11-20T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

void test('a draft idle for the stale window is marked, younger ones are not', () => {
  assert.equal(decide({ draft: true, labels: [], lastCommitAt: daysAgo(STALE_DAYS), staleSince: null }, NOW), 'mark');
  assert.equal(decide({ draft: true, labels: [], lastCommitAt: daysAgo(STALE_DAYS - 1), staleSince: null }, NOW), 'none');
  assert.equal(decide({ draft: false, labels: [], lastCommitAt: daysAgo(60), staleSince: null }, NOW), 'none');
});

void test('a marked draft closes after the close window, unless a commit arrived', () => {
  const marked = { draft: true, labels: [STALE_LABEL], lastCommitAt: daysAgo(30) };
  assert.equal(decide({ ...marked, staleSince: daysAgo(CLOSE_DAYS) }, NOW), 'close');
  assert.equal(decide({ ...marked, staleSince: daysAgo(CLOSE_DAYS - 1) }, NOW), 'none');
  assert.equal(
    decide({ draft: true, labels: [STALE_LABEL], lastCommitAt: daysAgo(1), staleSince: daysAgo(3) }, NOW),
    'unmark',
  );
  assert.equal(decide({ draft: false, labels: [STALE_LABEL], lastCommitAt: daysAgo(30), staleSince: daysAgo(9) }, NOW), 'unmark');
});

void test('comments explain how to keep, take over, and that the branch stays', () => {
  const mark = markComment({ lastCommitAt: daysAgo(8) });
  assert.match(mark, /推一次提交/);
  assert.match(mark, /takeover/);
  assert.match(closeComment(), /分支保留/);
});
