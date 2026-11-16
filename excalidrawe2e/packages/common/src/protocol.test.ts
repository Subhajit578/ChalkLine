import { test } from "node:test";
import assert from "node:assert/strict";
import { ClientMessageSchema, MAX_POINTS, MAX_TEXT_LENGTH } from "./protocol";

const HASH = "a".repeat(64);
const shape = (body: unknown) => ({ type: "shape", roomId: "7", id: "s1", shape: body });
const ok = (message: unknown) => ClientMessageSchema.safeParse(message).success;

test("every shape the client draws is accepted", () => {
  const bodies = [
    { type: "rect", data: { x: 1, y: 2, width: -30, height: 40, color: "ink" } },
    { type: "circle", data: { centerX: 5, centerY: 5, radius: 9, color: "red" } },
    { type: "pencil", data: { points: [{ x: 0, y: 0 }, { x: 3, y: 4 }], color: "blue" } },
    { type: "line", data: { points: [{ x: 0, y: 0 }, { x: 3, y: 4 }], color: "blue" } },
    { type: "arrow", data: { points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }] } },
    { type: "text", data: { x: 0, y: 0, text: "hi\nthere", fontSize: 20, fontFamily: "sans-serif", color: "ink" } },
    { type: "image", data: { x: 0, y: 0, width: 10, height: 10, hash: HASH, color: "ink" } },
  ];
  for (const body of bodies) assert.ok(ok(shape(body)), `${body.type} should be accepted`);
});

test("shapes that would break a client's repaint are refused", () => {
  const poison = [
    { type: "pencil", data: { points: null, color: "ink" } },
    { type: "pencil", data: { points: [{ x: 0, y: 0 }], color: "ink" } },
    { type: "pencil", data: { points: [{ x: 0, y: 0 }, { x: "1", y: 0 }] } },
    { type: "rect", data: { x: 1, y: 2, width: 3 } },
    { type: "rect", data: { x: 1e999, y: 2, width: 3, height: 4 } },
    { type: "circle", data: { centerX: 1, centerY: 2, radius: null } },
    { type: "text", data: { x: 0, y: 0, text: "", fontSize: 20, fontFamily: "x" } },
    { type: "text", data: { x: 0, y: 0, text: "x".repeat(MAX_TEXT_LENGTH + 1), fontSize: 20, fontFamily: "x" } },
    { type: "image", data: { x: 0, y: 0, width: 1, height: 1, hash: "../../etc/passwd" } },
    { type: "hexagon", data: {} },
    { type: "rect" },
  ];
  for (const body of poison) assert.equal(ok(shape(body)), false, JSON.stringify(body).slice(0, 80));
});

test("a stroke over the point cap is refused", () => {
  const points = Array.from({ length: MAX_POINTS + 1 }, (_, i) => ({ x: i, y: i }));
  assert.equal(ok(shape({ type: "pencil", data: { points } })), false);
});

test("unknown keys are stripped, not stored", () => {
  const parsed = ClientMessageSchema.parse(
    shape({ type: "rect", data: { x: 1, y: 2, width: 3, height: 4, junk: "x".repeat(1000) }, extra: 1 })
  );
  assert.equal(parsed.type, "shape");
  assert.deepEqual(parsed.type === "shape" && parsed.shape, {
    type: "rect",
    data: { x: 1, y: 2, width: 3, height: 4 },
  });
});

test("an update is checked against the type it names", () => {
  const update = (u: unknown) => ({ type: "update_shape", roomId: "7", update: u });
  assert.ok(ok(update({ id: "s1", shapeType: "circle", data: { centerX: 1, centerY: 2, radius: 3 } })));
  // a rect handed a circle's fields
  assert.equal(ok(update({ id: "s1", shapeType: "rect", data: { centerX: 1, centerY: 2, radius: 3 } })), false);
  // no type at all
  assert.equal(ok(update({ id: "s1", data: { x: 1, y: 2, width: 3, height: 4 } })), false);
});

test("room ids, batches and message types are bounded", () => {
  assert.equal(ok({ type: "join_room", roomId: "12abc" }), false);
  assert.equal(ok({ type: "join_room", roomId: 12 }), false);
  assert.ok(ok({ type: "join_room", roomId: "12" }));
  assert.equal(ok({ type: "delete_shapes", roomId: "1", ids: [] }), false);
  assert.equal(ok({ type: "delete_shapes", roomId: "1", ids: Array(2001).fill("a") }), false);
  assert.equal(ok({ type: "drop_table", roomId: "1" }), false);
});
