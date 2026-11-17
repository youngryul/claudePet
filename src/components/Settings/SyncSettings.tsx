import { useEffect, useState } from "react";
import { backend, broadcast, type SyncStatus } from "@/lib/backend";
import { useT } from "@/i18n";
import { EVT_SYNC_CHANGED } from "@/services/runtime";
import { formatRelative } from "@/utils/format";

/** Account-wide level/XP through a sync folder (OneDrive, iCloud Drive, Dropbox, ...). */
export function SyncSettings() {
  const L = useT().sync;
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void backend.syncStatus().then(setStatus).catch((e) => setError(String(e)));
  }, []);

  const choose = async (path: string | null) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await backend.syncSetFolder(path));
      setCustom("");
      // Pet and dashboard reload their numbers when progress changes.
      await broadcast(EVT_SYNC_CHANGED, null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;
  const muted = "text-[12px] text-[color:var(--text-muted)]";

  return (
    <section className="card space-y-3 px-4 py-3">
      <div>
        <div className="text-[13px] font-semibold">{L.title}</div>
        <div className={muted}>{L.hint}</div>
      </div>

      <div className="text-[12px]">
        {L.account}{" "}
        {status.account ? (
          <span className="font-semibold">{status.account.email ?? status.account.id}</span>
        ) : (
          <span style={{ color: "var(--danger)" }}>{L.noAccount}</span>
        )}
      </div>

      {status.folder ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className={muted}>{status.active ? L.on : L.unreachable}</div>
              <div className="mono truncate text-[12px]" title={status.folder}>
                {status.folder}
              </div>
            </div>
            <button className="btn btn-danger shrink-0" disabled={busy} onClick={() => void choose(null)}>
              {L.turnOff}
            </button>
          </div>
          {status.devices.length > 0 && (
            <div>
              <div className="label pb-1">{L.devices(status.devices.length)}</div>
              <ul className="space-y-0.5 text-[12px]">
                {status.devices.map((d) => (
                  <li key={d.deviceId} className="flex justify-between gap-2">
                    <span className="truncate">
                      {d.deviceName}
                      {d.thisDevice && <span className={muted}> · {L.thisDevice}</span>}
                    </span>
                    <span className={`${muted} tnum shrink-0`}>{d.updatedAt ? formatRelative(d.updatedAt) : "—"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {status.candidates.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {status.candidates.map((c) => (
                <button
                  key={c.path}
                  className="btn"
                  disabled={busy || !status.account}
                  title={c.path}
                  onClick={() => void choose(c.path)}
                >
                  {L.pickFolder(c.label)}
                </button>
              ))}
            </div>
          ) : (
            <div className={muted}>{L.noCandidates}</div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) void choose(custom.trim());
            }}
          >
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder={L.customPlaceholder}
              className="mono min-w-0 flex-1 rounded-[9px] px-2.5 py-1.5 text-[12px] outline-none"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
            <button className="btn" type="submit" disabled={busy || !status.account || !custom.trim()}>
              {L.use}
            </button>
          </form>
        </div>
      )}

      {(error ?? status.lastError) && (
        <div className="text-[12px]" style={{ color: "var(--danger)" }}>
          {error ?? status.lastError}
        </div>
      )}
      <div className={muted}>{L.privacy}</div>
    </section>
  );
}
