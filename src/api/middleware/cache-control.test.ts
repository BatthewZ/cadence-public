import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { AppEnv } from "../env";
import { cacheControl, noStoreCacheControl } from "./cache-control";

describe("cacheControl middleware", () => {
  function createApp(maxAge: number) {
    const app = new Hono<AppEnv>();
    app.use("*", cacheControl(maxAge));
    app.get("/ok", (c) => c.json({ ok: true }));
    app.get("/not-found", (c) => c.json({ error: "not found" }, 404));
    app.get("/server-error", (c) => c.json({ error: "boom" }, 500));
    app.post("/create", (c) => c.json({ created: true }, 201));
    app.patch("/update", (c) => c.json({ updated: true }));
    app.delete("/remove", (c) => c.json({ deleted: true }));
    return app;
  }

  it("adds Cache-Control header to successful GET responses", async () => {
    const app = createApp(300);
    const res = await app.request("/ok");

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
  });

  it("uses the provided maxAge value", async () => {
    const app = createApp(30);
    const res = await app.request("/ok");

    expect(res.headers.get("Cache-Control")).toBe("private, max-age=30");
  });

  it("does not add Cache-Control to 404 GET responses", async () => {
    const app = createApp(300);
    const res = await app.request("/not-found");

    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBeNull();
  });

  it("does not add Cache-Control to 500 GET responses", async () => {
    const app = createApp(300);
    const res = await app.request("/server-error");

    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBeNull();
  });

  it("does not add Cache-Control to POST responses", async () => {
    const app = createApp(300);
    const res = await app.request("/create", { method: "POST" });

    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBeNull();
  });

  it("does not add Cache-Control to PATCH responses", async () => {
    const app = createApp(300);
    const res = await app.request("/update", { method: "PATCH" });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBeNull();
  });

  it("does not add Cache-Control to DELETE responses", async () => {
    const app = createApp(300);
    const res = await app.request("/remove", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBeNull();
  });

  it("always uses the private directive", async () => {
    const app = createApp(60);
    const res = await app.request("/ok");

    const header = res.headers.get("Cache-Control")!;
    expect(header).toContain("private");
    expect(header).not.toContain("public");
  });

  it("handles maxAge of 0 (no-store equivalent pattern)", async () => {
    const app = createApp(0);
    const res = await app.request("/ok");

    expect(res.headers.get("Cache-Control")).toBe("private, max-age=0");
  });
});

describe("noStoreCacheControl middleware", () => {
  function createApp() {
    const app = new Hono<AppEnv>();
    app.use("*", noStoreCacheControl());
    app.get("/list", (c) => c.json({ ok: true }));
    app.post("/mint", (c) => c.json({ token: "xxx" }, 201));
    app.delete("/revoke", (c) => c.json({ ok: true }));
    app.get("/error", (c) => c.json({ error: "boom" }, 500));
    return app;
  }

  it("sets Cache-Control: no-store on GET responses", async () => {
    const res = await createApp().request("/list");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Pragma")).toBe("no-cache");
  });

  it("sets Cache-Control: no-store on POST responses", async () => {
    const res = await createApp().request("/mint", { method: "POST" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("sets Cache-Control: no-store on DELETE responses", async () => {
    const res = await createApp().request("/revoke", { method: "DELETE" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("sets Cache-Control: no-store even on error responses", async () => {
    // Token-management surface should never cache, including errors that
    // might disclose whether a token id exists.
    const res = await createApp().request("/error");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
