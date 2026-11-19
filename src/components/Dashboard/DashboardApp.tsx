import { useEffect, useState } from "react";
import { backend, broadcast, on, type AppInfo } from "@/lib/backend";
import type { AIStatus } from "@/providers/core/types";
import type { MockScenario } from "@/services/mockScenarios";
import { EVT_MOCK, EVT_REQUEST_STATUS, EVT_STATUS } from "@/services/runtime";
import { useDocumentLang, useT } from "@/i18n";
import { useAI } from "@/stores/aiStore";
import { ConnectPage } from "../Connect/ConnectPage";
import { DevPanel } from "../DevMode/DevPanel";
import { Settings } from "../Settings/Settings";
import { Dashboard } from "./Dashboard";

type Tab = "dashboard" | "connect" | "settings" | "dev";

const TABS: { id: Tab }[] = [{ id: "dashboard" }, { id: "connect" }, { id: "settings" }, { id: "dev" }];

const initialTab = (): Tab => {
  const h = window.location.hash.replace("#", "");
  return (TABS.some((t) => t.id === h) ? h : "dashboard") as Tab;
};

export function DashboardApp() {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const t = useT();
  useDocumentLang();

  useEffect(() => {
    void backend.appInfo().then(setInfo);
    const subs = [
      on<string>("dashboard://navigate", (id) => TABS.some((x) => x.id === id) && setTab(id as Tab)),
      on<AIStatus>(EVT_STATUS, (s) => useAI.getState().setLive(s)),
      on<MockScenario | null>(EVT_MOCK, (m) => useAI.getState().setMock(m)),
    ];
    void Promise.all(subs).then(() => broadcast(EVT_REQUEST_STATUS, null));
    return () => subs.forEach((p) => void p.then((u) => u()));
  }, []);

  const tabs = TABS.filter((x) => x.id !== "dev" || info?.devMode);

  return (
    <div className="flex h-full flex-col">
      <nav className="flex items-center gap-1 border-b px-5 pt-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="mr-4 flex items-center gap-2 pb-2.5 font-bold">
          <span aria-hidden>🌱</span> AI Coding Pet
        </div>
        {tabs.map((x) => (
          <button
            key={x.id}
            onClick={() => setTab(x.id)}
            className="-mb-px border-b-2 px-3 pb-2.5 text-[13px] font-semibold transition-colors"
            style={{
              borderColor: tab === x.id ? "var(--accent)" : "transparent",
              color: tab === x.id ? "var(--text)" : "var(--text-muted)",
            }}
          >
            {t.tabs[x.id]}
          </button>
        ))}
        <div className="ml-auto pb-2.5 text-[11px] text-[color:var(--text-muted)]">
          {info && `v${info.version}${info.devMode ? " · dev" : ""}`}
        </div>
      </nav>
      <main className="flex-1 overflow-y-auto p-5">
        {tab === "dashboard" && <Dashboard />}
        {tab === "connect" && <ConnectPage />}
        {tab === "settings" && <Settings />}
        {tab === "dev" && info?.devMode && <DevPanel />}
      </main>
    </div>
  );
}
