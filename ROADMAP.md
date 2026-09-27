# puregantt contribution roadmap

Build something you can see and try in the app. The first five items are **good first contributions**: bounded changes with a concrete demonstration. Choose a feature below, fix a bug, or propose your own improvement.

## Scope

Keep the task timeline, existing phases, owners, progress and dependency model; avoid introducing a new scheduling system.

Size describes scope, not a promised completion time: **Small** = one focused interface change; **Medium** = coordinated interface/state work; **Large** = a feature across several flows, storage or export paths. All items are proposals, not claims that existing features are absent. Check the current code and extend what is there. Maintainers review code and tests before merging. Attribution is your choice.

## Good first contributions

1. **See a task’s duration on its timeline bar.** Add the date-span duration to task tooltips using the same day-count convention as the current timeline.
   <!-- contribution: {"id": "task-duration-tooltip", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/task-duration-tooltip.md"} -->
   [Small · Good first contribution · Implementation brief](docs/contributions/task-duration-tooltip.md)

2. **Read long task names in short bars.** Keep full task names available on focus and hover when labels are clipped by narrow columns or short bars.
   <!-- contribution: {"id": "long-task-name-access", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/long-task-name-access.md"} -->
   [Small · Good first contribution · Implementation brief](docs/contributions/long-task-name-access.md)

3. **Clear an owner filter in one click.** Make an active owner filter visible beside its control and offer a one-click reset when no tasks match.
   <!-- contribution: {"id": "owner-filter-reset", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/owner-filter-reset.md"} -->
   [Small · Good first contribution · Implementation brief](docs/contributions/owner-filter-reset.md)

4. **Find today on a busy timeline.** Keep the today marker distinct from task bars and include its full date in an accessible label across supported zoom levels.
   <!-- contribution: {"id": "today-marker-readability", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/today-marker-readability.md"} -->
   [Small · Good first contribution · Implementation brief](docs/contributions/today-marker-readability.md)

5. **Choose a sample plan from a useful preview.** Show a short description and task count for each existing sample and reinforce that selecting it opens a new draft.
   <!-- contribution: {"id": "sample-plan-labels", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/sample-plan-labels.md"} -->
   [Small · Good first contribution · Implementation brief](docs/contributions/sample-plan-labels.md)

## More improvements

6. **Correct task dates without losing your edits.** Explain invalid or reversed task dates beside the edited fields and retain the draft values until corrected.
   <!-- contribution: {"id": "task-date-validation-messages", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/task-date-validation-messages.md"} -->
   [Small · Implementation brief](docs/contributions/task-date-validation-messages.md)

7. **Preview dates while dragging a task.** Show the proposed start and end dates beside the task during a move or resize, before committing the existing drag operation.
   <!-- contribution: {"id": "drag-date-preview", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/drag-date-preview.md"} -->
   [Medium · Implementation brief](docs/contributions/drag-date-preview.md)

8. **Enter progress as a percentage.** Label progress as a percentage and give clear feedback for values outside the supported range rather than silently accepting them.
   <!-- contribution: {"id": "progress-range-guidance", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/progress-range-guidance.md"} -->
   [Small · Implementation brief](docs/contributions/progress-range-guidance.md)

9. **Read the same phase names everywhere.** Use the same readable phase names in the task row, phase picker and summary so internal keys never leak into one view.
   <!-- contribution: {"id": "phase-label-consistency", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/phase-label-consistency.md"} -->
   [Small · Implementation brief](docs/contributions/phase-label-consistency.md)

10. **Add a task to an empty phase.** Explain when a visible phase has no tasks and offer the existing add-task action with that phase selected.
   <!-- contribution: {"id": "phase-empty-state-guidance", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/phase-empty-state-guidance.md"} -->
   [Small · Implementation brief](docs/contributions/phase-empty-state-guidance.md)

11. **See which tasks form a dependency cycle.** When a link would create a cycle, name the tasks in the detected cycle rather than showing only a generic rejection.
   <!-- contribution: {"id": "dependency-cycle-explanation", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/dependency-cycle-explanation.md"} -->
   [Medium · Implementation brief](docs/contributions/dependency-cycle-explanation.md)

12. **Recognise an existing dependency.** Explain that two tasks are already linked when the user repeats a dependency gesture, leaving the existing link unchanged.
   <!-- contribution: {"id": "duplicate-dependency-feedback", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/duplicate-dependency-feedback.md"} -->
   [Medium · Implementation brief](docs/contributions/duplicate-dependency-feedback.md)

13. **Inspect both ends of a dependency.** Show both task names and dates on a dependency connection so a crowded timeline is easier to inspect.
   <!-- contribution: {"id": "dependency-hover-context", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/dependency-hover-context.md"} -->
   [Medium · Implementation brief](docs/contributions/dependency-hover-context.md)

14. **See which links a task deletion affects.** List the number of incoming and outgoing links affected before removing a task, using the existing delete confirmation path.
   <!-- contribution: {"id": "delete-dependency-impact", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/delete-dependency-impact.md"} -->
   [Medium · Implementation brief](docs/contributions/delete-dependency-impact.md)

15. **Jump to a task outside the visible dates.** After editing a task outside the visible date range, offer a jump-to-task action instead of unexpectedly moving the viewport.
   <!-- contribution: {"id": "selected-task-visibility", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/selected-task-visibility.md"} -->
   [Medium · Implementation brief](docs/contributions/selected-task-visibility.md)

16. **Adjust task dates from the keyboard.** Offer small, explicit keyboard-accessible date-step controls in task editing, using the same validation as drag changes.
   <!-- contribution: {"id": "keyboard-date-adjustments", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/keyboard-date-adjustments.md"} -->
   [Medium · Implementation brief](docs/contributions/keyboard-date-adjustments.md)

17. **Avoid duplicate owner names caused by spaces.** Trim accidental leading and trailing spaces when committing owner names so visually identical owners do not create separate filter entries.
   <!-- contribution: {"id": "owner-name-trimming", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/owner-name-trimming.md"} -->
   [Small · Implementation brief](docs/contributions/owner-name-trimming.md)

18. **Understand the plan’s overview counts.** Clarify whether overview counts reflect all tasks or the filtered view, and label completed and overdue counts consistently.
   <!-- contribution: {"id": "overview-count-explanations", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/overview-count-explanations.md"} -->
   [Small · Implementation brief](docs/contributions/overview-count-explanations.md)

19. **Choose a useful timeline zoom.** Add short explanations to fit, detail and wide view choices, preserving the current timeline navigation model.
   <!-- contribution: {"id": "zoom-mode-descriptions", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/zoom-mode-descriptions.md"} -->
   [Small · Implementation brief](docs/contributions/zoom-mode-descriptions.md)

20. **Retry saving without losing the timeline.** Keep an unsaved timeline visible after a write error, show the document name and provide an explicit retry without discarding edits.
   <!-- contribution: {"id": "save-failure-continuity", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/save-failure-continuity.md"} -->
   [Medium · Implementation brief](docs/contributions/save-failure-continuity.md)

21. **Compare your plan with a saved baseline.** Let users capture a named schedule baseline and show ghost bars plus date deltas beside the current plan. Baselines are comparison data, not automatic rescheduling.
   <!-- contribution: {"id": "compare-your-plan-with-a-saved-baseline", "size": "large", "goodFirstIssue": false, "guide": "docs/contributions/compare-your-plan-with-a-saved-baseline.md"} -->
   [Large · Implementation brief](docs/contributions/compare-your-plan-with-a-saved-baseline.md)

## References

- [Contribution brief index](docs/contributions/README.md)
- [App guide](docs/app-guide.md)
- [Development guide](docs/development.md)
- [Contributing](CONTRIBUTING.md)
