#!/usr/bin/env node
/**
 * PR format check used by .github/workflows/pr-hygiene.yml (AGENTS §6).
 * Reads the pull_request event from GITHUB_EVENT_PATH, prints the findings,
 * exits 1 when any rule fails. Drafts only need the signature line and an
 * Issue reference; ready PRs also need the five handoff sections.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const EXEMPT_LABEL = 'hygiene-exempt';
export const SECTIONS = [
  { name: '改了什么', pattern: /^#{2,3}\s*改了什么/m },
  { name: '按什么规格', pattern: /^#{2,3}\s*(按什么规格|规格|验收)/m },
  { name: '跑了什么', pattern: /^#{2,3}\s*(跑了什么|命令与结果|证据)/m },
  { name: '没改什么 / 已知局限', pattern: /^#{2,3}\s*(没改什么|已知局限)/m },
  { name: '下一步', pattern: /^#{2,3}\s*下一步/m },
];

function firstLine(body) {
  const text = String(body ?? '').replace(/<!--[\s\S]*?-->/g, '');
  return text.split(/\r?\n/).find((line) => line.trim() !== '')?.trim() ?? '';
}

/**
 * @param {{ body?: string | null, title?: string, draft?: boolean, labels?: string[] }} pr
 * @returns {string[]} problems; empty means the PR passes
 */
export function checkPr(pr) {
  if ((pr.labels ?? []).includes(EXEMPT_LABEL)) return [];
  const body = String(pr.body ?? '');
  const problems = [];
  if (!/^(执行者|Executor)\s*[:：]\s*\S/.test(firstLine(body)))
    problems.push('正文第一行要以「执行者：<名字>」开头');
  if (!/#\d+/.test(`${pr.title ?? ''}\n${body}`))
    problems.push('标题或正文要引用关联的 Issue（#编号）');
  if (!pr.draft) {
    for (const section of SECTIONS)
      if (!section.pattern.test(body)) problems.push(`缺少「## ${section.name}」小节`);
    if (/<实际执行者>|#<编号>/.test(body)) problems.push('模板占位符未替换');
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8'));
  const pr = event.pull_request ?? {};
  const problems = checkPr({
    body: pr.body,
    title: pr.title,
    draft: pr.draft,
    labels: (pr.labels ?? []).map((l) => l.name),
  });
  if (problems.length === 0) {
    console.log('PR 格式检查通过');
  } else {
    console.log(`PR 格式检查未通过（见 AGENTS §6；维护者可加 ${EXEMPT_LABEL} 标签豁免）：`);
    for (const p of problems) console.log(`- ${p}`);
    process.exit(1);
  }
}
