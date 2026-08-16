/// <reference types="@cloudflare/workers-types" />
/**
 * Integration tests for the workspace project-creation policy.
 *
 * Real in-memory D1 (Miniflare) and the REAL middleware chain, because the
 * policy IS the middleware chain — a test that called the handler directly
 * would assert nothing about the thing under test.
 *
 * What these pin, and why each one is here rather than assumed:
 *
 * - **Both creation paths enforce it.** `POST /workspaces/:id/projects` is the
 *   obvious one. `POST /projects/:id/duplicate` is the one that makes the
 *   setting real: `createProject` hands its caller project-admin, so a member
 *   who created a project while the toggle was on satisfies
 *   `requireProjectRole("admin")` on it forever. Without the duplicate guard
 *   an admin could turn the setting off and that member would keep minting
 *   projects from their existing one — the toggle would be decorative, and no
 *   test of the create route alone would notice.
 *
 * - **Admins are exempt.** Not a convenience: if the toggle applied to admins,
 *   turning it off would be a one-way door that removes the ability to create
 *   projects from the only people who can turn it back on.
 *
 * - **The default is permissive.** Asserted against a workspace whose `policy`
 *   column was never written, which is every workspace that predates this
 *   feature. This is the regression test for "shipping the toggle silently
 *   locked out every existing member".
 *
 * - **PATCH merges rather than replaces.** The handler merges in SQL
 *   (`json_patch`) specifically so two admins saving different toggles cannot
 *   clobber each other. The merge is asserted through the endpoint because the
 *   race it prevents lives in the read-modify-write the handler is avoiding.
 *
 * - **The wire format is a resolved object.** Every client reads
 *   `workspace.policy.<toggle>` as a plain boolean; if the raw column leaked
 *   through, each of them would need its own copy of the defaults.
 */

import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createProjectSchema, duplicateProjectSchema } from "../../../shared/schemas/project";
import { updateWorkspaceSchema } from "../../../shared/schemas/workspace";
import type { AppEnv } from "../../env";
import {
  requireProjectCreation,
  requireProjectRole,
  requireWorkspaceMember,
  requireWorkspaceRole,
} from "../../middleware/authorize";
import { validateBody } from "../../middleware/validate";
import {
  createTestD1,
  fakeAuth,
  fakeEnv,
  jsonRequest,
  makeTestUser,
  seedProject,
  seedUser,
  seedWorkspace,
  seedWorkspaceMember,
  TEST_USER,
  type TestUserFixture,
} from "../../test-utils";
import { createProject, duplicateProject } from "../projects/projects.handlers";
import { getWorkspace, updateWorkspace } from "./workspaces.handlers";

let d1: D1Database;
let dispose: () => Promise<void>;

/** The workspace owner. */
const OWNER = TEST_USER;
/** An `admin`, to prove the toggle never applies to them. */
const ADMIN = makeTestUser("policy-admin", "Policy Admin");
/** A plain `member` — the only role the toggle governs. */
const MEMBER = makeTestUser("policy-member", "Policy Member");

beforeAll(async () => {
  const created = await createTestD1();
  d1 = created.d1;
  dispose = created.dispose;

  await seedUser(d1, OWNER);
  await seedUser(d1, ADMIN);
  await seedUser(d1, MEMBER);
});

afterAll(async () => {
  await dispose();
});

/**
 * A fresh workspace per test with the three roles seeded.
 *
 * Per-test rather than shared, because half of these tests mutate the policy
 * and a leaked toggle would make the suite order-dependent — the failure mode
 * where a test passes alone and fails in CI.
 */
async function seedPolicyWorkspace(): Promise<string> {
  const workspaceId = await seedWorkspace(d1, OWNER.id);
  await seedWorkspaceMember(d1, workspaceId, ADMIN.id, "admin");
  await seedWorkspaceMember(d1, workspaceId, MEMBER.id, "member");
  return workspaceId;
}

/** Write the stored policy directly, standing in for an admin having set it. */
async function setStoredPolicy(workspaceId: string, policy: unknown): Promise<void> {
  await d1
    .prepare("UPDATE workspace SET policy = ? WHERE id = ?")
    .bind(policy === null ? null : JSON.stringify(policy), workspaceId)
    .run();
}

/**
 * Read a JSON response body at a caller-supplied type.
 *
 * One assertion behind a generic rather than an `as` at each call site: the
 * inline form is what `eslint --fix` strips (it reads the assertion on a
 * `Promise<unknown>` as redundant), which silently turns every body in this
 * file back into `unknown` and breaks the tests project's typecheck. Nothing
 * here for a fixer to remove.
 */
async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Read the raw column, to assert on what was actually persisted. */
async function getStoredPolicy(workspaceId: string): Promise<string | null> {
  const row = await d1
    .prepare("SELECT policy FROM workspace WHERE id = ?")
    .bind(workspaceId)
    .first<{ policy: string | null }>();
  return row?.policy ?? null;
}

/** The create-project route with its real middleware chain. */
function createProjectApp(user: TestUserFixture) {
  const app = new Hono<AppEnv>();
  app.post(
    "/workspaces/:workspaceId/projects",
    fakeEnv(d1),
    fakeAuth(d1, user),
    requireWorkspaceMember(),
    requireProjectCreation(),
    validateBody(createProjectSchema),
    createProject,
  );
  return app;
}

/** The duplicate route with its real middleware chain, in the real order. */
function duplicateProjectApp(user: TestUserFixture) {
  const app = new Hono<AppEnv>();
  app.post(
    "/projects/:projectId/duplicate",
    fakeEnv(d1),
    fakeAuth(d1, user),
    requireProjectRole("admin"),
    requireProjectCreation(),
    validateBody(duplicateProjectSchema),
    duplicateProject,
  );
  return app;
}

/** The workspace PATCH/GET routes with their real role guards. */
function workspaceApp(user: TestUserFixture) {
  const app = new Hono<AppEnv>();
  app.patch(
    "/workspaces/:workspaceId",
    fakeEnv(d1),
    fakeAuth(d1, user),
    requireWorkspaceRole("owner", "admin"),
    validateBody(updateWorkspaceSchema),
    updateWorkspace,
  );
  app.get(
    "/workspaces/:workspaceId",
    fakeEnv(d1),
    fakeAuth(d1, user),
    requireWorkspaceMember(),
    getWorkspace,
  );
  return app;
}

describe("POST /workspaces/:workspaceId/projects — creation policy", () => {
  let workspaceId: string;

  beforeEach(async () => {
    workspaceId = await seedPolicyWorkspace();
  });

  it("lets a member create when the policy column was never written", async () => {
    // The upgrade path: every workspace that existed before this feature has a
    // NULL policy, and must behave exactly as it did before.
    expect(await getStoredPolicy(workspaceId)).toBeNull();

    const res = await createProjectApp(MEMBER).fetch(
      jsonRequest("POST", `/workspaces/${workspaceId}/projects`, { name: "Member Project" }),
    );

    expect(res.status).toBe(201);
  });

  it("lets a member create when the policy explicitly allows it", async () => {
    await setStoredPolicy(workspaceId, { allowMemberProjectCreation: true });

    const res = await createProjectApp(MEMBER).fetch(
      jsonRequest("POST", `/workspaces/${workspaceId}/projects`, { name: "Allowed" }),
    );

    expect(res.status).toBe(201);
  });

  it("refuses a member with 403 when the policy is off", async () => {
    await setStoredPolicy(workspaceId, { allowMemberProjectCreation: false });

    const res = await createProjectApp(MEMBER).fetch(
      jsonRequest("POST", `/workspaces/${workspaceId}/projects`, { name: "Refused" }),
    );

    expect(res.status).toBe(403);
    // The message names the setting's owner. Unlike the membership and PAT
    // guards, there is nothing to conceal here — the caller is a proven member
    // and the policy is their own workspace's visible configuration — so a
    // bare "Forbidden" would only send an integrator hunting for a scope bug.
    const body = await readJson<{ workspace: { policy: unknown } }>(res);
    expect(JSON.stringify(body)).toMatch(/owners and admins/i);
  });

  it("writes no project row when it refuses", async () => {
    await setStoredPolicy(workspaceId, { allowMemberProjectCreation: false });

    await createProjectApp(MEMBER).fetch(
      jsonRequest("POST", `/workspaces/${workspaceId}/projects`, { name: "Refused" }),
    );

    // The guard runs before the handler, so this should be impossible — which
    // is the point of checking. A 403 with a committed row would be the worst
    // outcome available: refused to the caller, created in the database.
    const count = await d1
      .prepare("SELECT COUNT(*) as c FROM project WHERE workspaceId = ?")
      .bind(workspaceId)
      .first<{ c: number }>();
    expect(count?.c).toBe(0);
  });

  it.each([
    ["owner", () => OWNER],
    ["admin", () => ADMIN],
  ])("still lets the %s create while the policy is off", async (_role, getUser) => {
    await setStoredPolicy(workspaceId, { allowMemberProjectCreation: false });

    const res = await createProjectApp(getUser()).fetch(
      jsonRequest("POST", `/workspaces/${workspaceId}/projects`, { name: "Admin Project" }),
    );

    // If this ever fails, turning the setting off has become a one-way door:
    // the people who could turn it back on would be the ones locked out.
    expect(res.status).toBe(201);
  });

  it("falls back to permissive when the stored policy is corrupt", async () => {
    await d1
      .prepare("UPDATE workspace SET policy = ? WHERE id = ?")
      .bind("{not json", workspaceId)
      .run();

    const res = await createProjectApp(MEMBER).fetch(
      jsonRequest("POST", `/workspaces/${workspaceId}/projects`, { name: "Corrupt Policy" }),
    );

    // Documented behaviour, asserted so it stays a decision rather than an
    // accident: a bad row degrades to the default instead of 500-ing the
    // endpoint. Safe here only because this toggle is governance, not
    // containment — admins retain full access to everything members create.
    expect(res.status).toBe(201);
  });

  it("applies each workspace's own policy, not a neighbour's", async () => {
    const otherWorkspaceId = await seedPolicyWorkspace();
    await setStoredPolicy(workspaceId, { allowMemberProjectCreation: false });
    await setStoredPolicy(otherWorkspaceId, { allowMemberProjectCreation: true });

    const refused = await createProjectApp(MEMBER).fetch(
      jsonRequest("POST", `/workspaces/${workspaceId}/projects`, { name: "A" }),
    );
    const allowed = await createProjectApp(MEMBER).fetch(
      jsonRequest("POST", `/workspaces/${otherWorkspaceId}/projects`, { name: "B" }),
    );

    expect(refused.status).toBe(403);
    expect(allowed.status).toBe(201);
  });
});

describe("POST /projects/:projectId/duplicate — the second creation path", () => {
  let workspaceId: string;
  let memberOwnedProjectId: string;

  beforeEach(async () => {
    workspaceId = await seedPolicyWorkspace();

    // The exact situation the guard exists for: a member created a project
    // while the toggle was on, so they hold project-admin on it.
    const created = await createProjectApp(MEMBER).fetch(
      jsonRequest("POST", `/workspaces/${workspaceId}/projects`, { name: "Seeded By Member" }),
    );
    expect(created.status).toBe(201);
    const body = await readJson<{ project: { id: string } }>(created);
    memberOwnedProjectId = body.project.id;
  });

  it("lets the member duplicate their project while the policy is on", async () => {
    const res = await duplicateProjectApp(MEMBER).fetch(
      jsonRequest("POST", `/projects/${memberOwnedProjectId}/duplicate`, { name: "Copy" }),
    );

    expect(res.status).toBe(201);
  });

  it("refuses the duplicate once the policy is turned off, despite project-admin", async () => {
    await setStoredPolicy(workspaceId, { allowMemberProjectCreation: false });

    const res = await duplicateProjectApp(MEMBER).fetch(
      jsonRequest("POST", `/projects/${memberOwnedProjectId}/duplicate`, { name: "Copy" }),
    );

    // THE bypass test. The member still passes `requireProjectRole("admin")`
    // here — that is precisely why the project-role check alone is not enough,
    // and why this route carries the workspace policy too.
    expect(res.status).toBe(403);
  });

  it("creates no copy when it refuses", async () => {
    await setStoredPolicy(workspaceId, { allowMemberProjectCreation: false });

    await duplicateProjectApp(MEMBER).fetch(
      jsonRequest("POST", `/projects/${memberOwnedProjectId}/duplicate`, { name: "Copy" }),
    );

    const count = await d1
      .prepare("SELECT COUNT(*) as c FROM project WHERE workspaceId = ?")
      .bind(workspaceId)
      .first<{ c: number }>();
    expect(count?.c).toBe(1); // only the original
  });

  it("still lets an admin duplicate while the policy is off", async () => {
    await setStoredPolicy(workspaceId, { allowMemberProjectCreation: false });

    const res = await duplicateProjectApp(ADMIN).fetch(
      jsonRequest("POST", `/projects/${memberOwnedProjectId}/duplicate`, { name: "Copy" }),
    );

    // The admin's project access here is elevated from the workspace, and the
    // policy exempts them — the same two rules as the create route, reached
    // through a different guard, so this proves the exemption is not
    // accidentally tied to the `:workspaceId` parameter.
    expect(res.status).toBe(201);
  });

  it("resolves the workspace from the project rather than a route parameter", async () => {
    // The duplicate route has no `:workspaceId`, so the middleware reads the
    // owning workspace from the project access cached by `requireProjectRole`.
    // A project seeded outside the create handler exercises that path with no
    // prior request having populated anything.
    const seededId = await seedProject(d1, workspaceId, { name: "Directly Seeded" });
    await setStoredPolicy(workspaceId, { allowMemberProjectCreation: false });

    const res = await duplicateProjectApp(ADMIN).fetch(
      jsonRequest("POST", `/projects/${seededId}/duplicate`, { name: "Copy" }),
    );

    expect(res.status).toBe(201);
  });
});

describe("PATCH /workspaces/:workspaceId — policy updates", () => {
  let workspaceId: string;

  beforeEach(async () => {
    workspaceId = await seedPolicyWorkspace();
  });

  it("persists a policy change made by an admin", async () => {
    const res = await workspaceApp(ADMIN).fetch(
      jsonRequest("PATCH", `/workspaces/${workspaceId}`, {
        policy: { allowMemberProjectCreation: false },
      }),
    );

    expect(res.status).toBe(200);
    const body = await readJson<{ workspace: { policy: { allowMemberProjectCreation: boolean } } }>(res);
    expect(body.workspace.policy.allowMemberProjectCreation).toBe(false);
    expect(JSON.parse((await getStoredPolicy(workspaceId)) ?? "{}")).toMatchObject({
      allowMemberProjectCreation: false,
    });
  });

  it("takes effect on the very next create attempt", async () => {
    await workspaceApp(ADMIN).fetch(
      jsonRequest("PATCH", `/workspaces/${workspaceId}`, {
        policy: { allowMemberProjectCreation: false },
      }),
    );

    const res = await createProjectApp(MEMBER).fetch(
      jsonRequest("POST", `/workspaces/${workspaceId}/projects`, { name: "After Toggle" }),
    );

    // End-to-end through the real write path, not a hand-written column. The
    // settings screen's promise is that the switch applies now.
    expect(res.status).toBe(403);
  });

  it("merges into the stored policy instead of replacing it", async () => {
    // A key from a future (or concurrent) deploy must survive a patch that
    // does not mention it — this is what makes the SQL-side merge worth having
    // over read-modify-write in the handler.
    await setStoredPolicy(workspaceId, {
      allowMemberProjectCreation: true,
      someOtherToggle: true,
    });

    await workspaceApp(ADMIN).fetch(
      jsonRequest("PATCH", `/workspaces/${workspaceId}`, {
        policy: { allowMemberProjectCreation: false },
      }),
    );

    const stored = JSON.parse((await getStoredPolicy(workspaceId)) ?? "{}") as Record<string, unknown>;
    expect(stored.allowMemberProjectCreation).toBe(false);
    expect(stored.someOtherToggle).toBe(true);
  });

  it("merges into a NULL column without losing the update", async () => {
    expect(await getStoredPolicy(workspaceId)).toBeNull();

    await workspaceApp(ADMIN).fetch(
      jsonRequest("PATCH", `/workspaces/${workspaceId}`, {
        policy: { allowMemberProjectCreation: false },
      }),
    );

    // `json_patch(NULL, ...)` returns NULL, which would silently discard the
    // admin's change — the `coalesce` in the handler is what prevents it, and
    // this is the test that would catch its removal.
    expect(JSON.parse((await getStoredPolicy(workspaceId)) ?? "{}")).toMatchObject({
      allowMemberProjectCreation: false,
    });
  });

  it("leaves the policy untouched when a request updates only other fields", async () => {
    await setStoredPolicy(workspaceId, { allowMemberProjectCreation: false });

    await workspaceApp(ADMIN).fetch(
      jsonRequest("PATCH", `/workspaces/${workspaceId}`, { name: "Renamed Workspace" }),
    );

    // Renaming a workspace must not quietly re-enable member project creation.
    expect(JSON.parse((await getStoredPolicy(workspaceId)) ?? "{}")).toMatchObject({
      allowMemberProjectCreation: false,
    });
  });

  it("rejects an unknown policy key rather than silently dropping it", async () => {
    const res = await workspaceApp(ADMIN).fetch(
      jsonRequest("PATCH", `/workspaces/${workspaceId}`, {
        policy: { allowMemberProjektCreation: false },
      }),
    );

    // A typo that returned 200 would leave an admin certain they had changed a
    // setting that is still on — worse than an error, because they stop
    // looking.
    expect(res.status).toBe(400);
  });

  it("refuses a plain member's attempt to change the policy", async () => {
    const res = await workspaceApp(MEMBER).fetch(
      jsonRequest("PATCH", `/workspaces/${workspaceId}`, {
        policy: { allowMemberProjectCreation: true },
      }),
    );

    // The governance setting must not be editable by the role it governs.
    expect(res.status).toBe(403);
  });
});

describe("GET /workspaces/:workspaceId — policy on the wire", () => {
  it("returns a fully-resolved policy object for a never-configured workspace", async () => {
    const workspaceId = await seedPolicyWorkspace();

    const res = await workspaceApp(MEMBER).fetch(
      jsonRequest("GET", `/workspaces/${workspaceId}`),
    );
    const body = await readJson<{ workspace: { policy: unknown } }>(res);

    // Never the raw column and never null: the client reads a boolean, so it
    // never needs its own copy of the defaults to interpret the response.
    expect(body.workspace.policy).toEqual({ allowMemberProjectCreation: true });
  });

  it("reflects a stored policy", async () => {
    const workspaceId = await seedPolicyWorkspace();
    await setStoredPolicy(workspaceId, { allowMemberProjectCreation: false });

    const res = await workspaceApp(MEMBER).fetch(
      jsonRequest("GET", `/workspaces/${workspaceId}`),
    );
    const body = await readJson<{ workspace: { policy: unknown } }>(res);

    expect(body.workspace.policy).toEqual({ allowMemberProjectCreation: false });
  });

  it("resolves a corrupt column to the defaults rather than failing the request", async () => {
    const workspaceId = await seedPolicyWorkspace();
    await d1
      .prepare("UPDATE workspace SET policy = ? WHERE id = ?")
      .bind("{not json", workspaceId)
      .run();

    const res = await workspaceApp(MEMBER).fetch(
      jsonRequest("GET", `/workspaces/${workspaceId}`),
    );

    // This endpoint is what every workspace route blocks on. A throw in the
    // resolver would take the whole tenant's UI down over one bad row.
    expect(res.status).toBe(200);
    const body = await readJson<{ workspace: { policy: unknown } }>(res);
    expect(body.workspace.policy).toEqual({ allowMemberProjectCreation: true });
  });
});
