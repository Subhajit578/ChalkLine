"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Kalam } from "next/font/google";
import { Minus, StickyNote as NoteIcon } from "lucide-react";
import { getNote, saveNote } from "@/draw/http";
import type { Palette } from "@/draw/theme";

/** the note's own handwriting, used nowhere else, so a note never reads as board text */
const noteHand = Kalam({ weight: "400", subsets: ["latin"], display: "swap" });

/** the same cap as MAX_NOTE_LENGTH in @repo/common/types, which the server enforces */
const MAX_LENGTH = 2000;
/** pause in typing before the note saves */
const SAVE_AFTER_MS = 600;

/** Blank text is no note at all: saving it deletes the note. */
const asSaved = (text: string) => (text.trim() === "" ? "" : text);

const openKey = (roomId: string) => `chalkline:note-open:${roomId}`;

/** Whether this browser last left the note open on this board. */
export function wasNoteOpen(roomId: string): boolean {
  try {
    return localStorage.getItem(openKey(roomId)) === "1";
  } catch {
    return false;
  }
}

const STATUS_TEXT = { idle: "", saving: "Saving…", saved: "Saved", failed: "Couldn't save" } as const;

/**
 * Your own sticky note on this board: a "Note" chip beside the people on the
 * board, with the note dropping down below it. Only you can see it. Plain
 * text, saved as you type. Once it has text it can only be hidden, which
 * leaves the chip; deleting all of its text deletes the note.
 *
 * Sits in the canvas's top-right corner, which positions it: the box hangs
 * from that corner's right edge, the same as the people list.
 */
export function StickyNote({
  roomId,
  open,
  onOpenChange,
  palette,
}: {
  roomId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  palette: Palette;
}) {
  const [text, setText] = useState("");
  const [load, setLoad] = useState<"loading" | "ready" | "failed">("loading");
  const [status, setStatus] = useState<keyof typeof STATUS_TEXT>("idle");
  // what the box holds and what the server holds ("" = no note)
  const latest = useRef("");
  const saved = useRef("");
  const busy = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const firstOpen = useRef(true);

  useEffect(() => {
    if (load !== "loading") return;
    let cancelled = false;
    getNote(roomId)
      .then((stored) => {
        if (cancelled) return;
        latest.current = saved.current = stored ?? "";
        setText(stored ?? "");
        setLoad("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[note] could not load your note", err);
        setLoad("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, load]);

  // Sends whatever the server does not have yet. One save at a time, so they
  // cannot land out of order; an edit made during one goes out right after it.
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (busy.current) return;
    busy.current = true;
    let sent = false;
    try {
      while (asSaved(latest.current) !== saved.current) {
        const sending = asSaved(latest.current);
        setStatus("saving");
        await saveNote(roomId, sending);
        saved.current = sending;
        sent = true;
      }
      if (sent) setStatus("saved");
    } catch (err) {
      // the text stays in the box; the next edit or hide tries again
      console.warn("[note] could not save your note", err);
      setStatus("failed");
    } finally {
      busy.current = false;
    }
  }, [roomId]);

  // save on hide (from here or the toolbar), on leaving the tab, and on leaving the board
  useEffect(() => {
    if (!open) void flush();
  }, [open, flush]);
  useEffect(() => {
    const onVisibility = () => document.visibilityState === "hidden" && void flush();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void flush();
    };
  }, [flush]);

  useEffect(() => {
    try {
      if (open) localStorage.setItem(openKey(roomId), "1");
      else localStorage.removeItem(openKey(roomId));
    } catch {
      // private mode or blocked storage: the note just starts hidden next time
    }
  }, [roomId, open]);

  // focus the box when someone opens it, not when it reopens itself on page load
  useEffect(() => {
    if (open && !firstOpen.current) fieldRef.current?.focus();
    firstOpen.current = false;
  }, [open]);

  const hasNote = text.trim() !== "";
  if (!open && !hasNote) return null;

  const surface: CSSProperties = {
    background: palette.panel,
    border: `1px solid ${palette.panelBorder}`,
    color: palette.panelText,
    backdropFilter: "blur(8px)",
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        title={open ? "Hide your note" : "Open your note"}
        style={{
          ...surface,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          borderRadius: 999,
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        <NoteIcon size={16} aria-hidden />
        Note
      </button>

      {open && (
        <section
          aria-label="Your note"
          style={{
            ...surface,
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            zIndex: 1,
            width: "min(280px, calc(100vw - 20px))",
            padding: 8,
            borderRadius: 12,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 4 }}>
            <NoteIcon size={14} aria-hidden color={palette.panelMuted} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Note</span>
            <span
              role="status"
              style={{
                flex: 1,
                fontSize: 12,
                color: status === "failed" ? palette.colors.red : palette.panelMuted,
              }}
            >
              {STATUS_TEXT[status]}
            </span>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              title="Hide note"
              aria-label="Hide note"
              style={{
                display: "grid",
                placeItems: "center",
                padding: 4,
                border: "none",
                borderRadius: 999,
                background: "transparent",
                color: palette.panelMuted,
                cursor: "pointer",
              }}
            >
              <Minus size={16} />
            </button>
          </div>

          {load === "failed" ? (
            <p style={{ margin: 0, padding: "12px 4px", fontSize: 13, color: palette.panelMuted }}>
              Couldn&apos;t load your note.{" "}
              <button
                type="button"
                onClick={() => setLoad("loading")}
                style={{
                  padding: 0,
                  border: "none",
                  background: "none",
                  color: palette.accent,
                  font: "inherit",
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                Try again
              </button>
            </p>
          ) : (
            <textarea
              ref={fieldRef}
              aria-label="Note text"
              value={text}
              disabled={load !== "ready"}
              placeholder={load === "loading" ? "Loading…" : "Only you can see this note"}
              maxLength={MAX_LENGTH}
              rows={8}
              onChange={(e) => {
                latest.current = e.target.value;
                setText(e.target.value);
                if (status === "saved") setStatus("idle");
                window.clearTimeout(timer.current);
                timer.current = window.setTimeout(() => void flush(), SAVE_AFTER_MS);
              }}
              onKeyDown={(e) => e.key === "Escape" && onOpenChange(false)}
              style={{
                resize: "none",
                width: "100%",
                boxSizing: "border-box",
                padding: 8,
                border: `1px solid ${palette.panelBorder}`,
                borderRadius: 8,
                background: "transparent",
                color: palette.panelText,
                fontFamily: noteHand.style.fontFamily,
                fontSize: 18,
                lineHeight: 1.35,
              }}
            />
          )}
        </section>
      )}
    </div>
  );
}
