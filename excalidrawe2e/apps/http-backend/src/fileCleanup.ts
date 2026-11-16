import { prismaClient } from "@repo/db-package/client";
import { TEMP_PREFIX, deleteObject, listOlderThan } from "./storage";

// Cleans up after image uploads:
//   abandoned uploads: bytes sent to tmp/ but never confirmed
//   orphaned images:   stored files that no shape points at any more

// Upload URLs last 5 minutes, so an hour-old pending object won't be confirmed.
const ABANDONED_AFTER_MS = 60 * 60 * 1000;

// An image is confirmed just before its shape is created, so "unreferenced"
// is briefly true of every new upload. The grace period covers that gap.
const ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

// How often the sweep runs.
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Max items per pass; the rest wait for the next run.
const BATCH = 500;

/** Deletes unconfirmed pending uploads. Returns how many. */
export async function sweepAbandonedUploads(now = Date.now()): Promise<number> {
  const keys = await listOlderThan(TEMP_PREFIX, new Date(now - ABANDONED_AFTER_MS), BATCH);
  for (const key of keys) await deleteObject(key);
  return keys.length;
}

/**
 * Deletes stored images no shape refers to. Returns how many.
 *
 * The reference check and the row delete are one statement, so a shape
 * created in between can't be missed.
 *
 * Row first, object second: if we die in between we leak some bytes, which
 * the next upload overwrites. The other order would leave a row pointing at
 * a missing object, and re-pastes would get a broken image.
 *
 * shortcut: a paste answered "already stored" at the instant its unused
 * week-old file is collected points at nothing; use a refcount if it happens.
 */
export async function sweepUnreferencedFiles(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - ORPHAN_GRACE_MS);
  const removed = await prismaClient.$queryRaw<{ hash: string }[]>`
    DELETE FROM "public"."File" AS f
    WHERE f."hash" IN (
      SELECT c."hash" FROM "public"."File" AS c
      WHERE c."createdAt" < ${cutoff}
        AND NOT EXISTS (
          SELECT 1 FROM "public"."Shape" AS s
          WHERE s."type" = 'image' AND s."data"->>'hash' = c."hash"
        )
      LIMIT ${BATCH}
    )
    RETURNING f."hash"
  `;

  for (const { hash } of removed) {
    try {
      await deleteObject(hash);
    } catch (err) {
      console.error(`[files] removed the row for ${hash} but not its object:`, err);
    }
  }
  return removed.length;
}

/**
 * Runs both sweeps every few hours. Errors are logged, never thrown.
 * Like the guest sweeper, this runs in-process: fine for one instance,
 * duplicated work on several.
 */
export function startFileSweeper() {
  const run = async () => {
    try {
      const abandoned = await sweepAbandonedUploads();
      const orphaned = await sweepUnreferencedFiles();
      if (abandoned || orphaned) {
        console.log(`[files] swept ${abandoned} abandoned upload(s) and ${orphaned} unused image(s)`);
      }
    } catch (err) {
      console.error("[files] sweep failed:", err);
    }
  };

  // offset from the guest sweeper's first run
  setTimeout(run, 120_000).unref?.();
  setInterval(run, SWEEP_INTERVAL_MS).unref?.();
}
