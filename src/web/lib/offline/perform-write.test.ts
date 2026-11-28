import { describe, expect, it } from "vitest";

import { performWrite } from "./perform-write";

const write = { method: "PATCH" as const, path: "/api/tasks/t1", body: { title: "x" }, key: "k1" };

describe("performWrite", () => {
  it("gives up on a request that never answers, as no answer (retried under the same key)", async () => {
    // A stalled network: the request is neither answered nor refused until it is aborted.
    const stalled = ((_path: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError"))
        );
      })) as typeof fetch;

    await expect(performWrite(write, stalled, 30)).resolves.toEqual({ kind: "network" });
  });

  it("returns the server's answer when it comes in time", async () => {
    const ok = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ task: { id: "t1" } }), { status: 200 })
      )) as typeof fetch;
    await expect(performWrite(write, ok, 1_000)).resolves.toEqual({
      kind: "ok",
      status: 200,
      data: { task: { id: "t1" } },
    });
  });
});
