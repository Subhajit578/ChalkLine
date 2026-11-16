"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { ConfirmDialog } from "./ConfirmDialog";
import { getToken, clearToken, installSessionGuard } from "@/lib/session";
import { API_URL as API } from "@/lib/config";
import { errorMessage, errorStatus } from "@/lib/errors";
import { ClaimAccountBanner } from "./ClaimAccountBanner";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { Avatar } from "./Avatar";
import { AvatarPicker } from "./AvatarPicker";
import { makeNotice, ToastStack, type Notice } from "./Toast";
import {
  Plus,
  Trash2,
  LogOut,
  Pencil,
  Share2,
  Check,
  MoreVertical,
  Users,
} from "lucide-react";

type Room = {
  id: number;
  /** name */
  slug: string;
  /** random link id; never changes */
  shareId: string;
  createdAt: string;
};

/** A room someone else owns, opened through a shared link. */
type JoinedRoom = Room & {
  owner?: string;
  /** the owner's avatar id, resolved by the server */
  ownerAvatar?: string;
  joinedAt?: string;
};

export function Dashboard() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  // rooms other people own, picked up by opening their link
  const [joinedRooms, setJoinedRooms] = useState<JoinedRoom[]>([]);
  // the canvas awaiting a delete confirmation, or null
  const [deleteTarget, setDeleteTarget] = useState<Room | null>(null);
  const [joinInput, setJoinInput] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /**
   * Transient messages, used mainly to announce a rollback.
   *
   * `errorMsg` renders *instead of* the canvas list, which is right for
   * "nothing loaded" and wrong for "that one change did not stick" - it would
   * blank the page to report a failed rename. An optimistic change that gets
   * undone has to say so somewhere that does not destroy what the person is
   * looking at.
   */
  const [notices, setNotices] = useState<Notice[]>([]);
  const notify = useCallback((message: string, tone: "error" | "info" | "success" = "error") => {
    setNotices((current) => [...current, makeNotice(message, tone)]);
  }, []);
  const dismissNotice = useCallback((id: string) => {
    setNotices((current) => current.filter((n) => n.id !== id));
  }, []);

  // Todo - Create a createModal 
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Todo - Create rename modal
  const [renameTarget, setRenameTarget] = useState<Room | null>(null);
  const [renameSlug, setRenameSlug] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  // Todo - Create share + per-card menu
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  // who is signed in, so a guest can be offered the upgrade. Asked of the
  // server rather than read from the token: a token minted before the account
  // was claimed would keep claiming it is a guest.
  const [me, setMe] = useState<{
    username: string;
    email: string | null;
    isGuest: boolean;
    /** the avatar to render - always a valid one, see the server's avatarFor */
    avatar: string | null;
  } | null>(null);
  const [pickingAvatar, setPickingAvatar] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    // before the first authenticated call: a token whose account has been
    // deleted still looks valid here, and only the server can say otherwise
    installSessionGuard();
    // getToken drops an expired one, so this also covers a session that ran
    // out while the tab was closed
    const token = getToken();
    if (!token) {
      router.push("/signin");
      return;
    }
    fetchRooms();
    axios
      .get(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setMe(r.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const close = () => setOpenMenuId(null);
    if (openMenuId !== null) {
      window.addEventListener("click", close);
      return () => window.removeEventListener("click", close);
    }
  }, [openMenuId]);

  function authHeaders() {
    return { Authorization: `Bearer ${getToken()}` };
  }
// 
  /**
   * Takes the last segment of a pasted link (minus query/fragment), which is
   * the share id. A bare name also works for canvases you're already in, but
   * can no longer be used to join.
   */
  function slugFromInput(value: string) {
    const trimmed = value.trim().split(/[?#]/)[0] ?? "";
    const parts = trimmed.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? "";
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const slug = slugFromInput(joinInput);
    if (!slug) return;

    setIsJoining(true);
    setJoinError(null);
    try {
      // join first, so a wrong link reports here rather than on a blank canvas
      const res = await axios.post(
        `${API}/room/${encodeURIComponent(slug)}/join`,
        {},
        { headers: authHeaders() }
      );
      router.push(`/canvas/${res.data.room.shareId}`);
    } catch (err) {
      setJoinError(
        errorStatus(err) === 404
          ? "No canvas with that link"
          : errorMessage(err, "Could not open that canvas")
      );
      setIsJoining(false);
    }
  }

  async function fetchRooms() {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await axios.get(`${API}/rooms`, { headers: authHeaders() });
      setRooms(res.data.rooms);
      setJoinedRooms(res.data.joined ?? []);
    } catch (err) {
      setErrorMsg(errorMessage(err, "Failed to load canvases"));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newSlug.trim()) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await axios.post(
        `${API}/room`,
        { slug: newSlug.trim() },
        { headers: authHeaders() }
      );
      router.push(`/canvas/${res.data.shareId}`);
    } catch (err) {
      setCreateError(errorMessage(err, "Failed to create"));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDelete(id: number) {
    const room = rooms.find((r) => r.id === id) ?? null;
    setDeleteTarget(room);
  }

  async function confirmDelete() {
    const room = deleteTarget;
    if (!room) return;
    setDeleteTarget(null);

    // Where it was, not just that it was: restoring a rolled-back delete by
    // appending would silently reorder the list, and the person would be left
    // wondering whether something else had changed too.
    const index = rooms.findIndex((r) => r.id === room.id);
    setRooms((r) => r.filter((existing) => existing.id !== room.id));

    try {
      await axios.delete(`${API}/room/${room.id}`, { headers: authHeaders() });
    } catch (err) {
      setRooms((r) => {
        if (r.some((existing) => existing.id === room.id)) return r; // already back
        const restored = [...r];
        restored.splice(Math.max(0, index), 0, room);
        return restored;
      });
      notify(
        `Couldn't delete "${room.slug}" - ${errorMessage(err, "the server refused")}. It's back in your list.`
      );
    }
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    if (!renameTarget || !renameSlug.trim()) return;
    const target = renameTarget;
    const wanted = renameSlug.trim();
    const previous = target.slug;

    // Show it renamed and get out of the way. Keeping the dialog open behind
    // a spinner makes a rename feel like a transaction; it is a rename.
    setRooms((r) => r.map((room) => (room.id === target.id ? { ...room, slug: wanted } : room)));
    setRenameTarget(null);
    setRenameSlug("");
    setRenameError(null);

    try {
      const res = await axios.patch(
        `${API}/room/${target.id}`,
        { slug: wanted },
        { headers: authHeaders() }
      );
      // reconcile with what the server actually stored rather than assuming
      // it took our string verbatim - it may normalise it
      if (res.data?.slug && res.data.slug !== wanted) {
        setRooms((r) => r.map((room) => (room.id === target.id ? { ...room, slug: res.data.slug } : room)));
      }
    } catch (err) {
      setRooms((r) => r.map((room) => (room.id === target.id ? { ...room, slug: previous } : room)));
      notify(
        `Couldn't rename to "${wanted}" - ${errorMessage(err, "the server refused")}. Still "${previous}".`
      );
    }
  }

  async function handleShare(room: Room) {
    const url = `${window.location.origin}/canvas/${room.shareId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(room.id);
      setTimeout(() => setCopiedId((c) => (c === room.id ? null : c)), 1500);
    } catch {
      // clipboard unavailable (insecure origin or denied): show the link to copy by hand
      notify(`Copy this link: ${url}`, "info");
    }
  }

  function handleLogout() {
    clearToken();
    router.push("/signin");
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  return (
    <div className="pu">
      {/* Top bar: a strip of copy paper pinned across the board */}
      <header className="pu-top">
        <div className="pu-wrap">
          <div className="pu-strip">
            <h1 className="pu-wordmark">My Canvases</h1>
            <div className="pu-strip-end">
              {/* The avatar is the way into the picker. Nothing else on this
                  page is about the account itself, so a settings screen for one
                  choice would be a page nobody would find. */}
              {me && (
                <button
                  type="button"
                  onClick={() => setPickingAvatar(true)}
                  title="Change your avatar"
                  className="pu-me"
                >
                  <Avatar id={me.avatar} username={me.username} size={34} />
                  <span className="pu-me-name">{me.username}</span>
                </button>
              )}
              <button type="button" onClick={handleLogout} className="pu-link">
                <LogOut aria-hidden="true" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="pu-wrap pu-main">
        {me?.isGuest && (
          <ClaimAccountBanner
            username={me.username}
            onClaimed={() => setMe({ ...me, isGuest: false })}
          />
        )}

        {/* Heading row */}
        <div className="pu-head">
          <div className="pu-head-title">
            <h2 className="pu-poster">Your work</h2>
            {!isLoading && !errorMsg && (
              <p className="pu-count">
                <span className="num">{rooms.length}</span>
                {rooms.length === 1 ? "canvas" : "canvases"}
              </p>
            )}
          </div>

          <div className="pu-actions">
            {/* Paste a link someone shared, or type the canvas name */}
            <form onSubmit={handleJoin} className="pu-join">
              <div className="pu-join-field">
                <input
                  value={joinInput}
                  onChange={(e) => {
                    setJoinInput(e.target.value);
                    setJoinError(null);
                  }}
                  placeholder="Paste a canvas link"
                  aria-label="Canvas link"
                  aria-invalid={joinError ? true : undefined}
                  aria-describedby={joinError ? "join-error" : undefined}
                  className="pu-input"
                />
                {joinError && (
                  <p id="join-error" className="pu-slip">
                    {joinError}
                  </p>
                )}
              </div>
              <button
                type="submit"
                disabled={isJoining || joinInput.trim() === ""}
                aria-busy={isJoining || undefined}
                className="pu-btn"
              >
                <Users aria-hidden="true" />
                {isJoining ? "Joining…" : "Join"}
              </button>
            </form>

            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="pu-btn pu-btn--primary"
            >
              <Plus aria-hidden="true" />
              New canvas
            </button>
          </div>
        </div>

        {isLoading ? (
          <ul className="pu-grid" aria-label="Loading canvases" aria-busy="true">
            {[...Array(6)].map((_, i) => (
              <li key={i} className="pu-skel" />
            ))}
          </ul>
        ) : errorMsg ? (
          <div className="pu-notice pu-notice--error" role="alert">
            {errorMsg}
          </div>
        ) : rooms.length === 0 ? (
          <div className="pu-notice">
            <h3>No canvases yet</h3>
            <p>Create your first canvas to start drawing.</p>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="pu-btn"
            >
              <Plus aria-hidden="true" />
              New canvas
            </button>
          </div>
        ) : (
          <ul className="pu-grid">
            {rooms.map((room) => (
              <li key={room.id} className="pu-sheet">
                <button
                  type="button"
                  onClick={() => router.push(`/canvas/${room.shareId}`)}
                  className="pu-sheet-open"
                  aria-label={`Open ${room.slug}`}
                >
                  <span className="pu-sheet-name">{room.slug}</span>
                </button>

                <div className="pu-sheet-foot">
                  <time className="pu-meta" dateTime={room.createdAt}>
                    {formatDate(room.createdAt)}
                  </time>

                  <div className="pu-sheet-actions">
                    <button
                      type="button"
                      onClick={() => router.push(`/canvas/${room.shareId}`)}
                      className="pu-link"
                    >
                      Open
                    </button>

                    {/* Per-sheet menu */}
                    <div className="pu-menu-wrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(openMenuId === room.id ? null : room.id);
                        }}
                        className="pu-icon-btn"
                        aria-label="More options"
                        aria-haspopup="menu"
                        aria-expanded={openMenuId === room.id}
                      >
                        <MoreVertical aria-hidden="true" />
                      </button>
                      {openMenuId === room.id && (
                        <div
                          role="menu"
                          onClick={(e) => e.stopPropagation()}
                          className="pu-menu"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setRenameTarget(room);
                              setRenameSlug(room.slug);
                              setOpenMenuId(null);
                            }}
                            className="pu-menu-item"
                          >
                            <Pencil aria-hidden="true" />
                            Rename
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              handleShare(room);
                              setOpenMenuId(null);
                            }}
                            className="pu-menu-item"
                          >
                            {copiedId === room.id ? (
                              <>
                                <Check aria-hidden="true" className="pu-copied" />
                                Copied!
                              </>
                            ) : (
                              <>
                                <Share2 aria-hidden="true" />
                                Share link
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              handleDelete(room.id);
                              setOpenMenuId(null);
                            }}
                            className="pu-menu-item pu-menu-item--danger"
                          >
                            <Trash2 aria-hidden="true" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Rooms belonging to other people, collected by opening their links.
            No rename or delete here - they are not yours to change. */}
        {joinedRooms.length > 0 && (
          <section className="pu-section">
            <div className="pu-section-head">
              <h2>Shared with you</h2>
              <p>Canvases you opened from someone else&apos;s link.</p>
            </div>
            <ul className="pu-grid">
              {joinedRooms.map((room) => (
                <li key={room.id} className="pu-sheet">
                  <button
                    type="button"
                    onClick={() => router.push(`/canvas/${room.shareId}`)}
                    className="pu-sheet-open"
                  >
                    <span className="pu-sheet-name">{room.slug}</span>
                    <span className="pu-sheet-owner">
                      <Avatar
                        id={room.ownerAvatar}
                        username={room.owner}
                        size={22}
                        lazy
                      />
                      <span>{room.owner ? `Owned by ${room.owner}` : "Shared canvas"}</span>
                    </span>
                  </button>

                  <div className="pu-sheet-foot">
                    <span />
                    <button
                      type="button"
                      onClick={() => router.push(`/canvas/${room.shareId}`)}
                      className="pu-link"
                    >
                      Open
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Set apart at the foot of the page, deliberately plain and far from
            Sign out - the two are one slip apart otherwise, and only one of
            them is reversible. */}
        <section className="pu-danger">
          <div>
            <p className="pu-danger-title">Delete account</p>
            <p>
              Removes your account and your canvases. Work you did on other people&rsquo;s
              canvases stays.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDeletingAccount(true)}
            className="pu-btn pu-btn--danger"
          >
            Delete account
          </button>
        </section>
      </main>

      <ToastStack notices={notices} onDismiss={dismissNotice} />

      {pickingAvatar && me && (
        <AvatarPicker
          current={me.avatar}
          username={me.username}
          onSaved={(avatar) => setMe({ ...me, avatar })}
          onRollback={(message) => notify(message)}
          onClose={() => setPickingAvatar(false)}
        />
      )}

      {deletingAccount && (
        <DeleteAccountDialog
          isGuest={me?.isGuest ?? false}
          roomCount={rooms.length}
          onCancel={() => setDeletingAccount(false)}
          onDeleted={() => {
            // the token now names an account that does not exist, so it has to
            // go with it - otherwise every later request 401s with no reason
            clearToken();
            router.push("/signin");
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Delete "${deleteTarget.slug}"?`}
          message="The canvas and everything drawn on it are removed for everyone. This cannot be undone."
          confirmLabel="Delete canvas"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Create modal */}
      {isCreateOpen && (
        <Modal onClose={() => setIsCreateOpen(false)} labelledBy="create-title">
          <h3 id="create-title" className="pu-dialog-title">New canvas</h3>
          <p className="pu-dialog-text">Pick a name. You can rename it later without breaking its share link.</p>
          <form onSubmit={handleCreate}>
            <input
              autoFocus
              type="text"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              placeholder="my-cool-canvas"
              aria-label="Canvas name"
              aria-invalid={createError ? true : undefined}
              className="pu-input"
              required
            />
            {createError && <p className="pu-error-text">{createError}</p>}
            <ModalButtons
              onCancel={() => setIsCreateOpen(false)}
              submitLabel={isCreating ? "Creating..." : "Create"}
              disabled={isCreating}
            />
          </form>
        </Modal>
      )}

      {/* Rename modal */}
      {renameTarget && (
        <Modal onClose={() => setRenameTarget(null)} labelledBy="rename-title">
          <h3 id="rename-title" className="pu-dialog-title">Rename canvas</h3>
          <p className="pu-dialog-text">The share link stays the same.</p>
          <form onSubmit={handleRename}>
            <input
              autoFocus
              type="text"
              value={renameSlug}
              onChange={(e) => setRenameSlug(e.target.value)}
              aria-label="New canvas name"
              aria-invalid={renameError ? true : undefined}
              className="pu-input"
              required
            />
            {renameError && <p className="pu-error-text">{renameError}</p>}
            <ModalButtons
              onCancel={() => setRenameTarget(null)}
              submitLabel="Save"
              disabled={false}
            />
          </form>
        </Modal>
      )}
    </div>
  );
}

/* --- small modal helpers to keep markup tidy --- */

function Modal({
  children,
  onClose,
  labelledBy,
}: {
  children: React.ReactNode;
  onClose: () => void;
  labelledBy?: string;
}) {
  return (
    <div className="pu-scrim" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="pu-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function ModalButtons({
  onCancel,
  submitLabel,
  disabled,
}: {
  onCancel: () => void;
  submitLabel: string;
  disabled: boolean;
}) {
  return (
    <div className="pu-dialog-actions">
      <button type="button" onClick={onCancel} className="pu-btn">
        Cancel
      </button>
      <button
        type="submit"
        disabled={disabled}
        className="pu-btn pu-btn--primary"
      >
        {submitLabel}
      </button>
    </div>
  );
}
