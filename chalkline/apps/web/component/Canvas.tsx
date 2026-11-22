"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { IconButton } from "./IconButton";
import {
  Circle,
  Monitor,
  Moon,
  Pencil,
  RectangleHorizontalIcon,
  Sun,
  Trash2,
  Minus,
  MoveUpRight,
  Type,
  Eraser,
  MousePointer2,
  Image as ImageIcon,
  Plus,
  Maximize,
  Hand,
  Compass,
  Grid2x2,
  FileDown,
  GripVertical,
  GripHorizontal,
} from "lucide-react";
import { Game, TextRequest } from "@/draw/Game";
import { nearestEdge, type Edge } from "@/draw/routing";
import TextOverlay from "./TextOverlay";
import { makeNotice, ToastStack, type Notice } from "./Toast";
import { ConfirmDialog } from "./ConfirmDialog";
import { saveBoardAsPdf } from "@/lib/pdf";
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from "@/draw/renderer";
import type { ConnectionStatus, RoomConnection } from "@/draw/connection";
import { useTheme } from "./ThemeProvider";
import { IDENTITY_CAMERA, type Camera } from "@/draw/camera";
import {
  COLOR_NAMES,
  DEFAULT_COLOR,
  THEMES,
  resolveColor,
  type ColorName,
  type ThemeChoice,
} from "@/draw/theme";
export type Tool = "circle" | "rect" | "pencil" | "line" | "arrow" | "text" | "eraser" | "select" | "hand";

export function Canvas({
  roomId,
  slug,
  connection,
  connectionStatus,
  connectionMessage,
}: {
  roomId: string;
  /** the canvas's name, used for the exported filename */
  slug: string;
  /** socket to this board; RoomCanvas owns and closes it */
  connection: RoomConnection;
  connectionStatus: ConnectionStatus;
  connectionMessage?: string;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  /**
   * Physical pixels per CSS pixel.
   *
   * 1 until the effect below runs, because window does not exist while this
   * renders on the server. Starting at the real value would mean guessing.
   */
  const [dpr, setDpr] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<Game>();
  const [selectedTool, setSelectedTool] = useState<Tool>("circle");
  // a palette name; the theme decides what it looks like
  const [selectedColor, setSelectedColor] = useState<ColorName>(DEFAULT_COLOR);
  // where the text editor is open, or null when there isn't one
  const [editing, setEditing] = useState<TextRequest | null>(null);
  // messages shown over the board: server refusals, load failures, confirmations
  const [notices, setNotices] = useState<Notice[]>([]);
  const [confirmingClear, setConfirmingClear] = useState(false);
  // an export is seconds of work, not a toggle: the button is disabled
  // while one runs so a double press cannot start two
  const [exporting, setExporting] = useState(false);
  // mirrored from Game so the zoom readout and the text editor can react to
  // it; Game remains the owner, this is a copy for rendering
  const [camera, setCamera] = useState<Camera>(IDENTITY_CAMERA);
  // whether any shape is on screen; drives the offer to scroll back
  const [contentVisible, setContentVisible] = useState(true);
  const [gridOn, setGridOn] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showNotice = useCallback(
    (message: string, tone: "error" | "info" | "success" = "error") => {
      setNotices((current) => [...current, makeNotice(message, tone)]);
    },
    []
  );

  const dismissNotice = useCallback((id: string) => {
    setNotices((current) => current.filter((n) => n.id !== id));
  }, []);
  const { theme, choice, cycle } = useTheme();
  const palette = THEMES[theme];

  // Connection status as a notice that stays while it's true. Drawing
  // continues offline (changes are queued), but the user must know not to
  // close the tab.
  const connectionNotice = useRef<string | null>(null);
  useEffect(() => {
    const raise = (message: string) => {
      const notice = makeNotice(message, "error", true);
      connectionNotice.current = notice.id;
      setNotices((current) => [...current, notice]);
    };
    const lower = () => {
      if (!connectionNotice.current) return false;
      dismissNotice(connectionNotice.current);
      connectionNotice.current = null;
      return true;
    };

    if (connectionStatus === "reconnecting") {
      if (!connectionNotice.current) {
        raise("Connection lost - reconnecting. Keep this tab open: your changes are saved once you are back online.");
      }
    } else if (connectionStatus === "closed") {
      lower();
      raise(connectionMessage ?? "Disconnected from this board. Reload to try again.");
    } else if (connectionStatus === "online" && lower()) {
      showNotice("Back online", "success");
    }
  }, [connectionStatus, connectionMessage, dismissNotice, showNotice]);

  useEffect(() => {
    game?.setTool(selectedTool);
  }, [selectedTool, game]);

  useEffect(() => {
    game?.setColor(selectedColor);
  }, [selectedColor, game]);

  useEffect(() => {
    game?.setTheme(theme);
  }, [theme, game]);

  useEffect(() => {
    game?.setOnTextRequest((at) => setEditing(at));
  }, [game]);

  useEffect(() => {
    game?.setOnNotice(showNotice);
  }, [game, showNotice]);

  // Game asks for a tool change after adding an image, so the picture arrives
  // ready to move rather than leaving the drawing tool armed over it
  useEffect(() => {
    game?.setOnToolChange(setSelectedTool);
  }, [game]);

  useEffect(() => {
    game?.setOnCameraChange(setCamera);
  }, [game]);

  useEffect(() => {
    game?.setOnContentVisibilityChange(setContentVisible);
  }, [game]);

  useEffect(() => {
    game?.setOnGridChange(setGridOn);
  }, [game]);

  // Images arrive three ways - dropped, pasted, or picked from the toolbar -
  // and all three end at Game.addImage. Paste is the one people actually use:
  // it is how a screenshot gets onto a board.
  useEffect(() => {
    if (!game) return;

    // addImage places the picture at a point on the board, so a drop position
    // has to cross from screen to world first - otherwise a drop lands
    // somewhere else entirely once the board has been scrolled
    const centre = () => game.viewportCentreWorld();

    // Whether this drag is carrying a file at all. During dragover the files
    // themselves are not readable yet - only the item list is - so the kind
    // is all there is to go on, and it is enough.
    const carriesFile = (e: DragEvent) =>
      Array.from(e.dataTransfer?.items ?? []).some((item) => item.kind === "file") ||
      (e.dataTransfer?.types ?? []).includes("Files");

    const onDrop = (e: DragEvent) => {
      // Prevent the default for everything that lands on the board, not just
      // for the drops that turn into images. The board has already told the
      // browser it accepts drops, so bailing out without this leaves the
      // browser to handle the drop itself - which means navigating away from
      // the board to display whatever was dropped, losing the canvas.
      e.preventDefault();

      const file = e.dataTransfer?.files?.[0];
      if (!file) {
        // A drag with no file: an image dragged out of another tab or app,
        // which travels as a URL rather than bytes. Saying so beats a drop
        // that visibly does nothing.
        const url = e.dataTransfer?.getData("text/uri-list");
        showNotice(
          url
            ? "That came across as a link, not a file. Save the image first, then drop the file - or copy the image and paste it here."
            : "Nothing to add - that drag did not carry a file.",
          "info"
        );
        return;
      }

      const rect = (e.target as HTMLElement)?.getBoundingClientRect?.();
      game.addImage(
        file,
        game.screenToWorld({
          x: e.clientX - (rect?.left ?? 0),
          y: e.clientY - (rect?.top ?? 0),
        })
      );
    };

    // Without this the browser never fires `drop` at all - it navigates away
    // to display the dragged file instead. Setting dropEffect alongside it is
    // what stops the cursor promising a "copy" the board will then refuse:
    // the badge now appears only for drags that really are files.
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = carriesFile(e) ? "copy" : "none";
    };

    const onPaste = (e: ClipboardEvent) => {
      // let a paste into the text editor stay a paste into the text editor
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      const file = Array.from(e.clipboardData?.files ?? [])[0];
      if (!file) {
        // Copying an image in another browser tab often puts only its HTML on
        // the clipboard, not the bytes - "Copy image" works, "Copy" on the
        // surrounding page does not.
        const looksLikeAnImage = Array.from(e.clipboardData?.items ?? []).some((item) =>
          item.type.startsWith("image/")
        );
        if (looksLikeAnImage) {
          showNotice(
            "That clipboard entry points at an image but does not contain it. Use \"Copy image\" at the source, or save it and drop the file here.",
            "info"
          );
        }
        return;
      }
      e.preventDefault();
      game.addImage(file, centre());
    };

    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("paste", onPaste);
    };
  }, [game, showNotice]);

  useEffect(() => {
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // devicePixelRatio is not constant: it changes when the window is dragged
  // to a display of a different density, and when the browser is zoomed.
  // There is no event for it, but a media query pinned to the current value
  // stops matching the moment it changes - so the query is rebuilt each time,
  // which is what the dependency is for.
  useEffect(() => {
    const update = () => setDpr(window.devicePixelRatio || 1);
    update();
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [dpr]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const g = new Game(canvasRef.current, roomId, connection, theme);
    setGame(g);
    return () => g.destroy();
    // theme is read once here for the first paint; later changes go through setTheme
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, connection]);

  // Setting a canvas's width or height wipes its contents, so every resize needs
  // a repaint. Without this the board stays blank until the next draw.
  useEffect(() => {
    if (!game || size.w === 0) return;
    game.repaint();
  }, [game, size.w, size.h, dpr]);

  function handlePickImage(file: File) {
    if (!game) return;
    game.addImage(file, game.viewportCentreWorld());
  }

  function handleClear() {
    if (!game) return;
    setConfirmingClear(true);
  }

  /**
   * Save the board - or the selection, when there is one - as a PDF.
   *
   * Scope follows the selection rather than asking. Someone with shapes
   * selected who presses export almost always means those shapes, and a
   * menu offering a choice they have already made is a click in the way.
   * Deselecting is the way to say "all of it".
   *
   * Guarded by `exporting` because this is not instant: a large board
   * spends a second or two allocating and encoding a bitmap of tens of
   * megapixels, and a second press would start a second one alongside it.
   */
  async function handleExportPdf() {
    if (!game || exporting) return;
    setExporting(true);
    try {
      const scope = game.hasSelection() ? "selection" : "board";
      // renderExport explains itself to the person when it returns null
      const render = await game.renderExport(scope);
      if (render) {
        const suffix = scope === "selection" ? "-selection" : "";
        await saveBoardAsPdf(render, `${slug}${suffix}`);
      }
    } catch (err) {
      console.error("[export] could not export the board", err);
      showNotice("Could not export that board");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div
      style={{
        height: "100vh",
        overflow: "hidden",
        background: palette.canvas,
      }}
    >
      {/* Two sizes, deliberately different. The width/height attributes are
          the backing store in physical pixels; the CSS size is what it
          occupies on the page. Setting only the first would make the canvas
          enormous, only the second would leave it soft on a Retina display -
          the ratio between them is what buys the sharpness. */}
      <canvas
        ref={canvasRef}
        width={Math.round(size.w * dpr)}
        height={Math.round(size.h * dpr)}
        style={{ width: size.w, height: size.h, display: "block" }}
      />

      {/* key: each editor is a fresh instance. Reusing one would keep the
          previous text (the textarea is uncontrolled, so defaultValue only
          applies on mount) and the `finished` latch, which would make the
          second editor silently refuse to commit. */}
      {editing && (
        <TextOverlay
          key={editing.shape?.id ?? `${editing.at.x}-${editing.at.y}`}
          // Recomputed from the world point on every camera change, so
          // panning or zooming mid-edit carries the editor with the board
          // rather than leaving it stranded over the wrong place.
          at={game ? game.worldToScreen(editing.at) : editing.at}
          // an existing text keeps its own styling: editing must not restyle it
          color={
            editing.shape
              ? resolveColor(editing.shape.color, theme)
              : palette.colors[selectedColor]
          }
          // the stored size is in world units; what is typed has to match
          // what will be painted, which is that size times the zoom
          fontSize={(editing.shape?.fontSize ?? DEFAULT_FONT_SIZE) * camera.zoom}
          fontFamily={editing.shape?.fontFamily ?? DEFAULT_FONT_FAMILY}
          initialValue={editing.shape?.text}
          onCommit={(value) => {
            if (editing.shape) {
              // editText handles the empty case by deleting the shape
              game?.editText(editing.shape.id, value);
            } else if (value.trim() !== "") {
              game?.addText(editing.at, value.trim(), DEFAULT_FONT_SIZE, DEFAULT_FONT_FAMILY);
            }
            setEditing(null);
          }}
          onCancel={() => {
            // bring back the shape that was hidden while its editor was open
            game?.endTextEdit();
            setEditing(null);
          }}
        />
      )}

      {confirmingClear && (
        <ConfirmDialog
          title="Clear this board?"
          message="Every shape is removed for everyone in the room. This cannot be undone."
          confirmLabel="Clear board"
          onConfirm={() => {
            setConfirmingClear(false);
            game?.clearRoom();
          }}
          onCancel={() => setConfirmingClear(false)}
        />
      )}

      {/* accept + capture together: desktop gets a file picker, mobile offers
          the camera as well, which is the "camera photos" route */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handlePickImage(file);
          // reset, or picking the same file twice in a row fires no change
          e.target.value = "";
        }}
      />

      {/* Whenever nothing is on screen, whatever tool is in hand: getting lost
          is not something only the hand tool can do - a wheel scroll or a
          zoom will do it just as well, and needing to switch tools to find
          your way back is a strange thing to ask. Still conditional on being
          lost, so it never covers a board someone can already see. */}
      {!contentVisible && (
        <button
          type="button"
          onClick={() => game?.scrollToNearestContent()}
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            borderRadius: 999,
            background: palette.panel,
            border: `1px solid ${palette.panelBorder}`,
            color: palette.panelText,
            backdropFilter: "blur(8px)",
            fontSize: 13,
            cursor: "pointer",
            zIndex: 20,
          }}
        >
          <Compass size={16} />
          Scroll back to content
        </button>
      )}

      <ToastStack notices={notices} onDismiss={dismissNotice} />

      <TopBar
        selectedTool={selectedTool}
        setSelectedTool={setSelectedTool}
        selectedColor={selectedColor}
        setSelectedColor={setSelectedColor}
        onClear={handleClear}
        onPickImage={() => fileInputRef.current?.click()}
        zoom={camera.zoom}
        onZoomIn={() => game?.zoomBy(1.2)}
        onZoomOut={() => game?.zoomBy(1 / 1.2)}
        onResetView={() => game?.resetView()}
        onZoomToFit={() => game?.zoomToFit()}
        onExportPdf={handleExportPdf}
        exporting={exporting}
        gridOn={gridOn}
        onToggleGrid={() => game?.toggleGrid()}
        themeChoice={choice}
        onCycleTheme={cycle}
        viewport={size}
      />
    </div>
  );
}

const THEME_LABEL: Record<ThemeChoice, string> = {
  system: "Theme: following your browser",
  light: "Theme: light",
  dark: "Theme: dark",
};

function TopBar({
  selectedTool,
  setSelectedTool,
  selectedColor,
  setSelectedColor,
  onClear,
  onPickImage,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetView,
  onZoomToFit,
  onExportPdf,
  exporting,
  gridOn,
  onToggleGrid,
  themeChoice,
  onCycleTheme,
  viewport,
}: {
  selectedTool: Tool;
  setSelectedTool: (s: Tool) => void;
  selectedColor: ColorName;
  setSelectedColor: (c: ColorName) => void;
  onClear: () => void;
  onPickImage: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onZoomToFit: () => void;
  onExportPdf: () => void;
  exporting: boolean;
  gridOn: boolean;
  onToggleGrid: () => void;
  themeChoice: ThemeChoice;
  onCycleTheme: () => void;
  viewport: { w: number; h: number };
}) {
  const { theme } = useTheme();

  // Docked to an edge, never free-floating: a row along the top or bottom, a
  // column down a side, `offset` px along that edge. Same buttons, same order.
  const [dock, setDock] = useState<{ edge: Edge; offset: number }>({ edge: "top", offset: DOCK_MARGIN });
  const [dragAt, setDragAt] = useState<{ x: number; y: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const grab = useRef({ dx: 0, dy: 0, x: 0, y: 0 });
  const vertical = dock.edge === "left" || dock.edge === "right";

  // Its length changes with orientation, so the offset can only be kept on
  // screen once it is laid out - after a re-dock or a window resize.
  useLayoutEffect(() => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r || dragAt) return;
    const length = vertical ? r.height : r.width;
    const span = vertical ? window.innerHeight : window.innerWidth;
    const offset = Math.max(DOCK_MARGIN, Math.min(dock.offset, span - length - DOCK_MARGIN));
    if (offset !== dock.offset) setDock({ edge: dock.edge, offset });
  }, [dock, dragAt, vertical, viewport.w, viewport.h]);

  function onGripDown(e: ReactPointerEvent<HTMLButtonElement>) {
    const r = barRef.current!.getBoundingClientRect();
    grab.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragAt({ x: r.left, y: r.top });
  }
  function onGripMove(e: ReactPointerEvent<HTMLButtonElement>) {
    if (dragAt) setDragAt({ x: e.clientX - grab.current.dx, y: e.clientY - grab.current.dy });
  }
  function onGripUp(e: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragAt) return;
    setDragAt(null);
    const g = grab.current;
    // a click, not a drag: near a corner the nearest edge would be a coin toss
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 4) return;
    const edge = nearestEdge(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
    setDock({ edge, offset: edge === "top" || edge === "bottom" ? dragAt.x : dragAt.y });
  }
  const palette = THEMES[theme];
  const iconProps = {
    color: palette.panelMuted,
    activeColor: palette.accent,
    activeBackground: palette.panelBorder,
  };

  return (
    <div
      ref={barRef}
      style={{
        position: "fixed",
        ...(dragAt
          ? { left: dragAt.x, top: dragAt.y }
          : dock.edge === "top"
            ? { top: DOCK_MARGIN, left: dock.offset }
            : dock.edge === "bottom"
              ? { bottom: DOCK_MARGIN, left: dock.offset }
              : dock.edge === "left"
                ? { left: DOCK_MARGIN, top: dock.offset }
                : { right: DOCK_MARGIN, top: dock.offset }),
        display: "flex",
        flexDirection: vertical ? "column" : "row",
        // every tool in a column is taller than a laptop screen: scroll, never clip
        maxHeight: vertical ? `calc(100vh - ${DOCK_MARGIN * 2}px)` : undefined,
        overflowY: vertical ? "auto" : undefined,
        // above the bottom-centre "scroll back" pill (20) when docked at the bottom
        zIndex: 30,
        gap: 12,
        background: palette.panel,
        border: `1px solid ${palette.panelBorder}`,
        color: palette.panelText,
        padding: 8,
        borderRadius: 12,
        backdropFilter: "blur(8px)",
        alignItems: "center",
      }}
    >
      <button
        type="button"
        aria-label="Move the toolbar: drag it to any edge, or press an arrow key"
        title="Drag to move the toolbar"
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={() => setDragAt(null)}
        onKeyDown={(e) => {
          const edge = ARROW_EDGE[e.key];
          if (edge) {
            e.preventDefault();
            setDock({ edge, offset: dock.offset });
          }
        }}
        style={{
          display: "flex",
          padding: 2,
          background: "transparent",
          border: "none",
          color: palette.panelMuted,
          cursor: dragAt ? "grabbing" : "grab",
          touchAction: "none",
        }}
      >
        {vertical ? <GripHorizontal size={16} /> : <GripVertical size={16} />}
      </button>

      {/* Tools */}
      <div style={{ display: "flex", flexDirection: vertical ? "column" : "row", gap: 4 }}>
        <IconButton
          onClick={() => setSelectedTool("pencil")}
          activated={selectedTool === "pencil"}
          icon={<Pencil size={20} />}
          title="Pencil"
          {...iconProps}
        />
        <IconButton
          onClick={() => setSelectedTool("rect")}
          activated={selectedTool === "rect"}
          icon={<RectangleHorizontalIcon size={20} />}
          title="Rectangle"
          {...iconProps}
        />
        <IconButton
          onClick={() => setSelectedTool("circle")}
          activated={selectedTool === "circle"}
          icon={<Circle size={20} />}
          title="Circle"
          {...iconProps}
        />
        <IconButton
          onClick={() => setSelectedTool("line")}
          activated={selectedTool === "line"}
          icon={<Minus size={20} />}
          title="Line"
          {...iconProps}
        />
        <IconButton
          onClick={() => setSelectedTool("arrow")}
          activated={selectedTool === "arrow"}
          icon={<MoveUpRight size={20} />}
          title="Arrow"
          {...iconProps}
        />
        <IconButton
          onClick={() => setSelectedTool("text")}
          activated={selectedTool === "text"}
          icon={<Type size={20} />}
          title="Text"
          {...iconProps}
        />
        <IconButton
          onClick={() => setSelectedTool("eraser")}
          activated={selectedTool === "eraser"}
          icon={<Eraser size={20} />}
          title="Eraser"
          {...iconProps}
        />
        <IconButton
          onClick={onPickImage}
          activated={false}
          icon={<ImageIcon size={20} />}
          title="Add an image - or just paste or drop one"
          {...iconProps}
        />
        <IconButton
          onClick={() => setSelectedTool("hand")}
          activated={selectedTool === "hand"}
          icon={<Hand size={20} />}
          title="Pan the board - or hold space with any tool"
          {...iconProps}
        />
        <IconButton
          onClick={() => setSelectedTool("select")}
          activated={selectedTool === "select"}
          icon={<MousePointer2 size={20} />}
          title="Select"
          {...iconProps}
        />
      </div>

      <Divider color={palette.panelBorder} vertical={vertical} />

      {/* Colours: names, drawn in this theme's version of each */}
      <div style={{ display: "flex", flexDirection: vertical ? "column" : "row", gap: 6 }}>
        {COLOR_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setSelectedColor(name)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              background: palette.colors[name],
              border:
                selectedColor === name
                  ? `2px solid ${palette.panelText}`
                  : `2px solid ${palette.panelBorder}`,
              cursor: "pointer",
              padding: 0,
            }}
            aria-label={name}
            aria-pressed={selectedColor === name}
            title={name}
          />
        ))}
      </div>

      <Divider color={palette.panelBorder} vertical={vertical} />

      {/* On an infinite canvas being lost is a real state, and the only clue
          that you are is the zoom. The readout is the reset button, so the
          way out is where you were already looking. */}
      <div style={{ display: "flex", flexDirection: vertical ? "column" : "row", alignItems: "center", gap: 2 }}>
        <IconButton
          onClick={onZoomOut}
          activated={false}
          icon={<Minus size={16} />}
          title="Zoom out"
          {...iconProps}
        />
        <button
          type="button"
          onClick={onResetView}
          title="Reset the view"
          style={{
            minWidth: 52,
            padding: "4px 6px",
            background: "transparent",
            border: "none",
            borderRadius: 8,
            color: palette.panelText,
            fontSize: 12,
            fontVariantNumeric: "tabular-nums",
            cursor: "pointer",
          }}
        >
          {Math.round(zoom * 100)}%
        </button>
        <IconButton
          onClick={onZoomIn}
          activated={false}
          icon={<Plus size={16} />}
          title="Zoom in"
          {...iconProps}
        />
        <IconButton
          onClick={onZoomToFit}
          activated={false}
          icon={<Maximize size={16} />}
          title="Fit everything on screen"
          {...iconProps}
        />
      </div>

      <Divider color={palette.panelBorder} vertical={vertical} />

      <IconButton
        onClick={onToggleGrid}
        activated={gridOn}
        icon={<Grid2x2 size={20} />}
        title={gridOn ? "Hide the grid" : "Show the grid"}
        {...iconProps}
      />

      <IconButton
        onClick={onExportPdf}
        activated={exporting}
        icon={<FileDown size={20} />}
        title={exporting ? "Exporting…" : "Export as PDF"}
        disabled={exporting}
        {...iconProps}
      />

      <IconButton
        onClick={onCycleTheme}
        activated={themeChoice !== "system"}
        icon={
          themeChoice === "system" ? (
            <Monitor size={20} />
          ) : themeChoice === "light" ? (
            <Sun size={20} />
          ) : (
            <Moon size={20} />
          )
        }
        title={THEME_LABEL[themeChoice]}
        color={palette.panelMuted}
        activeColor={palette.panelText}
        activeBackground={palette.panelBorder}
      />

      <IconButton
        onClick={onClear}
        activated={false}
        icon={<Trash2 size={20} />}
        title="Clear the board"
        {...iconProps}
      />
    </div>
  );
}

const DOCK_MARGIN = 10;
const ARROW_EDGE: Record<string, Edge> = { ArrowUp: "top", ArrowDown: "bottom", ArrowLeft: "left", ArrowRight: "right" };

/** Runs across the bar: an upright rule in a row, a flat one in a column. */
function Divider({ color, vertical }: { color: string; vertical: boolean }) {
  return <div style={vertical ? { width: 24, height: 1, background: color } : { width: 1, height: 24, background: color }} />;
}
