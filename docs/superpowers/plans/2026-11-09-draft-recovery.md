# Draft persistence reliability — #73 D2/D4

Base: 112f4a26b95cda32a077ceca3210282ff663fa2a.
Authority: user requested merge first, then continue remaining issues. #67 and
#74 have now merged. This increment addresses the existing save-loss findings,
with no new database, dependency or production configuration.

1. Add a bounded local-only image-deduplicating codec. In-memory Project and
portable v1 JSON exports stay unchanged; existing local v1 drafts still restore.
2. Separate unreadable-old-draft protection from retriable write failure.
Keep the stored record intact on failure; show saved/pending/unsaved state and
a retry action. Later smaller edits can save successfully without reopening.
Only a valid deliberate import can replace an unreadable old draft.
3. Keep 500ms debounce, but flush latest committed state on pagehide, hidden
visibility and true unmount. Avoid writing the preceding state on every edit.
4. Test legacy/compact roundtrip, dedup, invalid/missing references and decoded
limits; test quota failure/retry, smaller edit recovery, corrupt preservation,
latest-before-debounce flush and lifecycle cleanup. Verify actual UI save/reopen.

Work split: agent owns wrap-draft.ts plus its tests; root owns persistence
controller, component integration, controller tests and final verification.
Fresh reviewer checks final diff after implementation. Muse's broader visual
and real-phone acceptance stays separate; this change does not close D1/D3/D5/D6.
