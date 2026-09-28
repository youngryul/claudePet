/**
 * Pet window geometry. The pet window stays small (click-through elsewhere); when the
 * popover opens we grow the window around the pet so the pet itself never moves on
 * screen, flipping the popover below the pet when there is no room above.
 * Works in physical pixels to stay correct on mixed-DPI multi-monitor setups.
 */
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize, LogicalSize } from "@tauri-apps/api/dpi";
import { inTauri } from "@/lib/backend";

export interface Expansion {
  placement: "above" | "below";
  /** Pet stage offset inside the expanded window, logical px. */
  petLeft: number;
  petTop: number;
  width: number;
  height: number;
}

let saved: { pos: PhysicalPosition; size: PhysicalSize } | null = null;

export async function setBaseSize(width: number, height: number) {
  if (!inTauri || saved) return;
  await getCurrentWindow().setSize(new LogicalSize(width, height));
}

export async function expand(base: { width: number; height: number }, pop: { width: number; height: number }): Promise<Expansion> {
  const fallback: Expansion = {
    placement: "above",
    petLeft: Math.max(0, (pop.width - base.width) / 2),
    petTop: pop.height,
    width: Math.max(base.width, pop.width),
    height: base.height + pop.height,
  };
  if (!inTauri) return fallback;

  const win = getCurrentWindow();
  const [scale, pos, size, monitor] = await Promise.all([
    win.scaleFactor(),
    win.outerPosition(),
    win.outerSize(),
    currentMonitor(),
  ]);
  saved = { pos, size };

  const newW = Math.round(Math.max(base.width, pop.width) * scale);
  const newH = Math.round((base.height + pop.height) * scale);
  const popH = newH - size.height;
  let x = pos.x - Math.round((newW - size.width) / 2);
  let y = pos.y - popH;
  let placement: Expansion["placement"] = "above";

  const area = monitor ? (monitor.workArea ?? { position: monitor.position, size: monitor.size }) : null;
  if (area) {
    if (y < area.position.y) {
      placement = "below";
      y = pos.y;
    }
    x = Math.min(Math.max(x, area.position.x), area.position.x + area.size.width - newW);
  }

  await win.setPosition(new PhysicalPosition(x, y));
  await win.setSize(new PhysicalSize(newW, newH));
  return {
    placement,
    petLeft: (pos.x - x) / scale,
    petTop: placement === "above" ? popH / scale : 0,
    width: newW / scale,
    height: newH / scale,
  };
}

export async function collapse() {
  if (!inTauri || !saved) return;
  const win = getCurrentWindow();
  const { pos, size } = saved;
  saved = null;
  await win.setSize(size);
  await win.setPosition(pos);
}
