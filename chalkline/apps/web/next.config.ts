import type { NextConfig } from "next";
import path from "node:path";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Content-Security-Policy. Blocks framing, other-origin scripts, plugins and
 * base/form hijacking.
 *
 * script-src keeps 'unsafe-inline' because Next's hydration data is inline;
 * removing it needs nonces, which would make every page dynamic.
 * connect-src allows any https/wss origin because the page talks to the API,
 * socket server, image CDN and upload endpoint, and a missed one would only
 * fail in production.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:" + (isProduction ? "" : " http://localhost:*"),
  "font-src 'self' data:",
  "connect-src 'self' https: wss:" + (isProduction ? "" : " http://localhost:* ws://localhost:*"),
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // older browsers without frame-ancestors
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // canvas URLs contain the share id, so don't send full URLs cross-origin
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  // The floating dev badge sits over the canvas in the bottom-left corner,
  // exactly where the board is drawn. It only ever appears in development -
  // compile and runtime errors are still reported without it.
  devIndicators: false,

  // Next otherwise guesses the root from the highest lockfile, which can be ~.
  outputFileTracingRoot: path.join(__dirname, "../.."),

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
