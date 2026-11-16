# Hardening synopsis

What was fixed from the pre-deploy review, why each one mattered, and how it was solved.
Part 1 covers the problems that would have hurt badly. Part 2 lists everything else in a
few lines each. Part 3 is what was deliberately left, and what the host still needs.

## How this was checked

Everything below was run after the last code change.

| Check | Result |
| --- | --- |
| `pnpm build` (all three apps, including `next build`) | passes |
| `pnpm test` (unit tests: schema, shape guard, stroke simplification, image sniffing) | 14 of 14 pass |
| `pnpm smoke` (end to end against the running API, socket server, database and storage) | 46 of 46 pass |
| `pnpm audit --prod` | 0 advisories (was 62) |
| Frontend ESLint | 0 errors (was 13) |
| Database | migration applied, schema matches, no drift |

**Production startup.** With `NODE_ENV` unset, or `production` without a real secret or
an origin list, both servers refuse to start. Fully configured, the API answers, a token
forged with the old dev secret gets 401, a token claiming `alg: none` gets 401, only the
configured origin gets CORS headers, and the socket server refuses a foreign origin.

**In a browser, by hand:**

- Guest sign-in; a refused sign-up shows the server's sentence and stays on the page.
- Create a canvas, including the refused too-short name.
- Draw a circle, rectangle, arrow, pencil stroke and text; paste an image (the whole
  upload path); reload and find it all there.
- Move one shape, move a selection, erase a shape, delete with the Delete key.
- A second window on the same board shows every one of those changes live.
- Stop the socket server: the notice appears and stays. Draw a shape while it is down,
  restart it, and the shape is saved.
- Zoom out, zoom in, pan and fit-to-screen: shapes off screen are skipped, shapes
  crossing the edge are still drawn.
- Dashboard: a refused rename rolls back with a message, an accepted one keeps the same
  share link, the old name link opens for the owner, and the share link shows the id.
- A second account is refused by the name link, admitted by the share link, and sees the
  board under "Shared with you".
- Delete a canvas that has a member (204, gone for both people), and delete an account.

**Not checked** is listed in Part 3.

---

## Part 1 — the ones that would have hurt

### 1. Anyone could join any board over the WebSocket

**The issue.** `join_room` added a room to the socket without asking whether the account
was allowed in it. Live pencil strokes were relayed to any room id the message named,
joined or not.

**How it would have gone wrong.** Room ids are sequential integers and a guest account is
one click. A script could count upwards from 1 and read, draw on and erase every board
in the system. The HTTP route for loading shapes already checked membership, so the
hole was easy to miss.

**The fix.** `join_room` now runs the same owner-or-member check as `GET /shapes/:roomId`
(`roomAccess` in `apps/ws-backend/src/index.ts`) and fails closed if the database cannot
be asked. Every other message requires the socket to have joined. Messages from one
socket are handled in order, so a join is settled before the messages sent after it.
The canvas page now joins over HTTP first, because that is what makes a first-time
visitor a member.

### 2. Shapes were stored and relayed without being looked at

**The issue.** The socket server checked that a shape had an id and nothing else. Its
`type` and `data` went straight into Postgres and out to every client. There was no size
limit either: `ws` reads frames up to 100 MB by default.

**How it would have gone wrong.** One malformed shape, such as a pencil stroke with
`points: null`, throws inside every client's repaint on every frame. Because the row is
stored, the board stays broken across reloads for everyone until someone deletes the row
by hand. Any member of a board could do this in one message.

**The fix.** Every message is parsed against a zod schema in
`packages/common/src/protocol.ts` before anything acts on it. Coordinates are bounded,
strokes are capped at 10,000 points, text at 10,000 characters, batches at 2,000 shapes
and frames at 2 MB. The server stores and relays the parsed value, so unknown keys are
dropped. Updates now carry the shape's type and are checked against it. The client has
a second guard (`draw/shapeGuard.ts`) so a bad shape is left out instead of breaking the
board. All 82 shapes already in the database pass it.

### 3. Uploads were not tied to what was approved

**The issue.** The upload URL fixed the object key but not the bytes, the size or the
type, and `/files/confirm` never checked that the bytes hashed to the key. The URL wrote
directly to the final, public key.

**How it would have gone wrong.** Images are stored once by hash and handed to everyone
who later pastes "the same" picture. Someone could claim a popular image's hash with
different bytes, and other people's boards would show their image. The same URL could
also overwrite an image that was already confirmed. Separately, any account could park
files of any size and type in the public bucket and never confirm them.

**The fix.** Browsers now upload to a holding key (`tmp/<user>/<hash>`), never to the
final one. The exact size and content type are signed into the URL. `/files/confirm`
reads the pending object (capped at 5 MB), hashes it, checks it starts like a PNG, JPEG,
WebP or GIF, and then writes the final object itself with the type it worked out.
Anything that fails is deleted on the spot. Pending objects nobody confirms are swept
after an hour (`apps/http-backend/src/fileCleanup.ts`), and uploads are rate-limited and
capped at 250 MB per account.

### 4. A board's privacy was its name

**The issue.** The share link was `/canvas/<name>`, and knowing the name was all it took
to join.

**How it would have gone wrong.** People name boards "standup" and "roadmap". Guessing a
name gave full read and write access, and renaming a board broke every link already sent.

**The fix.** Every room has a random `shareId` (migration
`20261115120000_share_ids_and_indexes`), and links are `/canvas/<shareId>`. Only the
share id creates a membership. A name still opens the board for its owner and existing
members, so old bookmarks keep working, but it admits nobody new. Renaming no longer
changes the link. Joining is rate-limited per account.

### 5. The signing key fell back to a published value

**The issue.** `JWT_SECRET` defaulted to a string in the repository unless `NODE_ENV` was
exactly `production`.

**How it would have gone wrong.** A host that never set `NODE_ENV` would run with a key
anyone can read on GitHub, and with it forge a token for any account.

**The fix.** The default is only used when `NODE_ENV` is explicitly `development` or
`test` (the dev scripts set it). Anywhere else a missing secret, or one shorter than 32
characters, stops the process at startup. Tokens are signed and verified with the
algorithm pinned to HS256 on both servers. `ALLOWED_ORIGINS` gets the same
required-in-production treatment.

### 6. Deleting a canvas destroyed the drawing and kept the canvas

**The issue.** The route deleted the shapes, then the room, in two separate statements,
and sent no response when it succeeded.

**How it would have gone wrong.** For any room someone had joined, the room delete was
blocked by the membership foreign key after the shapes were already gone, and the handler
answered 200. The canvas came back on reload, empty. When the delete did work, the
request hung until a proxy timed it out, and the dashboard restored the canvas and
reported a failure.

**The fix.** Shapes, memberships and the room are deleted in one transaction, and the
route answers 204. A bad id is a 400 and other failures return a string message.

### 7. A dropped connection lost work silently

**The issue.** Nothing handled the socket closing, and `send()` had no check. Separately,
shapes loaded over HTTP while the socket was already delivering, and the response
replaced the list.

**How it would have gone wrong.** After a wifi blip, a deploy or a proxy idle timeout,
people kept drawing and none of it was saved, with no warning. On load, a shape drawn by
someone else in the wrong half second was dropped, and a deleted one came back.

**The fix.** `draw/connection.ts` owns the socket. It reconnects with backoff, pings to
detect dead connections, holds changes made offline and resends anything the server
never acknowledged. The server acknowledges each change once it is stored. While a
snapshot is loading, incoming messages are held and applied on top of it, and the server
only says "joined" after the room's pending writes have finished. A notice stays on
screen while disconnected.

### 8. Sign-up accepted anything, and errors came back as 200

**The issue.** Email and password were bare strings, so an empty password was valid.
Usernames could contain `@`. Invalid sign-ups and duplicate canvas names answered 200.

**How it would have gone wrong.** Someone could register a username equal to another
person's email and be found first when that person signed in. An invalid sign-up showed
"Account created". A duplicate canvas name sent the dashboard to `/canvas/undefined`. A
duplicate sign-up returned a raw database error object that the page tried to render.

**The fix.** Emails are validated and lowercased, passwords need 8 characters, and
usernames are limited to letters, digits, dot, dash and underscore. Sign-in looks in one
column, chosen by whether the input contains `@`. Every refusal is a 4xx with a string
message, and the frontend only ever renders a string (`lib/errors.ts`).

### 9. It only ran on your machine

**The issue.** Server URLs were hardcoded to localhost in a dozen files. The compiled
backends loaded raw `.ts` from the workspace packages, which only works on recent Node.
`start` compiled at boot and required a `.env` file. The socket port was fixed.

**How it would have gone wrong.** The first deploy would have failed in several
unrelated ways, one after another.

**The fix.**
- Frontend URLs come from `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` (`lib/config.ts`).
- The three packages compile to `dist/`; turbo builds them before `dev` and `build`.
- `start` runs the built output with an optional `.env`; `dev` sets `NODE_ENV=development`.
- Both servers read `PORT`; runtime packages moved to `dependencies`.
- `db-package` build runs `prisma generate`; `pnpm db:deploy` applies migrations.
- `directUrl` added for migrations; Node pinned to 22 (`engines`, `.nvmrc`).
- `.env.example` files added or updated for all three apps and the database package.

---

## Part 2 — everything else

**No index on `Shape.roomId`, `Room.adminId`, `RoomMember.userId`.** Every board load
scanned every shape in the system. Added `(roomId, createdAt)` on Shape plus indexes on
the other two and on `File.userId`. Applied to the database; no drift.

**Lint errors would fail `next build`.** 13 errors. Replaced `catch (err: any)` with a
shared `errorMessage` helper and fixed the `var` declarations. ESLint is at 0 errors.

**`trust proxy` not set.** Behind a proxy every visitor shared one rate-limit bucket.
It is now 1 hop in production and 0 otherwise, overridable with `TRUST_PROXY`. Never
`true`, which would let clients spoof their IP.

**No per-socket limits.** Each socket now has a message and byte allowance (200/s
sustained), each account at most 10 sockets, and a socket that stops reading is dropped.

**No `Origin` check, and the token was in the socket URL.** Browser pages from origins
outside `ALLOWED_ORIGINS` are refused at the upgrade. The token is sent as the first
message instead of in the URL, where it ended up in proxy logs.

**No security headers.** `helmet` on the API. The Next app sends a CSP, `X-Frame-Options`,
`nosniff`, a referrer policy (canvas URLs now contain a secret) and HSTS in production.

**Sign-in timing revealed which accounts exist.** Unknown users returned before bcrypt
ran. A dummy hash is now compared in that case, so both answers take the same time.

**No quotas.** 100 canvases per account, 20,000 shapes per board, 250 MB of images per
account, and per-account rate limits on creating canvases, joining and uploading.

**Rename accepted any string.** It now uses the same schema as create, which also
rejects `/ \ ? # %`.

**Small images were uploaded untouched, EXIF included.** Every image is now re-encoded
in the browser before upload (PNG for small PNG/GIF, WebP otherwise), so GPS and camera
data never reach the public bucket.

**Every message scanned every connection.** Sockets are now held in a map by connection
and a set per room, and a broadcast is serialised once instead of once per recipient.

**Pencil sent one frame per mouse move.** Points are batched every 30 ms. Finished
strokes are simplified with a half-pixel tolerance before saving, which keeps the same
pixels with far fewer points.

**Single edits waited for Postgres before reaching other people.** All changes are now
broadcast first and written after, in order, through one queue per room.

**The two `/rooms` queries ran one after the other.** They now run together.

**Every mouse move repainted the whole board.** Repaints are coalesced to one per
animation frame. The in-progress shape is drawn inside that paint.

**Off-screen shapes were painted and hit-tested.** Shapes outside the viewport are
skipped, shape bounds are cached, and hit-testing rejects by bounds first. Group drags
no longer search the whole board once per selected shape.

**Edits to one shape could commit out of order.** The per-room write queue stores
changes in the order they were broadcast. It replaced the `pendingCreates` map.

**A failed write only told the sender.** The room is now marked for reload, and once its
queue has drained everyone is sent `resync` and reloads from the database.

**A peer who dropped mid-stroke left a half-drawn line.** Live strokes that receive no
points for 15 seconds are removed.

**Neither server handled SIGTERM.** The API finishes in-flight requests. The socket
server tells clients to reconnect, drains its write queues, then closes the database.

**Deleting a room did not tell connected sockets.** The next write fails, the room
reloads, the load returns 404, and the client says the board no longer exists.

**Uploaded files were never garbage-collected.** A sweep removes images that no shape
has referenced for 7 days, and pending uploads older than an hour.

**A stale file row made an image impossible to re-upload.** Found while testing: if the
bucket loses an object, presign kept answering "already stored". It now checks the
object exists and removes the stale row.

**Dependencies with advisories.** 62 before, 0 now. Direct updates: express 5.3, ws 8.23,
zod 4.6.7, axios 1.21, jsonwebtoken 9.0.3, next 15.5.29, prisma 6.19.3, the AWS SDK.
Seven transitive packages are pinned to patched versions through `pnpm.overrides` in the
root `package.json`; the build, tests and Prisma CLI all pass with them.

**Next guessed the wrong workspace root.** It picked the home directory because of a
stray lockfile there. `outputFileTracingRoot` now names the monorepo root.

**The frontend's `.env.example` was git-ignored.** It now lists the two new URL
variables, and the ignore rule has an exception so it can be committed.

---

## Part 3 — not done, and what the host needs

### Left as they were, by your choice

- **Sessions.** Tokens still live 15 days in `localStorage` with no revocation.
- **Viewer / editor roles.** Anyone in a board can still edit and erase.
- **Email verification and password reset.** Needs an email provider.
- **Guest board handover.** An expired guest's boards are still deleted with everything
  on them, including what registered collaborators drew.

### Skipped, with the reason

- **Offscreen layer for settled shapes.** It conflicts with the "nothing retains" rule in
  CLAUDE.md, and culling plus one paint per frame cover most of the cost.
- **`Map` by id for `existingShapes`.** About 45 call sites and no tests around them. The
  quadratic paths it would have fixed are fixed another way.
- **Explicit z-order key.** Nothing uses it until bring-to-front exists.

### Not checked

- **Real R2 or S3.** The signed upload headers were tested against LocalStack with
  signature validation switched on, which is the closest local equivalent.
- **Speed.** One paint per frame, culling and the per-room socket map were checked for
  correctness, not measured. There is no before-and-after number.
- **More than one server instance.** Rate limits, the per-room write queues and the
  sweeps live in each process's memory.
- **PDF export** was not re-run. Its code was not changed; the shared paint function
  gained one optional argument that export does not pass.
- **Load.** The limits (messages per second, sockets per account, queue length) were
  chosen from how the client behaves, not from a load test.
- **Touch devices and GIF upload** were not tried.

### Things that changed on your machine

- The migration was applied to the Neon database.
- `DIRECT_URL` was added to `packages/db-package/.env`, derived from `DATABASE_URL`
  without the pooler.
- Docker Desktop was started and is still running. Three of your other containers
  started with it; I left them alone. The LocalStack container is stopped.
- The LocalStack container was recreated to switch on signature validation. Its bucket
  was already empty, because LocalStack does not keep data across restarts: 6 file rows
  pointed at objects that no longer existed, and 2 image shapes show placeholders.
- The new sweep ran once and removed 3 of those rows, which were over a week old and
  which no shape referenced. That is what it is for.
- Every account, canvas and upload created during testing was removed. The database is
  back to 11 users, 9 rooms, 82 shapes and 3 memberships.
- No existing username contains `@`, so the new sign-in rule locks nobody out. One
  existing email has capitals; sign-in compares emails without regard to case.
- `CLAUDE.md` was updated to match the new protocol, build and upload flow.
- Nothing was committed.

### Host-side settings

- Set `JWT_SECRET` (32+ characters, identical on both servers), `ALLOWED_ORIGINS`,
  `NODE_ENV=production`, `DATABASE_URL` (pooled) and `DIRECT_URL` (direct).
- Set `NEXT_PUBLIC_API_URL` (https) and `NEXT_PUBLIC_WS_URL` (wss) at **build** time.
- Run `pnpm db:deploy` on each release, before the servers start.
- Configure the production bucket's CORS for your site's origin, with `PUT`, `GET`, `HEAD`.
- Turn off Neon autosuspend, keep the servers in the database's region, and put a CDN in
  front of the bucket. Final objects are now written with an immutable cache header.
