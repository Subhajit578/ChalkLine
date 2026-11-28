"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Avatar } from "./Avatar";
import { getPeople } from "@/draw/http";
import { rankPeople, type Person } from "@/draw/people";
import { clearOfToolbar } from "@/draw/placement";
import type { RoomConnection } from "@/draw/connection";
import type { Palette } from "@/draw/theme";

/** faces in the stack before the rest fold into "+N" */
const STACK = 4;
const ONLINE = "#22c55e";
/** gap from the window's corner, the same as the toolbar's */
const MARGIN = 10;

/**
 * The top contributors as a stack of faces in the corner; clicking it lists
 * everyone who drew on the board. A green dot marks who is in the room now.
 *
 * Counts come from the server and are reloaded when the list opens, so the
 * stack's order can lag behind what is being drawn until then.
 */
export function BoardPeople({
  roomId,
  connection,
  palette,
  avoid,
}: {
  roomId: string;
  connection: RoomConnection;
  palette: Palette;
  /** the toolbar, which can be docked over this corner */
  avoid: DOMRect | null;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [online, setOnline] = useState<ReadonlySet<string>>(() => new Set());
  const [open, setOpen] = useState(false);
  const [reloads, setReloads] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<CSSProperties>({});
  // ids already reloaded for, so someone the server never lists cannot cause a loop
  const askedFor = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    getPeople(roomId)
      .then((list) => !cancelled && setPeople(list))
      .catch((err) => console.warn("[people] could not load who is on this board", err));
    return () => {
      cancelled = true;
    };
  }, [roomId, reloads]);

  useEffect(() => {
    connection.onPresence((ids) => setOnline(new Set(ids)));
    return () => connection.onPresence(null);
  }, [connection]);

  // someone online we have no name for joined after the list loaded
  useEffect(() => {
    const known = new Set(people.map((p) => p.id));
    const unknown = [...online].filter((id) => !known.has(id) && !askedFor.current.has(id));
    if (unknown.length === 0) return;
    unknown.forEach((id) => askedFor.current.add(id));
    setReloads((n) => n + 1);
  }, [people, online]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const ranked = useMemo(() => rankPeople(people, online), [people, online]);

  // in the top-right corner, unless the toolbar covers it
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || !avoid) return;
    const panel = { width: el.offsetWidth, height: el.offsetHeight };
    const view = { width: window.innerWidth, height: window.innerHeight };
    setPlaced(clearOfToolbar(avoid, panel, "top", view, MARGIN));
  }, [avoid, ranked.length]);
  if (ranked.length === 0) return null;

  const shown = ranked.slice(0, STACK);
  const more = ranked.length - shown.length;
  const onlineCount = ranked.filter((p) => online.has(p.id)).length;
  const surface: CSSProperties = {
    background: palette.panel,
    border: `1px solid ${palette.panelBorder}`,
    color: palette.panelText,
    backdropFilter: "blur(8px)",
  };

  return (
    <div ref={rootRef} style={{ position: "fixed", top: MARGIN, right: MARGIN, zIndex: 30, ...placed }}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`People on this board: ${ranked.length}, ${onlineCount} online`}
        title="People on this board"
        onClick={() => {
          if (!open) setReloads((n) => n + 1);
          setOpen(!open);
        }}
        style={{
          ...surface,
          display: "flex",
          alignItems: "center",
          padding: 6,
          borderRadius: 999,
          cursor: "pointer",
        }}
      >
        {shown.map((p, i) => (
          <Face
            key={p.id}
            person={p}
            online={online.has(p.id)}
            size={30}
            palette={palette}
            style={{ marginLeft: i === 0 ? 0 : -8, zIndex: STACK - i }}
          />
        ))}
        {more > 0 && (
          <span style={{ padding: "0 6px 0 8px", fontSize: 12, fontWeight: 600, color: palette.panelMuted }}>
            +{more}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="People on this board"
          style={{
            ...surface,
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: "min(280px, calc(100vw - 20px))",
            maxHeight: "min(420px, 70vh)",
            overflowY: "auto",
            padding: 6,
            borderRadius: 12,
          }}
        >
          <div style={{ padding: "6px 8px 8px", fontSize: 12, color: palette.panelMuted }}>
            {ranked.length} {ranked.length === 1 ? "person" : "people"} · {onlineCount} online
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {ranked.map((p) => (
              <li key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px" }}>
                <Face person={p} online={online.has(p.id)} size={32} palette={palette} />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 14,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.username}
                  {online.has(p.id) && <span style={visuallyHidden}> (online)</span>}
                </span>
                <span style={{ flex: "none", fontSize: 12, color: palette.panelMuted }}>
                  {p.shapes} {p.shapes === 1 ? "shape" : "shapes"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Face({
  person,
  online,
  size,
  palette,
  style,
}: {
  person: Person;
  online: boolean;
  size: number;
  palette: Palette;
  style?: CSSProperties;
}) {
  return (
    <span
      title={online ? `${person.username} (online)` : person.username}
      style={{
        position: "relative",
        display: "inline-flex",
        flex: "none",
        borderRadius: 999,
        // opaque, so overlapping faces in the stack do not show through each other
        background: `color-mix(in oklab, ${palette.accent} 22%, ${palette.canvas})`,
        boxShadow: `0 0 0 2px ${palette.canvas}`,
        ...style,
      }}
    >
      <Avatar id={person.avatar} username={person.username} size={size} />
      {online && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: Math.round(size * 0.3),
            height: Math.round(size * 0.3),
            borderRadius: 999,
            background: ONLINE,
            boxShadow: `0 0 0 2px ${palette.canvas}`,
          }}
        />
      )}
    </span>
  );
}

const visuallyHidden: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};
