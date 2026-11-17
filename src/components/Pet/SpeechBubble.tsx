import { useEffect, useRef, useState } from "react";
import { useT, type Dict } from "@/i18n";
import { pickIndex, workPhase, type WorkPhase, type WorkSchedule } from "@/pet/workday";

/** How often the bubble swaps the countdown for a cheer, and for how long. */
const CHEER_EVERY_MS = 10 * 60_000;
const CHEER_SHOW_MS = 15_000;
/** "Almost lunch / almost home" kicks in this many minutes before. */
const SOON_MIN = 10;

function countdownText(phase: WorkPhase, t: Dict): string | null {
  const dur = (min: number) => t.format.duration(Math.floor(min / 60), min % 60);
  switch (phase.kind) {
    case "off":
      return null;
    case "beforeWork":
      return t.bubble.beforeWork(dur(phase.minutesLeft));
    case "morning":
      return phase.minutesLeft <= SOON_MIN ? `${t.bubble.soonLunch} · ${dur(phase.minutesLeft)}` : t.bubble.morning(dur(phase.minutesLeft));
    case "lunch":
      return t.bubble.lunch(dur(phase.minutesLeft));
    case "afternoon":
      return phase.minutesLeft <= SOON_MIN ? `${t.bubble.soonLeave} · ${dur(phase.minutesLeft)}` : t.bubble.afternoon(dur(phase.minutesLeft));
    case "done":
      return t.bubble.done;
  }
}

/**
 * Speech bubble above the pet: work-day countdown, now and then replaced by a random
 * cheer. Purely visual: it sits outside the pet's hit area, so clicks pass through.
 */
export function SpeechBubble({ schedule, scale, bottom }: { schedule: WorkSchedule; scale: number; bottom: number }) {
  const t = useT();
  const [now, setNow] = useState(() => new Date());
  const [cheer, setCheer] = useState<number | null>(null);
  const lastCheer = useRef<number | null>(null);

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(tick);
  }, []);

  const phase = workPhase(schedule, now);
  const working = phase.kind !== "off" && phase.kind !== "done";
  const cheerCount = t.bubble.cheers.length;

  useEffect(() => {
    if (!schedule.cheers || !working) return;
    let hide: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      const i = pickIndex(cheerCount, lastCheer.current);
      lastCheer.current = i;
      setCheer(i);
      clearTimeout(hide);
      hide = setTimeout(() => setCheer(null), CHEER_SHOW_MS);
    };
    const first = setTimeout(show, 4_000); // a hello shortly after the pet appears
    const every = setInterval(show, CHEER_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearTimeout(hide);
      clearInterval(every);
      setCheer(null);
    };
  }, [schedule.cheers, working, cheerCount]);

  const text = cheer !== null && working ? t.bubble.cheers[cheer % cheerCount] : countdownText(phase, t);
  if (!text) return null;

  return (
    // The wrapper centers the bubble, so the bubble's own pop-in transform stays free.
    <div className="pointer-events-none absolute inset-x-0 flex justify-center" style={{ bottom }}>
      <div
        // Pop in when the message kind changes, not on every minute tick.
        key={cheer !== null && working ? `cheer-${cheer}` : phase.kind}
        className="speech-bubble relative text-center"
        style={{ fontSize: 11 * Math.max(scale, 0.85), maxWidth: "96%" }}
        aria-live="polite"
      >
        {text}
      </div>
    </div>
  );
}
