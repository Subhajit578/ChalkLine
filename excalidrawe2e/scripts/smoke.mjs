/**
 * End-to-end checks against the running API and socket server.
 *
 *   pnpm dev            (in another terminal)
 *   pnpm smoke
 *
 * Exercises the rules that are easy to break without noticing: who may join
 * a board, what the socket server refuses, what a failed request answers
 * with. It talks to the real servers and the real database, creating guest
 * accounts and one room and deleting them again at the end.
 *
 * No dependencies: fetch and WebSocket are built into Node 22.
 */
import { createHash, randomBytes } from "node:crypto";

const API = process.env.API_URL ?? "http://localhost:3001";
const WS = process.env.WS_URL ?? "ws://localhost:8080";

let failures = 0;
let skipped = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  - ${detail}` : ""}`);
  if (!ok) failures++;
}
const show = (value) => JSON.stringify(value)?.slice(0, 160);

async function api(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

/** A socket whose incoming messages can be awaited by predicate. */
class Sock {
  constructor() {
    this.inbox = [];
    this.waiters = [];
    this.closeCode = null;
    this.ws = new WebSocket(WS);
    this.opened = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error(`could not connect to ${WS}`));
    });
    this.ws.onmessage = (event) => {
      this.inbox.push(JSON.parse(event.data));
      this.settle();
    };
    this.ws.onclose = (event) => {
      this.closeCode = event.code;
      this.settle();
    };
  }
  settle() {
    this.waiters = this.waiters.filter((waiter) => !waiter());
  }
  send(message) {
    this.ws.send(typeof message === "string" ? message : JSON.stringify(message));
  }
  /** The first message matching `match` (removed from the inbox), or null. */
  next(match, ms = 6000) {
    return new Promise((resolve) => {
      const attempt = () => {
        const index = this.inbox.findIndex(match);
        if (index === -1) return false;
        clearTimeout(timer);
        resolve(this.inbox.splice(index, 1)[0]);
        return true;
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter !== attempt);
        resolve(null);
      }, ms);
      if (!attempt()) this.waiters.push(attempt);
    });
  }
  /** The close code, or null if still open after `ms`. */
  closed(ms = 6000) {
    return new Promise((resolve) => {
      const attempt = () => {
        if (this.closeCode === null) return false;
        clearTimeout(timer);
        resolve(this.closeCode);
        return true;
      };
      const timer = setTimeout(() => resolve(null), ms);
      if (!attempt()) this.waiters.push(attempt);
    });
  }
  async authed(token) {
    await this.opened;
    this.send({ type: "auth", token });
    return (await this.next((m) => m.type === "ready")) !== null;
  }
  close() {
    try { this.ws.close(); } catch { /* already closed */ }
  }
}

const is = (type) => (m) => m.type === type;
const rect = { type: "rect", data: { x: 10, y: 20, width: 30, height: 40, color: "ink" } };

async function main() {
  const tokens = [];      // guest accounts to delete at the end
  const sockets = [];
  const sock = () => { const s = new Sock(); sockets.push(s); return s; };
  let registered = null;  // { token, password }

  try {
    /* ── sign-up validation ─────────────────────────────────────────── */
    const name = `smoke${randomBytes(4).toString("hex")}`;
    const email = `${name}@example.com`;
    const password = "correct-horse-battery";

    let r = await api("POST", "/signup", { body: { email: "not-an-email", username: name, password } });
    check("signup: a bad email is a 400 with a sentence", r.status === 400 && typeof r.data?.message === "string", show(r));
    r = await api("POST", "/signup", { body: { email, username: name, password: "" } });
    check("signup: an empty password is refused", r.status === 400, show(r));
    r = await api("POST", "/signup", { body: { email, username: "someone@else.com", password } });
    check("signup: a username cannot contain @", r.status === 400, show(r));

    r = await api("POST", "/signup", { body: { email: email.toUpperCase(), username: name, password } });
    check("signup: a valid account is created", r.status === 201, show(r));
    r = await api("POST", "/signup", { body: { email, username: name, password } });
    check("signup: a duplicate is a 409 with a string message", r.status === 409 && typeof r.data?.message === "string", show(r));

    r = await api("POST", "/signin", { body: { identifier: name, password } });
    check("signin: by username", r.status === 200 && typeof r.data?.token === "string", show(r));
    if (r.data?.token) registered = { token: r.data.token, password };
    r = await api("POST", "/signin", { body: { identifier: email, password } });
    check("signin: by email, whatever its case at signup", r.status === 200, show(r));
    r = await api("POST", "/signin", { body: { identifier: name, password: "wrong-password" } });
    check("signin: a wrong password is a 401", r.status === 401, show(r));

    /* ── two guests, one room ───────────────────────────────────────── */
    const guestA = await api("POST", "/guest");
    const guestB = await api("POST", "/guest");
    check("guest accounts can be created", guestA.status === 200 && guestB.status === 200, show(guestA));
    const A = guestA.data.token;
    const B = guestB.data.token;
    tokens.push(A, B);

    const roomName = `smoke-${randomBytes(3).toString("hex")}`;
    r = await api("POST", "/room", { token: A, body: { slug: "x" } });
    check("room: a too-short name is a 400", r.status === 400 && typeof r.data?.message === "string", show(r));
    r = await api("POST", "/room", { token: A, body: { slug: roomName } });
    check("room: created with a share id", r.status === 201 && typeof r.data?.shareId === "string", show(r));
    const roomId = String(r.data.roomId);
    const shareId = r.data.shareId;
    r = await api("POST", "/room", { token: A, body: { slug: roomName } });
    check("room: a duplicate name is a 409", r.status === 409, show(r));
    r = await api("PATCH", `/room/${roomId}`, { token: A, body: { slug: "a/b?c" } });
    check("room: a rename with URL characters is refused", r.status === 400, show(r));

    /* ── who may get in ─────────────────────────────────────────────── */
    r = await api("GET", `/shapes/${roomId}`, { token: B });
    check("http: a non-member cannot read a board", r.status === 404, show(r));
    r = await api("POST", `/room/${encodeURIComponent(roomName)}/join`, { token: B });
    check("http: knowing a board's name does not let a stranger join", r.status === 404, show(r));

    const b = sock();
    check("ws: auth message is accepted", await b.authed(B));
    b.send({ type: "join_room", roomId });
    r = await b.next(is("error"));
    check("ws: a non-member cannot join a room by id", r?.code === "forbidden", show(r));
    b.send({ type: "shape", roomId, id: "smoke-1", shape: rect });
    r = await b.next(is("error"));
    check("ws: drawing in a room you have not joined is refused", r !== null, show(r));

    r = await api("POST", `/room/${shareId}/join`, { token: B });
    check("http: the share link id lets them join", r.status === 200 && r.data?.joined === true, show(r));
    b.send({ type: "join_room", roomId });
    check("ws: a member can join", (await b.next(is("joined"))) !== null);

    const a = sock();
    await a.authed(A);
    a.send({ type: "join_room", roomId });
    check("ws: the owner can join", (await a.next(is("joined"))) !== null);

    /* ── drawing ────────────────────────────────────────────────────── */
    a.send({ type: "shape", roomId, id: "smoke-1", shape: rect, seq: 7 });
    r = await a.next(is("ack"));
    check("ws: a numbered change is acknowledged once stored", r?.seq === 7, show(r));
    r = await b.next(is("shape"));
    check("ws: a shape reaches the other person", r?.id === "smoke-1" && r?.shape?.type === "rect", show(r));

    b.send({ type: "shape", roomId, id: "smoke-poison", shape: { type: "pencil", data: { points: null, color: "ink" } } });
    r = await b.next(is("error"));
    const leaked = await a.next((m) => m.type === "shape" && m.id === "smoke-poison", 800);
    check("ws: a malformed shape is refused and never relayed", r !== null && leaked === null, show(leaked));
    await b.next(is("resync"), 500);   // the sender is told to reload; not what this checks

    b.send({ type: "update_shape", roomId, update: { id: "smoke-1", shapeType: "rect", data: { x: 99, y: 20, width: 30, height: 40, color: "ink" } } });
    r = await a.next(is("update_shape"));
    check("ws: an update reaches the other person", r?.update?.data?.x === 99, show(r));

    b.send({ type: "stroke_start", roomId, strokeId: "st-1", color: "ink" });
    b.send({ type: "stroke_points", roomId, strokeId: "st-1", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] });
    r = await a.next(is("stroke_points"));
    check("ws: live stroke points are relayed in batches", r?.points?.length === 2, show(r));

    // a second shape with a type the update then lies about
    a.send({ type: "shape", roomId, id: "smoke-2", shape: rect });
    await b.next(is("shape"));
    b.send({ type: "update_shape", roomId, update: { id: "smoke-2", shapeType: "circle", data: { centerX: 1, centerY: 1, radius: 5 } } });
    r = await b.next(is("resync"), 8000);
    check("ws: an update that does not match the stored type triggers a reload", r !== null, show(r));

    await new Promise((resolve) => setTimeout(resolve, 500));
    r = await api("GET", `/shapes/${roomId}`, { token: A });
    const stored = r.data?.shapes ?? [];
    check(
      "db: valid changes were stored, refused ones were not",
      stored.length === 2 &&
        stored.find((s) => s.id === "smoke-1")?.data?.x === 99 &&
        stored.find((s) => s.id === "smoke-2")?.type === "rect" &&
        stored.find((s) => s.id === "smoke-2")?.data?.width === 30,
      show(stored)
    );

    /* ── owner-only, and limits ─────────────────────────────────────── */
    b.send({ type: "clear_room", roomId });
    r = await b.next(is("error"));
    check("ws: only the owner can clear a board", r !== null, show(r));

    const stranger = sock();
    await stranger.opened;
    stranger.send({ type: "join_room", roomId });
    check("ws: a socket that skips auth is closed", (await stranger.closed()) === 4401);

    const forged = sock();
    await forged.opened;
    forged.send({ type: "auth", token: "not.a.token" });
    check("ws: a bad token is closed", (await forged.closed()) === 4401);

    const big = sock();
    await big.authed(B);
    big.send(JSON.stringify({ type: "ping", pad: "x".repeat(3 * 1024 * 1024) }));
    check("ws: a frame over the size cap closes the socket", (await big.closed()) !== null);

    /* ── uploads ────────────────────────────────────────────────────── */
    const png = Buffer.concat([
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
      randomBytes(8),   // trailing bytes a decoder ignores, so every run uploads something new
    ]);
    const hash = createHash("sha256").update(png).digest("hex");
    const meta = { mimeType: "image/png", size: png.length, width: 1, height: 1 };
    const put = (url, body) => fetch(url, { method: "PUT", headers: { "Content-Type": "image/png" }, body });

    r = await api("POST", "/files/presign", { token: A, body: { hash, ...meta } });
    let storageUp = r.status === 200 && r.data?.exists === false;
    if (storageUp) {
      try {
        const oversized = await put(r.data.uploadUrl, Buffer.concat([png, Buffer.alloc(4096)]));
        check("upload: the URL only takes the size it was signed for", !oversized.ok, String(oversized.status));
        const uploaded = await put(r.data.uploadUrl, png);
        check("upload: the browser can PUT to the pending key", uploaded.ok, String(uploaded.status));
      } catch {
        storageUp = false;
      }
    }
    if (!storageUp) {
      skipped++;
      console.log("SKIP  uploads - object storage is not reachable (docker compose up -d)");
    } else {
      check("upload: the pending key is not the public one", new URL(r.data.uploadUrl).pathname.includes("/tmp/"));
      r = await api("POST", "/files/confirm", { token: A, body: { hash, width: 1, height: 1 } });
      check("upload: genuine bytes are confirmed", r.status === 200 && typeof r.data?.url === "string", show(r));
      const served = r.data?.url ? await fetch(r.data.url) : null;
      check(
        "upload: the stored object is the bytes, typed by the server",
        served?.ok === true &&
          served.headers.get("content-type") === "image/png" &&
          createHash("sha256").update(Buffer.from(await served.arrayBuffer())).digest("hex") === hash,
        String(served?.status)
      );

      // someone claims a hash and uploads different bytes under it
      const claimed = createHash("sha256").update(randomBytes(32)).digest("hex");
      r = await api("POST", "/files/presign", { token: B, body: { hash: claimed, ...meta } });
      await put(r.data.uploadUrl, png);
      r = await api("POST", "/files/confirm", { token: B, body: { hash: claimed, width: 1, height: 1 } });
      check("upload: bytes that do not match their hash are refused", r.status === 422, show(r));
      r = await api("POST", "/files/confirm", { token: B, body: { hash: claimed, width: 1, height: 1 } });
      check("upload: and the pending object is gone afterwards", r.status === 409, show(r));

      // not an image at all, hashed honestly
      const html = Buffer.from(`<script>alert(${Date.now()})</script>`);
      const htmlHash = createHash("sha256").update(html).digest("hex");
      r = await api("POST", "/files/presign", { token: B, body: { hash: htmlHash, mimeType: "image/png", size: html.length, width: 1, height: 1 } });
      await put(r.data.uploadUrl, html);
      r = await api("POST", "/files/confirm", { token: B, body: { hash: htmlHash, width: 1, height: 1 } });
      check("upload: a file that is not an image is refused", r.status === 422, show(r));
    }

    /* ── deleting a room that has a member ──────────────────────────── */
    r = await api("DELETE", `/room/${roomId}`, { token: B });
    check("room: a member cannot delete it", r.status === 403, show(r));
    r = await api("DELETE", `/room/${roomId}`, { token: A });
    check("room: the owner's delete answers, with 204", r.status === 204, show(r));
    r = await api("GET", "/rooms", { token: A });
    check("room: it is gone from the owner's list", !(r.data?.rooms ?? []).some((room) => String(room.id) === roomId), show(r));
    r = await api("GET", "/rooms", { token: B });
    check("room: and from the member's", !(r.data?.joined ?? []).some((room) => String(room.id) === roomId), show(r));

    // someone still on the board when it is deleted keeps drawing
    b.send({ type: "shape", roomId, id: "smoke-late", shape: rect });
    r = await b.next(is("resync"), 10000);
    check("ws: drawing on a deleted board tells everyone on it to reload", r !== null, show(r));
    r = await api("GET", `/shapes/${roomId}`, { token: B });
    check("http: and that reload finds the board gone", r.status === 404, show(r));
  } finally {
    for (const socket of sockets) socket.close();
    for (const token of tokens) await api("DELETE", "/account", { token, body: {} }).catch(() => {});
    if (registered) {
      await api("DELETE", "/account", { token: registered.token, body: { password: registered.password } }).catch(() => {});
    }
  }

  console.log(`\n${failures === 0 ? "All checks passed" : `${failures} check(s) FAILED`}${skipped ? `, ${skipped} group(s) skipped` : ""}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test could not run:", err.message);
  console.error(`is the dev stack up? expected the API at ${API} and the socket server at ${WS}`);
  process.exit(2);
});
