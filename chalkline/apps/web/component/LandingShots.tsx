/**
 * The three "screenshots" on the landing page: the whiteboard, the dashboard
 * and the avatar picker, redrawn in markup rather than captured, so they stay
 * sharp at any size and never go stale against a broken backend. Styles are in
 * Landing.css under `.shot`; every length there is in cqw so each picture
 * scales as one.
 *
 * shortcut: these are hand-kept copies of the real screens; when the app UI
 * changes enough that they look wrong, swap them for real screenshots.
 */

const TOOLS = [
  <path key="sel" d="M6 4 L6 18 L10 14 L13 20 L15 19 L12 13 L18 13 Z" />,
  <path key="pan" d="M8 12 L8 6.5 C 8 5, 11 5, 11 6.5 L11 11 M11 10 L11 4.5 C 11 3, 14 3, 14 4.5 L14 11 M14 10 L14 6.5 C 14 5, 17 5, 17 6.5 L17 14 C 17 18, 14 20, 11 20 C 8 20, 7 19, 5 16 L3.5 13.5 C 3 12, 5 11, 6 12.5 L8 15" />,
  null,
  <path key="pen" d="M4 20 L5 15 L16 4 L20 8 L9 19 Z" />,
  <rect key="rect" x="4" y="6" width="16" height="12" rx="2" />,
  <circle key="circle" cx="12" cy="12" r="8" />,
  <path key="line" d="M5 19 L19 5" />,
  <path key="arrow" d="M5 19 L19 5 M10 5 L19 5 L19 14" />,
  <path key="text" d="M6 6 L18 6 M12 6 L12 19" />,
  <g key="image"><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M20 16 L15 11 L6 19" /><circle cx="9" cy="10" r="1.5" /></g>,
  <path key="eraser" d="M9 20 L4 15 L13 6 L19 12 L11 20 Z M8 11 L14 17 M11 20 L20 20" />,
];

export function ShotWhiteboard() {
  return (
    <div className="shot" role="img" aria-label="The ChalkLine whiteboard: a shared architecture sketch with the drawing toolbar on top">
      <svg className="shot-fill" aria-hidden="true">
        <defs>
          <pattern id="shot-dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#dcdfe5" /></pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#shot-dots)" />
      </svg>
      <svg className="shot-fill" viewBox="0 0 1000 625" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <g transform="rotate(-3 800 480)">
          <rect x="700" y="420" width="200" height="120" fill="#fff3bf" />
          <g fill="#5c4a12" fontSize="22" fontWeight="500"><text x="718" y="462">ship rooms</text><text x="718" y="492">by friday</text></g>
        </g>
        <g fill="none" stroke="#1e1e1e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="120" y="230" width="190" height="96" rx="12" />
          <rect x="405" y="230" width="190" height="96" rx="12" fill="#e6f4f1" stroke="#0f766e" />
          <rect x="690" y="230" width="190" height="96" rx="12" />
          <path d="M312 278 L398 278 M386 268 L400 278 L386 288" />
          <path d="M597 278 L683 278 M671 268 L685 278 L671 288" />
          <path d="M500 328 L500 398 M490 386 L500 400 L510 386" />
          <ellipse cx="500" cy="420" rx="78" ry="16" />
          <path d="M422 420 L422 500 M578 420 L578 500 M422 500 C 422 522, 578 522, 578 500" />
          <path d="M785 328 C 785 410, 700 452, 592 462 M604 452 L590 462 L604 472" stroke="#868b95" strokeDasharray="8 8" />
        </g>
        <path d="M392 222 C 420 186, 604 186, 614 236 C 626 300, 590 344, 500 346 C 408 348, 378 300, 396 240" fill="none" stroke="#e8590c" strokeWidth="3" strokeLinecap="round" />
        <g fill="#181a1f" fontSize="24" fontWeight="500" textAnchor="middle">
          <text x="215" y="286">Web app</text><text x="500" y="286" fill="#0b4f49">WS server</text><text x="785" y="286">HTTP API</text><text x="500" y="474">Postgres</text>
        </g>
        <text x="120" y="190" fill="#181a1f" fontSize="30" fontWeight="600">v2 architecture</text>
        <path d="M120 202 L330 202" stroke="#181a1f" strokeWidth="2.5" strokeLinecap="round" />
      </svg>

      <div className="shot-chip shot-title">
        <svg viewBox="0 0 24 24"><path d="M15 5 L8 12 L15 19" fill="none" stroke="#585c66" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Sprint planning
      </div>
      <div className="shot-toolbar">
        {TOOLS.map((tool, i) =>
          tool ? (
            <span key={i} className={i === 4 ? "shot-tool is-on" : "shot-tool"}><svg viewBox="0 0 24 24">{tool}</svg></span>
          ) : (
            <span key={i} className="shot-sep" />
          )
        )}
      </div>
      <div className="shot-people">
        <span className="shot-faces">
          <span className="shot-face" style={{ background: "#f6e3c6", color: "#5c4a12" }}>A</span>
          <span className="shot-face" style={{ background: "#dbe7f3", color: "#1c4a7a" }}>R</span>
          <span className="shot-face" style={{ background: "#e3eedf", color: "#2b5a24" }}>M</span>
        </span>
        <span className="shot-teal shot-share">Share</span>
      </div>
      <div className="shot-chip shot-zoom"><span>−</span><b>100%</b><span>+</span></div>
    </div>
  );
}

const BOARDS = [
  {
    name: "Sprint planning", meta: "Edited 2h ago", dot: "#e8590c",
    art: <g fill="none" stroke="#1e1e1e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="12" y="28" width="36" height="24" rx="3" /><rect x="62" y="28" width="36" height="24" rx="3" stroke="#0f766e" /><rect x="112" y="28" width="36" height="24" rx="3" /><path d="M48 40 L62 40 M98 40 L112 40" /><path d="M12 72 L100 72 M12 82 L70 82" stroke="#9aa0a8" /></g>,
  },
  {
    name: "Onboarding flow", meta: "Edited yesterday", dot: "#1c7ed6",
    art: <g fill="none" stroke="#1e1e1e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="28" cy="50" r="13" /><path d="M80 34 L96 50 L80 66 L64 50 Z" /><rect x="112" y="38" width="36" height="24" rx="3" /><path d="M41 50 L64 50 M96 50 L112 50" /><path d="M80 66 L80 84" stroke="#1c7ed6" /></g>,
  },
  {
    name: "Homepage wireframe", meta: "Edited 3 days ago", dot: "#2f9e44", shared: true,
    art: <g fill="none" stroke="#1e1e1e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="14" y="12" width="132" height="78" rx="4" /><rect x="22" y="24" width="56" height="32" rx="2" /><path d="M88 28 L138 28 M88 38 L126 38" stroke="#9aa0a8" /><rect x="88" y="46" width="30" height="10" rx="5" /><path d="M22 68 L138 68 M22 78 L108 78" stroke="#9aa0a8" /></g>,
  },
  {
    name: "Team retro",
    art: <g><rect x="16" y="16" width="36" height="30" fill="#fff3bf" /><rect x="62" y="16" width="36" height="30" fill="#d3f9d8" /><rect x="108" y="16" width="36" height="30" fill="#ffe3e3" /><rect x="16" y="54" width="36" height="30" fill="#fff3bf" /><rect x="108" y="54" width="36" height="30" fill="#ffe3e3" /></g>,
  },
  {
    name: "System design",
    art: <g fill="none" stroke="#1e1e1e" strokeWidth="2" strokeLinecap="round"><ellipse cx="80" cy="60" rx="22" ry="6" /><path d="M58 60 L58 82 M102 60 L102 82 M58 82 C 58 88, 102 88, 102 82" /><rect x="20" y="14" width="40" height="22" rx="3" /><rect x="100" y="14" width="40" height="22" rx="3" /><path d="M40 36 L70 54 M120 36 L90 54" /></g>,
  },
  {
    name: "Ideas dump",
    art: <g fill="none" stroke="#1e1e1e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 80 C 40 30, 60 70, 84 40 C 104 16, 124 50, 144 24" /><circle cx="44" cy="30" r="8" stroke="#e8590c" /></g>,
  },
];

export function ShotDashboard() {
  return (
    <div className="shot shot--dash" role="img" aria-label="The ChalkLine dashboard: filters in a sidebar and a grid of board cards with thumbnails">
      <div className="shot-side">
        <div className="shot-brand">ChalkLine</div>
        <div className="shot-nav is-on"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>All drawings</div>
        <div className="shot-nav"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 20 C 5 15, 19 15, 20 20" /></svg>Yours</div>
        <div className="shot-nav"><svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="3.5" /><circle cx="17" cy="10" r="2.5" /><path d="M2.5 19 C 3.5 14.5, 14.5 14.5, 15.5 19 M15 15 C 18 14, 21 15.5, 21.5 18" /></svg>Shared with you</div>
        <div className="shot-me"><span>R</span><span><b>Riya</b><small>Account</small></span></div>
      </div>
      <div className="shot-main">
        <div className="shot-h">Drawings</div>
        <div className="shot-row">
          <div className="shot-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="M16 16 L20 20" /></svg>Search drawings</div>
          <span className="shot-ghost">Join</span>
          <span className="shot-teal shot-new"><svg viewBox="0 0 24 24"><path d="M12 5 L12 19 M5 12 L19 12" /></svg>New</span>
        </div>
        <div className="shot-grid">
          {BOARDS.map((b) => (
            <div key={b.name} className="shot-card">
              {b.shared && <span className="shot-chipdark">Shared</span>}
              <div className="shot-thumb"><svg viewBox="0 0 160 100">{b.art}</svg></div>
              <div className="shot-name">{b.name}</div>
              {b.meta && <div className="shot-meta"><i style={{ background: b.dot }} />{b.meta}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const HAIR = {
  short: "M11 21 C 10 13, 15 10, 20 10 C 26 10, 30 13, 29 21 C 27 16, 23 15, 19 15 C 15 15, 13 17, 11 21 Z",
  bun: "M11 20 C 11 13, 15 11, 20 11 C 25 11, 29 13, 29 20 C 26 15, 14 15, 11 20 Z M16.5 8 C 16.5 5, 23.5 5, 23.5 8 C 23.5 11, 16.5 11, 16.5 8 Z",
  long: "M10 31 C 9 18, 13 10, 20 10 C 27 10, 31 18, 30 31 L27 31 C 27 22, 25 17, 20 16 C 15 17, 13 22, 13 31 Z",
  spiky: "M11 19 L12 11 L15 14 L17 8 L20 13 L23 8 L25 14 L28 11 L29 19 C 25 16, 15 16, 11 19 Z",
  side: "M11 21 C 10 13, 15 10, 21 10 C 27 10, 30 13, 29 19 C 24 18, 18 16, 15 13 C 13 15, 12 18, 11 21 Z",
  curly: "M11 20 C 9 16, 11 12, 14 12.5 C 14 9.5, 18 8.5, 20 10.5 C 22 8.5, 26 9.5, 26 12.5 C 29 12, 31 16, 29 20 C 26 17, 14 17, 11 20 Z",
  beanie: "M10.5 18 C 10.5 11, 15 9, 20 9 C 25 9, 29.5 11, 29.5 18 Z M10 17 L30 17 L30 19.5 L10 19.5 Z",
};
const MOUTH = {
  smile: "M17 25.5 C 18.5 27.5, 21.5 27.5, 23 25.5",
  flat: "M18 26.5 L22 26.5",
  grin: "M17.5 25.5 C 19 28.5, 21 28.5, 22.5 25.5",
};
type Face = [bg: string, skin: string, hair: keyof typeof HAIR, hairColor: string, mouth: keyof typeof MOUTH, shirt: string];
const FACES: Face[] = [
  ["#f6e3c6", "#f1c9a5", "short", "#5a3a22", "smile", "#3b3f47"],
  ["#dbe7f3", "#8d5a3b", "curly", "#2b2b2b", "grin", "#e8590c"],
  ["#e3eedf", "#f5d6bd", "long", "#d9a441", "smile", "#1c7ed6"],
  ["#f3dfe2", "#c68a5d", "bun", "#2b2b2b", "flat", "#2f9e44"],
  ["#efe9d9", "#e0ac7e", "spiky", "#a0522d", "grin", "#181a1f"],
  ["#d9ecea", "#e0ac7e", "curly", "#2b2b2b", "smile", "#0f766e"],
  ["#ececec", "#f1c9a5", "beanie", "#e8590c", "smile", "#585c66"],
  ["#dbe7f3", "#f5d6bd", "side", "#6b6f76", "flat", "#e8590c"],
  ["#e3eedf", "#8d5a3b", "short", "#2b2b2b", "grin", "#1c7ed6"],
  ["#f6e3c6", "#c68a5d", "long", "#5a3a22", "smile", "#181a1f"],
  ["#f3dfe2", "#f1c9a5", "spiky", "#d9a441", "smile", "#2f9e44"],
  ["#efe9d9", "#8d5a3b", "beanie", "#1c7ed6", "grin", "#3b3f47"],
  ["#d9ecea", "#f5d6bd", "bun", "#a0522d", "smile", "#e8590c"],
  ["#ececec", "#e0ac7e", "side", "#2b2b2b", "flat", "#0f766e"],
  ["#dbe7f3", "#c68a5d", "curly", "#5a3a22", "smile", "#585c66"],
  ["#f6e3c6", "#f1c9a5", "long", "#2b2b2b", "grin", "#1c7ed6"],
];
const PICKED = 5;

function FaceArt({ face }: { face: Face }) {
  const [bg, skin, hair, hairColor, mouth, shirt] = face;
  return (
    <svg viewBox="0 0 40 40">
      <rect width="40" height="40" rx="5" fill={bg} />
      <path d="M8 40 C 9 31, 31 31, 32 40 Z" fill={shirt} />
      <rect x="17" y="27" width="6" height="5" fill={skin} />
      <circle cx="20" cy="21" r="9" fill={skin} />
      <path d={HAIR[hair]} fill={hairColor} />
      <circle cx="16.5" cy="22" r="1" fill="#1e1e1e" />
      <circle cx="23.5" cy="22" r="1" fill="#1e1e1e" />
      <path d={MOUTH[mouth]} fill="none" stroke="#1e1e1e" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function ShotAvatar() {
  return (
    <div className="shot shot--avatar" role="img" aria-label="The ChalkLine avatar picker: avatar styles as tabs over a grid of faces, one selected">
      <div className="shot-ghostui"><div /><div><i /><i /><i /><i /></div></div>
      <div className="shot-scrim" />
      <div className="shot-dialog">
        <div className="shot-dhead">
          <FaceArt face={FACES[PICKED]} />
          <div><b>Choose your avatar</b><small>96 to pick from, across 6 styles.</small></div>
          <svg className="shot-x" viewBox="0 0 24 24"><path d="M6 6 L18 18 M18 6 L6 18" /></svg>
        </div>
        <div className="shot-tabs">
          {["Adventurer", "Notionist", "Personas", "Pixel Art", "Toon Head", "Big Ears"].map((s, i) => (
            <span key={s} className={i === 0 ? "is-on" : undefined}>{s}</span>
          ))}
        </div>
        <div className="shot-faces-grid">
          {FACES.map((face, i) => (
            <div key={i} className={i === PICKED ? "shot-pick is-on" : "shot-pick"}>
              <FaceArt face={face} />
              {i === PICKED && <span className="shot-check"><svg viewBox="0 0 24 24"><path d="M5 12 L10 17 L19 7" /></svg></span>}
            </div>
          ))}
        </div>
        <div className="shot-dfoot">
          <span><svg viewBox="0 0 24 24"><path d="M3 7 L7 7 C 12 7, 12 17, 17 17 L21 17 M18 14 L21 17 L18 20 M3 17 L7 17 C 9 17, 10 15.5, 11 13.5 M13 10.5 C 14 8.5, 15 7, 17 7 L21 7 M18 4 L21 7 L18 10" /></svg>Surprise me</span>
          <span><span className="shot-ghost">Cancel</span><span className="shot-teal">Save</span></span>
        </div>
      </div>
    </div>
  );
}
