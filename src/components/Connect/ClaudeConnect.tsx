import { useCallback, useEffect, useState, type ReactNode } from "react";
import { backend, type ClaudeDetection, type ConnectionTest, type SettingsPreview } from "@/lib/backend";
import { useT } from "@/i18n";
import { formatRelative } from "@/utils/format";

type StepState = "ok" | "warn" | "fail" | "pending";

export function Step({ n, title, state, children }: { n: number; title: string; state: StepState; children?: ReactNode }) {
  const color = { ok: "var(--ok)", warn: "var(--warn)", fail: "var(--danger)", pending: "var(--text-muted)" }[state];
  const icon = { ok: "✓", warn: "!", fail: "✕", pending: String(n) }[state];
  return (
    <li className="flex gap-3">
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
        style={{ border: `1.5px solid ${color}`, color }}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 pb-3">
        <div className="text-[13px] font-semibold">{title}</div>
        {children && <div className="mt-0.5 text-[12px] break-words text-[color:var(--text-muted)]">{children}</div>}
      </div>
    </li>
  );
}

export function PreviewCard({
  preview,
  busy,
  onApprove,
  onCancel,
}: {
  preview: SettingsPreview;
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const [showJson, setShowJson] = useState(false);
  const c = useT().connect;
  return (
    <div className="card space-y-3 p-4" style={{ borderColor: "var(--accent)" }}>
      <div className="font-bold">
        {c.reviewChanges}<span className="mono text-[12px] font-normal">{preview.settingsPath}</span>
      </div>
      {preview.changes.length === 0 ? (
        <div className="text-[13px] text-[color:var(--text-muted)]">{c.nothingToChange}</div>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-[13px]">
          {preview.changes.map((c, i) => (
            <li key={i}>
              <span className="chip mr-1.5">{c.kind}</span>
              {c.description}
            </li>
          ))}
        </ul>
      )}
      {preview.warnings.map((w) => (
        <div key={w} className="rounded-lg p-2 text-[12px]" style={{ background: "var(--surface-2)", color: "var(--warn)" }}>
          {w}
        </div>
      ))}
      <div className="text-[12px] text-[color:var(--text-muted)]">
        {c.keepNote}
      </div>
      <button className="chip cursor-pointer" onClick={() => setShowJson((v) => !v)}>
        {showJson ? c.hideJson : c.showJson}
      </button>
      {showJson && (
        <div className="grid gap-2 md:grid-cols-2">
          {(["before", "after"] as const).map((k) => (
            <div key={k}>
              <div className="label mb-1">{c[k]}</div>
              <pre className="mono max-h-72 overflow-auto rounded-lg p-2 text-[11px]" style={{ background: "var(--surface-2)" }}>
                {preview[k] || c.noFile}
              </pre>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy || preview.changes.length === 0} onClick={onApprove}>
          {preview.action === "connect" ? c.approveConnect : c.approveDisconnect}
        </button>
        <button className="btn" onClick={onCancel} disabled={busy}>
          {c.cancel}
        </button>
      </div>
    </div>
  );
}

export function ClaudeConnect() {
  const [det, setDet] = useState<ClaudeDetection | null>(null);
  const [preview, setPreview] = useState<SettingsPreview | null>(null);
  const [test, setTest] = useState<ConnectionTest | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const c = useT().connect;

  const detect = useCallback(async () => {
    try {
      setDet(await backend.claudeDetect());
    } catch (e) {
      setMessage({ kind: "error", text: String(e) });
    }
  }, []);
  useEffect(() => {
    backend
      .claudeDetect()
      .then(setDet)
      .catch((e) => setMessage({ kind: "error", text: String(e) }));
  }, []);

  const runTest = async () => {
    setTest(null);
    setTest(await backend.claudeTestConnection().catch((e) => ({ collectorOk: false, lastClaudeEventAt: null, message: String(e) })));
  };

  const startPreview = async (action: "connect" | "disconnect") => {
    setMessage(null);
    try {
      setPreview(await backend.claudePreview(action));
    } catch (e) {
      setMessage({ kind: "error", text: String(e) });
    }
  };

  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await backend.claudeApply(preview.action, preview.baseHash);
      setMessage({
        kind: "ok",
        text: `${preview.action === "connect" ? c.connectedMsg : c.disconnectedMsg}${r.backupPath ? c.backup(r.backupPath) : ""}`,
      });
      setPreview(null);
      await detect();
      if (preview.action === "connect") await runTest();
    } catch (e) {
      setMessage({ kind: "error", text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const st = det?.status;
  const connected = !!st?.fullyConnected;
  const partial = !!st && !connected && (st.statusLineConnected || st.connectedHooks.length > 0);

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-[18px] font-bold">{c.title}</h2>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          {c.intro1}
          <b>statusLine</b>
          {c.intro2}
          <b>hooks</b>
          {c.intro3}
        </p>
      </div>

      <ol className="card p-4 pb-1">
        <Step n={1} title={c.step1} state={!det ? "pending" : det.installed ? "ok" : "fail"}>
          {det?.cliPath ? (
            <>
              <span className="mono">{det.cliPath}</span>
              {det.version && ` · ${det.version}`}
            </>
          ) : det?.installed ? (
            c.configFound
          ) : (
            c.notFound
          )}
        </Step>
        <Step n={2} title={c.step2} state={!det ? "pending" : det.configDirExists ? "ok" : "warn"}>
          <span className="mono">{det?.configDir ?? "…"}</span>
          {det && !det.configDirExists && c.willCreate}
        </Step>
        <Step n={3} title={c.step3} state={!det ? "pending" : det.settingsError ? "fail" : "ok"}>
          {det?.settingsError ?? (det?.settingsExists ? <span className="mono">{det.settingsPath}</span> : c.noSettings)}
        </Step>
        <Step n={4} title={c.step4} state={!det ? "pending" : connected ? "ok" : partial ? "warn" : "pending"}>
          {connected
            ? c.connected(st!.connectedHooks.length)
            : partial
              ? c.partial([!st!.statusLineConnected && "statusLine", ...st!.missingHooks].filter(Boolean).join(", "))
              : c.notConnected}
          {!!st?.foreignStatusLine && !connected && c.foreignStatusLine}
        </Step>
        <Step n={5} title={c.step5} state={!test ? "pending" : test.collectorOk ? (test.lastClaudeEventAt ? "ok" : "warn") : "fail"}>
          {test
            ? `${test.message}${test.lastClaudeEventAt ? c.lastEvent(formatRelative(test.lastClaudeEventAt)) : ""}`
            : c.runAfter}
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

      {preview ? (
        <PreviewCard preview={preview} busy={busy} onApprove={() => void apply()} onCancel={() => setPreview(null)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={!det || !!det.settingsError} onClick={() => void startPreview("connect")}>
            {connected ? c.repair : c.connectBtn}
          </button>
          <button className="btn" onClick={() => void runTest()}>
            {c.testBtn}
          </button>
          <button className="btn" onClick={() => void detect()}>
            {c.recheck}
          </button>
          {(connected || partial) && (
            <button className="btn btn-danger ml-auto" onClick={() => void startPreview("disconnect")}>
              {c.disconnect}
            </button>
          )}
        </div>
      )}

      <details className="text-[12px] text-[color:var(--text-muted)]">
        <summary className="cursor-pointer">{c.whatAdded}</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <span className="mono">statusLine</span>
            {c.addedStatusLine}
          </li>
          <li>
            <span className="mono">hooks</span>
            {c.addedHooks}
          </li>
          <li>
            {c.addedTag1}
            <span className="mono">--source=ai-coding-pet</span>
            {c.addedTag2}
          </li>
          {det && (
            <li>
              {c.shell}
              <span className="mono">{det.shell}</span>
              {c.exe}
              <span className="mono">{det.exePath}</span>
            </li>
          )}
        </ul>
      </details>
    </div>
  );
}
