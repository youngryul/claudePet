import { useEffect, useState } from "react";
import { useSettings } from "@/stores/settingsStore";
import { isCheerTime, workPhase } from "./workday";

const CHECK_MS = 15_000;

/** Schedule-driven pet moments: the lunch break and the cheer-up minutes. */
export function useWorkMoments(): { lunch: boolean; cheer: boolean } {
  const schedule = useSettings((s) => s.settings.schedule);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), CHECK_MS);
    return () => clearInterval(t);
  }, []);
  return { lunch: workPhase(schedule, now).kind === "lunch", cheer: isCheerTime(schedule, now) };
}
