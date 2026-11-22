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
