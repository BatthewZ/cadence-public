/**
 * Normalise a caller-supplied `?redirect=` value into a path this app is
 * willing to navigate to after authentication.
 *
 * Why it exists: the invitation flow depends on it. `/invite/:token` sends an
 * unauthenticated visitor to `/login?redirect=/invite/<token>` or
 * `/register?redirect=/invite/<token>`; without honouring that parameter the
 * user signs in, lands on the dashboard, and has to dig the invite link back
 * out of their email before they can accept — the exact drop-off an invite
 * flow can least afford.
 *
 * Why it validates rather than trusting: the value arrives in the URL, so
 * anyone can choose it. Passing it through unchecked turns both auth pages
 * into open redirectors — `?redirect=https://evil.example/login` produces a
 * convincing "you've been signed out, sign in again" phishing hop straight
 * after a real sign-in. Only same-origin *paths* are accepted:
 *
 *  - must start with a single `/` — rejects absolute URLs (`https://…`) and
 *    scheme-relative ones (`//evil.example`, which browsers treat as absolute)
 *  - must not contain a backslash — some parsers normalise `\` to `/`, so
 *    `/\evil.example` is another way to write a scheme-relative URL
 *  - must contain no C0 control character or space — see below
 *  - must still resolve same-origin once the real URL parser has had it
 *  - anything else, including an absent value, falls back to `fallback`
 *
 * ## Why the string the checks see is not the string the browser navigates to
 *
 * The three shape checks above are necessary and were not sufficient, because
 * they inspect the literal characters while the browser inspects the *parsed*
 * URL — and the WHATWG parser rewrites the input before parsing it. It removes
 * every U+0009 TAB, U+000A LF and U+000D CR anywhere in the string, and strips
 * leading and trailing C0 controls and spaces. So `/<TAB>/evil.example` starts with
 * a single `/`, contains no backslash, and does not begin `//` — yet
 * `new URL("/\t/evil.example", location.href)` is `https://evil.example/`.
 *
 * That is not theoretical here: `navigate()` hands the string to
 * `history.pushState`, which resolves it the same way, throws `SecurityError`
 * because the result is cross-origin, and react-router catches that and falls
 * back to `window.location.assign(url)` — a full navigation to the attacker's
 * origin, after a real sign-in. The exact phishing hop this module exists to
 * prevent, reached through the checks rather than around them.
 *
 * Hence both guards below. `hasControlOrSpace` states the rule (a path this app
 * would ever navigate to has no control characters in it, so rejecting them
 * costs nothing) and the parser cross-check enforces it with the same machinery
 * the browser will use, so any future parser quirk in this class is caught even
 * if the character class does not name it. A validator that disagrees with the
 * parser it is protecting is not a validator.
 *
 * Note for anyone tempted to delete the parser cross-check as redundant: it is
 * redundant *today*, and no test will stop you. Verified by mutation —
 * disabling `hasControlOrSpace` turns the whitespace case red, but disabling
 * the origin comparison leaves every test in `safe-redirect.test.ts` green,
 * because no input currently known reaches one guard without the other. That
 * is the point of it rather than an argument against it: it is here for the
 * bypass nobody has found yet, which is exactly the kind no test can name in
 * advance. Its cost is one `new URL` per sign-in redirect.
 */

/**
 * Origin used only to resolve the candidate for the same-origin check. A
 * reserved `.invalid` TLD (RFC 2606) so it can never collide with a real
 * deployment host, and a constant rather than `location.origin` so the function
 * stays pure and gives the same answer in tests, in SSR and in the browser —
 * the property under test is "does this resolve relative to its base", which no
 * particular base changes.
 */
const VALIDATION_ORIGIN = "https://redirect.invalid";

/**
 * True when `value` contains any C0 control, space, or DEL.
 *
 * That is the exact set the WHATWG URL parser either removes outright
 * (U+0009 TAB, U+000A LF, U+000D CR, anywhere in the string) or trims from the
 * ends — so it is the set whose presence means the parser is about to see a
 * different string than the shape checks above did.
 *
 * A character-code scan rather than a regular expression because a regex
 * expressing this range contains literal control characters, which `eslint`
 * rejects under `no-control-regex` — and suppressing that rule to keep a
 * one-liner would trade a real signal for cosmetics (CLAUDE.md rule 12).
 */
function hasControlOrSpace(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function safeRedirectPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.includes("\\")) return fallback;
  if (hasControlOrSpace(raw)) return fallback;

  let resolved: URL;
  try {
    resolved = new URL(raw, VALIDATION_ORIGIN);
  } catch {
    return fallback;
  }
  if (resolved.origin !== VALIDATION_ORIGIN) return fallback;

  return raw;
}
