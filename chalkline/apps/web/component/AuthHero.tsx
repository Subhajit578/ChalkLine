/**
 * The sign-in hero: a flowchart that looks pencil-sketched, then the wordmark
 * and a two-line pitch. Pure SVG, no image files.
 *
 * The pencil look is two SVG filters over the same line art: each wobbles the
 * strokes with low-frequency noise and eats into them with fine grain, and the
 * two passes use different seeds so every line comes out slightly doubled,
 * like a hand going over it twice.
 */
const pencil = (id: string, warpSeed: number, scale: number, grainSeed: number, alpha: string) => (
  <filter id={id} filterUnits="userSpaceOnUse" x="0" y="0" width="540" height="470">
    <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves={2} seed={warpSeed} result="warp" />
    <feDisplacementMap in="SourceGraphic" in2="warp" scale={scale} xChannelSelector="R" yChannelSelector="G" result="wob" />
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={1} seed={grainSeed} result="grain" />
    <feColorMatrix in="grain" type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${alpha}`} result="mask" />
    <feComposite in="wob" in2="mask" operator="in" />
  </filter>
);

export function AuthHero() {
  return (
    <>
      <div className="au-sketch">
        <svg viewBox="0 0 540 470" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <defs>
            {pencil("au-pencil-a", 3, 5, 8, "2.6 0 0 0 -0.55")}
            {pencil("au-pencil-b", 11, 7, 21, "2.8 0 0 0 -0.8")}
            <filter id="au-grain" filterUnits="userSpaceOnUse" x="0" y="0" width="540" height="470">
              <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={1} seed={5} result="grain" />
              <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2.4 0 0 0 -0.35" result="mask" />
              <feComposite in="SourceGraphic" in2="mask" operator="in" />
            </filter>
            <pattern id="au-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-40)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#3b3f47" strokeWidth="1" />
            </pattern>
            <g id="au-lines" fill="none" stroke="#3b3f47" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="200" y="58" width="140" height="46" rx="23" />
              <path d="M270 106 L270 148 M262 139 L270 150 L278 139" />
              <path d="M270 154 L350 214 L270 274 L190 214 Z" />
              <path d="M188 214 L130 214 M140 206 L129 214 L140 222" />
              <rect x="40" y="190" width="88" height="48" rx="6" />
              <path d="M352 214 L408 214 M398 206 L409 214 L398 222" />
              <rect x="410" y="188" width="100" height="52" rx="6" />
              <path d="M460 242 C 460 292, 428 322, 348 323 M359 315 L347 323 L359 331" />
              <rect x="196" y="300" width="148" height="48" rx="6" />
              <path d="M270 350 L270 388 M262 379 L270 390 L278 379" />
              <circle cx="270" cy="424" r="32" />
              <path d="M84 188 C 84 120, 120 82, 196 81" strokeDasharray="7 8" />
              <path d="M185 73 L198 81 L186 89" />
              <path d="M336 400 L340 412 L353 412 L343 420 L347 433 L336 425 L325 433 L329 420 L319 412 L332 412 Z" />
              <path d="M448 432 C 424 446, 386 444, 362 426 M369 438 L361 425 L375 424" />
            </g>
          </defs>
          <g filter="url(#au-pencil-a)" opacity="0.3">
            <path d="M270 154 L350 214 L270 274 L190 214 Z" fill="url(#au-hatch)" />
            <circle cx="270" cy="424" r="32" fill="url(#au-hatch)" />
          </g>
          <g filter="url(#au-pencil-a)" opacity="0.92"><use href="#au-lines" /></g>
          <g filter="url(#au-pencil-b)" opacity="0.5"><use href="#au-lines" /></g>
          <g className="au-sketch-labels" filter="url(#au-grain)" fill="#2f333a" fontWeight="600" fontSize="23" textAnchor="middle">
            <text x="270" y="88">new idea</text>
            <text x="270" y="221">worth it?</text>
            <text x="84" y="221">park it</text>
            <text x="460" y="221">sketch it</text>
            <text x="270" y="331">share link</text>
            <text x="270" y="431">ship</text>
            <text x="160" y="204" fontSize="19">no</text>
            <text x="380" y="204" fontSize="19">yes</text>
            <text x="66" y="140" fontSize="19" transform="rotate(-62 66 140)">later</text>
            <text x="476" y="446" fontSize="21" transform="rotate(-6 476 446)">launch!</text>
          </g>
        </svg>
      </div>
      <div className="au-copy">
        <p className="au-wordmark">
          Chalk
          <span>
            Line
            <svg viewBox="0 0 120 16" preserveAspectRatio="none" aria-hidden="true">
              <path d="M3 9 C 28 4, 58 12, 84 7 S 112 5, 117 8" fill="none" stroke="#3b3f47" strokeWidth="2.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              <path d="M10 12 C 40 9, 70 13, 104 10" fill="none" stroke="#3b3f47" strokeWidth="1.3" strokeLinecap="round" opacity="0.5" vectorEffect="non-scaling-stroke" />
            </svg>
          </span>
        </p>
        <p className="au-tagline">
          A shared whiteboard for thinking out loud.
          <br />
          Sketch flows, map ideas and draw together, live.
        </p>
      </div>
    </>
  );
}
