-- Deduplicate fractional-index `position` values and enforce uniqueness
-- per parent (projectId for task_group, taskGroupId for task, taskId for
-- subtask). Addresses a race in the create/duplicate/complete handlers
-- where concurrent writers read the same "last position" and both compute
-- the same `generateKeyBetween(last, null)` result, leaving duplicate
-- positions that make drag-reorder appear to move tied rows in lockstep.
--
-- Strategy: regenerate ALL positions within each parent partition using
-- ROW_NUMBER() with zero-padded digits ('a00001', 'a00002', ...). The
-- BASE_62_DIGITS set in shared/lib/fractional-index accepts 0-9 as valid
-- characters, so these keys round-trip through `generateKeyBetween`.
-- They sort correctly because they're fixed-width and only digits follow
-- the 'a' prefix.
--
-- Why UPDATE ... FROM (subquery) instead of UPDATE ... SET = (SELECT ...):
-- the subquery form with a correlated SELECT against the CTE risks
-- re-evaluation per outer row against a table whose `position` column is
-- mid-mutation — the ORDER BY inside ROW_NUMBER() would see partially
-- applied writes and could produce non-unique row numbers. UPDATE ... FROM
-- (supported on SQLite >= 3.33; D1 qualifies) materializes the subquery
-- once before the update applies, so ROW_NUMBER() runs against a stable
-- snapshot.
--
-- Ordering by (position, id) makes the partition's ordinal assignment
-- deterministic and stable: `id` is the primary key, so (position, id) is
-- a total order with no ties. Existing visible order is preserved for
-- rows that already had distinct positions; tied rows are broken
-- deterministically by id.

UPDATE task_group
SET position = ranked.new_pos
FROM (
  SELECT id,
    'a' || printf('%05d', ROW_NUMBER() OVER (PARTITION BY projectId ORDER BY position, id)) AS new_pos
  FROM task_group
) AS ranked
WHERE ranked.id = task_group.id;
--> statement-breakpoint

UPDATE task
SET position = ranked.new_pos
FROM (
  SELECT id,
    'a' || printf('%05d', ROW_NUMBER() OVER (PARTITION BY taskGroupId ORDER BY position, id)) AS new_pos
  FROM task
) AS ranked
WHERE ranked.id = task.id;
--> statement-breakpoint

UPDATE subtask
SET position = ranked.new_pos
FROM (
  SELECT id,
    'a' || printf('%05d', ROW_NUMBER() OVER (PARTITION BY taskId ORDER BY position, id)) AS new_pos
  FROM subtask
) AS ranked
WHERE ranked.id = subtask.id;
--> statement-breakpoint

CREATE UNIQUE INDEX `task_group_project_position_unique_idx` ON `task_group` (`projectId`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_group_position_unique_idx` ON `task` (`taskGroupId`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `subtask_task_position_unique_idx` ON `subtask` (`taskId`,`position`);
