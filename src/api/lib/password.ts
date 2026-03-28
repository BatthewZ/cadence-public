/**
 * PBKDF2-based password hashing for Cloudflare Workers, with a scrypt
 * migration shim for passwords hashed by Better Auth's default hasher.
 *
 * The default Better Auth scrypt implementation (N=16384, r=16) exceeds
 * the Workers CPU time limit. PBKDF2 via the Web Crypto API is natively
 * supported in Workers and stays well within CPU budget while remaining
 * cryptographically secure for password storage.
 *
 * The migration shim detects legacy scrypt hashes by their key length
 * (64 bytes / 128 hex chars vs PBKDF2's 32 bytes / 64 hex chars),
 * verifies with scrypt, then auto-rehashes to PBKDF2 so the user only
 * hits the slow path once. If scrypt verification itself exceeds the
 * Workers CPU limit, the user will need to reset their password via the
 * forgot-password flow (which hashes with PBKDF2).
 */

import { scryptAsync } from "@noble/hashes/scrypt.js";

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const KEY_LENGTH_BITS = 256;
const HASH_ALGORITHM = "SHA-256";

/** Length of the hex-encoded key portion for each algorithm */
const PBKDF2_KEY_HEX_LENGTH = 64; // 32 bytes
const SCRYPT_KEY_HEX_LENGTH = 128; // 64 bytes

/** Better Auth's default scrypt parameters — must match exactly to verify legacy hashes */
const SCRYPT_CONFIG = {
	N: 16384,
	r: 16,
	p: 1,
	dkLen: 64,
	maxmem: 128 * 16384 * 16 * 2,
} as const;

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
	const derived = await pbkdf2(password, salt);
	return `${toHex(salt)}:${toHex(new Uint8Array(derived))}`;
}

/**
 * Creates a verify function that handles both PBKDF2 and legacy scrypt
 * hashes. On successful scrypt verification, calls `onMigrated` so the
 * caller can persist the new PBKDF2 hash to the database.
 */
export function createMigratingVerify(
	onMigrated: (oldHash: string, newHash: string) => Promise<void>,
) {
	return async ({ hash, password }: { hash: string; password: string }): Promise<boolean> => {
		const [saltHex, keyHex] = hash.split(":");
		if (!saltHex || !keyHex) return false;

		if (keyHex.length === PBKDF2_KEY_HEX_LENGTH) {
			return verifyPbkdf2(password, saltHex, keyHex);
		}

		if (keyHex.length === SCRYPT_KEY_HEX_LENGTH) {
			const valid = await verifyScrypt(password, saltHex, keyHex);
			if (valid) {
				const newHash = await hashPassword(password);
				await onMigrated(hash, newHash).catch((err) => {
					console.error("Failed to migrate scrypt hash to PBKDF2:", err);
				});
			}
			return valid;
		}

		return false;
	};
}

/**
 * Standalone verify for contexts without DB access (e.g. tests).
 * Only verifies PBKDF2 hashes — does not handle scrypt migration.
 */
export async function verifyPassword({
	hash,
	password,
}: { hash: string; password: string }): Promise<boolean> {
	const [saltHex, keyHex] = hash.split(":");
	if (!saltHex || !keyHex) return false;
	return verifyPbkdf2(password, saltHex, keyHex);
}

async function verifyPbkdf2(password: string, saltHex: string, keyHex: string): Promise<boolean> {
	const salt = fromHex(saltHex);
	const derived = await pbkdf2(password, salt);
	return constantTimeEqual(new Uint8Array(derived), fromHex(keyHex));
}

async function verifyScrypt(password: string, saltHex: string, keyHex: string): Promise<boolean> {
	const derived = await scryptAsync(password.normalize("NFKC"), saltHex, SCRYPT_CONFIG);
	return constantTimeEqual(new Uint8Array(derived), fromHex(keyHex));
}

async function pbkdf2(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);

	return crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt: salt.buffer as ArrayBuffer,
			iterations: PBKDF2_ITERATIONS,
			hash: HASH_ALGORITHM,
		},
		keyMaterial,
		KEY_LENGTH_BITS,
	);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a[i] ^ b[i];
	}
	return result === 0;
}

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function fromHex(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = Number.parseInt(hex.substring(i, i + 2), 16);
	}
	return bytes;
}
