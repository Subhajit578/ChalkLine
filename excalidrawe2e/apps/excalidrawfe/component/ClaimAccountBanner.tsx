"use client";
import React, { useState } from "react";
import axios from "axios";
import { UserRound, X } from "lucide-react";
import { getToken, setToken, daysLeft } from "@/lib/session";
import { API_URL as API } from "@/lib/config";
import { errorMessage } from "@/lib/errors";

/**
 * The offer to turn a guest account into a real one.
 *
 * A guest is held by its token and nothing else: lose the browser and the
 * account goes with it, boards included. So the banner leads with the
 * deadline rather than with the form - "keep your work" is the reason, the
 * email and password are the mechanism.
 *
 * Claiming keeps the same user row, so every board, membership and shape
 * stays put. Only the credentials are added.
 */
export function ClaimAccountBanner({
  username,
  onClaimed,
}: {
  username: string;
  onClaimed: (token: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (dismissed) return null;
  const left = daysLeft();

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await axios.post(
        `${API}/account/claim`,
        { email, password },
        // read at call time rather than captured: the token may have been
        // replaced since this component mounted
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
    <div className="pu-sheet pu-banner">
      <UserRound className="pu-banner-icon" aria-hidden="true" />
      <div className="pu-banner-body">
        <p className="pu-banner-title">
          You are signed in as <b>{username}</b>, a guest
        </p>
        <p className="pu-banner-text">
          {left === null
            ? "Add an email and password to keep these boards."
            : `This session ends in ${left} day${left === 1 ? "" : "s"}, and the boards go with it. Add an email and password to keep them.`}
        </p>

        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className="pu-btn">
            Keep my account
          </button>
        ) : (
          <form onSubmit={claim} className="pu-banner-form">
            <input
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-label="Email"
              autoComplete="email"
              required
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
              className="pu-input"
            />
            <button type="submit" disabled={busy} aria-busy={busy || undefined} className="pu-btn">
              {busy ? "Saving…" : "Save"}
            </button>
          </form>
        )}

        {error && <p className="pu-error-text">{error}</p>}
        {open && (
          <p className="pu-banner-note">
            Your username stays <b>{username}</b>. Sign in with either that or your email.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        // dismissal is for this page view only, deliberately: a guest who
        // waves it away and then loses the browser loses everything, so it
        // comes back on the next visit
        aria-label="Hide for now"
        className="pu-icon-btn"
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}
