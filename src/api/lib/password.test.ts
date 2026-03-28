import { scryptAsync } from "@noble/hashes/scrypt.js";
import { describe, expect, it, vi } from "vitest";

import { createMigratingVerify, hashPassword, verifyPassword } from "./password";

describe("password hashing (PBKDF2)", () => {
  it("returns salt:hash format with correct lengths", async () => {
    const hash = await hashPassword("test-password");
    const parts = hash.split(":");
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBe(32); // 16 bytes hex = 32 chars
    expect(parts[1].length).toBe(64); // 32 bytes hex = 64 chars
  });

  it("produces unique hashes for same password (different salts)", async () => {
    const hash1 = await hashPassword("same-password");
    const hash2 = await hashPassword("same-password");
    expect(hash1).not.toBe(hash2);
  });

  it("verifies correct password", async () => {
    const password = "my-secure-password";
    const hash = await hashPassword(password);
    expect(await verifyPassword({ hash, password })).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("correct-password");
    expect(await verifyPassword({ hash, password: "wrong-password" })).toBe(false);
  });

  it("rejects malformed hashes", async () => {
    expect(await verifyPassword({ hash: "invalid", password: "test" })).toBe(false);
    expect(await verifyPassword({ hash: "", password: "test" })).toBe(false);
  });
});

describe("scrypt migration shim", () => {
  /** Produce a hash in Better Auth's default scrypt format */
  async function scryptHash(password: string): Promise<string> {
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = Array.from(saltBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const key = await scryptAsync(password.normalize("NFKC"), salt, {
      N: 16384,
      r: 16,
      p: 1,
      dkLen: 64,
      maxmem: 128 * 16384 * 16 * 2,
    });
    const keyHex = Array.from(new Uint8Array(key))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `${salt}:${keyHex}`;
  }

  it("verifies a legacy scrypt hash and calls onMigrated", async () => {
    const onMigrated = vi.fn().mockResolvedValue(undefined);
    const verify = createMigratingVerify(onMigrated);

    const password = "legacy-password";
    const hash = await scryptHash(password);

    expect(await verify({ hash, password })).toBe(true);
    expect(onMigrated).toHaveBeenCalledOnce();

    const [oldHash, newHash] = onMigrated.mock.calls[0] as [string, string];
    expect(oldHash).toBe(hash);
    // New hash should be PBKDF2 format (64 hex char key)
    expect(newHash.split(":")[1].length).toBe(64);
  });

  it("rejects wrong password against scrypt hash", async () => {
    const onMigrated = vi.fn().mockResolvedValue(undefined);
    const verify = createMigratingVerify(onMigrated);

    const hash = await scryptHash("correct");

    expect(await verify({ hash, password: "wrong" })).toBe(false);
    expect(onMigrated).not.toHaveBeenCalled();
  });

  it("still works if onMigrated fails", async () => {
    const onMigrated = vi.fn().mockRejectedValue(new Error("DB error"));
    const verify = createMigratingVerify(onMigrated);

    const password = "test-password";
    const hash = await scryptHash(password);

    // Should still return true even if migration fails
    expect(await verify({ hash, password })).toBe(true);
    expect(onMigrated).toHaveBeenCalledOnce();
  });

  it("handles PBKDF2 hashes without calling onMigrated", async () => {
    const onMigrated = vi.fn().mockResolvedValue(undefined);
    const verify = createMigratingVerify(onMigrated);

    const password = "new-password";
    const hash = await hashPassword(password);

    expect(await verify({ hash, password })).toBe(true);
    expect(onMigrated).not.toHaveBeenCalled();
  });
});
