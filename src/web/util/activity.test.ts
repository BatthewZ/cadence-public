import { describe, expect, it } from "vitest";

import { formatTokenAttribution } from "./activity";

/**
 * `formatTokenAttribution` drives the "(via <TokenName>)" suffix that
 * lets humans tell apart actions taken by integrations vs. real user
 * sessions in the activity feed.
 *
 * The three branches matter for distinct reasons:
 *  - present + named → shows the integration's name (e.g. Slackbot)
 *  - present + null name → token was hard-deleted, we still want to flag
 *    the row as integration-attributed so it isn't silently dropped
 *  - absent → cookie-auth, return null so the UI omits the suffix entirely
 *    (rendering an empty pair of parens would look broken)
 */
describe("formatTokenAttribution", () => {
  it("returns '(via <name>)' when both apiTokenId and tokenName are present", () => {
    expect(
      formatTokenAttribution({ apiTokenId: "tok_1", tokenName: "Slackbot" }),
    ).toBe("(via Slackbot)");
  });

  it("returns '(via deleted token)' when apiTokenId is set but tokenName is null", () => {
    expect(
      formatTokenAttribution({ apiTokenId: "tok_1", tokenName: null }),
    ).toBe("(via deleted token)");
  });

  it("returns '(via deleted token)' when tokenName is empty/whitespace", () => {
    expect(
      formatTokenAttribution({ apiTokenId: "tok_1", tokenName: "   " }),
    ).toBe("(via deleted token)");
  });

  it("returns null when apiTokenId is missing (cookie auth)", () => {
    expect(
      formatTokenAttribution({ apiTokenId: null, tokenName: null }),
    ).toBeNull();
  });

  it("returns null when apiTokenId is undefined (cookie auth)", () => {
    expect(
      formatTokenAttribution({ tokenName: "Stale" }),
    ).toBeNull();
  });
});
