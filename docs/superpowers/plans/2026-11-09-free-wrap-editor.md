# #73 implementation and visual cleanup

Authority: maintainer directly requested Codex to replace Claude, implement #73,
preserve PC mouse/keyboard usability, and include old #53 initial framing,
side-view and decorative-copy feedback. Axon reference supplied as local Nexusbot
preview HTML; use its neutral surfaces and restrained controls. Do not publish
the private reference source. Base 942454a7fe52f055b764fc1fb2df2f9662187780.

Spec: #73 confirmed decisions and Muse comment 6720675550. Mobile-first 2D
side editor with 3D preview; freehand boundary, independent editable text,
icons and solid/dashed strokes; persistent bilateral linkage, explicit side
exception and relinking; readable text; undo/redo; versioned local draft and
portable project. PC visible controls and scoped shortcuts, mouse drag/zoom.
Original GLB, paint eligibility and closed-pose attachment remain authoritative.
The 2D guide is not a fabrication template. Do not claim a 90 score before Muse.

## Task 1: document model and geometry
Add typed, validated versioned project, per-side linked objects, history,
boundary tidying, SVG output and safe keyboard mapping. Tests first for
link/split/relink/atomic undo, invalid input, path cleanup and readable sides.
Verify: node --experimental-strip-types --test tests/free-wrap.test.ts
Expected: all new behavior tests pass.

## Task 2: mobile/PC authoring and 3D integration
Focused /design route linked from home. Editable elements with color/text,
move, size, rotation, reorder, hide/lock, duplicate, delete, independent assets,
boundary/solid/dashed strokes and simple point correction. Pointer capture,
cancel on interrupted/multi-touch gesture, zoom/pan, buttons and input-safe keys.
Safe autosave/manual project export-import. Separate 3D mode uses existing
material chart, no opaque full-reference overlay. Tests and browser interaction.

## Task 3: old visual feedback
Pure lateral directions, responsive framing and default side view; remove
decorative slogans but retain operations, feedback and accessibility.
Apply verified Axon reference when supplied; no unrelated marketing redesign.
Check desktop and narrow viewport, startup and reset.

## Task 4: validation and review
Run lint, all tests, tsc, build with exact exit codes; preserve baseline failures
and private hosting-config blocker, do not fabricate owner identity config.
Record actual preview, editable source, screenshots and limitations. Fresh
reviewer checks complete diff; fix substantive findings before PR.
Muse cross-family / real-device / 90-point acceptance remains pending.

Review focus: stale React pointer state, two-side text orientation, malicious
import bounds, touch cancellation, focus shortcuts, texture lifecycle and
GLB eligibility, startup framing, restoration and storage failures.
