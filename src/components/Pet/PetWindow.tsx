import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { backend, inTauri, on } from "@/lib/backend";
import { resolvePetState } from "@/pet/PetStateMachine";
import { useWorkMoments } from "@/pet/useWorkMoments";
import { useDocumentLang, useT } from "@/i18n";
import { getSkin } from "@/pet/skins";
import { collapse, expand, setBaseSize, type Expansion } from "@/platform/petWindow";
import { selectStatus, useAI } from "@/stores/aiStore";
import { usePet } from "@/stores/petStore";
import { useSettings } from "@/stores/settingsStore";
import { UsagePanel } from "../UsagePanel/UsagePanel";
import { SpeechBubble } from "./SpeechBubble";

const BASE = 220;
const PET = 150;
const DRAG_THRESHOLD = 4;

export function PetWindow() {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const status = useAI(selectStatus);
  const setPopoverOpen = usePet((s) => s.setPopoverOpen);
  const [exp, setExp] = useState<Expansion | null>(null);
  const hitRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const t = useT();
  useDocumentLang();

  const { scale, opacity, animations, clickThrough, alwaysOnTop, visible } = settings.pet;
  const base = useMemo(() => ({ width: Math.round(BASE * scale), height: Math.round(BASE * scale) }), [scale]);
  const pop = useMemo(() => ({ width: 264, height: 262 }), []);

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
    void backend.petSetInteraction(clickThrough, exp !== null, { x: r.left, y: r.top, width: r.width, height: r.height });
  }, [clickThrough, exp]);
  useEffect(() => {
    reportHit();
    const el = hitRef.current;
    if (!el) return;
    const ro = new ResizeObserver(reportHit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [reportHit]);

  // ----- popover -----
  const close = useCallback(async () => {
    setExp(null);
    setPopoverOpen(false);
    await collapse();
  }, [setPopoverOpen]);

  const open = useCallback(async () => {
    const e = await expand(base, pop);
    setExp(e);
    setPopoverOpen(true);
    if (inTauri) await getCurrentWindow().setFocus();
  }, [base, pop, setPopoverOpen]);

  useEffect(() => {
    if (!inTauri) return;
    const p = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused && exp) void close();
    });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && exp && void close();
    window.addEventListener("keydown", onKey);
    return () => {
      void p.then((u) => u());
      window.removeEventListener("keydown", onKey);
    };
  }, [exp, close]);

  // ----- click vs drag -----
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const p = press.current;
      if (!p || p.dragging) return;
      if (Math.hypot(e.screenX - p.x, e.screenY - p.y) > DRAG_THRESHOLD) {
        p.dragging = true;
        if (exp) void close();
        if (inTauri) void getCurrentWindow().startDragging();
      }
    };
    const up = () => {
      const p = press.current;
      press.current = null;
      if (p && !p.dragging) void (exp ? close() : open());
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [exp, open, close]);

  const openDashboard = () => {
    void close();
    void backend.openDashboard("dashboard");
  };

  const info = t.petStates[resolution.state];
  const stageLeft = exp?.petLeft ?? 0;
  const stageTop = exp?.petTop ?? 0;
  const popLeft = exp ? Math.min(Math.max(stageLeft + base.width / 2 - pop.width / 2, 0), exp.width - pop.width) : 0;

  return (
    <div className="relative h-full w-full">
      {exp && (
        <div
          className="popover popover-enter absolute overflow-y-auto"
          style={{
            left: popLeft,
            width: pop.width,
            maxHeight: pop.height - 8,
            ...(exp.placement === "above" ? { bottom: base.height - 6 } : { top: base.height - 6 }),
          }}
        >
          <UsagePanel onOpenDashboard={openDashboard} />
        </div>
      )}

      <div
        className="absolute flex flex-col items-center justify-end"
        style={{ left: stageLeft, top: stageTop, width: base.width, height: base.height, paddingBottom: 6 * scale }}
      >
        {!exp && (
          <SpeechBubble
            schedule={settings.schedule}
            scale={scale}
            // Just above the cat's ears (the art fills the lower ~80% of the skin box).
            bottom={6 * scale + PET * scale * 0.86}
          />
        )}
        <div
          ref={hitRef}
          className="flex cursor-grab flex-col items-center active:cursor-grabbing"
          style={{ opacity }}
          title={`${info.label} — ${info.mood}`}
          onMouseDown={(e) => {
            if (e.button === 0) press.current = { x: e.screenX, y: e.screenY, dragging: false };
          }}
          onDoubleClick={openDashboard}
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
