"use client"
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Space_Grotesk, Caveat } from "next/font/google";
import axios from "axios";
import { getToken, setToken, installSessionGuard } from "@/lib/session";
import { API_URL } from "@/lib/config";
import { errorMessage } from "@/lib/errors";
import { ShotAvatar, ShotDashboard, ShotWhiteboard } from "./LandingShots";
import "./Landing.css";

// Same faces as the auth page: Space Grotesk for everything, Caveat for the pencil notes.
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" });
const caveat = Caveat({ subsets: ["latin"], weight: "600", variable: "--font-caveat", display: "swap" });

const GLOW = "#f2b544";

/**
 * A pencil pass: wobble the lines with low-frequency noise, then eat into them
 * with fine grain. Every sketch is drawn twice through two of these with
 * different seeds, so each line comes out slightly doubled, like a hand going
 * over it again. Same recipe as AuthHero, sized to each drawing's own box.
 */

const pencil = (id: string, warpSeed: number, scale: number, grainSeed: number, alpha: string) => (
  <filter id={id} x="-15%" y="-15%" width="130%" height="130%">
    <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves={2} seed={warpSeed} result="warp" />
    <feDisplacementMap in="SourceGraphic" in2="warp" scale={scale} xChannelSelector="R" yChannelSelector="G" result="wob" />
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={1} seed={grainSeed} result="grain" />
    <feColorMatrix in="grain" type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${alpha}`} result="mask" />
    <feComposite in="wob" in2="mask" operator="in" />
  </filter>
);

/** Draw a defined sketch twice, once through each pencil. */
function Twice({ id, a = 0.8, b = 0.4 }: { id: string; a?: number; b?: number }) {
  return (
    <>
      <use href={`#${id}`} filter="url(#lp-pa)" opacity={a} />
      <use href={`#${id}`} filter="url(#lp-pb)" opacity={b} />
    </>
  );
}

function Tick({ alt }: { alt?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <use href="#lp-tick" filter={alt ? "url(#lp-pb)" : "url(#lp-pa)"} />
    </svg>
  );
}

function Underline() {
  return (
    <svg viewBox="0 0 120 16" preserveAspectRatio="none" aria-hidden="true">
      <path d="M3 9 C 28 4, 58 12, 84 7 S 112 5, 117 8" fill="none" stroke="#3b3f47" strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Every filter, pattern and reusable drawing, defined once for the page. */
function Defs() {
  return (
    <svg className="lp-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {pencil("lp-pa", 3, 4, 8, "2.6 0 0 0 -0.55")}
        {pencil("lp-pb", 11, 6, 21, "2.8 0 0 0 -0.8")}
        <filter id="lp-gr" x="-10%" y="-20%" width="120%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={1} seed={5} result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2.4 0 0 0 -0.35" result="mask" />
          <feComposite in="SourceGraphic" in2="mask" operator="in" />
        </filter>
        <filter id="lp-blur" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="14" /></filter>
        <radialGradient id="lp-glow">
          <stop offset="0" stopColor={GLOW} stopOpacity="0.55" />
          <stop offset="0.4" stopColor={GLOW} stopOpacity="0.2" />
          <stop offset="1" stopColor={GLOW} stopOpacity="0" />
        </radialGradient>
        <pattern id="lp-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-40)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#3b3f47" strokeWidth="1" />
        </pattern>
        <pattern id="lp-rule" width="40" height="36" patternUnits="userSpaceOnUse">
          <path d="M0 35.5 L40 35.5" stroke="#e1e6ed" strokeWidth="1" />
        </pattern>
        <pattern id="lp-cardrule" width="32" height="32" patternUnits="userSpaceOnUse" y="22">
          <path d="M0 31.5 L32 31.5" stroke="#dde4ec" strokeWidth="1" />
        </pattern>
        <clipPath id="lp-glass">
          <path d="M266 330 C 250 300, 196 270, 192 196 C 188 112, 250 52, 320 52 C 390 52, 452 112, 448 196 C 444 270, 390 300, 374 330 Z" />
        </clipPath>

        <g id="lp-tick" fill="none" stroke="#3b3f47" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 11 L8 16 L17 3" /><path d="M2 4 L4 3 L5 5" />
        </g>
        <g id="lp-tape">
          <path d="M4 4 L76 2 L78 8 L75 14 L78 20 L76 26 L4 26 L2 20 L5 14 L2 8 Z" fill="#c9cdd4" fillOpacity="0.55" stroke="#9aa0a8" strokeWidth="0.8" />
        </g>
        <g id="lp-sbulb" fill="none" stroke="#3b3f47" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M54 122 C 46 110, 30 98, 30 74 C 30 46, 48 30, 70 30 C 92 30, 110 46, 110 74 C 110 98, 94 110, 86 122 Z" />
          <path d="M56 122 L84 122 M56 132 L84 132 M58 142 L82 142 M62 151 L78 151" />
          <path d="M64 122 L66 84 M76 122 L74 84 M66 84 L68 76 L70 84 L72 76 L74 84" />
          <path d="M70 18 L70 6 M36 34 L28 24 M104 34 L112 24 M18 72 L6 70 M122 72 L134 70" />
        </g>
        <g id="lp-hb" fill="none" stroke="#3b3f47" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M-14 0 L14 0 L14 26 L-14 26 Z M-14 9 L14 9 M-14 17 L14 17" />
          <path d="M-13 26 C -13 44, -46 58, -46 94 C -46 126, -25 146, 0 146 C 25 146, 46 126, 46 94 C 46 58, 13 44, 13 26" />
          <path d="M-6 26 L-6 84 M6 26 L6 84 M-6 84 L-3 92 L0 84 L3 92 L6 84" />
        </g>
        <g id="lp-flow" fill="none" stroke="#3b3f47" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="62" y="12" width="116" height="40" rx="20" />
          <path d="M120 54 L120 84 M113 75 L120 86 L127 75" />
          <path d="M120 90 L178 130 L120 170 L62 130 Z" />
          <path d="M60 130 L26 130 L26 196 M19 187 L26 198 L33 187" />
          <rect x="2" y="202" width="72" height="40" rx="6" />
          <path d="M120 172 L120 204 M113 195 L120 206 L127 195" />
          <rect x="82" y="210" width="78" height="40" rx="6" />
          <path d="M162 230 C 206 230, 222 256, 204 284" strokeDasharray="5 6" />
          <path d="M197 274 L203 286 L213 277" />
        </g>
        <g id="lp-note" fill="none" stroke="#3b3f47" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 12 L204 8 L206 150 L176 184 L12 186 Z" />
          <path d="M206 150 L178 154 L176 184" />
          <path d="M30 58 C 50 54, 76 60, 96 55" />
          <rect x="28" y="76" width="16" height="16" rx="2" />
          <rect x="28" y="110" width="16" height="16" rx="2" />
          <rect x="28" y="144" width="16" height="16" rx="2" />
          <path d="M30 84 L36 90 L48 72" /><path d="M30 118 L36 124 L48 106" /><path d="M56 86 L170 83" />
        </g>
        <g id="lp-mind" fill="none" stroke="#3b3f47" strokeWidth="1.6" strokeLinecap="round">
          <ellipse cx="140" cy="122" rx="58" ry="30" />
          <path d="M92 106 C 74 86, 62 70, 54 58" /><path d="M188 104 C 206 86, 220 72, 230 62" />
          <path d="M90 138 C 74 158, 64 174, 56 188" /><path d="M190 140 C 206 158, 218 174, 226 186" />
          <path d="M20 52 C 36 49, 52 54, 68 50" /><path d="M206 56 C 224 52, 244 57, 264 53" />
          <path d="M22 214 C 36 211, 52 215, 68 212" /><path d="M198 214 C 220 210, 244 216, 268 212" />
        </g>
        <g id="lp-wire" fill="none" stroke="#3b3f47" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="10" y="10" width="220" height="160" rx="8" />
          <path d="M10 34 L230 34" />
          <circle cx="24" cy="22" r="3" /><circle cx="35" cy="22" r="3" /><circle cx="46" cy="22" r="3" />
          <rect x="26" y="48" width="90" height="64" rx="2" />
          <path d="M26 48 L116 112 M116 48 L26 112" />
          <path d="M132 54 L210 54 M132 70 L196 70 M132 86 L204 86" />
          <rect x="132" y="98" width="52" height="18" rx="9" />
          <path d="M26 134 L210 134 M26 150 L170 150" />
        </g>
        <g id="lp-bulbart" fill="none" stroke="#3b3f47" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M266 330 C 250 300, 196 270, 192 196 C 188 112, 250 52, 320 52 C 390 52, 452 112, 448 196 C 444 270, 390 300, 374 330" />
          <path d="M266 330 L268 352 M374 330 L372 352" />
          <path d="M268 352 L372 352 M268 352 L268 410 M372 352 L372 410" />
          <path d="M268 370 C 300 377, 340 377, 372 370 M268 388 C 300 395, 340 395, 372 388 M268 406 C 300 413, 340 413, 372 406" />
          <path d="M268 410 L290 436 L350 436 L372 410 M304 436 C 306 454, 334 454, 336 436" />
          <path d="M300 352 C 300 330, 306 312, 312 304 L328 304 C 334 312, 340 330, 340 352" />
          <path d="M312 304 L304 238 M328 304 L336 238" />
          <path d="M304 238 L308 226 L312 240 L316 226 L320 240 L324 226 L328 240 L332 226 L336 238" />
          <path d="M320 30 L320 8 M222 70 L208 52 M418 70 L432 52 M168 150 L148 140 M472 150 L492 140 M164 236 L142 242 M476 236 L498 242" />
        </g>
        <g id="lp-cons" fill="none" stroke="#9aa0a8" strokeWidth="1" strokeLinecap="round">
          <path d="M320 0 L320 500" strokeDasharray="2 7" />
          <path d="M140 196 L500 196" strokeDasharray="2 7" />
          <circle cx="320" cy="190" r="140" strokeDasharray="3 8" />
          <path d="M600 52 L600 436 M592 60 L608 44 M592 444 L608 428" />
          <path d="M326 52 L612 52 M342 436 L612 436" strokeDasharray="2 5" />
          <path d="M192 486 L448 486 M184 494 L200 478 M440 494 L456 478" />
          <path d="M192 204 L192 498 M448 204 L448 498" strokeDasharray="2 5" />
          <path d="M340 232 C 380 214, 424 160, 462 128 M206 142 C 170 128, 132 110, 104 102 M266 392 C 230 400, 190 412, 160 420" />
          <circle cx="338" cy="233" r="3" /><circle cx="207" cy="143" r="3" /><circle cx="267" cy="391" r="3" />
        </g>
      </defs>
    </svg>
  );
}

/** The pencil sketches pinned around the hero copy (wide screens only). */
function HeroSketches() {
  return (
    <>
      <div className="lp-side" aria-hidden="true" style={{ top: 150, left: "calc(50% - 600px)", width: 210 }}>
        <svg viewBox="0 0 240 310">
          <g filter="url(#lp-pa)" opacity="0.28"><path d="M120 90 L178 130 L120 170 L62 130 Z" fill="url(#lp-hatch)" /></g>
          <Twice id="lp-flow" />
          <g className="lp-hand" filter="url(#lp-gr)" fill="#2f333a" fontSize="21" textAnchor="middle">
            <text x="120" y="38">new idea</text><text x="120" y="136">worth it?</text><text x="38" y="228">park it</text>
            <text x="121" y="236">sketch it</text><text x="42" y="122" fontSize="18">no</text><text x="134" y="194" fontSize="18">yes</text>
            <text x="210" y="304">ship</text>
          </g>
        </svg>
      </div>
      <div className="lp-side" aria-hidden="true" style={{ top: 560, left: "calc(50% - 590px)", width: 210, transform: "rotate(-4deg)" }}>
        <svg viewBox="0 0 220 200">
          <Twice id="lp-note" />
          <g className="lp-hand" filter="url(#lp-gr)" fill="#2f333a" fontSize="20">
            <text x="30" y="48" fontSize="26">to try</text><text x="56" y="90">map the user flow</text>
            <text x="56" y="124">wireframe v2</text><text x="56" y="158">send the link</text>
          </g>
        </svg>
      </div>
      <div className="lp-side" aria-hidden="true" style={{ top: 140, right: "calc(50% - 600px)", width: 240 }}>
        <svg viewBox="0 0 280 240">
          <Twice id="lp-mind" />
          <g className="lp-hand" filter="url(#lp-gr)" fill="#2f333a" fontSize="21" textAnchor="middle">
            <text x="140" y="129" fontSize="25">launch</text><text x="44" y="44">users</text><text x="235" y="48">pricing</text>
            <text x="45" y="206">copy</text><text x="233" y="206">beta list</text>
          </g>
        </svg>
      </div>
      <div className="lp-side lp-glow" aria-hidden="true" style={{ top: 420, right: "calc(50% - 500px)", width: 96 }}>
        <svg viewBox="0 0 140 170">
          <circle cx="70" cy="80" r="62" fill="url(#lp-glow)" />
          <Twice id="lp-sbulb" a={0.85} />
        </svg>
      </div>
      <div className="lp-side" aria-hidden="true" style={{ top: 650, right: "calc(50% - 590px)", width: 220, transform: "rotate(3deg)" }}>
        <svg viewBox="0 0 240 180">
          <Twice id="lp-wire" a={0.75} b={0.35} />
          <g className="lp-hand" filter="url(#lp-gr)" fill="#2f333a" fontSize="19"><text x="150" y="28">hero v3?</text></g>
        </svg>
      </div>
    </>
  );
}

/** The big construction-line lightbulb under the hero copy. */
function Bulb() {
  return (
    <div className="lp-bulb" aria-hidden="true">
      <svg className="lp-art" viewBox="0 0 640 540">
        <g className="lp-glow">
          <circle cx="320" cy="226" r="190" fill="url(#lp-glow)" />
          <circle cx="320" cy="232" r="26" fill={GLOW} opacity="0.5" filter="url(#lp-blur)" />
        </g>
        <g clipPath="url(#lp-glass)" filter="url(#lp-pa)" opacity="0.32"><rect x="372" y="52" width="90" height="290" fill="url(#lp-hatch)" /></g>
        <g filter="url(#lp-pa)" opacity="0.3"><rect x="344" y="352" width="28" height="60" fill="url(#lp-hatch)" /></g>
        <use href="#lp-cons" filter="url(#lp-pa)" opacity="0.85" />
        <Twice id="lp-bulbart" a={0.92} b={0.48} />
        <g className="lp-hand" filter="url(#lp-gr)" fill="#2f333a" fontSize="22">
          <text x="18" y="30" fontSize="20">fig. 01, the idea</text>
          <text x="468" y="122">first spark</text>
          <text x="24" y="94">room to think</text>
          <text x="66" y="432">share link</text>
          <text x="618" y="252" fontSize="19" transform="rotate(-90 618 252)">h 384</text>
          <text x="320" y="512" fontSize="19" textAnchor="middle">⌀ 256</text>
        </g>
      </svg>
    </div>
  );
}

function Tape({ style, alt }: { style: React.CSSProperties; alt?: boolean }) {
  return (
    <svg className="lp-tape" viewBox="0 0 80 30" aria-hidden="true" style={style}>
      <use href="#lp-tape" filter={alt ? "url(#lp-pb)" : "url(#lp-pa)"} />
    </svg>
  );
}

export function Landing() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<null | "board" | "guest">(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [guestError, setGuestError] = useState<string | null>(null);

  // a stored token the server no longer accepts sends the tab to sign in, as on the dashboard
  useEffect(() => installSessionGuard(), []);

  /** This tab's token: the signed-in one, or a new guest session. */
  async function session(): Promise<string> {
    const existing = getToken();
    if (existing) return existing;
    const res = await axios.post(`${API_URL}/guest`);
    setToken(res.data.token);
    return res.data.token;
  }

  /** Name a board, then open it, starting a guest session first when nobody is signed in. */
  async function startBoard(e: React.FormEvent) {
    e.preventDefault();
    const slug = name.trim() || "Untitled board";
    // checked here so a too-short name does not create a guest account for a board that cannot exist
    if (slug.length < 3) {
      setBoardError("Use at least 3 characters");
      return;
    }
    setBusy("board");
    setBoardError(null);
    try {
      const token = await session();
      const res = await axios.post(`${API_URL}/room`, { slug }, { headers: { Authorization: `Bearer ${token}` } });
      router.push(`/canvas/${res.data.shareId}`);
    } catch (err) {
      setBoardError(errorMessage(err, "Could not start a board"));
      setBusy(null);
    }
  }

  async function continueAsGuest() {
    setBusy("guest");
    setGuestError(null);
    try {
      await session();
      router.push("/dashboard");
    } catch (err) {
      setGuestError(errorMessage(err, "Could not start a guest session"));
      setBusy(null);
    }
  }

  return (
    <div id="top" className={`lp ${spaceGrotesk.variable} ${caveat.variable}`}>
      <Defs />

      {/* ============ 1 · hero ============ */}
      <section className="lp-hero" aria-label="Introduction">
        <div className="lp-frame" aria-hidden="true">
          <svg viewBox="0 0 1200 1000" preserveAspectRatio="none">
            <path d="M1 0 L2 1000 M1199 0 L1198 1000 M-60 78 L1260 79" fill="none" stroke="#c6cad2" strokeWidth="1.2" strokeLinecap="round" filter="url(#lp-pa)" />
            <path d="M-8 78 L10 78 M1 70 L1 86 M1190 78 L1208 78 M1199 70 L1199 86" fill="none" stroke="#9aa0a8" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>

        <header className="lp-nav">
          <a href="#top" className="lp-logo">Chalk<span className="lp-wordmark">Line<Underline /></span></a>
          <nav className="lp-links" aria-label="Sections">
            <a href="#screens">Screens</a>
            <a href="#about">About</a>
            <a href="#start">Get started</a>
            <a href="https://github.com/Subhajit578/ChalkLine" target="_blank" rel="noopener noreferrer">Github</a>
          </nav>
          <Link href="/signin" className="lp-pill">Sign in</Link>
        </header>

        <HeroSketches />

        <div className="lp-intro">
          <h1 className="lp-h1">
            Think out loud,<br />draw it{" "}
            <span className="lp-mark">
              together.
              <svg viewBox="0 0 300 30" preserveAspectRatio="none" aria-hidden="true">
                {/* the empty rect widens the filter's box: it is sized from the path, not its 16px stroke */}
                <g filter="url(#lp-pa)" opacity="0.4">
                  <rect width="300" height="30" fill="none" />
                  <path d="M6 18 C 70 10, 150 22, 294 12" fill="none" stroke={GLOW} strokeWidth="16" strokeLinecap="round" />
                </g>
              </svg>
            </span>
          </h1>
          <p className="lp-lede">ChalkLine is a shared whiteboard for sketching flows, mapping ideas and drawing with your team, live. Open a board, send the link, start thinking.</p>

          <form className="lp-bar" onSubmit={startBoard}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20 L5 15 L16 4 L20 8 L9 19 Z M14 6 L18 10" fill="none" stroke="#3b3f47" strokeWidth="1.6" strokeLinejoin="round" /></svg>
            <label htmlFor="lp-board">
              <span>Name your first board</span>
              <input
                id="lp-board"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sprint planning, user flow, anything"
                maxLength={20}
                autoComplete="off"
              />
            </label>
            <button type="submit" className="lp-btn lp-btn--dark" disabled={busy !== null} aria-busy={busy === "board"}>
              {busy === "board" ? "Opening…" : "Start drawing"}
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3 L11 8 L6 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </form>
          {boardError && <p className="lp-error" role="alert">{boardError}</p>}
          <p className="lp-join">Got a share link? <Link href="/dashboard">Join a board</Link></p>
        </div>

        <Bulb />
      </section>

      {/* ============ 2 · screens, on ruled paper ============ */}
      <section id="screens" className="lp-screens" aria-labelledby="lp-screens-title">
        <div className="lp-paper" aria-hidden="true">
          <svg><rect width="100%" height="100%" fill="url(#lp-rule)" filter="url(#lp-pa)" /></svg>
          <div className="lp-margin" />
        </div>
        <div className="lp-side" aria-hidden="true" style={{ top: -90, right: "calc(50% - 780px)", width: 340 }}>
          <svg viewBox="0 0 340 340">
            <g fill="none" stroke="#b9bec6" strokeWidth="1.5" strokeLinecap="round" filter="url(#lp-pa)">
              <path d="M170 24 C 260 22, 318 90, 316 172 C 314 258, 248 318, 166 316 C 84 314, 24 254, 26 168 C 28 88, 90 30, 182 30" />
              <path d="M170 84 C 220 82, 258 120, 256 172 C 254 222, 214 258, 166 256 C 116 254, 84 216, 86 168" opacity="0.6" />
            </g>
          </svg>
        </div>
        <div className="lp-side" aria-hidden="true" style={{ bottom: 60, left: "calc(50% - 700px)", width: 180 }}>
          <svg viewBox="0 0 180 160">
            <g fill="none" stroke="#b9bec6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" filter="url(#lp-pa)">
              <path d="M20 140 L90 18 L160 140 Z" /><path d="M44 128 L90 48 M66 134 L104 70" opacity="0.6" />
            </g>
          </svg>
        </div>

        <div className="lp-wrap">
          <div className="lp-screens-head">
            <div>
              <p className="lp-overline">Inside ChalkLine</p>
              <h2 id="lp-screens-title" className="lp-h2">Three screens, that&rsquo;s the whole app.</h2>
            </div>
            <p>A board to draw on, a home for every board, and a face so people know it&rsquo;s you.</p>
          </div>

          <div className="lp-bento">
            <div>
              <div className="lp-shot">
                <Tape style={{ left: -22, top: -12, transform: "rotate(-9deg)" }} />
                <Tape style={{ right: -22, top: -12, transform: "rotate(8deg)" }} />
                <div className="lp-shot-inner"><ShotWhiteboard /></div>
              </div>
              <div className="lp-board-notes">
                <div>
                  <h3>The board</h3>
                  <p>One canvas everyone draws on at once. Changes show up for the whole room as they happen.</p>
                </div>
                <ul className="lp-ticks">
                  <li><Tick />Pencil, shapes, arrows and text</li>
                  <li><Tick alt />Paste or drop in images</li>
                  <li><Tick />Export the board as a PDF</li>
                </ul>
              </div>
            </div>

            <div className="lp-stack">
              <div>
                <div className="lp-shot lp-shot--cw">
                  <Tape alt style={{ left: "50%", top: -14, transform: "translateX(-50%) rotate(-3deg)" }} />
                  <div className="lp-shot-inner"><ShotDashboard /></div>
                </div>
                <div className="lp-caption"><h3>Your boards</h3><span className="lp-hand">all of them, searchable</span></div>
              </div>
              <div>
                <div className="lp-shot lp-shot--ccw">
                  <Tape style={{ right: -18, top: -12, transform: "rotate(10deg)" }} />
                  <div className="lp-shot-inner"><ShotAvatar /></div>
                </div>
                <div className="lp-caption"><h3>Your face</h3><span className="lp-hand">96 to pick from</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ 3 · about + sign in ============ */}
      <section id="start" className="lp-start" aria-labelledby="lp-start-title">
        <span id="about" style={{ position: "absolute", top: 0 }} />
        <div className="lp-side lp-glow" aria-hidden="true" style={{ top: 0, left: "calc(50% - 640px)", width: 120 }}>
          <svg viewBox="0 0 120 260">
            <circle cx="60" cy="190" r="70" fill="url(#lp-glow)" />
            <path d="M60 0 C 62 40, 58 80, 60 110" fill="none" stroke="#3b3f47" strokeWidth="1.4" strokeLinecap="round" filter="url(#lp-pa)" />
            <g transform="translate(60 110) scale(0.62)"><Twice id="lp-hb" a={0.9} /></g>
          </svg>
        </div>

        <div className="lp-start-row">
          <div className="lp-about">
            <p className="lp-overline">About ChalkLine</p>
            <h2 id="lp-start-title" className="lp-h2">Bring the team.<br />Bring a pencil.</h2>
            <p>ChalkLine is a whiteboard for the messy middle of an idea. Sketch the flow, argue over the boxes and leave with something everyone drew together. Every board has its own link, so inviting someone takes a second.</p>
            <ul className="lp-ticks">
              <li><Tick />Free to start, nothing to install</li>
              <li><Tick alt />Share any board with one link</li>
              <li><Tick />Try it as a guest, keep your boards later</li>
            </ul>
          </div>

          <div className="lp-cardwrap">
            <div className="lp-card">
              <svg className="lp-card-lines" aria-hidden="true">
                <rect y="70" width="100%" height="100%" fill="url(#lp-cardrule)" />
                <path d="M48 0 L48 2000" stroke="#e6b8b8" strokeWidth="1.2" />
              </svg>
              <svg className="lp-clip" viewBox="0 0 40 80" aria-hidden="true">
                <path d="M28 18 L28 64 C 28 76, 10 76, 10 64 L10 10 C 10 0, 24 0, 24 10 L24 58 C 24 64, 15 64, 15 58 L15 22" fill="none" stroke="#3b3f47" strokeWidth="2.2" strokeLinecap="round" filter="url(#lp-pa)" />
              </svg>
              <div className="lp-card-body">
                <p className="lp-card-title lp-hand">start here</p>
                <p>Make an account to keep your boards, or sign in to pick up where you left off.</p>
                <div className="lp-card-actions">
                  <Link href="/signup" className="lp-btn lp-btn--dark">Create account</Link>
                  <Link href="/signin" className="lp-btn lp-btn--light">Sign in</Link>
                </div>
                <div className="lp-or lp-hand" aria-hidden="true">
                  <svg viewBox="0 0 100 6" preserveAspectRatio="none"><path d="M2 3 C 30 2, 70 4, 98 3" fill="none" stroke="#c6cad2" strokeWidth="1.3" vectorEffect="non-scaling-stroke" /></svg>
                  or
                  <svg viewBox="0 0 100 6" preserveAspectRatio="none"><path d="M2 3 C 30 4, 70 2, 98 3" fill="none" stroke="#c6cad2" strokeWidth="1.3" vectorEffect="non-scaling-stroke" /></svg>
                </div>
                <button type="button" className="lp-guest" onClick={continueAsGuest} disabled={busy !== null} aria-busy={busy === "guest"}>
                  {busy === "guest" ? "Starting…" : "Continue as a guest"}
                </button>
                {guestError && <p className="lp-error" role="alert">{guestError}</p>}
              </div>
            </div>
          </div>
        </div>

        <footer className="lp-foot">
          <svg viewBox="0 0 1200 6" preserveAspectRatio="none" aria-hidden="true">
            <path d="M2 3 C 300 1, 900 5, 1198 2" fill="none" stroke="#c6cad2" strokeWidth="1.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <span><strong>ChalkLine</strong> · a shared whiteboard · © {new Date().getFullYear()}</span>
          <nav aria-label="Account">
            <Link href="/signin">Sign in</Link>
            <Link href="/signup">Create account</Link>
          </nav>
        </footer>
      </section>
    </div>
  );
}
