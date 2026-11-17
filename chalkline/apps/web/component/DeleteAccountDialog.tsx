"use client";
import React, { useState } from "react";
import axios from "axios";
import { getToken } from "@/lib/session";
import { API_URL as API } from "@/lib/config";
import { errorMessage } from "@/lib/errors";

/**
 * Confirming account deletion.
 *
 * Its own component rather than a ConfirmDialog with an extra prop, because
 * the confirmation is not a button press: an account with a password has to
 * re-enter it. A token alone should not be enough to destroy an account, and
 * a dialog that asks for something is a different shape from one that asks
 * whether.
 *
 * The copy spells out what survives. "Delete account" reads as "erase
 * everything I did", and for shapes drawn on other people's boards that is
 * not what happens - saying so here is better than someone discovering it
 * afterwards, in either direction.
 */
export function DeleteAccountDialog({
  isGuest,
  roomCount,
  onCancel,
  onDeleted,
}: {
  isGuest: boolean;
  roomCount: number;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await axios.delete(`${API}/account`, {
        headers: { Authorization: `Bearer ${getToken()}` },
        // axios puts a DELETE body under `data`, not as the second argument
        data: isGuest ? {} : { password },
      });
      onDeleted();
    } catch (err) {
      setError(errorMessage(err, "Could not delete the account"));
      setBusy(false);
    }
  }

  return (
    <div className="pu-scrim">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
        className="pu-dialog"
      >
        <h2 id="delete-account-title" className="pu-dialog-title">
          Delete this account?
        </h2>

        <p className="pu-dialog-text">
          This cannot be undone.{" "}
          {roomCount > 0 ? (
            <>
              Your <strong>{roomCount}</strong> canvas{roomCount === 1 ? "" : "es"} will be
              deleted, along with everything anyone has drawn on {roomCount === 1 ? "it" : "them"}.
            </>
          ) : (
            <>You have no canvases of your own to lose.</>
          )}
        </p>
        <p className="pu-dialog-text">
          Anything you drew on <em>other people&rsquo;s</em> canvases stays where it is &mdash;
          it just stops being attributed to you.
        </p>

        <form onSubmit={remove}>
          {!isGuest && (
            <input
              type="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password to confirm"
              aria-label="Password"
              autoComplete="current-password"
              required
              autoFocus
              aria-invalid={error ? true : undefined}
              className="pu-input"
            />
          )}
          {error && <p className="pu-error-text">{error}</p>}
          <div className="pu-dialog-actions">
            <button type="button" onClick={onCancel} disabled={busy} className="pu-btn">
              Keep my account
            </button>
            <button
              type="submit"
              disabled={busy}
              aria-busy={busy || undefined}
              className="pu-btn pu-btn--danger-fill"
            >
              {busy ? "Deleting…" : "Delete account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
