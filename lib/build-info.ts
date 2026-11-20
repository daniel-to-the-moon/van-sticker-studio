/**
 * Build identity baked in at build time, so anyone can read which commit a
 * running Worker version was built from (GET /api/version) without dashboard
 * access. Only non-secret CI metadata is read: commit SHA, branch, build time.
 *
 * Workers Builds injects WORKERS_CI / WORKERS_CI_COMMIT_SHA / WORKERS_CI_BRANCH
 * into the build; GitHub Actions provides GITHUB_SHA / GITHUB_REF_NAME.
 * Anything else (local builds) reports "unknown" instead of guessing.
 */

export type BuildSource = 'workers-builds' | 'github-actions' | 'local';

export type BuildInfo = {
  commit: string;
  branch: string;
  builtAt: string;
  source: BuildSource;
};

export const UNKNOWN_BUILD: BuildInfo = {
  commit: 'unknown',
  branch: 'unknown',
  builtAt: 'unknown',
  source: 'local',
};

const SHA_PATTERN = /^[0-9a-f]{7,40}$/;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,120}$/;

function cleanCommit(value: string | undefined): string {
  const commit = (value ?? '').trim().toLowerCase();
  return SHA_PATTERN.test(commit) ? commit : 'unknown';
}

function cleanBranch(value: string | undefined): string {
  const branch = (value ?? '').trim();
  return BRANCH_PATTERN.test(branch) ? branch : 'unknown';
}

export function resolveBuildInfo(
  env: Readonly<Record<string, string | undefined>>,
  now: Date = new Date(),
): BuildInfo {
  const builtAt = now.toISOString();
  if (env.WORKERS_CI === '1') {
    return {
      commit: cleanCommit(env.WORKERS_CI_COMMIT_SHA),
      branch: cleanBranch(env.WORKERS_CI_BRANCH),
      builtAt,
      source: 'workers-builds',
    };
  }
  if (env.GITHUB_ACTIONS === 'true') {
    return {
      commit: cleanCommit(env.GITHUB_SHA),
      branch: cleanBranch(env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME),
      builtAt,
      source: 'github-actions',
    };
  }
  return { ...UNKNOWN_BUILD, builtAt };
}

// Replaced by Vite `define` (see vite.config.ts). Undefined outside a build,
// e.g. under `node --test`, where currentBuildInfo() reports UNKNOWN_BUILD.
declare const __VSS_BUILD_INFO__: BuildInfo | undefined;

export function currentBuildInfo(): BuildInfo {
  return typeof __VSS_BUILD_INFO__ === 'undefined'
    ? UNKNOWN_BUILD
    : __VSS_BUILD_INFO__;
}
