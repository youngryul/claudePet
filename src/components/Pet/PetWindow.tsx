import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { backend, inTauri, on } from "@/lib/backend";
import { resolvePetState } from "@/pet/PetStateMachine";
import { useDocumentLang, useT } from "@/i18n";
import { getSkin } from "@/pet/skins";
import { collapse, expand, setBaseSize, type Expansion } from "@/platform/petWindow";
import { selectStatus, useAI } from "@/stores/aiStore";
import { usePet } from "@/stores/petStore";
import { useSettings } from "@/stores/settingsStore";
import { listenChat, useChat, type ChatPhase } from "@/stores/chatStore";
import type { AIActivityState } from "@/providers/core/types";
import { ChatPanel } from "../Chat/ChatPanel";
import { UsagePanel } from "../UsagePanel/UsagePanel";
import { SpeechBubble } from "./SpeechBubble";

type PopoverMode = "status" | "chat";

/** While chatting, the pet reacts to the conversation instead of Claude Code. */
const CHAT_ACTIVITY: Record<Exclude<ChatPhase, "idle">, AIActivityState> = {
  thinking: "thinking",
  talking: "working",
  done: "completed",
  error: "error",
};

const BASE = 220;
const PET = 150;
const DRAG_THRESHOLD = 4;

export function PetWindow() {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const status = useAI(selectStatus);
  const setPopoverOpen = usePet((s) => s.setPopoverOpen);
  const chatPhase = useChat((s) => s.phase);
  const [exp, setExp] = useState<Expansion | null>(null);
  const [mode, setMode] = useState<PopoverMode>("status");
  const hitRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const t = useT();
  useDocumentLang();

  const { scale, opacity, animations, clickThrough, alwaysOnTop, visible } = settings.pet;
  const base = useMemo(() => ({ width: Math.round(BASE * scale), height: Math.round(BASE * scale) }), [scale]);
  const popFor = useCallback(
    (m: PopoverMode) => (m === "chat" ? { width: 300, height: 400 } : { width: 264, height: settings.display.showUsage ? 492 : 262 }),
    [settings.display.showUsage],
  );
  const pop = popFor(mode);

  const resolution = useMemo(
    () =>
      resolvePetState({
        activity: chatPhase === "idle" ? status.activity : CHAT_ACTIVITY[chatPhase],
        fiveHour: status.fiveHour.usedPercentage.value,
        weekly: status.weekly.usedPercentage.value,
        context: status.context.usedPercentage.value,
      }),
    [status, chatPhase],
  );
  const Skin = getSkin(settings.pet.skin).Renderer;

  // ----- window configuration -----
  useEffect(() => void setBaseSize(base.width, base.height), [base.width, base.height]);
  useEffect(() => {
    if (inTauri) void backend.petSetAlwaysOnTop(alwaysOnTop);
  }, [alwaysOnTop]);
  useEffect(() => void backend.petSetVisible(visible), [visible]);
  useEffect(() => {
    const p = listenChat();
    return () => void p.then((u) => u());
  }, []);
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

  const open = useCallback(
    async (m: PopoverMode = "status") => {
      const e = await expand(base, popFor(m));
      setMode(m);
      setExp(e);
      setPopoverOpen(true);
      if (inTauri) await getCurrentWindow().setFocus();
    },
    [base, popFor, setPopoverOpen],
  );

  /** Swap popover content; the window is re-grown because the two modes differ in size. */
  const switchMode = useCallback(
    async (m: PopoverMode) => {
      await collapse();
      await open(m);
    },
    [open],
  );

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
  const fiveHour = status.fiveHour.usedPercentage.value;

  return (
    <div className="relative h-full w-full">
      {exp && (
        <div
          className="popover popover-enter absolute overflow-y-auto"
          style={{
            left: popLeft,
            width: pop.width,
            maxHeight: pop.height - 8,
            ...(mode === "chat" && { height: pop.height - 8, overflow: "hidden" }),
            ...(exp.placement === "above" ? { bottom: base.height - 6 } : { top: base.height - 6 }),
          }}
        >
          {mode === "chat" ? (
            <ChatPanel onBack={() => void switchMode("status")} />
          ) : (
            <UsagePanel onOpenDashboard={openDashboard} onOpenChat={() => void switchMode("chat")} />
          )}
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
            bottom={6 * scale + PET * scale * 0.86 + (settings.display.showUsageBadge ? 18 * scale : 0)}
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
            modifiers={resolution.modifiers}
            animate={animations}
            size={Math.round(PET * scale)}
            detail={status.activity === "tool" ? status.activityDetail : null}
          />
          {settings.display.showUsageBadge && (
            <div className="chip tnum mt-0.5" style={{ fontSize: 10 * Math.max(scale, 0.9) }}>
              5h {fiveHour === null ? "—" : `${Math.round(fiveHour)}%`}
              {status.context.usedPercentage.value !== null && ` · ctx ${Math.round(status.context.usedPercentage.value)}%`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
