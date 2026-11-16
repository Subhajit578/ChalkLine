/** Config shared by the HTTP and WebSocket servers, so the two can't drift apart. */

// Local defaults are allowed only when NODE_ENV is explicitly development or
// test. "Not production" isn't enough: a host that never sets NODE_ENV would
// get the published dev key. The dev scripts set it.
const IS_DEV =
  process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

// Signs every session token. Outside development a missing or short secret
// stops startup, since the dev default is public in this repo.
const secret = process.env.JWT_SECRET;

if (!IS_DEV && (!secret || secret.length < 32)) {
  throw new Error(
    "JWT_SECRET must be set to at least 32 characters (try: openssl rand -hex 32). " +
      "Refusing to start with a missing or guessable signing key. " +
      "For local work, run with NODE_ENV=development."
  );
}

export const JWT_SECRET = secret || "dev-only-insecure-shared-secret";

// Passed to sign and verify so tokens claiming another algorithm are refused.
export const JWT_ALGORITHM = "HS256" as const;

// Browser origins allowed to call the API and open a socket. Required outside
// development so a forgotten variable fails at startup, not as refused requests.
const origins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (!IS_DEV && origins.length === 0) {
  throw new Error(
    "ALLOWED_ORIGINS is not set. List the site's origin(s), comma separated, " +
      "for example https://app.example.com"
  );
}

export const ALLOWED_ORIGINS =
  origins.length > 0 ? origins : ["http://localhost:3000"];

/** A missing Origin is allowed (curl, server calls); the token guards those. */
export function isAllowedOrigin(origin: string | undefined): boolean {
  return !origin || ALLOWED_ORIGINS.includes(origin);
}
