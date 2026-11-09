# Issue #73 candidate handoff

Executor: Codex. Implementation run: issue73-free-wrap-takeover.
Status: candidate delivered for review; not accepted, merged or deployed.
Code SHA: `368857d23d3886892a1567808633c65da05669b1`.
Base/main last checked: `942454a7fe52f055b764fc1fb2df2f9662187780`.
Evidence-only commits do not change the tested product code.

## Authority and scope

The maintainer directly requested takeover of Claude's implementation, PC
mouse/keyboard support, incorporation of the old framing/side-view/decorative
copy feedback, the supplied Nexusbot/Axon visual reference, and Grok collaboration.
These are direct instructions in the implementing Codex chat, not authority
inferred from a GitHub nickname. Exact historical message timestamps are not
available in the current context. Private transcript/reference source is not
published.

Single claim: [6731815818](https://github.com/daniel-to-the-moon/van-sticker-studio/issues/73#issuecomment-6731815818).
Scope addition: [#53 record](https://github.com/daniel-to-the-moon/van-sticker-studio/issues/53#issuecomment-6731857652).
Frozen visual target: [Muse rubric](https://github.com/daniel-to-the-moon/van-sticker-studio/issues/73#issuecomment-6720675550).
Decision table: AGENTS.md on the base SHA, sections 0, 11, 13–16.
Implementation is isolated in a separate clone and new branch; the original
checkout and other branches are untouched. This is not a declaration that
Claude's private run stopped or that unknown unpushed work was abandoned.
Claude private process state/unpushed work and old semantic-lock handoff are
unverified; dot coordinates their record. No previous #73 candidate PR was found.
#67's two test-file fixes remain separate.

## Delivered behavior

- /design route, visible homepage entry, mobile toolbar, PC pointer and scoped keys.
- Finger/mouse line simplified into above/below/closed fill boundaries;
  point correction; separate solid/dashed strokes, text, vector icons and local images.
- Persistent linked sides by default; split, relink, one-side delete and atomic history.
- Move, size, rotation, layer order, duplicate, visibility and locking.
- Versioned bounded JSON import/export, local autosave/recovery, SVG export.
- Model-derived chart and window mask; existing closed-pose geometry coordinates
  drive the 3D texture so movable surfaces retain their local art.
- Level side directions, viewport-aware fit, preserved manual camera on resize/export.
- Neutral surfaces, restrained controls and reduced decorative copy from the
  supplied Nexusbot/Axon reference.
- Desktop canvas stays visible while the long inspector scrolls separately.

No GLB, asset metadata, dependency versions, lockfile, production settings,
private hosting identity, governance files or generation service changes.
The two existing assertion updates reflect the requested level camera and
decorative-copy removal; brand protection and behavior checks remain.

## Verification, 2026-11-09

Actual test runtime: Node v25.8.1 on macOS. Installation used Node v22.22.3.

| Command | Exit | Result |
| --- | --- | --- |
| npm run lint | 0 | No reported warnings/errors |
| npm test | 1 | 220 tests: 216 pass, 4 fail |
| npx tsc --noEmit | 2 | Missing owner-private hosting configuration import only |
| npm run build | 1 | Blocked by the same owner-private configuration; not retried without a configuration change |
| node --experimental-strip-types --test tests/free-wrap.test.ts tests/wrap-chart.test.ts tests/wrap-guides.test.ts tests/studio-framing.test.ts tests/drawing-export.test.ts tests/homepage-simplify.test.ts | 0 | 44 pass, 0 fail |
| git diff --check | 0 | Clean |

The four full-suite failures reproduce on base code in an isolated baseline:
generation-availability's import harness does not know PalettePicker; three
secret-hygiene assertions pin outdated README/DEPLOY line numbers.
Baseline reproduction command:
`node --experimental-strip-types --test tests/generation-availability.test.ts tests/secret-hygiene.test.ts`
— exit 1, 44 tests, 40 pass, same 4 fail.
They remain failures, not waived gates. The private hosting file was not read,
created or replaced to make checks pass.

Initial dependency installation failed (npm exit-handler failure; registry
connectivity was also observed). The later isolated install succeeded using
`npm ci --ignore-scripts --registry=https://registry.npmjs.org --replace-registry-host=always`.
Only command-local registry flags were used; package/lock and persistent npm
configuration were not changed. Exact earlier attempt timestamps/exit code:
not reconstructed; existing local logs retained. No install rerun for this handoff.

## Observed browser behavior

Local client-only Vite preview, 1280×720 and 390×844 browser viewport:
independent region/text/icon insertion; drawing a boundary; undo/redo;
switching linked sides; unlinking and recoloring only one side; reload restoring
10 imported editable layers; real GLB 3D side/hero previews; side-door opening;
desktop long inspector keeps the canvas in the first viewport.
Desktop pointer/arrow editing was exercised. Narrow viewport uses browser
emulation with pointer input: not a physical-phone, multi-touch or timed-user test.

Local preview: http://127.0.0.1:3073/design (host machine only, while server runs).
It omits hosting integration and is not production-build evidence. Home API
status cannot run without Cloudflare runtime in this client-only preview.
The resulting dev overlay was dismissed for layout screenshots; no AI request
was made and the API is not claimed verified.

Screenshots retained with the implementing run: mobile-coffee-editor,
desktop-coffee-editor, desktop-coffee-3d, desktop-coffee-side,
desktop-coffee-door-open, homepage-before-default, homepage-after-default.
The homepage pair compares identical default-startup actions, not identical
camera poses: changing the default camera is part of this task. Matched-pose
before/after drawing acceptance is still pending. Screenshots are actual UI,
not image-generated beautifications.

## Reproduce the editable study

Open /design, choose Import draft, select [coffee-study.json](coffee-study.json).
It contains ten independent vector/text layers: mint region, black sign,
white handwritten title, cup, runner, badge, small text, dashed path, two stripes.
This fixture was authored in code then imported through the actual UI.
It is not a from-blank timed human reconstruction and is not a 90-point result.
No reference photograph is embedded as a flattened texture.

R01 reference SHA:
`d7a7287c1ec4e4506699f9cc19c1bd97cb1e8467fc1d3c2132652c29db60c9f5`.
R02 reference SHA:
`8831240e98cffdedd9bae82e11857e372bbc5b4b0482f2f712af162e0b3c4421`.
References show two states of the same side, not opposite sides.

## Review and remaining limits

Fresh read-only Codex reviewer checked core/state/texture/geometry changes;
reported issues were fixed. Final pass and later CSS-only pass reported no
remaining P1/P2 within their checked scope. Same-family review does not replace
the repository's required independent cross-family acceptance.

Grok [conditional receipt](https://github.com/daniel-to-the-moon/van-sticker-studio/issues/73#issuecomment-6732030366):
request seen; formal acceptance awaits dot confirmation and fixed PR/head.
Requested scope: PC text/keyboard, linkage/history, save/reopen, readable 3D
text and door attachment. No implementation file lock is assigned to review.
Muse retains D1–D5 scoring, F1–F5, physical-phone workflow and actual elapsed
creation time. No Muse result or score has been supplied.

Known visual limits: chart is an unfolded material coordinate view, not an
orthographic construction drawing; front seams can look distorted.
Handwritten font uses system fallback and is not yet a portable reference-font
match. The editable study's icon proportions/layout need Muse's actual scoring.
The current model differs from the reference service-window van.
Advanced Bezier/pen editing is not implemented; only freehand cleanup and
point correction are provided.

Next: dot binds this exact candidate to Grok's review; Grok gives a factual
COMMENT with checked/unchecked items. Muse performs independent creation/scoring.
Keep Draft until four gates, lock handoff, required review and frozen acceptance
are actually satisfied. No merge, deployment, tag or traffic switch requested here.
Rollback after any later merge: revert this PR; older project routes remain
separate and no saved user draft should be deleted.
