import axios from "axios";
import { API_URL } from "@/lib/config";
import { getToken } from "@/lib/session";
import { errorStatus } from "@/lib/errors";
import { isDrawable } from "./shapeGuard";
import type { Shape } from "./Game";
import type { Person } from "./people";

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

/** The board's owner and members, with how many of its shapes each drew. */
export async function getPeople(roomId: string): Promise<Person[]> {
  const res = await axios.get(`${API_URL}/people/${roomId}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  return res.data.people;
}

/** Your private sticky note on a board, or null when you have none. */
export async function getNote(roomId: string): Promise<string | null> {
  const res = await axios.get(`${API_URL}/note/${roomId}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  return res.data.text;
}

/**
 * Saves your note on a board; blank text deletes it. A keepalive fetch rather
 * than axios, so the save sent as the tab closes still arrives.
 */
export async function saveNote(roomId: string, text: string): Promise<void> {
  const res = await fetch(`${API_URL}/note/${roomId}`, {
    method: "PUT",
    keepalive: true,
    headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Could not save the note (HTTP ${res.status})`);
}
