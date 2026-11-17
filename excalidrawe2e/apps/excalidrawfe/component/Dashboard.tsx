"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { ConfirmDialog } from "./ConfirmDialog";
import { getToken, clearToken, installSessionGuard } from "@/lib/session";
import { API_URL as API } from "@/lib/config";
import { errorMessage, errorStatus } from "@/lib/errors";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { ClaimAccountDialog } from "./ClaimAccountDialog";
import { Avatar } from "./Avatar";
import { AvatarPicker } from "./AvatarPicker";
import { BoardThumb } from "./BoardThumb";
import { makeNotice, ToastStack, type Notice } from "./Toast";
import { useTheme } from "./ThemeProvider";
import {
  Plus,
  Trash2,
  LogOut,
  Pencil,
  Link2,
  Check,
  MoreVertical,
  Users,
  User,
  LayoutGrid,
  Search,
  X,
  ChevronDown,
  UserRound,
  UserPlus,
  Moon,
  Sun,
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

type Filter = "all" | "yours" | "shared";

/** A board of either kind, flattened for the one grid, search and filter. */
type Item = {
  id: number;
  slug: string;
  shareId: string;
  date: string;
  shared: boolean;
  owner?: string;
  ownerAvatar?: string;
};

/** Rank a board against the query: name beats owner, a prefix beats a mid-word hit. */
function matchScore(item: Item, q: string): number {
  const name = item.slug.toLowerCase();
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  if (name.includes(q)) return 60;
  if (item.owner && item.owner.toLowerCase().includes(q)) return 30;
  return 0;
}

const FILTERS: { value: Filter; nav: string; title: string }[] = [
  { value: "all", nav: "All", title: "All whiteboards" },
  { value: "yours", nav: "Yours", title: "Your whiteboards" },
  { value: "shared", nav: "Shared with you", title: "Shared with you" },
];

/** A curated, non-garish palette so each board card carries its own colour. */
const CARD_COLORS = ["#0ea5e9", "#06b6d4", "#10b981", "#22c55e", "#84cc16", "#f59e0b", "#f97316", "#f43f5e", "#6366f1"];
function cardColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CARD_COLORS[h % CARD_COLORS.length];
}

export function Dashboard() {
  const router = useRouter();
  const { theme, setChoice } = useTheme();

  const [rooms, setRooms] = useState<Room[]>([]);
  // rooms other people own, picked up by opening their link
  const [joinedRooms, setJoinedRooms] = useState<JoinedRoom[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Room | null>(null);
  const [joinInput, setJoinInput] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  /**
   * Transient messages, used mainly to announce a rollback — an optimistic
   * change undone has to say so somewhere that does not blank the page.
   */
  const [notices, setNotices] = useState<Notice[]>([]);
  const notify = useCallback((message: string, tone: "error" | "info" | "success" = "error") => {
    setNotices((current) => [...current, makeNotice(message, tone)]);
  }, []);
  const dismissNotice = useCallback((id: string) => {
    setNotices((current) => current.filter((n) => n.id !== id));
  }, []);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [renameTarget, setRenameTarget] = useState<Room | null>(null);
  const [renameSlug, setRenameSlug] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  // the account block at the sidebar foot: always shown on desktop, a dropdown on mobile
  const [accountOpen, setAccountOpen] = useState(false);

  const [me, setMe] = useState<{
    username: string;
    email: string | null;
    isGuest: boolean;
    avatar: string | null;
  } | null>(null);
  const [pickingAvatar, setPickingAvatar] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    installSessionGuard();
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
    if (!accountOpen && openMenuId === null) return;
    const close = () => {
      setAccountOpen(false);
      setOpenMenuId(null);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [accountOpen, openMenuId]);

  function authHeaders() {
    return { Authorization: `Bearer ${getToken()}` };
  }

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

  function handleDelete(id: number) {
    setDeleteTarget(rooms.find((r) => r.id === id) ?? null);
  }

  async function confirmDelete() {
    const room = deleteTarget;
    if (!room) return;
    setDeleteTarget(null);

    const index = rooms.findIndex((r) => r.id === room.id);
    setRooms((r) => r.filter((existing) => existing.id !== room.id));

    try {
      await axios.delete(`${API}/room/${room.id}`, { headers: authHeaders() });
    } catch (err) {
      setRooms((r) => {
        if (r.some((existing) => existing.id === room.id)) return r;
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

  async function handleShare(item: { id: number; shareId: string }) {
    const url = `${window.location.origin}/canvas/${item.shareId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((c) => (c === item.id ? null : c)), 1500);
    } catch {
      notify(`Copy this link: ${url}`, "info");
    }
  }

  function handleLogout() {
    clearToken();
    router.push("/signin");
  }

  function toggleTheme() {
    // a plain two-state switch on top of the browser preference
    setChoice(theme === "dark" ? "light" : "dark");
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  const counts = { all: rooms.length + joinedRooms.length, yours: rooms.length, shared: joinedRooms.length };

  const items = useMemo<Item[]>(() => {
    const owned: Item[] = rooms.map((r) => ({
      id: r.id, slug: r.slug, shareId: r.shareId, date: r.createdAt, shared: false,
    }));
    const joined: Item[] = joinedRooms.map((r) => ({
      id: r.id, slug: r.slug, shareId: r.shareId, date: r.joinedAt ?? r.createdAt, shared: true,
      owner: r.owner, ownerAvatar: r.ownerAvatar,
    }));
    const base = filter === "yours" ? owned : filter === "shared" ? joined : [...owned, ...joined];

    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base
      .map((it) => ({ it, score: matchScore(it, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.it);
  }, [rooms, joinedRooms, filter, query]);

  const hasBoards = rooms.length > 0 || joinedRooms.length > 0;
  const noun = (n: number) => (n === 1 ? "whiteboard" : "whiteboards");

  return (
    <div className="pu">
      {/* Sidebar: wordmark, filter nav, account at the foot */}
      <aside className="pu-side">
        <div className="pu-side-top">
          <span className="pu-wordmark">ExcaliDraw</span>
          {me && (
            <button
              type="button"
              className="pu-side-acct"
              aria-label="Account"
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              onClick={(e) => {
                e.stopPropagation();
                setAccountOpen((o) => !o);
                setOpenMenuId(null);
              }}
            >
              <Avatar id={me.avatar} username={me.username} size={28} />
              <ChevronDown aria-hidden="true" />
            </button>
          )}
        </div>

        <p className="pu-side-label">Library</p>
        <nav className="pu-side-nav" aria-label="Filter whiteboards">
          {FILTERS.map((f) => {
            const Icon = f.value === "all" ? LayoutGrid : f.value === "yours" ? User : Users;
            return (
              <button
                key={f.value}
                type="button"
                className="pu-nav-item"
                aria-current={filter === f.value}
                onClick={() => setFilter(f.value)}
              >
                <Icon aria-hidden="true" />
                {f.nav}
                <span className="pu-nav-count">{counts[f.value]}</span>
              </button>
            );
          })}
        </nav>

        {me && (
          <div className="pu-side-foot" data-open={accountOpen ? "true" : "false"} onClick={(e) => e.stopPropagation()}>
            <div className="pu-side-user">
              <Avatar id={me.avatar} username={me.username} size={36} />
              <div className="pu-side-user-t">
                <b>{me.username}</b>
                <span>{me.isGuest ? "Guest account" : me.email ?? "Signed in"}</span>
              </div>
            </div>
            <button type="button" className="pu-side-item" onClick={() => { setPickingAvatar(true); setAccountOpen(false); }}>
              <UserRound aria-hidden="true" />
              Change avatar
            </button>
            {me.isGuest && (
              <button type="button" className="pu-side-item" onClick={() => { setClaiming(true); setAccountOpen(false); }}>
                <UserPlus aria-hidden="true" />
                Claim your account
                <span className="pu-menu-tag">Guest</span>
              </button>
            )}
            <button type="button" className="pu-side-item" onClick={() => { toggleTheme(); setAccountOpen(false); }}>
              {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
              {theme === "dark" ? "Switch to light" : "Switch to dark"}
            </button>
            <button type="button" className="pu-side-item" onClick={handleLogout}>
              <LogOut aria-hidden="true" />
              Sign out
            </button>
            <button type="button" className="pu-side-item pu-side-item--danger" onClick={() => { setDeletingAccount(true); setAccountOpen(false); }}>
              <Trash2 aria-hidden="true" />
              Delete account
            </button>
          </div>
        )}
      </aside>

      {/* Body: toolbar + content */}
      <div className="pu-body">
        <header className="pu-header">
          <div className="pu-head">
            <h1 className="pu-title">Drawings</h1>
            {!isLoading && !errorMsg && (
              <span className="pu-count">{items.length} {noun(items.length)}</span>
            )}
          </div>
          <div className="pu-toolbar">
          <div className="pu-search">
            <Search aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your whiteboards"
              aria-label="Search your whiteboards"
            />
            {query && (
              <button type="button" className="pu-search-clear" aria-label="Clear search" onClick={() => setQuery("")}>
                <X aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="pu-toolbar-actions">
            <form onSubmit={handleJoin} className="pu-join-wrap">
              <div className="pu-join">
                <input
                  value={joinInput}
                  onChange={(e) => { setJoinInput(e.target.value); setJoinError(null); }}
                  placeholder="Paste a link to join…"
                  aria-label="Join by link"
                  aria-invalid={joinError ? true : undefined}
                  aria-describedby={joinError ? "join-error" : undefined}
                />
                <button type="submit" disabled={isJoining || joinInput.trim() === ""} aria-busy={isJoining || undefined}>
                  {isJoining ? "Joining…" : "Join"}
                </button>
              </div>
              {joinError && <p id="join-error" className="pu-slip">{joinError}</p>}
            </form>

            <button type="button" onClick={() => setIsCreateOpen(true)} className="pu-btn pu-btn--primary">
              <Plus aria-hidden="true" />
              New whiteboard
            </button>
          </div>
          </div>
        </header>

        <main className="pu-main">

          {isLoading ? (
            <ul className="pu-grid" aria-label="Loading whiteboards" aria-busy="true">
              {[...Array(10)].map((_, i) => (
                <li key={i} className="pu-skel">
                  <div className="pu-skel-thumb" />
                  <div className="pu-skel-line" />
                  <div className="pu-skel-line pu-skel-line--sm" />
                </li>
              ))}
            </ul>
          ) : errorMsg ? (
            <div className="pu-notice pu-notice--error" role="alert">{errorMsg}</div>
          ) : !hasBoards ? (
            <div className="pu-notice">
              <h3>No whiteboards yet</h3>
              <p>Create your first whiteboard to start drawing, or paste a link to join one.</p>
              <button type="button" onClick={() => setIsCreateOpen(true)} className="pu-btn pu-btn--primary">
                <Plus aria-hidden="true" />
                New whiteboard
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="pu-notice">
              <h3>Nothing matches</h3>
              <p>
                {query
                  ? `No whiteboards match "${query.trim()}".`
                  : filter === "shared"
                    ? "No one has shared a whiteboard with you yet."
                    : "You don't own any whiteboards yet."}
              </p>
            </div>
          ) : (
            <ul className="pu-grid">
              {items.map((item) => (
                <li
                  key={`${item.shared ? "s" : "o"}-${item.id}`}
                  className="pu-card"
                  style={{ "--card-accent": cardColor(item.slug) } as React.CSSProperties}
                >
                  <button
                    type="button"
                    className="pu-card-open"
                    aria-label={`Open ${item.slug}`}
                    onClick={() => router.push(`/canvas/${item.shareId}`)}
                  />

                  <div className="pu-card-media">
                  <BoardThumb roomId={item.id} name={item.slug} />

                  {item.shared && (
                    <span className="pu-card-chip">
                      <Users aria-hidden="true" />
                      Shared
                    </span>
                  )}

                  <div className="pu-menu-wrap">
                    <button
                      type="button"
                      className="pu-card-more"
                      aria-label="More options"
                      aria-haspopup="menu"
                      aria-expanded={openMenuId === item.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(openMenuId === item.id ? null : item.id);
                        setAccountOpen(false);
                      }}
                    >
                      <MoreVertical aria-hidden="true" />
                    </button>
                    {openMenuId === item.id && (
                      <div className="pu-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                        {!item.shared && (
                          <button
                            type="button"
                            role="menuitem"
                            className="pu-menu-item"
                            onClick={() => {
                              const room = rooms.find((r) => r.id === item.id);
                              if (room) { setRenameTarget(room); setRenameSlug(room.slug); }
                              setOpenMenuId(null);
                            }}
                          >
                            <Pencil aria-hidden="true" />
                            Rename
                          </button>
                        )}
                        <button
                          type="button"
                          role="menuitem"
                          className="pu-menu-item"
                          onClick={() => handleShare(item)}
                        >
                          {copiedId === item.id ? (
                            <>
                              <Check aria-hidden="true" className="pu-copied" />
                              Copied!
                            </>
                          ) : (
                            <>
                              <Link2 aria-hidden="true" />
                              Copy link
                            </>
                          )}
                        </button>
                        {!item.shared && (
                          <button
                            type="button"
                            role="menuitem"
                            className="pu-menu-item pu-menu-item--danger"
                            onClick={() => { handleDelete(item.id); setOpenMenuId(null); }}
                          >
                            <Trash2 aria-hidden="true" />
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  </div>

                  <div className="pu-card-meta">
                    <div className="pu-card-name">{item.slug}</div>
                    <div className="pu-card-sub">
                      {item.shared ? (
                        <>
                          <Avatar id={item.ownerAvatar} username={item.owner} size={16} lazy />
                          <span>{item.owner ? item.owner : "Shared with you"}</span>
                        </>
                      ) : (
                        <>
                          <span className="pu-card-dot" />
                          <span>{formatDate(item.date)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>

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

      {claiming && me && (
        <ClaimAccountDialog
          username={me.username}
          onClaimed={() => { setMe({ ...me, isGuest: false }); setClaiming(false); }}
          onClose={() => setClaiming(false)}
        />
      )}

      {deletingAccount && (
        <DeleteAccountDialog
          isGuest={me?.isGuest ?? false}
          roomCount={rooms.length}
          onCancel={() => setDeletingAccount(false)}
          onDeleted={() => { clearToken(); router.push("/signin"); }}
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

      {isCreateOpen && (
        <Modal onClose={() => setIsCreateOpen(false)} labelledBy="create-title">
          <h3 id="create-title" className="pu-dialog-title">New whiteboard</h3>
          <p className="pu-dialog-text">Pick a name. You can rename it later without breaking its share link.</p>
          <form onSubmit={handleCreate}>
            <input
              autoFocus
              type="text"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              placeholder="my-cool-whiteboard"
              aria-label="Whiteboard name"
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

      {renameTarget && (
        <Modal onClose={() => setRenameTarget(null)} labelledBy="rename-title">
          <h3 id="rename-title" className="pu-dialog-title">Rename whiteboard</h3>
          <p className="pu-dialog-text">The share link stays the same.</p>
          <form onSubmit={handleRename}>
            <input
              autoFocus
              type="text"
              value={renameSlug}
              onChange={(e) => setRenameSlug(e.target.value)}
              aria-label="New whiteboard name"
              aria-invalid={renameError ? true : undefined}
              className="pu-input"
              required
            />
            {renameError && <p className="pu-error-text">{renameError}</p>}
            <ModalButtons onCancel={() => setRenameTarget(null)} submitLabel="Save" disabled={false} />
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
    <div
      className="pu-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={labelledBy} className="pu-dialog">
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
      <button type="submit" disabled={disabled} className="pu-btn pu-btn--primary">
        {submitLabel}
      </button>
    </div>
  );
}
