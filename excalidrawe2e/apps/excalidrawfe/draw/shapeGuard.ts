import type { Shape } from "./Game";

/**
 * True if the client can safely hold this shape.
 *
 * The server already validates, so this is a backstop for old rows or a
 * server/client version mismatch. Paint and hit-testing read fields like
 * `points[0]` unchecked on every frame, so one bad shape would break the
 * whole board; failing shapes are skipped instead.
 *
 * Keep in step with SHAPE_DATA in packages/common/src/protocol.ts.
 */
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const point = (v: unknown): boolean =>
  typeof v === "object" && v !== null && num((v as { x?: unknown }).x) && num((v as { y?: unknown }).y);

export function isDrawable(value: unknown): value is Shape {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  if (typeof s.id !== "string" || s.id.length === 0) return false;

  switch (s.type) {
    case "rect":
      return num(s.x) && num(s.y) && num(s.width) && num(s.height);
    case "circle":
      return num(s.centerX) && num(s.centerY) && num(s.radius);
    case "pencil":
    case "line":
    case "arrow":
      return Array.isArray(s.points) && s.points.length >= 2 && s.points.every(point);
    case "text":
      return (
        num(s.x) && num(s.y) &&
        typeof s.text === "string" &&
        num(s.fontSize) && s.fontSize > 0 &&
        typeof s.fontFamily === "string"
      );
    case "image":
      return (
        num(s.x) && num(s.y) && num(s.width) && num(s.height) &&
        typeof s.hash === "string" && /^[a-f0-9]{64}$/.test(s.hash)
      );
    default:
      return false;
  }
}
