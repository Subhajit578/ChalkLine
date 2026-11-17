import { test } from "node:test";
import assert from "node:assert/strict";
import { simplifyStroke } from "./routing.ts";
import { isDrawable } from "./shapeGuard.ts";

test("simplifyStroke drops points on a straight run and keeps the ends", () => {
  const line = Array.from({ length: 200 }, (_, i) => ({ x: i, y: i * 2 }));
  assert.deepEqual(simplifyStroke(line, 0.5), [line[0], line[199]]);
});

test("simplifyStroke keeps corners", () => {
  const corner = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 10, y: 10 }];
  assert.deepEqual(simplifyStroke(corner, 0.5), [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
});

test("simplifyStroke never strays further than the tolerance", () => {
  // a noisy arc, the kind a hand actually draws
  const arc = Array.from({ length: 2000 }, (_, i) => {
    const t = i / 2000;
    return { x: 300 * Math.cos(t * 5) + Math.sin(i * 12.9898) * 0.3, y: 300 * Math.sin(t * 5) + Math.cos(i * 78.233) * 0.3 };
  });
  const tolerance = 0.5;
  const simple = simplifyStroke(arc, tolerance);
  assert.ok(simple.length < arc.length / 2, `expected far fewer points, kept ${simple.length}`);

  const toSegment = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
    const u = l === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l));
    return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
  };
  for (const p of arc) {
    let nearest = Infinity;
    for (let i = 1; i < simple.length; i++) nearest = Math.min(nearest, toSegment(p, simple[i - 1]!, simple[i]!));
    assert.ok(nearest <= tolerance + 1e-9, `a point ended up ${nearest} from the simplified stroke`);
  }
});

test("simplifyStroke leaves short strokes and a zero tolerance alone", () => {
  const two = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  assert.equal(simplifyStroke(two, 1), two);
  const three = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }];
  assert.equal(simplifyStroke(three, 0), three);
});

test("isDrawable accepts every shape type and refuses what would break a repaint", () => {
  const hash = "a".repeat(64);
  const good = [
    { id: "1", type: "rect", x: 0, y: 0, width: -5, height: 5, color: "ink" },
    { id: "2", type: "circle", centerX: 0, centerY: 0, radius: 5 },
    { id: "3", type: "pencil", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    { id: "4", type: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    { id: "5", type: "arrow", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
    { id: "6", type: "text", x: 0, y: 0, text: "hi", fontSize: 20, fontFamily: "sans-serif" },
    { id: "7", type: "image", x: 0, y: 0, width: 5, height: 5, hash },
  ];
  for (const shape of good) assert.ok(isDrawable(shape), shape.type);

  const bad = [
    null,
    "rect",
    { type: "rect", x: 0, y: 0, width: 5, height: 5 },                      // no id
    { id: "1", type: "pencil", points: null },
    { id: "1", type: "pencil", points: [{ x: 0, y: 0 }] },
    { id: "1", type: "line", points: [{ x: 0, y: 0 }, { x: "1", y: 1 }] },
    { id: "1", type: "rect", x: NaN, y: 0, width: 5, height: 5 },
    { id: "1", type: "circle", centerX: 0, centerY: 0 },
    { id: "1", type: "text", x: 0, y: 0, text: 5, fontSize: 20, fontFamily: "x" },
    { id: "1", type: "image", x: 0, y: 0, width: 5, height: 5, hash: "../evil" },
    { id: "1", type: "hexagon" },
  ];
  for (const shape of bad) assert.equal(isDrawable(shape), false, JSON.stringify(shape));
});
