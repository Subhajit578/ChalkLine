"use client";
import React, { useEffect, useState } from "react";
import axios from "axios";
import { getToken, setToken, daysLeft } from "@/lib/session";
import { API_URL as API } from "@/lib/config";
import { errorMessage } from "@/lib/errors";

/**
 * Turn a guest account into a real one, from the account menu.
 *
 * A guest is held by its token and nothing else: lose the browser and the
 * account - boards included - goes with it. Claiming keeps the same user row,
 * so every board, membership and shape stays put; only an email and password
 * are added. Leads with the deadline, because "keep your work" is the reason
 * and the form is only the mechanism.
 */
export function ClaimAccountDialog({
  username,
  onClaimed,
  onClose,
}: {
  username: string;
  onClaimed: (token: string) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = daysLeft();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await axios.post(
        `${API}/account/claim`,
        { email, password },
        // read at call time: the token may have been replaced since mount
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setToken(res.data.token);
      onClaimed(res.data.token);
    } catch (err) {
      setError(errorMessage(err, "Could not save those details"));
      setBusy(false);
    }
  }

  return (
    <div
      className="pu-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="claim-title" className="pu-dialog">
        <h2 id="claim-title" className="pu-dialog-title">Keep your account</h2>
        <p className="pu-dialog-text">
          You are signed in as <strong>{username}</strong>, a guest.{" "}
          {left === null
            ? "Add an email and password to keep these boards for good."
            : `This session ends in ${left} day${left === 1 ? "" : "s"}, and the boards go with it. Add an email and password to keep them.`}
        </p>
        <form onSubmit={claim}>
          <input
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Email"
            autoComplete="email"
            required
            autoFocus
            className="pu-input"
          />
          <input
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Choose a password"
            aria-label="Password"
            autoComplete="new-password"
            minLength={8}
            required
            aria-invalid={error ? true : undefined}
            className="pu-input"
          />
          {error && <p className="pu-error-text">{error}</p>}
          <p className="pu-dialog-text" style={{ marginTop: 0 }}>
            Your username stays <strong>{username}</strong>. Sign in with either that or your email.
          </p>
          <div className="pu-dialog-actions">
            <button type="button" onClick={onClose} disabled={busy} className="pu-btn">
              Not now
            </button>
            <button type="submit" disabled={busy} aria-busy={busy || undefined} className="pu-btn pu-btn--primary">
              {busy ? "Saving…" : "Save account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
