# puregantt roadmap

## Scope

Keep the task timeline, existing phases, owners, progress and dependency model; avoid introducing a new scheduling system.

These are proposed, incremental improvements, not a release schedule or a list of missing core features. Keep each change small and preserve existing file formats, user data and app workflows.

## Improvements

1. **Task date validation messages.** Explain invalid or reversed task dates beside the edited fields and retain the draft values until corrected.

2. **Drag date preview.** Show the proposed start and end dates beside the task during a move or resize, before committing the existing drag operation.

3. **Task duration tooltip.** Add the date-span duration to task tooltips using the same day-count convention as the current timeline.

4. **Progress range guidance.** Label progress as a percentage and give clear feedback for values outside the supported range rather than silently accepting them.

5. **Long task name access.** Keep full task names available on focus and hover when labels are clipped by narrow columns or short bars.

6. **Owner filter reset.** Make an active owner filter visible beside its control and offer a one-click reset when no tasks match.

7. **Phase label consistency.** Use the same readable phase names in the task row, phase picker and summary so internal keys never leak into one view.

8. **Phase empty-state guidance.** Explain when a visible phase has no tasks and offer the existing add-task action with that phase selected.

9. **Dependency cycle explanation.** When a link would create a cycle, name the tasks in the detected cycle rather than showing only a generic rejection.

10. **Duplicate dependency feedback.** Explain that two tasks are already linked when the user repeats a dependency gesture, leaving the existing link unchanged.

11. **Dependency hover context.** Show both task names and dates on a dependency connection so a crowded timeline is easier to inspect.

12. **Delete dependency impact.** List the number of incoming and outgoing links affected before removing a task, using the existing delete confirmation path.

13. **Today marker readability.** Keep the today marker distinct from task bars and include its full date in an accessible label across supported zoom levels.

14. **Selected task visibility.** After editing a task outside the visible date range, offer a jump-to-task action instead of unexpectedly moving the viewport.

15. **Keyboard date adjustments.** Offer small, explicit keyboard-accessible date-step controls in task editing, using the same validation as drag changes.

16. **Owner name trimming.** Trim accidental leading and trailing spaces when committing owner names so visually identical owners do not create separate filter entries.

17. **Overview count explanations.** Clarify whether overview counts reflect all tasks or the filtered view, and label completed and overdue counts consistently.

18. **Zoom mode descriptions.** Add short explanations to fit, detail and wide view choices, preserving the current timeline navigation model.

19. **Sample plan labels.** Show a short description and task count for each existing sample and reinforce that selecting it opens a new draft.

20. **Save failure continuity.** Keep an unsaved timeline visible after a write error, show the document name and provide an explicit retry without discarding edits.

## References

- [App guide](docs/app-guide.md)
- [Development guide](docs/development.md)
- [Current implementation](src/components/GanttWorkspace.tsx)
