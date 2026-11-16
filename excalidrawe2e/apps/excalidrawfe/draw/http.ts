import axios from "axios";
import { API_URL } from "@/lib/config";
import { getToken } from "@/lib/session";
import { errorStatus } from "@/lib/errors";
import { isDrawable } from "./shapeGuard";
import type { Shape } from "./Game";

type ShapeRow = {
  id: string;
  type: string;
  data: Record<string, unknown>;
};

/** The board is not there to load: deleted, or no longer shared with us. */
export class BoardGoneError extends Error {}

/** Every shape saved on a board, oldest first - which is also z-order. */
export async function getExistingShapes(roomId: string): Promise<Shape[]> {
  let rows: ShapeRow[];
  try {
    const res = await axios.get(`${API_URL}/shapes/${roomId}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    rows = res.data.shapes;
  } catch (err) {
    if (errorStatus(err) === 404) throw new BoardGoneError();
    throw err;
  }

  // keep the id: it is how we recognise our own shapes coming back to us,
  // and what delete and move address
  const shapes = rows.map((row) => ({ id: row.id, type: row.type, ...row.data }));
  const drawable = shapes.filter(isDrawable);
  if (drawable.length !== shapes.length) {
    console.warn(`[canvas] left out ${shapes.length - drawable.length} stored shape(s) that could not be drawn`);
  }
  return drawable;
}
