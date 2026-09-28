import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { inTauri } from "@/lib/backend";
import { startRuntime } from "@/services/runtime";
import { syncSettingsAcrossWindows, useSettings } from "@/stores/settingsStore";
import { DashboardApp } from "@/components/Dashboard/DashboardApp";
import { PetWindow } from "@/components/Pet/PetWindow";
import "./styles.css";

/** One bundle, two windows: the label decides what to render. */
const label = inTauri ? getCurrentWindow().label : new URLSearchParams(location.search).get("window") ?? "pet";
const isPet = label === "pet";
document.body.classList.add(isPet ? "is-pet" : "is-dashboard");

function PetApp() {
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void startRuntime().then((s) => (cancelled ? s() : (stop = s)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  return <PetWindow />;
}

async function boot() {
  await useSettings.getState().load();
  void syncSettingsAcrossWindows();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>{isPet ? <PetApp /> : <DashboardApp />}</StrictMode>,
  );
}

void boot();
