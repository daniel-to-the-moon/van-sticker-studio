# Issue #31: bounded integration candidate

Executor: GPT (Codex cloud implementer). Claim: `vss-integration-9-28-gpt-20261026-01`.
Task: `01a1786a-607f-71a4-a4e4-46c3f78f8014`; initial turn: `01a1786a-6b63-71b5-87d1-130c1e4d42f0`.
Prepared on 2026-10-26 UTC in `/workspace/van-sticker-studio`; no user Mac used.
Branch: `feature/31-acceptance-candidate`. Refs #31, #9, #28.

## Authority and frozen inputs

Read the frozen main versions of `constitution.md`, `AGENTS.md`, `CONTRIBUTING.md`,
the PR template and both Issue templates. Repository `.agents/skills/` is absent;
the environment `/workspace/.agents/` is empty, so no local `SKILL.md` was available.
No unmerged governance rules were adopted.

| Input | Exact commit |
| --- | --- |
| main (including merged #22) | `3ef8fc05691604dbb9c546a67fe24c8c2c178cb4` |
| PR #9 | `5eddce13e9bbad38038daa69555c81700900a7b0` |
| PR #28 | `9b8b9dfcd791345ea7147725586d450b26a7f337` |

[Issue #31](https://github.com/shengjun89/van-sticker-studio/issues/31) specifies this
union. [CI authorization and execution receipt](https://github.com/shengjun89/van-sticker-studio/issues/31#issuecomment-6417327163)
records the owner's direct 13:34 UTC approval: use the existing automatic GitHub CI
with its existing build identity configuration. This permits one bounded push and
a Draft PR. It does not authorize local application execution or reading identity
configuration, workflow/configuration changes, main merge, production deployment,
real AI generation, credential/permission changes, or a retry after CI failure.

## Source stop and exclusivity checks

- [PR #9 final stop receipt](https://github.com/shengjun89/van-sticker-studio/pull/9#issuecomment-6404650271)
  records original run `bc-b9b11fa7-b141-56fa-abc2-5d5e59441f3e` as finished at the
  frozen head. The original VM's uncommitted state remains **unverified**; that VM
  was not accessed or restarted. No unpublished source work was discovered here.
- [PR #28 freeze receipt](https://github.com/shengjun89/van-sticker-studio/pull/28#issuecomment-6405000921)
  and [coordinator confirmation](https://github.com/shengjun89/van-sticker-studio/pull/28#issuecomment-6405028843)
  record original run `bc-a0c2a143-fdbe-518a-9f4b-42d2d9a17fe0` as finished,
  last worktree clean, dev stopped. VM retention is unknown. No source run restarted.
- Initial local `status --porcelain=v1 --untracked-files=all` was empty. There was
  one worktree, branch `work`, at the frozen main and no local candidate branch.
- `ls-remote --heads origin` matched all three frozen heads and found no candidate
  branch. Both source PRs were open Drafts at their frozen heads.
- A separate **read-only** inventory at 13:36:35 UTC checked all 9 open PRs, all 14
  remote branches, and all 34 Actions runs. There was no duplicate candidate
  branch/PR/run and no running Actions. This was not another implementation run.
  Sources: [PR inventory](https://api.github.com/repos/shengjun89/van-sticker-studio/pulls?state=open&per_page=100&page=1),
  [branch inventory](https://api.github.com/repos/shengjun89/van-sticker-studio/branches?per_page=100&page=1),
  [run inventory](https://api.github.com/repos/shengjun89/van-sticker-studio/actions/runs?per_page=100&page=1).
- Process metadata showed the Codex/tool process chain and environment services;
  no application server, test, browser or other implementation writer was found.
  A detached `git` PID 633 was reconciled as state `Z` (zombie), with empty cmdline:
  it was already exited and could not write. No process was killed or restarted.

## Composition and content identity

Source merge bases are `62f9318accac151544060f2cbfceaec72beda0d0` (#9) and
`20aee5d1136bcfbec9b2a992aa5fbdfa25ff9eaf` (#28). The source path sets are disjoint.
Both exact source patches passed `git apply --check --index` against frozen main,
then applied without conflict. No implementation, assertion or source evidence
was repaired, rewritten, weakened or regenerated.

The staged product/evidence tree **before adding this record** was
`982c2b6c451ec02bf84f08052551bee32685f3ec`.
An entire-index versus main metadata comparison proved that its only differences
were the following ten paths; each file mode and blob exactly matched its frozen
source. The final candidate adds only this record under the authorized new evidence
directory. The final commit SHA and remote CI observations belong in the Draft PR
handoff, avoiding a self-referential commit identifier in this file.

| Path | Source | Exact Git blob |
| --- | --- | --- |
| `tests/secret-hygiene.test.ts` | #9 | `a8a47e99957ae99ae001c1e511fc6eb1c5daceac` |
| `tools/scan-dist-secrets.mjs` | #9 | `af851df041b973adada3f5bb81d183ef2e0809d9` |
| `app/page.tsx` | #28 | `dcee92555844554ee41857d8d87dc2f2f15a1e3c` |
| `lib/i18n.ts` | #28 | `91e7884b386bcc897e31855551e7f4d3e6db7625` |
| `tests/generation-availability.test.ts` | #28 | `9d6f436c25e105253b02b906d26973115616d8cb` |
| `docs/reviews/pr-17/EVIDENCE.md` | #28 | `bdeff9fffff26a9882dff0adcedcb23dabdd5cba` |
| `docs/reviews/pr-17/disabled-en.png` | #28 | `02fae0b94ab1a464751eae83e9807d95f0b4c883` |
| `docs/reviews/pr-17/disabled-zh.png` | #28 | `00f78bdb9a8cde32339bc49967d4f73b74d80356` |
| `docs/reviews/pr-17/recovered-en.png` | #28 | `04342edd89813d11fb42587ac6d209e524bb6c38` |
| `docs/reviews/pr-17/recovered-zh.png` | #28 | `c6af0228bfa1ea5d0f7b5813e3465e64766ec3cc` |

The seven documents merged by #22 remain byte-identical to frozen main:
`docs/opc/decal-material-library.md`, `docs/opc/demand-pool.md`,
`docs/opc/layout-data-pipeline.md`, `docs/opc/sticker-compliance-onepager.md`,
`docs/opc/validation/problem-hypothesis.md`, `docs/opc/validation/red-team-brief.md`,
`docs/opc/validation/validation-plan.md`. The entire-index comparison also preserves
every other main path outside the allowlist, including governance, workflows,
configuration, spec and GLB. #23/#25/#26/#30 and the new vehicle direction are excluded.

## Local commands and results

All Git operations used `git -c core.hooksPath=/dev/null -c core.fsmonitor=false`;
diffs additionally used `--no-ext-diff --no-textconv`. No hooks or external diff
driver ran. These controls do not represent completion of application gates.

| Command/action | Result |
| --- | --- |
| `status --porcelain=v1 --untracked-files=all`; `worktree list --porcelain`; local branch metadata | exit 0; initially clean, one worktree |
| `ls-remote --heads origin` | exit 0; frozen inputs match, no candidate branch |
| `fetch --no-tags --no-write-fetch-head origin <frozen-9> <frozen-28>` | exit 0; exact objects fetched, source refs untouched |
| `merge-base <main> <frozen-source>` for each source | exit 0; bases listed above |
| `diff --no-ext-diff --no-textconv --binary <source-base> <source-head>` for each source | exit 0; operational patch files in `/tmp` |
| `check-attr filter merge diff -- <ten allowed paths>` | exit 0; all unspecified; no custom driver/filter |
| `apply --check --index /tmp/vss-31-source-9.patch` and `...-28.patch` | exit 0 each; no conflicts |
| `switch -c feature/31-acceptance-candidate <frozen-main>` | exit 0 |
| `apply --index /tmp/vss-31-source-9.patch` and `...-28.patch` | exit 0 each |
| `diff --no-ext-diff --no-textconv --cached --check` | exit 0; no whitespace errors |
| entire-tree path/mode/blob comparison via `ls-tree` and `ls-files --stage` | exit 0; exact source union and all remaining main entries preserved |

Discovery probes also reported missing repository `.agents` (rg exit 2) and source
objects not initially present (cat-file exit 128); no application execution or
integration failed. Frozen objects were subsequently fetched once; no failed
build, integration, push or remote run was retried.

## Not run and pending acceptance

- Local `npm install`, `npm ci`, lint, tests (including targeted/red/green tests),
  `npx tsc --noEmit`, build, dev and browser: **not run**. Local configuration
  consumption is prohibited; no dependencies or substitute configuration added.
- Local post-build `node tools/scan-dist-secrets.mjs`: **not run**; no local build
  produced candidate `dist/client`. Only a safe existing CI artifact path could
  support later scanning. If none is available, report the gap without changing CI.
- Existing source-PR gate/scanner reports are historical evidence only; they do
  not pass this combined SHA. Record automatic remote CI and actual checkout SHA
  separately in the Draft PR. Any failed CI stops this task without rerun or repair.
- No private identity/configuration file was opened or printed, including
  `.openai/hosting.json`, `.env` or real credential files.
- No new screenshots, paid generation, runtime/language/input-preservation/recovery
  acceptance or owner visual approval. Existing `pr-17` screenshots are preserved
  source evidence, not before/after evidence or runtime acceptance for this tree.
- A successful `/api/status` response alone is not proof of upstream generation
  health. Preview acceptance must avoid real generation requests and charges.
- Non-implementer review must bind the final combined SHA; this implementer does
  not self-review. Draft candidate is not a main/production approval.

## Handoff and rollback

After pre-push input/exclusivity recheck: one normal push, one Draft PR, observe
existing CI/preview metadata, then stop and hand the exact SHA to the parent for
independent review. Keep the candidate, source branches, PRs and Issues. Main and
production are unchanged. No deletion/reset/rebase/force push is part of rollback.

Cost is unavailable in this environment (`[NEEDS CLARIFICATION]`); preparation
started around 13:34 UTC. Final elapsed time is recorded in the PR handoff.

## 2026-10-27: authorized CI scan evidence follow-up

The preceding sections retain the original 2026-10-26 preparation record. This
follow-up changes only the workflow restriction for the exact technical slice
below; it does not retroactively scan or approve the old candidate.

- Actual executor/task remains GPT, Codex cloud implementer,
  `01a1786a-607f-71a4-a4e4-46c3f78f8014`, on the same branch and Draft PR #32.
- Unique claim: `vss-integration-9-28-ci-scan-20261027`, confirmed by
  [dot's bounded instruction](https://github.com/shengjun89/van-sticker-studio/pull/32#issuecomment-6436651269).
  The previous implementation was completed and clean before this continuation.
- Effective rule/spec and decision table: main
  `5a9605ed0a45857996c48843b41977e9b30ad08b`; read `constitution.md`, `AGENTS.md`,
  `CONTRIBUTING.md`, PR and task templates. AGENTS sections 7, 8, 10–16 apply;
  section 14 rows for task refinement, claim/lock assignment and authorized
  existing automatic previews/CI apply. dot decided this scope; credentials,
  security permissions, fees and private configuration remain reserved.
- Code parent/frozen pre-follow-up head:
  `709afa4161fd9049c9651d59553ffb7299c516c1`. The branch is not rebased or merged
  with newer main. Its existing workflow is identical to that effective main's
  workflow, so no synchronization is technically necessary.
- Exclusive write set: `.github/workflows/ci.yml` and this `CANDIDATE.md`.
  Semantic lock: the existing gates job's post-build client scan and its evidence.
  Original product/source blobs, scanner and tests must remain identical to the
  pre-follow-up head; no trigger/runner/permission/secret/checkout/cache/production
  setting changes, artifact uploads, storage or dependency additions.

Preflight: local status was clean at the frozen candidate, one worktree, no other
implementation/application process. Remote main and candidate matched the stated
SHAs. Read-only inventory on 2026-10-27 around 07:57–07:59 UTC found all 10 open PRs,
16 branches and 39 Actions runs; all runs were completed, with only the original
candidate run `40332762253`/attempt 1. No competing workflow modification, duplicate
candidate or scan run was found. The current claim and
[#9 coordination record](https://github.com/shengjun89/van-sticker-studio/pull/9#issuecomment-6436663821)
assign this addition to the original candidate executor. The audit helper was
read-only, not another implementation or formal review. Environment `.agents` is
empty and repository/main `.agents/skills` is absent; no local `SKILL.md` exists.

### Exact CI addition and diagnostic boundary

One step, `Scan client build for secret markers`, follows the existing
`npm run build` in the same gates job. It explicitly uses Bash and:

1. Rejects a missing/non-directory `dist` or `dist/client` and either path being
   a symbolic link before traversal.
2. Uses `find -P` to detect any symbolic link inside the client tree without
   following it. The only captured output is a fixed marker, never a filename;
   traversal diagnostics are suppressed and traversal failure exits nonzero.
3. Runs the unchanged `node tools/scan-dist-secrets.mjs dist/client`, with original
   stdout and stderr redirected to `/dev/null`. A shell `if` captures the real
   scanner failure status before printing a fixed failure message and exits with
   that exact status. Success prints only a fixed success message. There is no
   `continue-on-error`, retry, fallback or path/matched-content output.

The existing scanner's source was inspected; it scans passed tree file bytes and
does not import application/configuration modules, read environment configuration
or access the network. Its root `stat` follows symlinks and its diagnostics include
paths, which is why this wrapper adds those two protections. The scanner itself
is unchanged. Passing proves only that its existing marker rules did not find a
match in that client's files; it does not establish absence of every secret.
No scan count is fabricated or exposed.

### Verification and evidence binding

Local checks are limited to workflow/YAML structure, Bash syntax, Git scope/blob
identity and safe diffcheck. No local install, application test, lint, tsc, build,
dev, browser, scanner execution or private identity/configuration access is
permitted. No synthetic configuration is added. Local wrapper branches are not
executed; static validation is not runtime proof of every failure branch.

Completed local static checks (exit 0 each): `python3 -I` with YAML `BaseLoader`
parsed the old/new workflows and proved that removing the one appended step leaves
the entire original workflow structure identical, including the four gates and
all trigger/runner/checkout/cache settings; it also checked the exact two-path
write set and unchanged historical evidence prefix. `bash --noprofile --norc -n`
accepted the extracted step via stdin without executing it.
`git -c core.hooksPath=/dev/null -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check 709afa4161fd9049c9651d59553ffb7299c516c1`
reported no whitespace errors. This is static syntax/scope evidence, not a local
application gate or local scanner result.

The follow-up's final commit SHA, full static-check results, new automatic CI run,
actual checkout SHA/tree and the four original gates plus the distinct scan step
will be recorded in the PR handoff comment, not self-referenced in this commit.
Until that new evidence exists, the new scan is pending. The original
`709afa4161fd9049c9651d59553ffb7299c516c1`/run `40332762253` remains **not scanned**.
Only one normal push to the original PR is allowed; no manually triggered run or
automatic retry. Any action/CI failure stops with its actual phase recorded;
uncertain remote outcomes must be read back before another action.

Frozen visual/runtime/model acceptance is unchanged. The prior failed cloud
browser WebGL check is not resumed; no new screenshots, model or real AI generation
is attempted. Earlier independent static review remains historical evidence for
the old head; a non-implementer must review the final workflow increment/new head.
The implementer does not self-review, merge or deploy. Next receiver is the parent
coordinator dot, who assigns that independent review. Cost is unavailable; final
elapsed time and stop/clean status are recorded in the handoff comment.

## 2026-10-27: independently authorized exact line-map correction

The CI scan follow-up stopped after run `40470767509`/attempt 1 failed at
`npm test` (158/161 passed, exit 1); tsc, build and the client scan were skipped.
The failure and stop record remains
[PR comment 6436820489](https://github.com/shengjun89/van-sticker-studio/pull/32#issuecomment-6436820489).
That run is not rerun, and neither earlier candidate is retroactively scanned.

The parent completed an independent read-only cause/equivalence check and issued
[the next bounded correction](https://github.com/shengjun89/van-sticker-studio/pull/32#issuecomment-6436862532)
under claim `vss-integration-9-28-line-map-20261027`. This continues the original
sole implementer/task `01a1786a-607f-71a4-a4e4-46c3f78f8014`, branch and Draft PR.
The effective rule/spec and AGENTS section 14 decision-table version remains
main `5a9605ed0a45857996c48843b41977e9b30ad08b`; sections 7/14 permit the documented
coordinate correction for a real documentation/spec migration after independent
review. dot decided this exact scope; the implementer does not self-review.
Visual/runtime/model acceptance stages and private configuration boundaries do
not change.

Frozen code parent: `11c43e4c8f19be6aa2a08c2f323b1cbf38ce0580`.
Local worktree was clean, one worktree and no other implementation/application
writer; remote head and effective main matched these stated SHAs. Incremental
read-only metadata checks found the unique new claim, both previous candidate
runs completed, and no active candidate/duplicate line-map run. No new branch,
PR, implementation task, browser QA or manual CI run is created.

### Cause, equivalence and exact write set

The three existing public safety statements in `DEPLOY.md` are byte-identical
between original main `3ef8fc05691604dbb9c546a67fe24c8c2c178cb4` and effective main;
only their line coordinates moved. The implementation independently compared the
complete old/new lines before editing and checked current public documentation
coordinates rather than assuming the supplied numbers. The current main document
blob is `58e8debdb68a68c348dcdfd057723586725afaae`; the frozen candidate test blob
before this correction is `a8a47e99957ae99ae001c1e511fc6eb1c5daceac`.
The parent's independent check tied those same blobs to failed CI checkout
`2f18ca18abc243b4fb3008776c677985134d0cdf`, whose parents were effective main plus
the frozen candidate. Its tree differed from the branch tree; no main update was
merged or rebased into this branch.

| Exact public statement coordinate | Old | Effective main |
| --- | --- | --- |
| first existing deployment safety statement | 136 | 129 |
| second existing deployment safety statement | 259 | 260 |
| third existing deployment safety statement | 285 | 287 |

Only `tests/secret-hygiene.test.ts` and this evidence file may change. The test
change is exactly six numeric substitutions: three allowlist `lineNumber` fields
and the corresponding three expected `DEPLOY.md` coordinates. Existing constant
identifiers retain their historical names; their exact strings are unchanged.
Paths, the fourth README entry/coordinate, the total of four allowed statements,
strict path/line/text matching, independent credential detection, every negative
test, matching logic and failure assertion remain unchanged. There is no regex
relaxation, automatic location discovery, new exception or removed assertion.
Scanner, workflow (including the guarded post-build step), application and all
other source blobs remain identical to the frozen code parent.

### Local verification and new CI binding

Only static public-source/Git comparisons and safe diffcheck are allowed locally:
check the six exact before/after substitutions, unchanged remaining test bytes,
old/new safety-statement byte equality and coordinates, the two-path scope,
unchanged remaining tree entries and preserved historical evidence. No local
application test/lint/tsc/build, install, dev, browser, scanner or private identity
configuration read is performed; no substitute configuration is created.

Completed static checks, exit 0: a Python standard-library byte comparison proved
the entire test file equals the frozen parent plus exactly those six replacements;
all remaining bytes are unchanged. Public-source comparisons confirmed identical
full statement lines and current coordinates 129/260/287 in DEPLOY, plus the
unchanged README coordinate 23. Scope is exactly the two allowed paths, and the
prior evidence is an unchanged prefix. Safe
`git -c core.hooksPath=/dev/null -c core.fsmonitor=false diff --no-ext-diff --no-textconv --check 11c43e4c8f19be6aa2a08c2f323b1cbf38ce0580`
returned exit 0. These checks did not execute the TypeScript test or scanner.

The next normal push is one new commit under this separate correction claim.
Its final head, new automatic CI run/attempt, actual merge checkout parents/tree,
four gates and distinct client-scan step results are recorded in the PR handoff
comment to avoid self-referential commit identifiers. Until then they are pending.
Do not infer that head and checkout have the same tree. Scan success means only
the unchanged scanner's existing marker rules did not match that built client;
no scan count or guarantee that all secrets are absent is asserted.

If the new CI fails, stop without further correction or rerun. Keep all previous
failure records and unchanged visual/runtime/model gaps; do not resume WebGL QA.
The next receiver is parent coordinator dot for a non-implementer final review
of this increment and its actual gate/scan evidence. No merge or deployment is
authorized. Final stop/clean status, elapsed time and unavailable cost metrics
are recorded in the handoff comment.
