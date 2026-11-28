type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };

/**
 * Where a panel pinned in the top- or bottom-right corner moves when the
 * toolbar covers it (a narrow window, or docked there): just past a
 * horizontal bar, or beside a vertical one. Nothing when the corner is clear.
 */
export function clearOfToolbar(
  bar: Box,
  panel: { width: number; height: number },
  corner: "top" | "bottom",
  view: { width: number; height: number },
  margin: number
): { top?: number; bottom?: number; right?: number } {
  const top = corner === "top" ? margin : view.height - margin - panel.height;
  const covered =
    bar.right > view.width - margin - panel.width &&
    bar.left < view.width - margin &&
    bar.top < top + panel.height &&
    bar.bottom > top;
  if (!covered) return {};
  if (bar.width < bar.height) return { right: view.width - bar.left + 8 };
  return corner === "top" ? { top: bar.bottom + 8 } : { bottom: view.height - bar.top + 8 };
}
