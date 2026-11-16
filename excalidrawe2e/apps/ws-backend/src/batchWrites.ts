import { prismaClient, Prisma } from "@repo/db-package/client";
import type { ShapeUpdate } from "@repo/common/protocol";

/**
 * Writes a whole selection in one statement. One round trip per shape was
 * far too slow against Neon (50 shapes took 60s and some never landed).
 */

/**
 * Rows per statement.
 *
 * Every row contributes three bound parameters and Postgres caps a statement at
 * 65535 of them, so the hard ceiling is far above this. The limit that
 * actually matters is how long one statement holds its locks: a selection of
 * 500 is already unusual, and anything larger simply takes a second pass
 * rather than one enormous statement.
 */
export const WRITE_CHUNK = 500;

/** Split a list into runs of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Apply many shape updates as a single UPDATE per chunk.
 *
 * Each row carries its own `data`, so this cannot be an updateMany - that
 * sets one value across every matched row. The shape Postgres offers for
 * "different value per row" is a VALUES list joined against the table:
 *
 *   UPDATE "Shape" SET data = v.data FROM (VALUES (...), (...)) AS v(id, data)
 *
 * Built with Prisma.join so every id and every blob stays a bound parameter.
 * Interpolating them would be both an injection hole and a query the planner
 * has to recompile for every distinct batch size.
 *
 * Scoped by roomId in the same statement, so a caller cannot reach a shape on
 * a board they have not joined by naming its id - and by type, so a row is
 * only ever given the geometry its own type was validated against.
 *
 * Returns how many rows were actually changed, which is how the caller learns
 * that an id was wrong without a second query.
 */
export async function updateShapesBatch(
  roomId: number,
  updates: ShapeUpdate[]
): Promise<number> {
  let changed = 0;

  for (const batch of chunk(updates, WRITE_CHUNK)) {
    const rows = batch.map(
      (u) => Prisma.sql`(${u.id}::text, ${u.shapeType}::text, ${JSON.stringify(u.data)}::jsonb)`
    );
    const affected = await prismaClient.$executeRaw`
      UPDATE "public"."Shape" AS s
      SET "data" = v.data
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, type, data)
      WHERE s."id" = v.id AND s."type" = v.type AND s."roomId" = ${roomId}
    `;
    changed += affected;
  }

  return changed;
}

/**
 * Delete many shapes at once.
 *
 * deleteMany with an `in` list is genuinely one statement, so this needs no
 * raw SQL - only the same chunking, for the same reason.
 */
export async function deleteShapesBatch(roomId: number, ids: string[]): Promise<number> {
  let removed = 0;
  for (const batch of chunk(ids, WRITE_CHUNK)) {
    const { count } = await prismaClient.shape.deleteMany({
      where: { id: { in: batch }, roomId },
    });
    removed += count;
  }
  return removed;
}
