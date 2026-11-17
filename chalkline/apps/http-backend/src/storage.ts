import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createGuard } from "@repo/backend-common/resilience";

/**
 * The object store is the second dependency that can hang.
 *
 * Presigning and publicUrl are local and can't block. Every network call
 * here goes through this guard, so a wedged store can't pile up requests.
 *
 * Tighter limits than the database gets: an existence check should be fast,
 * nothing else in the app depends on it, and the sensible answer when it is
 * unwell is to stop asking rather than to wait.
 */
const storageGuard = createGuard({
  name: "object-storage",
  timeoutMs: Number(process.env.STORAGE_TIMEOUT_MS) > 0 ? Number(process.env.STORAGE_TIMEOUT_MS) : 4000,
  concurrency: 20,
  queueLimit: 50,
  slowCallMs: 2000,
  failureThreshold: 0.5,
  minimumCalls: 5,
  openMs: 15000,
  halfOpenTrials: 2,
  onStateChange: (from, to, name) => console.warn(`[resilience] ${name}: ${from} -> ${to}`),
});

/** For the health endpoint, so the breaker's state is observable. */
export const storageHealth = () => storageGuard.snapshot;

/**
 * Object storage, configured entirely from the environment.
 *
 * MinIO, Cloudflare R2 and AWS S3 all speak the same S3 API, so there is no
 * provider abstraction here on purpose - an interface with three
 * implementations that differ only in a base URL would be ceremony around a
 * config value. Moving between them is an env change:
 *
 *   MinIO   endpoint http://localhost:9000   region us-east-1   path style
 *   R2      endpoint <account>.r2.cloudflarestorage.com  region auto  path style
 *   S3      endpoint omitted                 region eu-west-1  virtual host
 *
 * The one real difference is addressing. MinIO serves <endpoint>/<bucket>/<key>
 * while S3 prefers <bucket>.<endpoint>/<key>, which is what forcePathStyle
 * selects. Getting it wrong produces 404s that look like a missing object.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // fail at startup rather than on the first upload: a missing key here is a
    // deployment mistake, and it should not wait for a user to find it
    throw new Error(`[storage] ${name} is not set`);
  }
  return value;
}

export const STORAGE_BUCKET = required("STORAGE_BUCKET");

/** Where a stored object can be read from, without signing. */
const PUBLIC_BASE = required("STORAGE_PUBLIC_BASE").replace(/\/+$/, "");

/**
 * How long an upload URL stays valid.
 *
 * Long enough for a slow connection to finish a few hundred kilobytes, short
 * enough that a leaked URL is not a standing write permission. The client
 * downscales before uploading, so this is not sized for raw camera photos.
 */
const PRESIGN_EXPIRY_SECONDS = 300;

export const s3 = new S3Client({
  region: process.env.STORAGE_REGION || "us-east-1",
  /**
   * Do not add checksum headers unless the operation requires them.
   *
   * Since v3.729 the SDK computes a CRC32 of the body and sends it by default.
   * That breaks presigning: at signing time there is no body, so the checksum
   * of an *empty* payload gets baked into the signed query string, and the
   * real upload is then rejected with "Value for x-amz-checksum-crc32 header
   * is invalid". The signature itself is fine - it is the checksum that
   * disagrees, which is why the error does not mention signing at all.
   *
   * It also keeps the signed request to the headers every S3 implementation
   * understands, which matters for R2.
   */
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  // omitted for real S3, which derives the endpoint from the region
  endpoint: process.env.STORAGE_ENDPOINT || undefined,
  forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE !== "false",
  credentials: {
    accessKeyId: required("STORAGE_ACCESS_KEY_ID"),
    secretAccessKey: required("STORAGE_SECRET_ACCESS_KEY"),
  },
});

/**
 * Holding area for uploads. Browsers can only write under this prefix, never
 * to the final hash key that boards read from (which would let them
 * overwrite an image everyone sees). Only the server writes final keys,
 * after hashing the bytes itself. Namespaced per account so simultaneous
 * uploads of the same picture don't collide.
 */
export const TEMP_PREFIX = "tmp/";

export function tempKey(userId: string, hash: string): string {
  return `${TEMP_PREFIX}${userId}/${hash}`;
}

/**
 * URL the browser may PUT one pending upload to.
 *
 * Content-Type and Content-Length are signed, so S3/R2 reject a different
 * type or size. The body itself can't be signed (UNSIGNED-PAYLOAD), which is
 * fine: nothing is trusted until /files/confirm downloads and hashes it.
 * The bytes go straight to the store, not through this server.
 */
export function presignPut(
  key: string,
  contentType: string,
  contentLength: number
): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: STORAGE_BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    {
      expiresIn: PRESIGN_EXPIRY_SECONDS,
      // otherwise the presigner leaves these out of the signature
      signableHeaders: new Set(["content-type", "content-length"]),
    }
  );
}

/** HTTP status carried by a storage error, if any. */
function statusOf(err: unknown): number | undefined {
  return (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
}

/** Size and type the store reports for a key, or null if missing. Confirms an upload really happened. */
export async function headObject(
  key: string
): Promise<{ size: number; mimeType: string } | null> {
  try {
    const head = await storageGuard.run(() =>
      s3.send(new HeadObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }))
    );
    return {
      size: head.ContentLength ?? 0,
      mimeType: head.ContentType ?? "application/octet-stream",
    };
  } catch (err) {
    const status = statusOf(err);
    // 404 and 403 both mean "not there as far as we are concerned"; anything
    // else is a storage fault the caller should hear about
    if (status === 404 || status === 403) return null;
    throw err;
  }
}

/**
 * Where the browser reads an object from.
 *
 * Built from a base URL rather than signed, because a content hash is already
 * unguessable: knowing one tells you nothing about any other. That keeps reads
 * cacheable forever and lets a CDN serve them without involving this process.
 */
export function publicUrl(key: string): string {
  return `${PUBLIC_BASE}/${key}`;
}

/**
 * An object's bytes, or null if missing. Reads at most `maxBytes + 1`, so the
 * caller can detect "too large" without downloading the whole object.
 */
export async function getObjectBytes(
  key: string,
  maxBytes: number
): Promise<Buffer | null> {
  try {
    const res = await storageGuard.run(() =>
      s3.send(
        new GetObjectCommand({
          Bucket: STORAGE_BUCKET,
          Key: key,
          // inclusive range: maxBytes + 1 bytes
          Range: `bytes=0-${maxBytes}`,
        })
      )
    );
    if (!res.Body) return null;
    // the SDK's stream helper, rather than hand-rolling a chunk collector
    return Buffer.from(await res.Body.transformToByteArray());
  } catch (err) {
    const status = statusOf(err);
    // 404 and 403 mean there is nothing to read; 416 means the object is
    // empty object
    if (status === 404 || status === 403 || status === 416) return null;
    throw err;
  }
}

/**
 * Writes an object under its final key. Only the server does this, with the
 * type it sniffed from the bytes (not the uploader's claim). `immutable` is
 * safe because the key is the hash of the content.
 */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await storageGuard.run(() =>
    s3.send(
      new PutObjectCommand({
        Bucket: STORAGE_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      })
    )
  );
}

/** Deletes an object; a missing one is not an error. */
export async function deleteObject(key: string): Promise<void> {
  await storageGuard.run(() =>
    s3.send(new DeleteObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }))
  );
}

/** Keys under `prefix` last modified before `olderThan`, capped at `limit` so a sweep stays bounded. */
export async function listOlderThan(
  prefix: string,
  olderThan: Date,
  limit = 1000
): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await storageGuard.run(() =>
      s3.send(
        new ListObjectsV2Command({
          Bucket: STORAGE_BUCKET,
          Prefix: prefix,
          ContinuationToken: token,
        })
      )
    );
    for (const object of page.Contents ?? []) {
      if (object.Key && object.LastModified && object.LastModified < olderThan) {
        keys.push(object.Key);
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token && keys.length < limit);
  return keys.slice(0, limit);
}
