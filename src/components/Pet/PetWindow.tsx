import { useCallback, useEffect, useMemo, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { backend, inTauri, on } from "@/lib/backend";
import { resolvePetState } from "@/pet/PetStateMachine";
import { useWorkMoments } from "@/pet/useWorkMoments";
import { useDocumentLang, useT } from "@/i18n";
import { getSkin } from "@/pet/skins";
import { setBaseSize } from "@/platform/petWindow";
import { selectStatus, useAI } from "@/stores/aiStore";
import { useSettings } from "@/stores/settingsStore";
import { SpeechBubble } from "./SpeechBubble";

const BASE = 220;
const PET = 150;
const DRAG_THRESHOLD = 4;

const openDashboard = () => void backend.openDashboard("dashboard");

export function PetWindow() {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const status = useAI(selectStatus);
  const hitRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const t = useT();
  useDocumentLang();

  const { scale, opacity, animations, clickThrough, alwaysOnTop, visible } = settings.pet;
  const base = useMemo(() => ({ width: Math.round(BASE * scale), height: Math.round(BASE * scale) }), [scale]);

  const { lunch, cheer } = useWorkMoments();
  const resolution = useMemo(
    () =>
      resolvePetState({ activity: status.activity, lunch, cheer }),
    [status, lunch, cheer],
  );
  const Skin = getSkin(settings.pet.skin).Renderer;

  // ----- window configuration -----
  useEffect(() => void setBaseSize(base.width, base.height), [base.width, base.height]);
  useEffect(() => {
    if (inTauri) void backend.petSetAlwaysOnTop(alwaysOnTop);
  }, [alwaysOnTop]);
  useEffect(() => void backend.petSetVisible(visible), [visible]);
  useEffect(() => {
    // Tray "Show/Hide Pet" -> persist into settings.
    const p = on<boolean>("pet://visibility", (v) => {
      if (useSettings.getState().settings.pet.visible !== v) void update((s) => ({ ...s, pet: { ...s.pet, visible: v } }));
    });
    return () => void p.then((u) => u());
  }, [update]);

  // ----- click-through hit region -----
  const reportHit = useCallback(() => {
    const el = hitRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    void backend.petSetInteraction(clickThrough, false, { x: r.left, y: r.top, width: r.width, height: r.height });
  }, [clickThrough]);
  useEffect(() => {
    reportHit();
    const el = hitRef.current;
    if (!el) return;
    const ro = new ResizeObserver(reportHit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [reportHit]);

  // ----- click vs drag -----
  // A click opens the dashboard; the pet window itself never moves or resizes.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const p = press.current;
      if (!p || p.dragging) return;
      if (Math.hypot(e.screenX - p.x, e.screenY - p.y) > DRAG_THRESHOLD) {
        p.dragging = true;
        if (inTauri) void getCurrentWindow().startDragging();
      }
    };
    const up = () => {
      const p = press.current;
      press.current = null;
      if (p && !p.dragging) openDashboard();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const info = t.petStates[resolution.state];

  return (
    <div className="relative h-full w-full">
      <div
        className="absolute flex flex-col items-center justify-end"
        style={{ left: 0, top: 0, width: base.width, height: base.height, paddingBottom: 6 * scale }}
      >
        <SpeechBubble
          schedule={settings.schedule}
          scale={scale}
          // Just above the cat's ears (the art fills the lower ~80% of the skin box).
          bottom={6 * scale + PET * scale * 0.86}
        />
        <div
          ref={hitRef}
          className="flex cursor-grab flex-col items-center active:cursor-grabbing"
          style={{ opacity }}
          title={`${info.label} — ${info.mood}`}
          onMouseDown={(e) => {
            if (e.button === 0) press.current = { x: e.screenX, y: e.screenY, dragging: false };
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            openDashboard();
          }}
        >
          <Skin
            state={resolution.state}
            animate={animations}
            size={Math.round(PET * scale)}
            detail={status.activity === "tool" ? status.activityDetail : null}
          />
        </div>
      </div>
    </div>
  );
}
