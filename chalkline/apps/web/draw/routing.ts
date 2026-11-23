import type { Point } from "./renderer";
/**
 * A drag shorter than this on either axis counts as straight: an elbow there
 * would leave a stub of a few pixels, which reads as a rendering glitch rather
 * than a deliberate corner.
 */
const STRAIGHT_THRESHOLD = 8;

export function circleFromDrag(
  from: Point,
  to: Point
): { centerX: number; centerY: number; radius: number } {
  const width = to.x - from.x;
  const height = to.y - from.y;

  return {
    centerX: from.x + width / 2,
    centerY: from.y + height / 2,
    radius: Math.min(Math.abs(width), Math.abs(height)) / 2,
  };
}

export function elbowPoints(from: Point, to: Point): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  const start = { x: from.x, y: from.y };
  const end = { x: to.x, y: to.y };

  if (Math.abs(dx) < STRAIGHT_THRESHOLD || Math.abs(dy) < STRAIGHT_THRESHOLD) {
    return [start, end];
  }

  const corner =
    Math.abs(dx) > Math.abs(dy)
      ? { x: to.x, y: from.y } // across, then down
      : { x: from.x, y: to.y }; // down, then across

  return [start, corner, end];
}

/**
 * Outlines a rect shape can be drawn as, in the same box. Keep in step with
 * SHAPE_DATA.rect in packages/common/src/protocol.ts.
 */
export const RECT_KINDS = ["rhombus", "parallelogram", "triangle", "cylinder"] as const;
export type RectKind = (typeof RECT_KINDS)[number];

/** How far a parallelogram's top edge is pushed right, as a share of its width. */
const PARALLELOGRAM_SLANT = 0.25;

/**
 * Corners of the straight-edged kinds, clockwise from the top, for a box
 * already normalised to a top-left origin. Null for a plain rectangle and for
 * the cylinder, whose outline is curved. Drawing and hit-testing both read
 * this, so what is clicked is what is seen.
 */
export function polygonOf(kind: RectKind | undefined, left: number, top: number, w: number, h: number): Point[] | null {
  const right = left + w;
  const bottom = top + h;
  const cx = left + w / 2;
  const cy = top + h / 2;
  if (kind === "triangle") return [{ x: cx, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  if (kind === "rhombus") return [{ x: cx, y: top }, { x: right, y: cy }, { x: cx, y: bottom }, { x: left, y: cy }];
  if (kind === "parallelogram") {
    const s = w * PARALLELOGRAM_SLANT;
    return [{ x: left + s, y: top }, { x: right, y: top }, { x: right - s, y: bottom }, { x: left, y: bottom }];
  }
  return null;
}

/** A purely horizontal or vertical run from `from`, along whichever axis the drag mostly went. */
export function straightPoints(from: Point, to: Point): Point[] {
  const end =
    Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
      ? { x: to.x, y: from.y }
      : { x: from.x, y: to.y };
  return [{ x: from.x, y: from.y }, end];
}

/** How far `p` is from the segment a-b. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

/**
 * Removes redundant points from a pencil stroke (Ramer-Douglas-Peucker).
 * A point is dropped if the line through its neighbours passes within
 * `tolerance` of it, so the result never strays further than that. Ends are
 * always kept. Iterative, since a long scribble could overflow the stack.
 */
export function simplifyStroke(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2 || !(tolerance > 0)) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const spans: [number, number][] = [[0, points.length - 1]];
  while (spans.length > 0) {
    const [first, last] = spans.pop()!;
    let worst = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const distance = distanceToSegment(points[i]!, points[first]!, points[last]!);
      if (distance > worst) {
        worst = distance;
        index = i;
      }
    }
    if (index !== -1 && worst > tolerance) {
      keep[index] = 1;
      spans.push([first, index], [index, last]);
    }
  }

  return points.filter((_, i) => keep[i] === 1);
}

export type Edge = "top" | "bottom" | "left" | "right";

/** The viewport edge closest to a point: where a dropped toolbar docks, since it never floats mid-screen. */
export function nearestEdge(x: number, y: number, width: number, height: number): Edge {
  const options: [Edge, number][] = [["top", y], ["bottom", height - y], ["left", x], ["right", width - x]];
  return options.reduce((best, next) => (next[1] < best[1] ? next : best))[0];
}
