// Server URLs. Next inlines NEXT_PUBLIC_* at build time, so set them before
// `next build`. The localhost defaults are for `next dev` only.
// In production use https:// and wss://: an https page can't open ws://.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/+$/, "");

export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080";
