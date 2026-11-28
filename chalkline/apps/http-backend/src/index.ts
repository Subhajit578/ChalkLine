import express from "express";
import jwt from "jsonwebtoken";
import {isLoggedIn} from "./middleware"
import {JWT_SECRET, JWT_ALGORITHM, isAllowedOrigin} from '@repo/backend-common/config'
import {CreateUserSchema,SigninUserSchema,CreateRoomSchema,ClaimAccountSchema,PresignUploadSchema,ConfirmUploadSchema,UpdateAvatarSchema,SaveNoteSchema,MAX_IMAGE_BYTES} from "@repo/common/types";
import { guestUsername, MAX_NAME_ATTEMPTS } from "./guestNames";
import { startGuestSweeper, GUEST_TTL_DAYS, deleteAccount } from "./guestCleanup";
import { startFileSweeper } from "./fileCleanup";
import { presignPut, headObject, publicUrl, getObjectBytes, putObject, deleteObject, tempKey, storageHealth } from "./storage";
import { readDimensions, sniffImageType } from "./imageSize";
import { STYLES, isAvatarId, randomAvatarId, avatarFor } from "./avatars";
import { prismaClient, dbGuard } from "@repo/db-package/client"
import cors from "cors"
import compression from "compression"
import { createHash, randomUUID } from "crypto"
import rateLimit from "express-rate-limit"
import helmet from "helmet"
import zlib from "zlib"
import bcrypt from "bcrypt"
const app = express()

/**
 * Number of proxies in front of this server. Behind a load balancer every
 * request would otherwise share the balancer's IP, and one rate-limit bucket.
 * Always a number, never `true`: trusting every hop lets clients spoof their
 * IP via X-Forwarded-For. Defaults to 1 in production; override with TRUST_PROXY.
 */
const proxyHops =
  process.env.TRUST_PROXY !== undefined
    ? Number(process.env.TRUST_PROXY)
    : process.env.NODE_ENV === "production" ? 1 : 0;
app.set("trust proxy", Number.isInteger(proxyHops) && proxyHops >= 0 ? proxyHops : 0);

// Standard security headers (no sniffing, no framing, HSTS). This API only returns JSON, so defaults are fine.
app.use(helmet())

/**
 * Compress responses on the way out.
 *
 * Registered before the routes, because it works by wrapping res.write and
 * res.end - a route mounted earlier would answer without it.
 *
 * The payload this is for is GET /shapes/:roomId. Board JSON is almost
 * entirely repetition - the same keys on every shape, a UUID-shaped userId,
 * an ISO timestamp, the full font stack on every text, and pencil strokes
 * that are {"x":n,"y":n} a hundred times over - so it compresses by around
 * 80%. It is also the request a person waits on before seeing anything, and
 * the one that grows without bound as a board fills up.
 *
 * Defaults are kept where they are already right, and that is most of them:
 *
 *   threshold  1KB. Below that the encoding header and the CPU cost exceed
 *              the saving, so small replies - /me, /rooms, an error - go out
 *              untouched.
 *   filter     consults the Content-Type against the `compressible` table,
 *              which already excludes image/*, video/* and archives. That is
 *              what stops a PNG being deflated a second time for nothing.
 *              Images are served from object storage rather than through
 *              this process anyway, so they never reach here.
 *   encoding   brotli when the client offers it, gzip otherwise, decided
 *              from Accept-Encoding. Both are transparent to the browser.
 *
 * Vary: Accept-Encoding is set for us, which matters the moment anything
 * caches these responses - without it a proxy could hand a brotli body to a
 * client that cannot read it.
 */
app.use(compression({
  // Brotli quality, raised from the library default of 4.
  //
  // At 4 brotli is actually *worse* than gzip on this payload - measured
  // 42,119 bytes against gzip's 40,153 - which would be a silly outcome,
  // because every current browser asks for brotli and would get the larger
  // answer. Measured on a 200-shape board:
  //
  //   gzip level 6      40,153 bytes   4.5 ms
  //   brotli quality 4  42,119 bytes   1.3 ms   (worse than gzip)
  //   brotli quality 6  39,473 bytes   3.1 ms   (smaller AND faster)
  //   brotli quality 9  38,499 bytes  11.8 ms   (1KB more for 4x the work)
  //
  // 6 is the point where it beats gzip on both size and time. Past that the
  // curve flattens and the CPU is being spent per request, on the server, to
  // save bytes the user will not notice.
  // nested under `brotli`: a top-level `params` is read for gzip and
  // silently ignored here, which looks like it worked and does nothing
  brotli: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } },
}))

app.use(express.json())
/**
 * Who may call this API from a browser.
 *
 * `cors()` with no arguments answers every origin with permission. Auth here
 * is a Bearer header rather than a cookie, so a hostile page still cannot
 * borrow a session it does not have - but it could use a token it obtained
 * some other way, and an open API is a standing invitation to build things
 * against it that then break when it is closed.
 *
 * Allowlist from ALLOWED_ORIGINS (shared with the socket server).
 */
app.use(cors({
  origin(origin, callback) {
    // no Origin header at all: curl, a mobile app, a server-to-server call.
    // These are not browsers, so CORS is not what protects them - the token is.
    if (!origin) return callback(null, true);
    return callback(null, isAllowedOrigin(origin));
  },
  credentials: true,
}))

/**
 * Rate limits on the endpoints worth attacking.
 *
 * Nothing stood between a script and unlimited attempts at any of these.
 * Signing in was free to brute force, and /guest would mint accounts as fast
 * as the database could write them - each one a real row with a real
 * username, kept for fifteen days.
 *
 * Keyed by IP, which is coarse: a shared NAT counts as one caller. The limits
 * are therefore set where a human will not reach them.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many attempts - wait a few minutes and try again" },
});

const guestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many guest sessions from here - try again later" },
});

app.use("/signin", authLimiter);
app.use("/signup", authLimiter);
app.use("/account/claim", authLimiter);
app.use("/guest", guestLimiter);

/**
 * Per-account limits for costly routes. Keyed by user id (use behind
 * isLoggedIn only): the IP limits can't stop one person making many free
 * guest accounts.
 */
function perUserLimit(windowMs: number, limit: number, message: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => req.userId ?? "anonymous",
    message: { message },
  });
}

const createRoomLimiter = perUserLimit(60 * 60 * 1000, 30, "Too many new canvases - try again later");
const joinLimiter = perUserLimit(10 * 60 * 1000, 60, "Too many attempts to open canvases - wait a few minutes");
const presignLimiter = perUserLimit(10 * 60 * 1000, 60, "Too many uploads - wait a few minutes");
const confirmLimiter = perUserLimit(10 * 60 * 1000, 60, "Too many uploads - wait a few minutes");
// the note autosaves after a pause in typing, so steady typing stays well under this
const noteLimiter = perUserLimit(60 * 1000, 120, "Saving the note too often - wait a moment");

/** Max canvases per account. */
const MAX_ROOMS_PER_USER = 100;

/** Max image bytes per account. */
const MAX_STORAGE_BYTES_PER_USER = 250 * 1024 * 1024;

/**
 * Liveness, and a window into the breakers.
 *
 * Deliberately touches nothing: no database, no object store. That is the
 * point - if this stays fast while Postgres is on fire, the fire is
 * contained. If it slows down too, something is still shared that should not
 * be, and this is the endpoint that says so.
 */
app.get("/health", (_req, res) => {
  res.send({
    ok: true,
    dependencies: [dbGuard.snapshot, storageHealth()],
  });
});

/**
 * How long a session lasts.
 *
 * Long enough that someone returning to a board next week is simply still
 * signed in, which matters most for guests: the token is the only thing
 * holding a one-click account, so an expiry is also the account's lifetime.
 *
 * Absolute rather than sliding - 15 days from issue, not from last use. A
 * sliding window needs a refresh endpoint and a way to revoke, which is a
 * bigger change than this is worth today.
 */
const TOKEN_TTL = `${GUEST_TTL_DAYS}d`;

/** The only place a session token is minted, so the lifetime cannot drift. */
function issueToken(user: { id: string; username: string }) {
  return jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
    algorithm: JWT_ALGORITHM,
  });
}

/** Creates an account. Refusals are 4xx with a string message. */
app.post("/signup", async (req,res) => {
    const parsed = CreateUserSchema.safeParse(req.body)
    if(!parsed.success) {
        return res.status(400).send({
            message : parsed.error.issues[0]?.message ?? "Check your details and try again"
        })
    }
    const { email, username, password } = parsed.data
    try {
        await prismaClient.user.create({
            data: {
                username,
                email,
                password : await bcrypt.hash(password, 10),
                // a face from the fixed pool, picked at random. Everyone
                // arrives looking like someone rather than like a placeholder,
                // and the dashboard lets them change it.
                photo : randomAvatarId()
            },
        })
        return res.status(201).send({message:"User created"})
    } catch (err: any){
        if (err?.code === "P2002") {
            const taken = String(err?.meta?.target ?? "").includes("email")
                ? "That email is already registered"
                : "That username is taken"
            return res.status(409).send({ message: taken })
        }
        console.error("[auth] signup failed:", err)
        return res.status(500).send({ message: "Could not create the account" })
    }
}) 

/**
 * Dummy bcrypt hash, compared against when the account or password is
 * missing, so "no such user" takes as long as "wrong password" and doesn't
 * reveal which usernames exist.
 */
const DUMMY_HASH = bcrypt.hashSync(randomUUID(), 10)

// done 
app.post("/signin", async (req,res) => {
    const safeData = SigninUserSchema.safeParse(req.body)
    if (!safeData.success) {
        return res.status(422).send({ message: "Invalid input format" })
    }
    const { password } = safeData.data
    // one field for both: guests have no email, and everyone who signed up
    // before this change typed one. Looking in both columns means the switch
    // to username-first logins locks nobody out.
    const identifier = (safeData.data.identifier ?? safeData.data.email)!.trim()

    // Look in one column, chosen by whether the input has "@" (usernames
    // can't). Searching both let someone register another person's email as a
    // username. Email match ignores case for accounts older than lowercasing.
    const user = await prismaClient.user.findFirst({
        where: identifier.includes("@")
            ? { email: { equals: identifier, mode: "insensitive" } }
            : { username: identifier },
        select: { username: true, id: true, password: true, isGuest: true },
    })

    // Same answer for "no such user" and "wrong password": telling them apart
    // turns this endpoint into a way to discover which usernames exist.
    const DENIED = { message: "Invalid credentials" }
    if (!user) {
        await bcrypt.compare(password, DUMMY_HASH)
        return res.status(401).send(DENIED)
    }
    if (!user.password) {
        await bcrypt.compare(password, DUMMY_HASH)
        // a guest, held by its token alone - there is no password to check,
        // and bcrypt.compare against an empty hash would throw
        return res.status(401).send({
            message: "That is a guest account. Open it again from the browser you created it in.",
        })
    }

    const passwordMatch = await bcrypt.compare(password, user.password)
    if (!passwordMatch) {
        return res.status(401).send(DENIED)
    }
    return res.status(200).send({ token: issueToken(user) })
})

/**
 * Start a one-click guest session.
 *
 * No form, no email, no password: the account is held entirely by the token
 * this returns, which is also why its expiry is the account's lifetime. The
 * claim route below is how it stops being disposable.
 */
app.post("/guest", async (req, res) => {
    // The database decides uniqueness, not a pre-flight check: a check
    // followed by an insert is a race, and the unique constraint is the only
    // thing that can actually settle it. So: try, and retry on collision.
    for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt++) {
        try {
            const user = await prismaClient.user.create({
                data: {
                    username: guestUsername(attempt),
                    email: null,
                    password: null,
                    isGuest: true,
                    // guests get one too: a one-click account that looks
                    // anonymous is harder to recognise in a shared room, and
                    // the pool costs nothing to draw from
                    photo: randomAvatarId(),
                },
                select: { id: true, username: true, photo: true },
            })
            return res.status(200).send({
                token: issueToken(user),
                username: user.username,
                isGuest: true,
                avatar: avatarFor(user.photo, user.id),
            })
        } catch (err: any) {
            if (err?.code === "P2002") continue   // name taken; the suffix widens
            console.error("[auth] guest creation failed:", err)
            return res.status(500).send({ message: "Could not start a guest session" })
        }
    }
    console.error("[auth] exhausted guest name attempts")
    return res.status(503).send({ message: "Could not start a guest session, try again" })
})

/**
 * Who the caller is.
 *
 * The token carries a username, but not whether the account is a guest - and
 * baking that into the token would mean it going stale the moment the account
 * is claimed. Asked rather than stored, so it is always current.
 */
app.get("/me", isLoggedIn, async (req, res) => {
    //@ts-ignore - set by isLoggedIn
    const userId: string = req.userId
    const user = await prismaClient.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, email: true, isGuest: true, photo: true },
    })
    if (!user) {
        // 401, not 404: the token verified, but the account it names is gone
        // - deleted, or swept after its guest session expired. The credential
        // no longer identifies anyone, which is an authentication failure, and
        // saying so is what lets the client sign out instead of sitting on a
        // token that quietly fails every request.
        return res.status(401).send({ message: "This account no longer exists" })
    }
    // `photo` is the stored column; `avatar` is what to render. They differ
    // for accounts predating avatars and for anyone whose chosen style has
    // since left the pool - see avatarFor.
    const { photo, ...rest } = user
    return res.send({ ...rest, avatar: avatarFor(photo, user.id) })
})

/**
 * The avatar pool, grouped by style and in picker order.
 *
 * Unauthenticated on purpose: it is a list of paths to static files that
 * anyone can already fetch, so requiring a token would protect nothing and
 * would stop the sign-up page ever showing what is on offer.
 *
 * Served from the manifest rather than by listing the directory - the
 * manifest is what the write path validates against, so the picker and the
 * validator cannot disagree about what exists.
 */
/**
 * The avatar pool: the one response here that is the same for everybody.
 *
 * It is a build-time constant - the SVGs are generated and committed, and
 * STYLES is read from the manifest - so it cannot change while the process
 * runs. Serialising it per request, and making every browser revalidate it,
 * was work with no possible variation in the answer.
 *
 * Rendered once at startup and hashed once, so a request costs a string
 * comparison and a write. The ETag is the hash of the body, which means a
 * deploy that changes the pool invalidates it on its own - there is no
 * version to remember to bump.
 *
 * `public` is correct here and would be wrong almost anywhere else on this
 * API: this endpoint takes no token and its answer does not depend on who is
 * asking. Everything behind isLoggedIn is marked private below.
 */
const AVATARS_BODY = JSON.stringify({ styles: STYLES });
const AVATARS_ETAG = `"${createHash("sha256").update(AVATARS_BODY).digest("hex").slice(0, 32)}"`;

app.get("/avatars", (req, res) => {
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
    res.set("ETag", AVATARS_ETAG);

    // already has it: answer with nothing at all
    if (req.headers["if-none-match"] === AVATARS_ETAG) {
        return res.status(304).end();
    }
    res.type("application/json");
    return res.send(AVATARS_BODY);
})

/**
 * Change the signed-in account's avatar.
 *
 * The id is checked against the pool rather than believed. It is written to a
 * column that the frontend interpolates straight into an asset path, so an
 * unchecked value is both a broken image for everyone who sees this account
 * and a string of someone else's choosing inside a URL. Same reasoning as
 * /files/confirm reading the real image dimensions instead of taking the
 * client's word: if the server is going to store it, the server checks it.
 *
 * PATCH rather than PUT: one field of the account, not the whole of it.
 */
app.patch("/me/avatar", isLoggedIn, async (req, res) => {
    const parsed = UpdateAvatarSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(422).send({
            message: parsed.error.issues[0]?.message ?? "Pick an avatar",
        })
    }
    if (!isAvatarId(parsed.data.avatar)) {
        // 422, not 404: the request is well formed and the route exists, the
        // value just is not one of the ones on offer
        return res.status(422).send({ message: "That is not one of the available avatars" })
    }

    //@ts-ignore - set by isLoggedIn
    const userId: string = req.userId

    try {
        const user = await prismaClient.user.update({
            where: { id: userId },
            data: { photo: parsed.data.avatar },
            select: { id: true, photo: true },
        })
        return res.send({ avatar: avatarFor(user.photo, user.id) })
    } catch (err: any) {
        if (err?.code === "P2025") {
            // the row is gone - deleted, or a guest swept after expiry. Same
            // 401 as everywhere else, so the client signs out rather than
            // retrying a request that can never succeed.
            return res.status(401).send({ message: "This account no longer exists" })
        }
        console.error("[avatars] could not save avatar:", err)
        return res.status(500).send({ message: "Could not save that avatar" })
    }
})

/**
 * Delete the signed-in account, permanently.
 *
 * Same erasure as the expiry sweep, down to the same function: the account,
 * its memberships and the rooms it created all go, while anything it drew on
 * other people's boards stays and stays editable.
 *
 * A password is required when the account has one. The token alone is not
 * enough for something irreversible - a borrowed laptop or a stolen token
 * should not be able to destroy an account and every board on it. Guests have
 * no password to ask for, so for them the confirmation is the UI's job.
 */
app.delete("/account", isLoggedIn, async (req, res) => {
    //@ts-ignore - set by isLoggedIn
    const userId: string = req.userId

    const user = await prismaClient.user.findUnique({
        where: { id: userId },
        select: { password: true, isGuest: true },
    })
    if (!user) {
        // 401, not 404: the token verified, but the account it names is gone
        // - deleted, or swept after its guest session expired. The credential
        // no longer identifies anyone, which is an authentication failure, and
        // saying so is what lets the client sign out instead of sitting on a
        // token that quietly fails every request.
        return res.status(401).send({ message: "This account no longer exists" })
    }

    if (user.password) {
        const password = req.body?.password
        if (typeof password !== "string" || password.length === 0) {
            return res.status(422).send({ message: "Enter your password to delete this account" })
        }
        const matches = await bcrypt.compare(password, user.password)
        if (!matches) {
            // 403 rather than 401: the token is fine, the confirmation is not,
            // and a 401 would make the client think the session had expired
            return res.status(403).send({ message: "That password is not correct" })
        }
    }

    try {
        const { rooms } = await deleteAccount(userId)
        return res.send({ deleted: true, roomsDeleted: rooms })
    } catch (err) {
        console.error("[auth] account deletion failed:", err)
        return res.status(500).send({ message: "Could not delete the account" })
    }
})

/**
 * Turn the signed-in guest into a real account.
 *
 * Keeps the same user row, so every board, membership and shape it owns stays
 * put - that is the whole point of having an account before you have
 * credentials. Only the credentials are added.
 */
app.post("/account/claim", isLoggedIn, async (req, res) => {
    const parsed = ClaimAccountSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(422).send({
            message: parsed.error.issues[0]?.message ?? "Invalid details",
        })
    }
    //@ts-ignore - set by isLoggedIn
    const userId: string = req.userId

    const current = await prismaClient.user.findUnique({
        where: { id: userId },
        select: { isGuest: true },
    })
    if (!current) {
        // 401, not 404: the token verified, but the account it names is gone
        // - deleted, or swept after its guest session expired. The credential
        // no longer identifies anyone, which is an authentication failure, and
        // saying so is what lets the client sign out instead of sitting on a
        // token that quietly fails every request.
        return res.status(401).send({ message: "This account no longer exists" })
    }
    if (!current.isGuest) {
        // not an error the UI should ever cause, but claiming twice would
        // otherwise overwrite a real account's password from a stale tab
        return res.status(409).send({ message: "This account is already registered" })
    }

    try {
        const user = await prismaClient.user.update({
            where: { id: userId },
            data: {
                email: parsed.data.email,
                password: await bcrypt.hash(parsed.data.password, 10),
                isGuest: false,
            },
            select: { id: true, username: true },
        })
        // a fresh token: the old one says nothing untrue, but reissuing keeps
        // the 15 days measured from becoming a real account
        return res.status(200).send({ token: issueToken(user), username: user.username })
    } catch (err: any) {
        if (err?.code === "P2002") {
            return res.status(409).send({ message: "That email is already registered" })
        }
        console.error("[auth] claim failed:", err)
        return res.status(500).send({ message: "Could not save those details" })
    }
})
/** Creates a canvas. Refusals are 4xx with a string message. */
app.post("/room", isLoggedIn, createRoomLimiter, async (req,res) => {
    const parsed = CreateRoomSchema.safeParse(req.body);
    if(!parsed.success){
        return res.status(400).send({
            message: parsed.error.issues[0]?.message ?? "That name is not valid"
        })
    }
    const userId = req.userId!;
    try{
        const owned = await prismaClient.room.count({ where: { adminId: userId } })
        if (owned >= MAX_ROOMS_PER_USER) {
            return res.status(403).send({
                message: `You have reached the limit of ${MAX_ROOMS_PER_USER} canvases. Delete one to make another.`
            })
        }
        const room = await prismaClient.room.create({
            data: { slug: parsed.data.slug, adminId: userId }
        })
        return res.status(201).send({ roomId : room.id, slug : room.slug, shareId : room.shareId })
    } catch (err: any){
        if (err?.code === "P2002") {
            return res.status(409).send({ message: "A canvas with that name already exists" })
        }
        if (err?.code === "P2003") {
            // owner row is gone
            return res.status(401).send({ message: "This account no longer exists" })
        }
        throw err   // the handler at the bottom turns it into a 503 or a 500
    }
})

const ROOM_FIELDS = { id: true, slug: true, shareId: true, adminId: true, createdAt: true } as const

/**
 * Finds the room a link points at for this user, or null.
 *
 * The share id (random, unguessable) is what lets a newcomer in; `viaLink`
 * says that's how it was found. The room's *name* still resolves, but only
 * for its owner and members, so old bookmarks keep working while guessing a
 * name no longer admits anyone.
 */
async function resolveRoom(key: string, userId: string) {
    const byLink = await prismaClient.room.findUnique({ where: { shareId: key }, select: ROOM_FIELDS })
    if (byLink) return { room: byLink, viaLink: true }

    const byName = await prismaClient.room.findUnique({
        where: { slug: key },
        select: { ...ROOM_FIELDS, members: { where: { userId }, select: { id: true } } },
    })
    if (!byName || (byName.adminId !== userId && byName.members.length === 0)) return null
    const { members, ...room } = byName
    return { room, viaLink: false }
}

/** Room details, by share link id (or by name, for people already in it). */
app.get("/room/:key", isLoggedIn, async(req , res) => {
    const found = await resolveRoom(req.params.key ?? "", req.userId!)
    if(!found) {
        return res.status(404).send({ message : "Room not found" })
    }
    return res.send({ room: found.room })
})
/**
 * Every shape on a board.
 *
 * Membership is checked, not just authentication. Before, any signed-in
 * caller could read any board by its id - and those ids are sequential
 * integers, and anyone can mint an account in one click from /guest, so
 * "every private board in the system" was a short for-loop away.
 *
 * Admin or member. Those are the same two relations the join-by-link flow
 * creates, so a person who legitimately opened a shared link already
 * satisfies this by the time the canvas asks for shapes.
 */
app.get("/shapes/:roomId" , isLoggedIn, async (req, res) => {
    const roomId = Number(req.params.roomId)
    //@ts-ignore - set by isLoggedIn
    const userId: string = req.userId
    if(Number.isNaN(roomId)) {
        return res.status(404).send({message : "Invalid Room Id"})
    } else {
        try {
            const room = await prismaClient.room.findUnique({
                where: { id: roomId },
                select: { adminId: true, members: { where: { userId }, select: { id: true } } },
            })
            // 404 rather than 403 for a board you are not in: telling the
            // difference confirms which room ids exist and who owns them
            if (!room || (room.adminId !== userId && room.members.length === 0)) {
                return res.status(404).send({ message: "Invalid Room Id" })
            }

            const shapes = await prismaClient.shape.findMany({
                where : {roomId}, 
                orderBy: {createdAt : "asc"}
            })
            res.send({shapes})
        } catch(err) {
            // 500, not 411. Length Required means "your request had no
            // Content-Length"; this is a failed read on our side and nothing
            // the caller can fix by changing their request. It also made the
            // browser console report a protocol error on every cold start,
            // which sent me looking in the wrong place more than once.
            return res.status(500).send({ message: "Could not load this board" })
        }
    }
})
/**
 * Everyone on a board - the owner and every member - with how many of its
 * shapes each one drew. Not only the people who drew: the canvas marks who is
 * online from the socket's list of user ids, and anyone in the room can be
 * online. Owner and members cover every author, because a membership is only
 * removed along with the account, and that clears the shapes' author too.
 *
 * Counts are shapes on the board now: a deleted shape or a cleared board no
 * longer counts for anyone. Same access rule and 404 as /shapes.
 */
app.get("/people/:roomId", isLoggedIn, async (req, res) => {
    const roomId = Number(req.params.roomId)
    const userId = req.userId!
    if (!Number.isInteger(roomId)) {
        return res.status(404).send({ message: "Invalid Room Id" })
    }
    const person = { select: { id: true, username: true, photo: true } }
    try {
        // shortcut: sends every member; page it if boards reach thousands of members
        const [room, counts] = await Promise.all([
            prismaClient.room.findUnique({
                where: { id: roomId },
                select: { adminId: true, admin: person, members: { select: { user: person } } },
            }),
            prismaClient.shape.groupBy({
                by: ["userId"],
                where: { roomId, userId: { not: null } },
                _count: { _all: true },
            }),
        ])
        if (!room || (room.adminId !== userId && !room.members.some((m) => m.user.id === userId))) {
            return res.status(404).send({ message: "Invalid Room Id" })
        }
        const shapes = new Map(counts.map((c) => [c.userId, c._count._all]))
        const people = [room.admin, ...room.members.map((m) => m.user)].map((u) => ({
            id: u.id,
            username: u.username,
            avatar: avatarFor(u.photo, u.id),
            shapes: shapes.get(u.id) ?? 0,
        }))
        return res.send({ people })
    } catch (err) {
        console.error("[people] could not load the people on a board", err)
        return res.status(500).send({ message: "Could not load who is on this board" })
    }
})
/** Whether someone can open a board: its owner or a member, as for /shapes. */
async function inRoom(roomId: number, userId: string) {
    const room = await prismaClient.room.findUnique({
        where: { id: roomId },
        select: { adminId: true, members: { where: { userId }, select: { id: true } } },
    })
    return !!room && (room.adminId === userId || room.members.length > 0)
}

/**
 * Your sticky note on a board, or null if you have none. Private: only ever
 * the caller's own row, and nothing about it goes over the socket.
 */
app.get("/note/:roomId", isLoggedIn, async (req, res) => {
    const roomId = Number(req.params.roomId)
    const userId = req.userId!
    if (!Number.isInteger(roomId)) return res.status(404).send({ message: "Invalid Room Id" })
    try {
        if (!(await inRoom(roomId, userId))) return res.status(404).send({ message: "Invalid Room Id" })
        const note = await prismaClient.note.findUnique({
            where: { roomId_userId: { roomId, userId } },
            select: { text: true },
        })
        return res.send({ text: note?.text ?? null })
    } catch (err) {
        console.error("[note] could not load a note", err)
        return res.status(500).send({ message: "Could not load your note" })
    }
})

/** Saves your note on a board. Blank text deletes it, so there is never an empty note. */
app.put("/note/:roomId", isLoggedIn, noteLimiter, async (req, res) => {
    const roomId = Number(req.params.roomId)
    const userId = req.userId!
    if (!Number.isInteger(roomId)) return res.status(404).send({ message: "Invalid Room Id" })
    const parsed = SaveNoteSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).send({ message: parsed.error.issues[0]?.message ?? "That note is not valid" })
    }
    const { text } = parsed.data
    try {
        if (!(await inRoom(roomId, userId))) return res.status(404).send({ message: "Invalid Room Id" })
        if (text.trim() === "") {
            await prismaClient.note.deleteMany({ where: { roomId, userId } })
            return res.send({ text: null })
        }
        await prismaClient.note.upsert({ where: { roomId_userId: { roomId, userId } }, create: { roomId, userId, text }, update: { text } })
        return res.send({ text })
    } catch (err) {
        console.error("[note] could not save a note", err)
        return res.status(500).send({ message: "Could not save your note" })
    }
})
/**
 * Joins a room (opening a shared link). Idempotent; the owner is never added
 * as a member. Only the share id creates a membership; a name creates
 * nothing. The canvas page calls this before opening its socket, since the
 * socket server checks the membership written here.
 */
app.post("/room/:key/join", isLoggedIn, joinLimiter, async (req, res) => {
    const userId = req.userId!;
    const found = await resolveRoom(req.params.key ?? "", userId)
    if (!found) {
        return res.status(404).send({ message: "Room not found" });
    }
    const { room, viaLink } = found
    if (room.adminId === userId) {
        return res.send({ room, joined: false, reason: "you own this room" });
    }
    if (viaLink) {
        try {
            await prismaClient.roomMember.upsert({
                where: { roomId_userId: { roomId: room.id, userId } },
                create: { roomId: room.id, userId },
                update: {},
            });
        } catch (err: any) {
            if (err?.code === "P2003") {
                return res.status(401).send({ message: "This account no longer exists" })
            }
            throw err
        }
    }
    return res.send({ room, joined: true });
});

/**
 * Every room this person can get back to: the ones they created, plus the ones
 * they have opened through a shared link. `owned` tells the two apart so the
 * dashboard can group them and only offer rename or delete on its own.
 */
app.get("/rooms", isLoggedIn, async(req, res) => {
    const userId = req.userId!
    // independent queries, run together
    const [owned, memberships] = await Promise.all([
        prismaClient.room.findMany({
            where : {adminId : userId},
            orderBy: {createdAt: "desc"},
            select : {id:true, slug: true, shareId: true, createdAt:true}
        }),
        prismaClient.roomMember.findMany({
            where: { userId },
            orderBy: { joinedAt: "desc" },
            select: {
                joinedAt: true,
                room: { select: { id: true, slug: true, shareId: true, createdAt: true, admin: { select: { id: true, username: true, photo: true } } } },
            },
        }),
    ])
    const joined = memberships.map(({ joinedAt, room: { admin, ...room } }) => ({
        ...room,
        joinedAt,
        owner: admin.username,
        // resolve here: owners predating avatars have a blank column
        ownerAvatar: avatarFor(admin.photo, admin.id),
        owned: false,
    }))
    res.send({
        rooms: owned.map((r) => ({ ...r, owned: true })),
        joined,
    })
})

/**
 * Deletes a canvas with its shapes and memberships in one transaction
 * (children first). Deleting the room alone fails on the RoomMember foreign
 * key once anyone has joined.
 */
app.delete("/room/:id" , isLoggedIn, async(req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) {
        return res.status(400).send({ message: "Invalid id" })
    }
    const room = await prismaClient.room.findUnique({ where : {id}, select: { adminId: true } })
    if(!room) return res.status(404).send({message : "Not found"})
    if(room.adminId !== req.userId) {
        return res.status(403).send({message : "Not your room"})
    }
    await prismaClient.$transaction([
        prismaClient.shape.deleteMany({ where: { roomId: id } }),
        prismaClient.roomMember.deleteMany({ where: { roomId: id } }),
        prismaClient.room.delete({ where: { id } }),
    ])
    return res.status(204).end()
})

/** Rename a canvas. The share link is the shareId, so it does not change. */
app.patch("/room/:id", isLoggedIn, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).send({ message: "Invalid id" });
    }

    // same rules as creating
    const parsed = CreateRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).send({
        message: parsed.error.issues[0]?.message ?? "That name is not valid",
      });
    }

    const room = await prismaClient.room.findUnique({ where: { id }, select: { adminId: true } });
    if (!room) return res.status(404).send({ message: "Not found" });
    if (room.adminId !== req.userId) {
      return res.status(403).send({ message: "Not your room" });
    }

    try {
      const updated = await prismaClient.room.update({
        where: { id },
        data: { slug: parsed.data.slug },
        select: { id: true, slug: true, shareId: true },
      });
      return res.send(updated);
    } catch (err: any) {
      if (err?.code === "P2002") {
        return res.status(409).send({ message: "A canvas with that name already exists" });
      }
      throw err;
    }
  });

/* ── Image uploads ──────────────────────────────────────────────────────
 * The browser PUTs bytes straight to object storage (into a holding key);
 * /files/confirm then checks them and writes the final object. Images are
 * keyed by SHA-256, so each picture is stored once and cached forever, which
 * only holds if the server computes the hash itself. */

/**
 * Asks to upload one image. Answers "already stored" (no upload needed) or a
 * short-lived URL for one PUT of the declared type and size. The URL points
 * at a per-account holding key, never the final key boards read from.
 */
app.post("/files/presign", isLoggedIn, presignLimiter, async (req, res) => {
  const parsed = PresignUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).send({
      message: "Invalid upload request",
      issues: parsed.error.issues.map((i) => i.message),
    });
  }
  const { hash, mimeType, size } = parsed.data;
  const userId = req.userId!;

  const existing = await prismaClient.file.findUnique({ where: { hash } });
  if (existing) {
    if (await headObject(hash)) {
      // these exact bytes are already stored
      return res.send({
        exists: true,
        url: publicUrl(hash),
        width: existing.width,
        height: existing.height,
      });
    }
    // Row exists but the object is gone (e.g. local storage was reset).
    // Drop the stale row so the picture can be uploaded again.
    await prismaClient.file.delete({ where: { hash } }).catch(() => {});
  }

  const used = await prismaClient.file.aggregate({ where: { userId }, _sum: { size: true } });
  if ((used._sum.size ?? 0) + size > MAX_STORAGE_BYTES_PER_USER) {
    return res.status(413).send({
      message: "You have used all the image storage this account gets. Remove some images to add more.",
    });
  }

  const uploadUrl = await presignPut(tempKey(userId, hash), mimeType, size);
  return res.send({ exists: false, uploadUrl, maxBytes: MAX_IMAGE_BYTES, size });
});

/**
 * Confirms an upload by verifying the pending object, trusting nothing from
 * the client:
 *   size  within the cap
 *   hash  SHA-256 of the bytes equals the key (otherwise someone else's image
 *         could show up on boards that paste "the same" picture)
 *   type  starts like a PNG, JPEG, WebP or GIF
 * Then the server writes the final object from the bytes it just checked.
 * Failed checks delete the pending object. Retrying is safe: an existing row
 * means success.
 */
app.post("/files/confirm", isLoggedIn, confirmLimiter, async (req, res) => {
  const parsed = ConfirmUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).send({ message: "Invalid confirmation" });
  }
  const { hash, width, height } = parsed.data;
  const userId = req.userId!;

  const existing = await prismaClient.file.findUnique({ where: { hash } });
  if (existing) {
    return res.send({ url: publicUrl(hash), width: existing.width, height: existing.height });
  }

  const pendingKey = tempKey(userId, hash);
  // best effort: the sweep removes leftovers, so a failed delete isn't a 500
  const discard = () => deleteObject(pendingKey).catch(() => {});

  if (!(await headObject(pendingKey))) {
    return res.status(409).send({ message: "That upload did not arrive" });
  }
  // reads at most limit + 1 bytes, which is enough to detect "too large"
  const bytes = await getObjectBytes(pendingKey, MAX_IMAGE_BYTES);
  if (!bytes) {
    return res.status(409).send({ message: "That upload did not arrive" });
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    await discard();
    return res.status(413).send({ message: "That image is too large" });
  }
  if (createHash("sha256").update(bytes).digest("hex") !== hash) {
    await discard();
    return res.status(422).send({ message: "That upload does not match the image it claimed to be" });
  }
  const mimeType = sniffImageType(bytes);
  if (!mimeType) {
    await discard();
    return res.status(422).send({ message: "That file is not a PNG, JPEG, WebP or GIF" });
  }

  // Dimensions from the header; fall back to the client's (worst case: bad layout).
  const measured = readDimensions(bytes);
  const actualWidth = measured?.width ?? width;
  const actualHeight = measured?.height ?? height;

  await putObject(hash, bytes, mimeType);

  try {
    await prismaClient.file.create({
      data: { hash, mimeType, size: bytes.length, width: actualWidth, height: actualHeight, userId },
    });
  } catch (err: any) {
    // two tabs confirming the same paste at once: the loser of the race finds
    // the row already written, which is the outcome it wanted anyway
    if (err?.code !== "P2002") throw err;
  }
  await discard();

  return res.send({ url: publicUrl(hash), width: actualWidth, height: actualHeight });
});

// configurable so a second instance can be run alongside the dev one, for
// example to exercise a route against the real database without restarting it
/**
 * Turn a refused dependency into an honest status code.
 *
 * A tripped breaker, a timeout and a full queue are all "we are not going to
 * manage this right now, come back shortly" - which is 503 with a Retry-After,
 * not 500. The difference matters to anything that retries: a 500 says the
 * request was wrong or we are broken, a 503 says wait and it will probably
 * work. Returning 500 for an overload invites clients to hammer a dependency
 * that is already struggling.
 *
 * Last in the chain, so it only sees what the routes did not handle.
 */
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  if (err?.name === "DependencyError") {
    const seconds = err.code === "open" ? 10 : 2;
    console.warn(`[resilience] refusing: ${err.dependency} ${err.code}`);
    return res.status(503).set("Retry-After", String(seconds)).send({
      message: "Busy right now - please try again in a moment",
      reason: err.code,
    });
  }
  // malformed JSON or oversized body: the caller's mistake, not a 500
  if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 500) {
    return res.status(err.status).send({ message: "That request could not be read" });
  }
  console.error("[api] unhandled:", err);
  return res.status(500).send({ message: "Something went wrong" });
});

// expired guests are unreachable accounts: swept so the table does not grow
// without bound, and so their usernames come back into circulation
startGuestSweeper();
// abandoned uploads and unused images
startFileSweeper();

const server = app.listen(Number(process.env.PORT) || 3001)

/**
 * On SIGTERM (every deploy): stop accepting connections, let in-flight
 * requests finish, close the DB pool. The timer covers keep-alive
 * connections that would hold close() open.
 */
function shutdown(signal: string) {
  console.log(`[api] ${signal} received, finishing in-flight requests`);
  server.close(() => {
    prismaClient.$disconnect().catch(() => {}).finally(() => process.exit(0));
  });
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
