import { useCallback, useEffect, useState } from "react";
import { backend, type CodexConnectionTest, type CodexDetection, type SettingsPreview } from "@/lib/backend";
import { useT } from "@/i18n";
import { useSettings } from "@/stores/settingsStore";
import { formatRelative } from "@/utils/format";
import { PreviewCard, Step } from "./ClaudeConnect";

/**
 * Codex needs no setup: the app follows Codex's session logs (CLI, desktop app and IDE
 * extensions alike), so the user only switches Codex on. Hooks are an optional extra
 * for slightly faster reactions, tucked under "Advanced".
 */
export function CodexConnect() {
  const [det, setDet] = useState<CodexDetection | null>(null);
  const [preview, setPreview] = useState<SettingsPreview | null>(null);
  const [test, setTest] = useState<CodexConnectionTest | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const enabled = useSettings((s) => s.settings.providers.enabled.includes("codex"));
  const t = useT();
  const c = t.connect;
  const x = t.codexConnect;

  const detect = useCallback(async () => {
    try {
      setDet(await backend.codexDetect());
    } catch (e) {
      setMessage({ kind: "error", text: String(e) });
    }
  }, []);
  useEffect(() => {
    backend
      .codexDetect()
      .then(setDet)
      .catch((e) => setMessage({ kind: "error", text: String(e) }));
  }, []);

  const runTest = async () => {
    setTest(null);
    setTest(await backend.codexTestConnection().catch(() => ({ collectorOk: false, lastEventAt: null })));
  };

  /** The pet only listens to enabled providers. */
  const enable = async () => {
    await useSettings.getState().update((s) =>
      s.providers.enabled.includes("codex") ? s : { ...s, providers: { ...s.providers, enabled: [...s.providers.enabled, "codex"] } },
    );
    setMessage({ kind: "ok", text: x.enabledMsg });
    await runTest();
  };

  const startPreview = async (action: "connect" | "disconnect") => {
    setMessage(null);
    try {
      setPreview(await backend.codexPreview(action));
    } catch (e) {
      setMessage({ kind: "error", text: String(e) });
    }
  };

  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await backend.codexApply(preview.action, preview.baseHash);
      setMessage({
        kind: "ok",
        text: `${preview.action === "connect" ? c.connectedMsg : c.disconnectedMsg}${r.backupPath ? c.backup(r.backupPath) : ""}`,
      });
      setPreview(null);
      if (preview.action === "connect" && !enabled) await enable();
      await detect();
      if (preview.action === "connect") await runTest();
    } catch (e) {
      setMessage({ kind: "error", text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const st = det?.status;
  const hooked = !!st?.fullyConnected;
  const partial = !!st && !hooked && st.connectedHooks.length > 0;
  const eventsText = !enabled
    ? x.enableFirst
    : test?.lastEventAt
      ? `${x.arriving}${c.lastEvent(formatRelative(test.lastEventAt))}`
      : test
        ? x.waitingLog
        : c.runAfter;

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-[18px] font-bold">{x.title}</h2>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">{x.intro}</p>
      </div>

      <ol className="card p-4 pb-1">
        <Step n={1} title={x.step1} state={!det ? "pending" : det.installed ? "ok" : "fail"}>
          {det?.cliPath ? (
            <>
              <span className="mono">{det.cliPath}</span>
              {det.version && ` · ${det.version}`}
            </>
          ) : det?.installed ? (
            x.configFound
          ) : (
            x.notFound
          )}
        </Step>
        <Step n={2} title={x.sessionsStep} state={!det ? "pending" : det.sessionsDirExists ? "ok" : "warn"}>
          <span className="mono">{det?.sessionsDir ?? "…"}</span>
          {det && !det.sessionsDirExists && x.sessionsMissing}
        </Step>
        <Step n={3} title={x.enableStep} state={enabled ? "ok" : "pending"}>
          {enabled ? x.enabledHint : x.enableHint}
        </Step>
        <Step n={4} title={x.eventsStep} state={!enabled || !test ? "pending" : test.lastEventAt ? "ok" : "warn"}>
          {eventsText}
        </Step>
      </ol>

      {message && (
        <div
          className="rounded-lg p-3 text-[13px] break-words"
          style={{ background: "var(--surface-2)", color: message.kind === "ok" ? "var(--ok)" : "var(--danger)" }}
        >
          {message.text}
        </div>
      )}

      {!preview && (
        <div className="flex flex-wrap gap-2">
          {!enabled && (
            <button className="btn btn-primary" onClick={() => void enable()}>
              {x.enableBtn}
            </button>
          )}
          <button className="btn" onClick={() => void runTest()}>
            {c.testBtn}
          </button>
          <button className="btn" onClick={() => void detect()}>
            {c.recheck}
          </button>
        </div>
      )}

      <details className="card p-4" open={hooked || partial || !!preview}>
        <summary className="cursor-pointer text-[13px] font-semibold">{x.advanced}</summary>
        <p className="mt-2 text-[12px] text-[color:var(--text-muted)]">{x.advancedHint}</p>

        <ol className="mt-3">
          <Step n={1} title={x.step3} state={!det ? "pending" : det.hooksError ? "fail" : "ok"}>
            {det?.hooksError ?? (det?.hooksExists ? <span className="mono">{det.hooksPath}</span> : x.noHooksFile)}
          </Step>
          <Step n={2} title={x.step4} state={!det ? "pending" : hooked ? "ok" : partial ? "warn" : "pending"}>
            {hooked ? x.connected(st!.connectedHooks.length) : partial ? c.partial(st!.missingHooks.join(", ")) : c.notConnected}
          </Step>
          <Step n={3} title={x.step5} state={hooked ? "warn" : "pending"}>
            {x.trustHint}
          </Step>
        </ol>

        {preview ? (
          <PreviewCard preview={preview} busy={busy} onApprove={() => void apply()} onCancel={() => setPreview(null)} />
        ) : (
          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={!det || !!det.hooksError} onClick={() => void startPreview("connect")}>
              {hooked ? c.repair : x.connectBtn}
            </button>
            {(hooked || partial) && (
              <button className="btn btn-danger ml-auto" onClick={() => void startPreview("disconnect")}>
                {c.disconnect}
              </button>
            )}
          </div>
        )}

        <details className="mt-3 text-[12px] text-[color:var(--text-muted)]">
          <summary className="cursor-pointer">{c.whatAdded}</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <span className="mono">hooks.json</span>
              {x.addedHooks}
            </li>
            <li>{x.addedUsage}</li>
            <li>
              {c.addedTag1}
              <span className="mono">--source=ai-coding-pet</span>
              {c.addedTag2}
            </li>
            {det?.exePath && (
              <li>
                {x.exe}
                <span className="mono">{det.exePath}</span>
              </li>
            )}
          </ul>
        </details>
      </details>
    </div>
  );
}
