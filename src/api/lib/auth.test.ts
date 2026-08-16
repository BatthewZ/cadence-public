import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("better-auth", () => ({
  betterAuth: vi.fn(() => ({ api: { getSession: vi.fn() } })),
}));

vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: vi.fn(),
}));

vi.mock("../../db", () => ({
  createDb: vi.fn(),
}));

vi.mock("./email", () => ({
  createEmailService: vi.fn(() => ({ send: vi.fn() })),
}));

vi.mock("./password", () => ({
  hashPassword: vi.fn(),
  createMigratingVerify: vi.fn(() => vi.fn()),
}));

vi.mock("./email/templates/email-verification", () => ({
  emailVerificationEmail: vi.fn(),
}));

vi.mock("./email/templates/password-reset", () => ({
  passwordResetEmail: vi.fn(),
}));

import { betterAuth } from "better-auth";

import {
  createAuth,
  parseTrustedOrigins,
  resetAllowedOriginCache,
  resetAuthCache,
  resolveAllowedOrigin,
} from "./auth";

const mockBetterAuth = vi.mocked(betterAuth);

function fakeEnv(overrides?: Partial<Record<string, unknown>>) {
  return {
    DB: {} as D1Database,
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost:8787",
    TOKEN_HASH_PEPPER: "test-pepper",
    ASSETS: {} as Fetcher,
    ...overrides,
  };
}

describe("createAuth caching", () => {
  beforeEach(() => {
    resetAuthCache();
    mockBetterAuth.mockClear();
  });

  it("returns a cached instance on repeated calls with the same env", () => {
    const env = fakeEnv();
    const first = createAuth(env);
    const second = createAuth(env);

    expect(first).toBe(second);
    expect(mockBetterAuth).toHaveBeenCalledTimes(1);
  });

  it("recreates the instance when BETTER_AUTH_SECRET changes", () => {
    const env1 = fakeEnv({ BETTER_AUTH_SECRET: "secret-a" });
    const env2 = fakeEnv({ BETTER_AUTH_SECRET: "secret-b" });

    const first = createAuth(env1);
    const second = createAuth(env2);

    expect(first).not.toBe(second);
    expect(mockBetterAuth).toHaveBeenCalledTimes(2);
  });

  it("resetAuthCache forces a fresh instance on next call", () => {
    const env = fakeEnv();
    const first = createAuth(env);
    resetAuthCache();
    const second = createAuth(env);

    expect(first).not.toBe(second);
    expect(mockBetterAuth).toHaveBeenCalledTimes(2);
  });
});

describe("parseTrustedOrigins", () => {
  it("returns [] for undefined input", () => {
    expect(parseTrustedOrigins(undefined)).toEqual([]);
  });

  it("returns [] for empty string", () => {
    expect(parseTrustedOrigins("")).toEqual([]);
  });

  it("returns [] for whitespace-only input", () => {
    expect(parseTrustedOrigins("   ")).toEqual([]);
  });

  it("parses a single origin", () => {
    expect(parseTrustedOrigins("https://a.com")).toEqual(["https://a.com"]);
  });

  it("parses comma-separated origins", () => {
    expect(parseTrustedOrigins("https://a.com,https://b.com")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  it("trims whitespace around origins", () => {
    expect(parseTrustedOrigins("https://a.com , https://b.com")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  it("handles trailing comma", () => {
    expect(parseTrustedOrigins("https://a.com,")).toEqual(["https://a.com"]);
  });

  it("handles double comma (empty segment)", () => {
    expect(parseTrustedOrigins("https://a.com,,https://b.com")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });
});

describe("resolveAllowedOrigin", () => {
  beforeEach(() => {
    resetAllowedOriginCache();
  });

  const baseUrl = "http://localhost:8787";

  it("returns origin when it matches baseUrl", () => {
    expect(resolveAllowedOrigin(baseUrl, baseUrl)).toBe(baseUrl);
  });

  it("returns origin when it matches a trusted origin", () => {
    expect(
      resolveAllowedOrigin("https://trusted.com", baseUrl, "https://trusted.com")
    ).toBe("https://trusted.com");
  });

  it("returns null for unlisted origin", () => {
    expect(resolveAllowedOrigin("https://evil.com", baseUrl)).toBeNull();
  });

  it("returns null for unlisted origin with trusted origins set", () => {
    expect(
      resolveAllowedOrigin("https://evil.com", baseUrl, "https://trusted.com")
    ).toBeNull();
  });

  it("handles undefined trustedOrigins", () => {
    expect(resolveAllowedOrigin(baseUrl, baseUrl, undefined)).toBe(baseUrl);
  });
});

// ---------------------------------------------------------------------------
// Email verification policy
// ---------------------------------------------------------------------------
//
// `betterAuth` is mocked in this file, so the options object handed to it is
// directly inspectable — which makes it the only place these three flags can
// be asserted without standing up a full auth server. They are asserted
// because each one is load-bearing and each one is a single boolean that a
// future edit could flip without any test noticing.

describe("email verification policy", () => {
  beforeEach(() => {
    resetAuthCache();
    mockBetterAuth.mockClear();
  });

  function optionsFor() {
    createAuth(fakeEnv());
    return mockBetterAuth.mock.calls[0][0];
  }

  it("requires a verified email before sign-in", () => {
    // This is what makes `acceptInvitation`'s email match mean anything. With
    // it off, registering a colleague's address was enough to claim their
    // workspace invitation (audit finding 04, reproduced live).
    expect(optionsFor().emailAndPassword?.requireEmailVerification).toBe(true);
  });

  it("re-sends the verification link on a refused sign-in", () => {
    // Without this the flag is a trap: the signup email is the only link ever
    // issued, so a user whose link expired has no self-service way to get
    // another one and the account is permanently unreachable.
    expect(optionsFor().emailVerification?.sendOnSignIn).toBe(true);
  });

  it("signs the user in when they follow the verification link", () => {
    // The invitation journey depends on it: invite email → register → verify →
    // signed in and returned to /invite/:token, which then has a session and
    // can accept.
    expect(optionsFor().emailVerification?.autoSignInAfterVerification).toBe(true);
  });
});
