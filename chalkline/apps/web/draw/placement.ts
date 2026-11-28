type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };

/**
 * Where a panel pinned in the top-right corner moves when the toolbar covers
 * it (a narrow window, or docked there): just below a horizontal bar, or
 * beside a vertical one. Nothing when the corner is clear.
 */
export function clearOfToolbar(
  bar: Box,
  panel: { width: number; height: number },
  viewWidth: number,
  margin: number
): { top?: number; right?: number } {
  const covered =
    bar.right > viewWidth - margin - panel.width &&
    bar.left < viewWidth - margin &&
    bar.top < margin + panel.height &&
    bar.bottom > margin;
  if (!covered) return {};
  return bar.width < bar.height ? { right: viewWidth - bar.left + 8 } : { top: bar.bottom + 8 };
}
