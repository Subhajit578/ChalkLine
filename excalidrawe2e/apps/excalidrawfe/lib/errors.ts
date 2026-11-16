import axios from "axios";

/** Server's message if it sent a string, else `fallback`. Never render a non-string: React throws on objects. */
export function errorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message: unknown = err.response?.data?.message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}

/** The HTTP status of a failed request, or null when nothing answered. */
export function errorStatus(err: unknown): number | null {
  return axios.isAxiosError(err) ? err.response?.status ?? null : null;
}
