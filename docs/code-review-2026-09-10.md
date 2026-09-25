# PureGantt code review — 2026-09-10

Baseline: own remote main 546df9cbf01f44cf6b2f90272579251034902d83, freshly fetched and matched before review. Source: suite architecture/bridge/lifecycle docs and app implementation. Submodule-only changes.

## Fixed

- Exact task IDs take precedence over matching names, preventing edits/deletes of the wrong task. Ambiguous names no longer pick the first task.
- Reject invalid create/update batch members before any mutation; formerly null/numeric entries were skipped and the tool claimed success.
- Reject unsupported document schema versions before adoption/autosave.
- Normalize reversed saved task ranges to one day, consistent with the existing invalid-end fallback.

## Verification

Seven focused checks in src/lib/codeReview.test.ts passed (six reproduced failures before fixes). App typecheck passed. No full suite or new Electron UI run.

## Coverage and follow-up

Read document/date/dependency/path/transition helpers, App lifecycle, boot/bridge, agent hook/catalog/handlers; inspected workspace timeline, editing and dependency paths. Not every rendering/style line was reviewed.

Remaining app concerns:
- Parser deliberately drops invalid-start tasks and accepts empty objects; a future import-repair preview should expose dropped data before adoption.
- Duplicate stored task IDs remain ambiguous; validate rather than silently rename dependency targets.
- The hook holds a render snapshot even though App's updater uses a live ref. Batch validation/ID allocation should read live state before every call.
- Very long timelines generate daily weekend/tick arrays and large DOMs; add viewport rendering and bounded data handling.
- UI text dependency edits allow unknown task IDs; align validation with drawer rules while preserving draft typing.
- Name ambiguity errors should explicitly request an ID.

No shell implementation changed. These checks do not establish mission completion or all UI behavior.
