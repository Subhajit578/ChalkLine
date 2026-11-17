"use client";
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Check, Shuffle, X } from "lucide-react";
import { getToken } from "@/lib/session";
import { AvatarStyle, avatarUrl, fetchAvatarStyles, saveAvatar } from "@/lib/avatars";

/**
 * Choose a face from the pool.
 *
 * Browsing is local and saving is one request: clicking a face only moves the
 * selection, and nothing is written until Save. A picker that saved on every
 * click would fire a dozen writes for one decision, and would leave whatever
 * the pointer happened to land on last as the answer.
 *
 * The pool is fetched when this mounts - which is when it opens, because the
 * dashboard renders it conditionally. ~450KB of SVG exists in all, so loading
 * it on every dashboard visit for the few people who want to change their
 * avatar would be a poor trade. The grids are lazily loaded on top of that,
 * so only the style being looked at is actually fetched.
 */
export function AvatarPicker({
  current,
  username,
  onSaved,
  onClose,
  onRollback,
}: {
  current: string | null;
  username: string;
  onSaved: (avatar: string) => void;
  onClose: () => void;
  /** told when an applied choice had to be undone, so it can be announced */
  onRollback?: (message: string) => void;
}) {
  const [styles, setStyles] = useState<AvatarStyle[] | null>(null);
  const [activeStyle, setActiveStyle] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(current);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAvatarStyles()
      .then((list) => {
        if (cancelled) return;
        setStyles(list);
        // open on the style the current avatar belongs to, so the face
        // someone already has is the one they are looking at
        const own = current?.split("/")[0];
        const match = list.find((s) => s.id === own) ?? list[0];
        setActiveStyle(match?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the avatars");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Escape closes, as it does for the other dialogs on this page
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const active = useMemo(
    () => styles?.find((s) => s.id === activeStyle) ?? null,
    [styles, activeStyle]
  );

  /** Everything, flattened - only needed for the shuffle button. */
  const allIds = useMemo(() => (styles ?? []).flatMap((s) => s.ids), [styles]);

  function shuffle() {
    if (allIds.length === 0) return;
    // excluding what is already selected, so the button always visibly does
    // something rather than landing on the same face one time in seventy-two
    const options = allIds.filter((id) => id !== selected);
    const pick = options[Math.floor(Math.random() * options.length)];
    if (!pick) return;
    setSelected(pick);
    setActiveStyle(pick.split("/")[0] ?? activeStyle);
  }

  /**
   * Apply the choice at once and close; reconcile afterwards.
   *
   * Picking an avatar is a preference, not a transaction - there is nothing
   * to confirm and nothing that depends on the answer, so making someone
   * watch a spinner to find out whether their own click worked is pure
   * latency for no information.
   *
   * The server still has the last word: it validates the id against the pool
   * and may answer with a different one, so its reply is applied when it
   * differs. A refusal puts the old face back and says so, rather than
   * leaving a face on screen that nobody else will ever see.
   */
  function handleSave() {
    if (!selected || selected === current) {
      onClose();
      return;
    }
    const token = getToken();
    if (!token) return;

    const chosen = selected;
    const previous = current;

    onSaved(chosen);
    onClose();

    saveAvatar(chosen, token)
      .then((saved) => {
        // the pool is the server's to define; if it settled on something else
        // that is what every other viewer will see
        if (saved && saved !== chosen) onSaved(saved);
      })
      .catch((err) => {
        const message = axios.isAxiosError(err) ? err.response?.data?.message : undefined;
        // `current` may be null for an account that never had one; putting
        // back an empty id is correct - avatarFor derives a stable fallback
        onSaved(previous ?? "");
        onRollback?.(
          `Couldn't change your avatar - ${message ?? "the server refused"}. Put the old one back.`
        );
      });
  }

  return (
    <div
      className="pu-scrim"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Choose an avatar"
    >
      <div className="pu-dialog pu-dialog--wide" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="pu-dialog-head">
          <div className="pu-dialog-head-main">
            <span className="pu-avatar" style={{ width: 64, height: 64 }}>
              {avatarUrl(selected) ? (
                <img src={avatarUrl(selected)!} alt="" width={64} height={64} />
              ) : (
                <span className="pu-avatar-initial" style={{ fontSize: 24 }}>
                  {username.charAt(0).toUpperCase()}
                </span>
              )}
            </span>
            <div>
              <h3 className="pu-dialog-title">Choose your avatar</h3>
              <p className="pu-dialog-text">
                {allIds.length > 0
                  ? `${allIds.length} to pick from, across ${styles?.length} styles.`
                  : "Loading the pool…"}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="pu-icon-btn">
            <X aria-hidden="true" />
          </button>
        </div>

        {/* Style tabs */}
        {styles && styles.length > 0 && (
          <div className="pu-tabs" role="tablist" aria-label="Avatar styles">
            {styles.map((style) => (
              <button
                key={style.id}
                type="button"
                role="tab"
                aria-selected={style.id === activeStyle}
                onClick={() => setActiveStyle(style.id)}
                className="pu-tab"
              >
                {style.label}
              </button>
            ))}
          </div>
        )}

        {/* Grid */}
        <div className="pu-faces">
          {error && !styles ? (
            <p className="pu-error-text">{error}</p>
          ) : !active ? (
            <div className="pu-face-grid" aria-busy="true">
              {[...Array(12)].map((_, i) => (
                <div key={i} className="pu-face-skel" />
              ))}
            </div>
          ) : (
            <div className="pu-face-grid">
              {active.ids.map((id) => {
                const isSelected = id === selected;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelected(id)}
                    aria-pressed={isSelected}
                    aria-label={`${active.label} avatar ${id.split("/")[1]}`}
                    className="pu-face"
                  >
                    <img src={avatarUrl(id)!} alt="" loading="lazy" />
                    {isSelected && (
                      <span className="pu-face-check">
                        <Check aria-hidden="true" strokeWidth={3} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pu-dialog-foot">
          <button
            type="button"
            onClick={shuffle}
            disabled={allIds.length === 0}
            className="pu-link"
          >
            <Shuffle aria-hidden="true" />
            Surprise me
          </button>
          <div className="pu-dialog-foot-end">
            {error && styles && <p className="pu-error-text">{error}</p>}
            <button type="button" onClick={onClose} className="pu-btn">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!selected}
              className="pu-btn pu-btn--primary"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
