# Drizzle Query Examples

### Select all rows

```ts
const db = createDb(c.env.DB);
const allUsers = await db.select().from(user);
```

### Select with filter

```ts
import { eq } from "drizzle-orm";

const result = await db
  .select()
  .from(user)
  .where(eq(user.email, "test@example.com"));
```

### Select specific columns

```ts
const names = await db
  .select({ id: user.id, name: user.name })
  .from(user);
```

### Insert a row

```ts
await db.insert(user).values({
  id: "user_123",
  name: "Alice",
  email: "alice@example.com",
  createdAt: new Date(),
  updatedAt: new Date(),
});
```

### Update a row

```ts
import { eq } from "drizzle-orm";

await db
  .update(user)
  .set({ name: "Alice Smith", updatedAt: new Date() })
  .where(eq(user.id, "user_123"));
```

### Delete a row

```ts
import { eq } from "drizzle-orm";

await db.delete(user).where(eq(user.id, "user_123"));
```

### Relational queries (using the query API)

Because the schema is passed to `drizzle()`, you can use the relational query builder:

```ts
const db = createDb(c.env.DB);

// Find a user with their sessions
const result = await db.query.user.findFirst({
  where: eq(user.id, "user_123"),
  with: {
    sessions: true,
  },
});
```

> **Note:** For relational queries with `with`, you need to define `relations` in your schema using Drizzle's `relations()` helper. The current auth schema relies on foreign key constraints but does not yet export explicit Drizzle relations objects. If you need the `with` API, add relations to the schema file.

### Join example

```ts
import { eq } from "drizzle-orm";

const usersWithSessions = await db
  .select({
    userName: user.name,
    sessionToken: session.token,
    expiresAt: session.expiresAt,
  })
  .from(user)
  .innerJoin(session, eq(user.id, session.userId));
```

### Count

```ts
import { count } from "drizzle-orm";

const [result] = await db.select({ total: count() }).from(user);
console.log(result.total);
```

### Batch multiple queries

Use `db.batch()` to send multiple independent queries in a single D1 round-trip. This is the preferred pattern when a handler needs several lookups before it can proceed:

```ts
const [taskResult, labelResult, [{ value: labelCount }]] = await db.batch([
  db.select({ id: task.id, projectId: task.projectId })
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1),
  db.select({ id: label.id, name: label.name })
    .from(label)
    .where(eq(label.id, labelId))
    .limit(1),
  db.select({ value: count() })
    .from(taskLabel)
    .where(eq(taskLabel.taskId, taskId)),
] as const);

const foundTask = taskResult[0]; // may be undefined
```

> **`as const`** — Always add `as const` to the batch array so TypeScript can infer the correct tuple types for each result.

#### SQL aliases in batch queries

When a batch query joins tables that share column names (e.g., `task.id` and `project.id`), D1's result mapping can collide. Use `.as()` to disambiguate:

```ts
const overdueQuery = db
  .select({
    id: sql<string>`${task.id}`.as("task_id"),
    title: task.title,
    projectId: sql<string>`${project.id}`.as("proj_id"),
    projectName: sql<string>`${project.name}`.as("proj_name"),
  })
  .from(task)
  .innerJoin(project, eq(task.projectId, project.id));
```

### Delete or update with returning

Use `.returning()` to combine a mutation with a lookup in a single query, avoiding a separate SELECT:

```ts
const [deleted] = await db
  .delete(notification)
  .where(and(eq(notification.id, id), eq(notification.userId, userId)))
  .returning({ id: notification.id });

if (!deleted) {
  return c.json({ error: "Notification not found" }, 404);
}
```
