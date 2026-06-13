import { asc, eq } from "drizzle-orm";
import type { Context } from "hono";

import { user as userTable } from "../../../db/schema/auth";
import { label, taskLabel } from "../../../db/schema/label";
import { project } from "../../../db/schema/project";
import { task, taskGroup } from "../../../db/schema/task";
import type { AppEnv } from "../../env";
import { toCsv } from "../../lib/csv";
import { errorResponse } from "../../lib/error-response";
import { requireParam } from "../../lib/params";

/**
 * Column set for the per-project CSV export. Declared `as const` at module
 * level so the header literals flow into `toCsv`'s `const H` generic — a row
 * missing a column (or typo-ing a key) is a compile error, not a silently
 * empty cell in someone's spreadsheet.
 */
const CSV_HEADERS = [
  "title",
  "group",
  "assignee_email",
  "due_date",
  "priority",
  "labels",
  "completed",
  "cost",
] as const;

/**
 * Render integer cents as decimal currency units (1050 → "10.50").
 *
 * WHY a string and not a number: `toCsv` stringifies numbers via `String()`,
 * which collapses `10.50` to `"10.5"` — losing the fixed two-decimal currency
 * formatting users expect when summing a cost column. Formatting here with
 * integer math (no float division) guarantees exact cents and a stable
 * `D+.DD` shape.
 *
 * WHY routing the result through toCsv's STRING path is safe: string cells
 * are subject to formula-injection hardening, but a cost string always starts
 * with a digit (the shared task schema enforces `cost >= 0`), so the hardener
 * never fires and the cell stays a spreadsheet-summable numeric literal. The
 * sign handling below is purely defensive — if a negative ever slipped past
 * the schema, the hardener would render it as literal text rather than let a
 * leading `-` be parsed as a formula, which is the correct failure mode.
 */
function formatCostCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * `GET /projects/:projectId/export/csv` — flat CSV of every task in the
 * project, in board reading order (group position, then task position).
 *
 * WHY any project member — including viewers — may export
 * (`requireProjectAccess()` at the route, no role check here): viewers can
 * already read every exported field through the task list API, so gating the
 * CSV behind a higher role would be security theater, not a control. The
 * export contains nothing a viewer cannot see one request at a time.
 *
 * WHY the injection-hardening integration matters at THIS layer: `title`,
 * `group`, and `labels` are user-controlled strings, and a task titled
 * `=HYPERLINK(...)` would execute as a formula on the machine of whoever
 * opens the export. They are deliberately passed to `toCsv` as RAW strings so
 * the lib's OWASP `'`-prefix hardening applies; the tests pin a `=`-leading
 * title arriving hardened end-to-end so a refactor cannot silently bypass
 * the lib (e.g. by pre-concatenating cells). `cost` is the one formatted
 * string (see {@link formatCostCents}); `completed` stays a boolean —
 * typed, non-injectable, exempt from hardening by design.
 *
 * Data access is a single `db.batch` (one D1 subrequest — the same budget
 * discipline as the workspace export): project name for the filename, tasks
 * joined to their group (name/order) and assignee (email), and the
 * task↔label pairs joined through `task` to scope by project. Joining in SQL
 * rather than selecting raw tables keeps the handler free of per-row lookup
 * maps for everything except labels, which are 1:N per task.
 */
export async function exportProjectCsv(c: Context<AppEnv>) {
  const projectId = requireParam(c, "projectId");
  const db = c.get("db");

  const [projectRows, taskRows, labelRows] = await db.batch([
    db
      .select({ name: project.name })
      .from(project)
      .where(eq(project.id, projectId))
      .limit(1),
    db
      .select({
        id: task.id,
        title: task.title,
        groupName: taskGroup.name,
        assigneeEmail: userTable.email,
        dueDate: task.dueDate,
        priority: task.priority,
        completed: task.completed,
        cost: task.cost,
      })
      .from(task)
      .innerJoin(taskGroup, eq(task.taskGroupId, taskGroup.id))
      .leftJoin(userTable, eq(task.assigneeId, userTable.id))
      .where(eq(task.projectId, projectId))
      .orderBy(asc(taskGroup.position), asc(task.position)),
    db
      .select({ taskId: taskLabel.taskId, name: label.name })
      .from(taskLabel)
      .innerJoin(label, eq(taskLabel.labelId, label.id))
      .innerJoin(task, eq(taskLabel.taskId, task.id))
      .where(eq(task.projectId, projectId))
      .orderBy(asc(label.name)),
  ] as const);

  // Defensive: requireProjectAccess() already 404s missing projects, but the
  // handler must not synthesize a CSV for a project that vanished between
  // middleware and batch (or when mounted without middleware in tests).
  const projectRow = projectRows[0];
  if (!projectRow) return errorResponse(c, "Project not found", 404);

  // Labels per task, pre-sorted by name via the ORDER BY above so the
  // `;`-joined cell is deterministic regardless of assignment order.
  const labelsByTask = new Map<string, string[]>();
  for (const row of labelRows) {
    const names = labelsByTask.get(row.taskId);
    if (names) {
      names.push(row.name);
    } else {
      labelsByTask.set(row.taskId, [row.name]);
    }
  }

  const csv = toCsv(
    CSV_HEADERS,
    taskRows.map((t) => ({
      // Raw user-controlled strings — MUST stay strings so toCsv hardens them.
      title: t.title,
      group: t.groupName,
      assignee_email: t.assigneeEmail, // null (unassigned) → empty cell
      // Repo date convention: dueDate is a UTC-midnight timestamp; the date
      // portion of the ISO string is the canonical YYYY-MM-DD rendering.
      due_date: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
      priority: t.priority,
      labels: labelsByTask.get(t.id)?.join(";") ?? "",
      completed: t.completed, // boolean → "true"/"false", exempt from hardening
      cost: t.cost === null ? null : formatCostCents(t.cost),
    })),
  );

  // Same header-injection sanitation as the uploads serve endpoint, plus path
  // separators: CR/LF/quote/backslash could break out of the quoted filename
  // parameter; slashes confuse user agents that map the name to a path.
  const safeName = projectRow.name.replace(/[\r\n"\\/]/g, "_").trim() || "tasks";

  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${safeName}.csv"`);
  return c.body(csv);
}
