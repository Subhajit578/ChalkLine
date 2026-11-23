import { WebSocket, WebSocketServer, type RawData } from "ws";
import jwt from "jsonwebtoken";
import { JWT_SECRET, JWT_ALGORITHM, isAllowedOrigin } from "@repo/backend-common/config";
import { prismaClient } from "@repo/db-package/client";
import {
    ClientMessageSchema,
    MAX_MESSAGE_BYTES,
    type ClientMessage,
} from "@repo/common/protocol";
import { updateShapesBatch, deleteShapesBatch } from "./batchWrites";

/* ── Limits ──────────────────────────────────────────────────────────────
 * Caps on what one socket, account or room can make this process do. Guest
 * accounts are free, so anything unlimited is unlimited for everyone. */

/** How long a new socket has to send its `auth` message. */
const AUTH_TIMEOUT_MS = 10_000;

/** Open sockets per account (one per tab, with headroom). */
const MAX_SOCKETS_PER_USER = 10;

/** Rooms per socket; the app only joins one. */
const MAX_ROOMS_PER_SOCKET = 8;

/**
 * Messages per socket: a burst, then a sustained rate. A pencil stroke is
 * ~30/s, so real clients stay far below. The burst covers the replay of
 * offline changes after a reconnect.
 */
const MESSAGE_BURST = 600;
const MESSAGES_PER_SECOND = 200;

/** Same limit in bytes, so a few huge frames can't get around the message limit. */
const BYTE_BURST = 16 * 1024 * 1024;
const BYTES_PER_SECOND = 2 * 1024 * 1024;

/** Rate-limited messages before the socket is closed. */
const MAX_DROPPED = 2000;

/** Queued writes per room; beyond this the database isn't keeping up. */
const MAX_PENDING_WRITES = 500;

/** Shapes per room (a board load fetches all of them). */
const MAX_SHAPES_PER_ROOM = 20_000;

/** Buffered bytes after which a slow client is dropped. */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

/** Ping interval; a socket that misses one pong is terminated. */
const HEARTBEAT_MS = 30_000;

/** attempts for a database call (and for the connection at startup) */
const DB_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── State ─────────────────────────────────────────────────────────────── */

type Client = {
    socket: WebSocket;
    /** null until the socket has sent a valid `auth` message */
    userId: string | null;
    rooms: Set<string>;
    /** serialises this socket's messages */
    chain: Promise<void>;
    messageTokens: number;
    byteTokens: number;
    refilledAt: number;
    dropped: number;
    warnedAt: number;
    /** cleared by each ping, set by the pong that answers it */
    alive: boolean;
};

type Room = {
    sockets: Set<WebSocket>;
    /** the end of this room's write queue: every write waits for the one before */
    tail: Promise<void>;
    pending: number;
    /** a write was lost, so what clients show may not be what is stored */
    needsResync: boolean;
    /** rows in this room, as last counted; bumped on every create */
    shapeCount: number;
};

/** Sockets by connection and by room, so a broadcast only visits the room. */
const clients = new Map<WebSocket, Client>();
const rooms = new Map<string, Room>();
const socketsPerUser = new Map<string, number>();

/* ── Database ──────────────────────────────────────────────────────────── */

/** Connection-level errors, which are worth retrying (a query error would just repeat). */
function isConnectionError(err: unknown): boolean {
    const name = (err as { name?: string })?.name ?? "";
    return (
        name === "PrismaClientInitializationError" ||
        name === "PrismaClientRustPanicError"
    );
}

/**
 * Runs a DB call, retrying on connection errors. Neon suspends when idle, and
 * a failed Prisma initialisation leaves the client broken for the life of the
 * process, so we disconnect and reconnect between attempts instead of just
 * retrying the query.
 */
async function withDb<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= DB_ATTEMPTS; attempt++) {
        try {
            return await operation();
        } catch (err) {
            lastError = err;
            if (!isConnectionError(err) || attempt === DB_ATTEMPTS) break;

            console.warn(
                `[WS] database unreachable (attempt ${attempt}/${DB_ATTEMPTS}), reconnecting...`
            );
            try { await prismaClient.$disconnect(); } catch { /* already down */ }
            await sleep(500 * attempt);
            try { await prismaClient.$connect(); } catch { /* the retry will report it */ }
        }
    }

    throw lastError;
}

/** Wakes the database at startup. Failing is not fatal: writes retry on demand. */
async function connectDatabase() {
    for (let attempt = 1; attempt <= DB_ATTEMPTS; attempt++) {
        try {
            await prismaClient.$connect();
            console.log("[WS] database connected");
            return;
        } catch (err) {
            console.warn(
                `[WS] could not connect to the database (attempt ${attempt}/${DB_ATTEMPTS})`
            );
            await sleep(1000 * attempt);
        }
    }
    console.error("[WS] starting without a database connection; writes will retry on demand");
}

/**
 * Whether this account owns or is a member of the room, plus its shape count.
 * Same rule as GET /shapes/:roomId. Fails closed: a DB error propagates and
 * the join is refused.
 */
async function roomAccess(roomId: string, userId: string): Promise<{ shapes: number } | null> {
    const room = await withDb(() =>
        prismaClient.room.findUnique({
            where: { id: Number(roomId) },
            select: {
                adminId: true,
                members: { where: { userId }, select: { id: true } },
                _count: { select: { shapes: true } },
            },
        })
    );
    if (!room || (room.adminId !== userId && room.members.length === 0)) return null;
    return { shapes: room._count.shapes };
}

/** Whether the user owns the room. Fails closed on DB errors. */
async function isAdmin(roomId: string, userId: string): Promise<boolean> {
    const room = await withDb(() =>
        prismaClient.room.findUnique({
            where: { id: Number(roomId) },
            select: { adminId: true },
        })
    );
    return room?.adminId === userId;
}

/* ── Sending ───────────────────────────────────────────────────────────── */

/** Sends a serialised frame if the socket is open. */
function sendRaw(socket: WebSocket, frame: string) {
    if (socket.readyState !== WebSocket.OPEN) return;
    // A client that stopped reading would otherwise buffer broadcasts in our
    // memory forever. Drop it; it reconnects and reloads.
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        socket.terminate();
        return;
    }
    socket.send(frame);
}

function send(socket: WebSocket, payload: Record<string, unknown>) {
    sendRaw(socket, JSON.stringify(payload));
}

/** Sends to everyone in a room. Serialised once, not per recipient. */
function broadcast(roomId: string, payload: Record<string, unknown>, except?: WebSocket) {
    const room = rooms.get(roomId);
    if (!room) return;
    const frame = JSON.stringify(payload);
    for (const socket of room.sockets) {
        if (socket !== except) sendRaw(socket, frame);
    }
}

/* ── Rooms and write queues ────────────────────────────────────────────── */

function roomFor(roomId: string): Room {
    let room = rooms.get(roomId);
    if (!room) {
        room = {
            sockets: new Set(),
            tail: Promise.resolve(),
            pending: 0,
            needsResync: false,
            shapeCount: 0,
        };
        rooms.set(roomId, room);
    }
    return room;
}

/** Drops a room with no sockets and no pending writes. */
function releaseRoom(roomId: string, room: Room) {
    if (room.sockets.size === 0 && room.pending === 0) rooms.delete(roomId);
}

function leaveRoom(client: Client, roomId: string) {
    client.rooms.delete(roomId);
    const room = rooms.get(roomId);
    if (!room) return;
    room.sockets.delete(client.socket);
    releaseRoom(roomId, room);
    sendPresence(roomId);
}

/**
 * Tells everyone in a room who is in it now, as user ids, on every join and
 * leave. The whole list rather than a joined/left event: a late or missed
 * message cannot leave anyone's list wrong, and a person with two tabs open
 * stays listed until the last one closes. Names and faces come from /people.
 */
function sendPresence(roomId: string) {
    const room = rooms.get(roomId);
    if (!room) return;
    const userIds = new Set<string>();
    for (const socket of room.sockets) {
        const userId = clients.get(socket)?.userId;
        if (userId) userIds.add(userId);
    }
    broadcast(roomId, { type: "presence", roomId, userIds: [...userIds] });
}

/**
 * Runs `task` after the room's pending writes. Changes are broadcast first
 * and written after; this queue keeps the writes in broadcast order (so two
 * edits to one shape can't commit out of order, and an edit can't run before
 * its shape's create). One queue per room, so a slow board doesn't block
 * others.
 *
 * If a write failed (`needsResync`), everyone is told to reload once the
 * queue is empty. Waiting for empty means the database then holds every
 * change that will ever land, so the reload shows the truth.
 */
function enqueue(roomId: string, task: () => Promise<void>) {
    const room = roomFor(roomId);
    room.pending++;
    room.tail = room.tail
        .then(task)
        .catch((err) => {
            console.error(`[WS] room ${roomId}: queued task failed:`, err);
            room.needsResync = true;
        })
        .then(() => {
            room.pending--;
            if (room.pending > 0) return;
            if (room.needsResync) {
                room.needsResync = false;
                broadcast(roomId, { type: "resync", roomId });
            }
            releaseRoom(roomId, room);
        });
}

/**
 * Stores a change that was already broadcast. `write` resolves to whether it
 * took. If not (error, or the row was gone), screens no longer match the
 * database: the sender is told why and the room is marked to reload.
 */
function persist(
    roomId: string,
    sender: WebSocket,
    seq: number | undefined,
    failure: Record<string, unknown>,
    write: () => Promise<boolean>
) {
    const room = roomFor(roomId);
    if (room.pending >= MAX_PENDING_WRITES) {
        // DB is far behind; refuse more. Reload is sent once the queue drains.
        room.needsResync = true;
        send(sender, { type: "error", message: "The server is busy - that change was not saved" });
        acknowledge(sender, seq);
        return;
    }
    enqueue(roomId, async () => {
        let stored = false;
        try {
            stored = await write();
        } catch (err) {
            console.error(`[WS] room ${roomId}: write failed:`, err);
        }
        if (!stored) {
            room.needsResync = true;
            send(sender, { type: "error", ...failure });
        }
        // settled: stored, or refused in a way a resend can't fix
        acknowledge(sender, seq);
    });
}

/** Tell a sender one of its numbered changes has been dealt with. */
function acknowledge(socket: WebSocket, seq: number | undefined) {
    if (seq !== undefined) send(socket, { type: "ack", seq });
}

/* ── Per-socket limits ─────────────────────────────────────────────────── */

/** Spends one message of `bytes` from the socket's allowance; false if exhausted. */
function withinLimits(client: Client, bytes: number): boolean {
    const now = Date.now();
    const elapsed = (now - client.refilledAt) / 1000;
    client.refilledAt = now;
    client.messageTokens = Math.min(MESSAGE_BURST, client.messageTokens + elapsed * MESSAGES_PER_SECOND);
    client.byteTokens = Math.min(BYTE_BURST, client.byteTokens + elapsed * BYTES_PER_SECOND);
    if (client.messageTokens < 1 || client.byteTokens < bytes) return false;
    client.messageTokens -= 1;
    client.byteTokens -= bytes;
    return true;
}

/**
 * Tells a client its message was refused and makes it reload. It applied the
 * change locally first, so its screen may now be ahead of the database.
 * Throttled to once a second.
 */
function refuse(client: Client, message: string) {
    const now = Date.now();
    if (now - client.warnedAt < 1000) return;
    client.warnedAt = now;
    send(client.socket, { type: "error", message });
    for (const roomId of client.rooms) send(client.socket, { type: "resync", roomId });
}

/* ── Messages ──────────────────────────────────────────────────────────── */

function userIdFromToken(token: string): string | null {
    try {
        // pin the algorithm, as in the HTTP middleware
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
        if (typeof decoded === "string") return null;
        return typeof decoded.userId === "string" && decoded.userId ? decoded.userId : null;
    } catch {
        return null;
    }
}

/**
 * First message on a socket. The token is sent here, not in the URL, because
 * URLs are logged by proxies and load balancers.
 */
function authenticate(client: Client, message: ClientMessage) {
    const userId = message.type === "auth" ? userIdFromToken(message.token) : null;
    if (!userId) {
        client.socket.close(4401, "Sign in again");
        return;
    }
    const open = socketsPerUser.get(userId) ?? 0;
    if (open >= MAX_SOCKETS_PER_USER) {
        client.socket.close(4429, "Too many open boards");
        return;
    }
    socketsPerUser.set(userId, open + 1);
    client.userId = userId;
    send(client.socket, { type: "ready" });
}

/** Whether the socket joined the room. If not, tells the sender and acks the change so it isn't resent. */
function requireRoom(client: Client, roomId: string, seq?: number): boolean {
    if (client.rooms.has(roomId)) return true;
    send(client.socket, { type: "error", message: "You have not joined that room" });
    acknowledge(client.socket, seq);
    return false;
}

async function joinRoom(client: Client, userId: string, roomId: string) {
    const { socket } = client;
    if (!client.rooms.has(roomId)) {
        if (client.rooms.size >= MAX_ROOMS_PER_SOCKET) {
            send(socket, { type: "error", code: "forbidden", roomId, message: "Too many boards open on this connection" });
            return;
        }
        let access: { shapes: number } | null;
        try {
            access = await roomAccess(roomId, userId);
        } catch (err) {
            // couldn't check access: refuse, but let the client retry
            console.error("[WS] could not check room access:", err);
            send(socket, { type: "error", code: "join_failed", roomId, message: "Could not open this board right now" });
            return;
        }
        if (!access) {
            send(socket, { type: "error", code: "forbidden", roomId, message: "You do not have access to this board" });
            return;
        }
        // socket may have closed during the DB lookup
        if (socket.readyState !== WebSocket.OPEN) return;

        const room = roomFor(roomId);
        room.shapeCount = Math.max(room.shapeCount, access.shapes);
        room.sockets.add(socket);
        client.rooms.add(roomId);
        sendPresence(roomId);
    }

    // Sent behind the room's pending writes, so when the client loads the
    // board it already contains everything broadcast before it joined, and
    // everything after was sent to it as a room member. No gap.
    enqueue(roomId, async () => send(socket, { type: "joined", roomId }));
}

async function handle(client: Client, raw: Buffer) {
    const { socket } = client;

    let body: unknown;
    try {
        body = JSON.parse(raw.toString());
    } catch {
        send(socket, { type: "error", message: "Could not read that message" });
        return;
    }

    const parsed = ClientMessageSchema.safeParse(body);
    if (!parsed.success) {
        if (!client.userId) {
            socket.close(4401, "Sign in again");
            return;
        }
        refuse(client, "The server refused that change");
        const seq = (body as { seq?: unknown } | null)?.seq;
        if (Number.isSafeInteger(seq)) acknowledge(socket, seq as number);
        return;
    }
    const message = parsed.data;

    if (!client.userId) {
        authenticate(client, message);
        return;
    }
    const userId = client.userId;

    switch (message.type) {
        case "auth":
            return;   // already signed in; a second one changes nothing

        case "ping":
            send(socket, { type: "pong" });
            return;

        case "join_room":
            await joinRoom(client, userId, message.roomId);
            return;

        case "leave_room":
            leaveRoom(client, message.roomId);
            return;

        // Live pencil stroke: relayed to the room, never stored. Joined rooms only.
        case "stroke_start":
        case "stroke_points":
            if (client.rooms.has(message.roomId)) broadcast(message.roomId, message, socket);
            return;

        case "clear_room": {
            const { roomId, seq } = message;
            if (!requireRoom(client, roomId, seq)) return;
            if (!(await isAdmin(roomId, userId))) {
                send(socket, { type: "error", message: "Only the room's owner can clear the board" });
                acknowledge(socket, seq);
                return;
            }
            broadcast(roomId, { type: "clear_room", roomId });
            roomFor(roomId).shapeCount = 0;
            persist(roomId, socket, seq, { message: "The board could not be cleared" }, async () => {
                await withDb(() => prismaClient.shape.deleteMany({ where: { roomId: Number(roomId) } }));
                return true;
            });
            return;
        }

        case "shape": {
            const { roomId, id, shape, seq } = message;
            if (!requireRoom(client, roomId, seq)) return;
            const strokeId = message.strokeId ?? null;

            const room = roomFor(roomId);
            if (room.shapeCount >= MAX_SHAPES_PER_ROOM) {
                // the cached count only goes up; recount before refusing
                room.shapeCount = await withDb(() =>
                    prismaClient.shape.count({ where: { roomId: Number(roomId) } })
                );
            }
            if (room.shapeCount >= MAX_SHAPES_PER_ROOM) {
                // sender already drew it locally; undo it there
                send(socket, { type: "delete_shape", id, roomId });
                send(socket, {
                    type: "error",
                    message: `This board is full (${MAX_SHAPES_PER_ROOM} shapes). Delete some to add more.`,
                    strokeId,
                });
                acknowledge(socket, seq);
                return;
            }
            room.shapeCount++;

            // Broadcast first, persist after: the row adds nothing receivers
            // need, and waiting on Postgres (seconds when Neon is cold) delays
            // everyone. Safe because receivers dedupe by id and the upsert
            // makes a resend a no-op. If the write fails, `persist` reloads the room.
            // strokeId lets receivers clear the live preview of this stroke
            broadcast(roomId, { type: "shape", roomId, id, shape, strokeId });

            persist(roomId, socket, seq, { message: "That shape could not be saved", strokeId }, async () => {
                try {
                    // Upsert so a resend is a no-op. Keep `update` empty:
                    // updating on conflict would resurrect deleted shapes.
                    await withDb(() => prismaClient.shape.upsert({
                        where: { id },
                        create: { id, type: shape.type, data: shape.data, roomId: Number(roomId), userId },
                        update: {},
                    }));
                    return true;
                } catch (err) {
                    // A reported failure may still have committed (three creates
                    // reported P1001 and all were stored). Check before calling
                    // it lost; if that also fails, rethrow and let the room reload.
                    console.error("[WS] shape create reported a failure:", err);
                    const row = await withDb(() =>
                        prismaClient.shape.findUnique({ where: { id }, select: { id: true } })
                    );
                    return row !== null;
                }
            });
            return;
        }

        case "update_shape": {
            const { roomId, update, seq } = message;
            if (!requireRoom(client, roomId, seq)) return;
            // Broadcast first, like every other change.
            broadcast(roomId, { type: "update_shape", roomId, update });
            // id lets the sender revert its optimistic change
            persist(roomId, socket, seq, { message: "That shape no longer exists", id: update.id }, async () => {
                const { count } = await withDb(() => prismaClient.shape.updateMany({
                    // Scoped to room and type, so a member can't edit another
                    // board's shape or give a shape the wrong geometry.
                    where: { id: update.id, roomId: Number(roomId), type: update.shapeType },
                    data: { data: update.data },
                }));
                return count > 0;
            });
            return;
        }

        // Batched gestures (group drag/resize, multi-delete): one message,
        // one broadcast, one statement per chunk.
        case "update_shapes": {
            const { roomId, updates, seq } = message;
            if (!requireRoom(client, roomId, seq)) return;
            broadcast(roomId, { type: "update_shapes", roomId, updates });
            persist(roomId, socket, seq, { message: "Those changes could not be saved" }, async () => {
                // fewer rows than sent: one was gone or had a different type
                const changed = await withDb(() => updateShapesBatch(Number(roomId), updates));
                return changed === updates.length;
            });
            return;
        }

        case "delete_shape": {
            const { roomId, id, seq } = message;
            if (!requireRoom(client, roomId, seq)) return;
            broadcast(roomId, { type: "delete_shape", id, roomId });
            persist(roomId, socket, seq, { message: "That shape could not be deleted" }, async () => {
                // no match is fine: already erased
                await withDb(() => prismaClient.shape.deleteMany({ where: { id, roomId: Number(roomId) } }));
                return true;
            });
            return;
        }

        case "delete_shapes": {
            const { roomId, ids, seq } = message;
            if (!requireRoom(client, roomId, seq)) return;
            broadcast(roomId, { type: "delete_shapes", ids, roomId });
            persist(roomId, socket, seq, { message: "Those shapes could not be deleted" }, async () => {
                await withDb(() => deleteShapesBatch(Number(roomId), ids));
                return true;
            });
            return;
        }
    }
}

/* ── Connections ───────────────────────────────────────────────────────── */

const wss = new WebSocketServer({
    port: Number(process.env.PORT) || 8080,
    // ws defaults to 100MB
    maxPayload: MAX_MESSAGE_BYTES,
    // Refuse sockets from other sites. The token (sent as a message, not a
    // cookie) is the real guard, but there's no reason to let them connect.
    verifyClient: ({ origin }: { origin?: string }) => isAllowedOrigin(origin),
});

connectDatabase();

wss.on("connection", (socket) => {
    const client: Client = {
        socket,
        userId: null,
        rooms: new Set(),
        chain: Promise.resolve(),
        messageTokens: MESSAGE_BURST,
        byteTokens: BYTE_BURST,
        refilledAt: Date.now(),
        dropped: 0,
        warnedAt: 0,
        alive: true,
    };
    clients.set(socket, client);

    // close sockets that never authenticate
    const authTimer = setTimeout(() => {
        if (!client.userId) socket.close(4401, "Sign in again");
    }, AUTH_TIMEOUT_MS);

    socket.on("pong", () => { client.alive = true; });

    // ws closes the socket itself on oversized frames; this just avoids an unhandled error
    socket.on("error", (err) => console.warn("[WS] socket error:", err.message));

    socket.on("close", () => {
        clearTimeout(authTimer);
        for (const roomId of [...client.rooms]) leaveRoom(client, roomId);
        clients.delete(socket);
        if (client.userId) {
            const open = (socketsPerUser.get(client.userId) ?? 1) - 1;
            if (open <= 0) socketsPerUser.delete(client.userId);
            else socketsPerUser.set(client.userId, open);
        }
    });

    socket.on("message", (data: RawData, isBinary: boolean) => {
        if (isBinary) {
            socket.close(1003, "Text frames only");
            return;
        }
        const raw = Buffer.isBuffer(data)
            ? data
            : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);

        if (!withinLimits(client, raw.length)) {
            if (++client.dropped > MAX_DROPPED) {
                socket.close(4429, "Too many messages");
                return;
            }
            refuse(client, "You are sending changes too quickly - some were not saved");
            return;
        }

        // One at a time, in arrival order: a join must finish its DB check
        // before later messages run. The catch keeps one bad message or a
        // sleeping database from crashing the process.
        client.chain = client.chain
            .then(() => handle(client, raw))
            .catch((err) => {
                console.error("[WS] failed to handle message:", err);
                refuse(client, "Could not process that message");
            });
    });
});

/**
 * Pings every socket; one that missed the last ping is terminated. Catches
 * connections that vanished silently, and keeps idle ones open through proxies.
 */
const heartbeat = setInterval(() => {
    for (const client of clients.values()) {
        if (!client.alive) {
            client.socket.terminate();
            continue;
        }
        client.alive = false;
        client.socket.ping();
    }
}, HEARTBEAT_MS);

/**
 * On SIGTERM (every deploy): stop accepting connections, tell clients to
 * reconnect (1012), wait for every room's write queue to drain, then close
 * the DB. Needed because changes are broadcast before they're written.
 */
async function shutdown(signal: string) {
    console.log(`[WS] ${signal} received, draining writes`);
    clearInterval(heartbeat);
    wss.close();
    const queues = [...rooms.values()].map((room) => room.tail);
    for (const socket of clients.keys()) socket.close(1012, "Server restarting");
    // time-boxed; the host will kill us anyway
    await Promise.race([Promise.allSettled(queues), sleep(8000)]);
    await prismaClient.$disconnect().catch(() => {});
    process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
