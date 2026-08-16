/**
 * Unit tests for workspace policy resolution.
 *
 * Why these matter: `resolveWorkspacePolicy` is the ONLY place the defaults
 * for a workspace's governance toggles live, and it stands between a free-form
 * JSON column and an authorization decision. Two properties have to hold or
 * the "defaults in code, nothing backfilled" design silently stops working:
 *
 *  1. **Absence resolves to the default, at every granularity.** A NULL column,
 *     an empty object, and an object missing one key must all produce the same
 *     answer for that key. This is what lets a new toggle ship without a
 *     migration touching a single existing row — and it is exactly the property
 *     that a "clever" future refactor (returning the parsed object directly,
 *     say) would break without failing any test that only checks the happy path.
 *
 *  2. **It is total.** Every malformed shape resolves rather than throwing,
 *     because this function runs inside `getWorkspace` — the query every
 *     workspace route blocks on. A throw here is a tenant-wide outage, so the
 *     malformed cases below are not paranoia about hand-edited databases; they
 *     pin the blast radius of one bad row to "that row uses the defaults".
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORKSPACE_POLICY,
  resolveWorkspacePolicy,
  WORKSPACE_POLICY_KEYS,
} from "./workspace-policy";

describe("DEFAULT_WORKSPACE_POLICY", () => {
  it("allows member project creation, preserving the behaviour every existing workspace had", () => {
    // Not a style preference. Before this feature every workspace member could
    // create projects, so any other default would silently change the
    // behaviour of every deployed workspace on upgrade — a migration disguised
    // as a constant.
    expect(DEFAULT_WORKSPACE_POLICY.allowMemberProjectCreation).toBe(true);
  });

  it("exposes a key list that covers every field of the defaults", () => {
    // The resolver iterates WORKSPACE_POLICY_KEYS. If a toggle were added to
    // the interface and the defaults but the key list drifted, that toggle
    // would silently ignore its stored value and always read as the default.
    expect([...WORKSPACE_POLICY_KEYS].sort()).toEqual(
      Object.keys(DEFAULT_WORKSPACE_POLICY).sort(),
    );
  });
});

describe("resolveWorkspacePolicy — absence means default", () => {
  it("resolves null (never configured) to the defaults", () => {
    expect(resolveWorkspacePolicy(null)).toEqual(DEFAULT_WORKSPACE_POLICY);
  });

  it("resolves undefined to the defaults", () => {
    expect(resolveWorkspacePolicy(undefined)).toEqual(DEFAULT_WORKSPACE_POLICY);
  });

  it("resolves an empty string to the defaults", () => {
    expect(resolveWorkspacePolicy("")).toEqual(DEFAULT_WORKSPACE_POLICY);
  });

  it("resolves an empty object to the defaults", () => {
    expect(resolveWorkspacePolicy("{}")).toEqual(DEFAULT_WORKSPACE_POLICY);
  });

  it("fills a missing key from the defaults while honouring the keys present", () => {
    // The forward-compatibility case, stated as a test: a row written when the
    // policy had fewer toggles must keep working, with the new toggle at its
    // code default. `{}` standing in for "a row from before this key existed".
    const resolved = resolveWorkspacePolicy(JSON.stringify({}));
    expect(resolved.allowMemberProjectCreation).toBe(
      DEFAULT_WORKSPACE_POLICY.allowMemberProjectCreation,
    );
  });
});

describe("resolveWorkspacePolicy — stored values win", () => {
  it("honours an explicit false", () => {
    expect(resolveWorkspacePolicy('{"allowMemberProjectCreation":false}')).toEqual({
      allowMemberProjectCreation: false,
    });
  });

  it("honours an explicit true", () => {
    expect(resolveWorkspacePolicy('{"allowMemberProjectCreation":true}')).toEqual({
      allowMemberProjectCreation: true,
    });
  });

  it("ignores keys it does not know about", () => {
    // A key from a newer deploy, or a hand-edit. It must not leak into the
    // resolved object: callers destructure this and an unexpected key that
    // shadows nothing is harmless, but one that collides with a future toggle
    // name would resurrect a setting nobody set.
    const resolved = resolveWorkspacePolicy(
      '{"allowMemberProjectCreation":false,"somethingFromTheFuture":true}',
    );
    expect(resolved).toEqual({ allowMemberProjectCreation: false });
  });

  it("returns a fresh object each call so callers cannot mutate the shared defaults", () => {
    const first = resolveWorkspacePolicy(null);
    first.allowMemberProjectCreation = false;
    // If the defaults were returned by reference, this second call would come
    // back false and one request would have permanently changed the policy of
    // every workspace in the isolate.
    expect(resolveWorkspacePolicy(null).allowMemberProjectCreation).toBe(true);
    expect(DEFAULT_WORKSPACE_POLICY.allowMemberProjectCreation).toBe(true);
  });
});

describe("resolveWorkspacePolicy — total over malformed input", () => {
  // Each of these would be a 500 on the workspace detail endpoint if the
  // resolver threw, taking down every route in the workspace.
  it.each([
    ["invalid JSON", "{not json"],
    ["a bare string", '"nope"'],
    ["a number", "42"],
    ["a boolean", "true"],
    ["null literal", "null"],
    ["an array", '["allowMemberProjectCreation"]'],
  ])("resolves %s to the defaults without throwing", (_label, stored) => {
    expect(() => resolveWorkspacePolicy(stored)).not.toThrow();
    expect(resolveWorkspacePolicy(stored)).toEqual(DEFAULT_WORKSPACE_POLICY);
  });

  it.each([
    ["a string", '{"allowMemberProjectCreation":"false"}'],
    ["a number", '{"allowMemberProjectCreation":0}'],
    ["null", '{"allowMemberProjectCreation":null}'],
    ["an object", '{"allowMemberProjectCreation":{"value":false}}'],
  ])("falls back to the default when a key holds %s", (_label, stored) => {
    // Deliberately NOT truthiness-coerced. `"false"` and `0` are the two
    // values a sloppy writer produces, and coercion would read them as
    // opposite booleans — one of which silently disables a setting the admin
    // never touched.
    expect(resolveWorkspacePolicy(stored).allowMemberProjectCreation).toBe(true);
  });

  it("keeps valid keys when an unrelated key is malformed", () => {
    // Per-key fallback rather than whole-object. With one toggle this is hard
    // to observe, so it is asserted through the unknown-key path: a bad
    // neighbour must not discard a good value.
    const resolved = resolveWorkspacePolicy(
      '{"allowMemberProjectCreation":false,"futureToggle":"garbage"}',
    );
    expect(resolved.allowMemberProjectCreation).toBe(false);
  });
});
