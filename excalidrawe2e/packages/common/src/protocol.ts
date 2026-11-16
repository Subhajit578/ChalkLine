import { z } from "zod";

/**
 * Schemas for everything a client may send over the WebSocket.
 *
 * The server parses each message against these and stores/relays the parsed
 * value, so unknown keys are dropped. This matters because a stored shape
 * with bad data (e.g. `points: null`) would crash every client's repaint,
 * permanently. Every size has a cap for the same reason.
 */

/** Max points in one pencil stroke, line or arrow. */
export const MAX_POINTS = 10_000;

/** Max characters in one text shape. */
export const MAX_TEXT_LENGTH = 10_000;

/** Max shapes per batched message. The client splits larger selections. */
export const MAX_BATCH = 2000;

/** Max points per live-preview frame. */
export const MAX_STROKE_POINTS = 256;

/** Max frame size the socket server reads. `ws` defaults to 100MB; the biggest real message is ~0.5MB. */
export const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;

// World coordinate. Bounded because `1e999` parses to Infinity, which breaks canvas calls.
const Coord = z.number().min(-1e9).max(1e9);
const Point = z.object({ x: Coord, y: Coord });
const Points = z.array(Point).min(2).max(MAX_POINTS);

// Client-generated shape and stroke ids.
const Id = z.string().min(1).max(100);

// Room id: the numeric primary key as a string. Max 9 digits so it fits the int column.
const RoomId = z.string().regex(/^[1-9]\d{0,8}$/);

// Palette name or legacy hex. Optional: old rows have no colour.
const Color = z.string().max(40).optional();

const Box = { x: Coord, y: Coord, width: Coord, height: Coord, color: Color };

/**
 * Geometry stored in `data` for each shape type: the `Shape` union in
 * draw/Game.ts minus `id` and `type`. A new shape type needs an entry here
 * or the server rejects it.
 */
export const SHAPE_DATA = {
  rect: z.object(Box),
  circle: z.object({ centerX: Coord, centerY: Coord, radius: Coord, color: Color }),
  pencil: z.object({ points: Points, color: Color }),
  line: z.object({ points: Points, color: Color }),
  arrow: z.object({ points: Points, color: Color }),
  text: z.object({
    x: Coord,
    y: Coord,
    text: z.string().min(1).max(MAX_TEXT_LENGTH),
    fontSize: z.number().positive().max(10_000),
    fontFamily: z.string().min(1).max(200),
    color: Color,
  }),
  image: z.object({
    ...Box,
    // SHA-256 only: clients build a storage URL from this
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
};

export type ShapeType = keyof typeof SHAPE_DATA;

/** A new shape: its type plus that type's geometry. */
const NewShape = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rect"), data: SHAPE_DATA.rect }),
  z.object({ type: z.literal("circle"), data: SHAPE_DATA.circle }),
  z.object({ type: z.literal("pencil"), data: SHAPE_DATA.pencil }),
  z.object({ type: z.literal("line"), data: SHAPE_DATA.line }),
  z.object({ type: z.literal("arrow"), data: SHAPE_DATA.arrow }),
  z.object({ type: z.literal("text"), data: SHAPE_DATA.text }),
  z.object({ type: z.literal("image"), data: SHAPE_DATA.image }),
]);

/**
 * A shape's full new geometry. Carries the type so the data is checked
 * against the right schema and the write can be scoped to it (otherwise a
 * rect could be given a circle's fields).
 */
const ShapeUpdate = z.discriminatedUnion("shapeType", [
  z.object({ id: Id, shapeType: z.literal("rect"), data: SHAPE_DATA.rect }),
  z.object({ id: Id, shapeType: z.literal("circle"), data: SHAPE_DATA.circle }),
  z.object({ id: Id, shapeType: z.literal("pencil"), data: SHAPE_DATA.pencil }),
  z.object({ id: Id, shapeType: z.literal("line"), data: SHAPE_DATA.line }),
  z.object({ id: Id, shapeType: z.literal("arrow"), data: SHAPE_DATA.arrow }),
  z.object({ id: Id, shapeType: z.literal("text"), data: SHAPE_DATA.text }),
  z.object({ id: Id, shapeType: z.literal("image"), data: SHAPE_DATA.image }),
]);

export type ShapeUpdate = z.infer<typeof ShapeUpdate>;

/**
 * Sender's counter for a change, echoed in an `ack` once the server has
 * stored or finally refused it. Unacknowledged changes are resent after a
 * reconnect; changes are idempotent, so repeats are harmless.
 */
const Seq = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional();

/** Every message the server accepts; anything else is refused. */
export const ClientMessageSchema = z.discriminatedUnion("type", [
  // must be the first message on a socket
  z.object({ type: z.literal("auth"), token: z.string().min(1).max(4096) }),
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("join_room"), roomId: RoomId }),
  z.object({ type: z.literal("leave_room"), roomId: RoomId }),
  // live pencil stroke: relayed, never stored
  z.object({ type: z.literal("stroke_start"), roomId: RoomId, strokeId: Id, color: Color }),
  z.object({
    type: z.literal("stroke_points"),
    roomId: RoomId,
    strokeId: Id,
    points: z.array(Point).min(1).max(MAX_STROKE_POINTS),
  }),
  z.object({
    type: z.literal("shape"),
    roomId: RoomId,
    seq: Seq,
    id: Id,
    shape: NewShape,
    // the live preview this shape replaces (pencil only)
    strokeId: Id.nullish(),
  }),
  z.object({ type: z.literal("update_shape"), roomId: RoomId, seq: Seq, update: ShapeUpdate }),
  z.object({
    type: z.literal("update_shapes"),
    roomId: RoomId,
    seq: Seq,
    updates: z.array(ShapeUpdate).min(1).max(MAX_BATCH),
  }),
  z.object({ type: z.literal("delete_shape"), roomId: RoomId, seq: Seq, id: Id }),
  z.object({
    type: z.literal("delete_shapes"),
    roomId: RoomId,
    seq: Seq,
    ids: z.array(Id).min(1).max(MAX_BATCH),
  }),
  z.object({ type: z.literal("clear_room"), roomId: RoomId, seq: Seq }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
