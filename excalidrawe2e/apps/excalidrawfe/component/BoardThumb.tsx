"use client";
import React, { useEffect, useRef, useState } from "react";
import { getExistingShapes } from "@/draw/http";
import { renderShapesToBlob, exportBounds } from "@/draw/exportBoard";
import { useTheme } from "./ThemeProvider";

/**
 * A board's thumbnail, rendered on the client from its own shapes.
 *
 * Reuses the exact export renderer the PDF/print path uses, pointed at a small
 * off-screen bitmap: no backend thumbnail pipeline, no capture step. The fetch
 * and render only run once the card is near the viewport (IntersectionObserver),
 * so a long, lazily-paged grid does not fetch every board at once.
 *
 * Image shapes render as placeholders here (an empty decoded-image map) - a
 * preview does not need to pull every uploaded picture. An empty board, or any
 * failure, falls back to a plain well, never an error the person has to read.
 */
export function BoardThumb({ roomId, name }: { roomId: number; name: string }) {
  const { theme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  // pending while off-screen or rendering; blank once we know there is nothing to show
  const [status, setStatus] = useState<"pending" | "ready" | "blank">("pending");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let objectUrl: string | null = null;

    const render = async () => {
      try {
        const shapes = await getExistingShapes(String(roomId));
        if (cancelled) return;
        const box = exportBounds(shapes);
        if (!box) {
          setStatus("blank");
          return;
        }
        // target a ~480px long edge so each thumbnail stays a small bitmap
        const scale = Math.min(2, Math.max(0.05, 480 / Math.max(box.width, box.height)));
        // render in the app's current theme: white preview in light, dark in dark
        const result = await renderShapesToBlob(shapes, new Map(), scale, theme);
        if (cancelled || !result) {
          setStatus("blank");
          return;
        }
        objectUrl = URL.createObjectURL(result.blob);
        setUrl(objectUrl);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("blank");
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          render();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);

    return () => {
      cancelled = true;
      io.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [roomId, theme]);

  return (
    <div
      ref={ref}
      className={`pu-thumb${status === "pending" ? " pu-thumb--pending" : ""}`}
      aria-hidden="true"
    >
      {status === "ready" && url ? (
        <img src={url} alt="" />
      ) : status === "blank" ? (
        <span className="pu-thumb-empty" title={`${name} — empty board`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M9 21V9" opacity="0.5" />
          </svg>
        </span>
      ) : null}
    </div>
  );
}
