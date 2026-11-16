# AI Coding Pet 🌱

A tiny desktop companion that lives in the corner of your screen and reacts, in real time, to what your AI coding agent is doing — and grows the more you code together.

MVP provider: **Claude Code**. Architecture is provider-agnostic so Codex CLI, Gemini CLI, etc. can plug in later.

## What it does

- **Live reactions** — the pet codes while Claude writes, thinks while Claude thinks, spins a gear while a tool runs, looks at you when Claude needs permission, jumps when a turn completes, gets dizzy on errors and falls asleep when Claude Code isn't running.
- **Usage at a glance** — click the pet for a small popover: 5‑hour and weekly plan limits, context window fill, session lines changed, pet level/XP, today's coding time and streak.
- **Gets tired with you** — 5h/weekly usage over 60/80/95% makes the pet slightly tired → tired → exhausted; context over 80/95% makes it confused → overwhelmed.
- **Grows** — XP from coding time, code changes, completed turns and sessions; levels; daily streaks.
- **Dashboard** — today's stats, plan limits vs. context, last 7 days chart.
- **100% local** — no server, no login, nothing leaves your machine.

## Screenshots

> _Placeholder — add screenshots of the desktop pet, popover and dashboard here._

## Requirements

- Claude Code **2.1.80+** (statusLine `rate_limits` field; hooks used exist since 2.1.78). Plan-limit bars need a Claude **Pro/Max** plan; otherwise they show "Unavailable".
- To build: Node **18/20/22+**, Rust (stable), and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)
  - macOS: Xcode Command Line Tools
  - Windows: Microsoft C++ Build Tools + WebView2 (preinstalled on Windows 10/11)

## Install

### macOS
1. `npm run tauri:build` → `src-tauri/target/release/bundle/dmg/AI Coding Pet_<version>.dmg` (or `bundle/macos/AI Coding Pet.app`).
2. Drag to Applications and launch. The app lives in the menu bar (tray) and has no Dock icon until you open the dashboard.
3. Unsigned local builds: right‑click → Open the first time.

### Windows
1. `npm run tauri:build` on Windows → `src-tauri\target\release\bundle\nsis\AI Coding Pet_<version>_x64-setup.exe` (per-user install, no admin needed) or the `.msi`.
2. Run the installer; the pet appears bottom-right and the icon sits in the system tray.

## Development

```bash
npm install
npm run tauri:dev          # app with hot reload (Developer Mode is on in debug builds)
npm run dev                # UI only in a browser: http://localhost:1420/?window=dashboard  or  ?window=pet
npm test                   # TypeScript unit tests (vitest)
npm run typecheck && npm run lint
cd src-tauri && cargo test # Rust unit tests
npm run tauri:build        # release bundles
```

Developer Mode (Dashboard → Developer) mocks every state — offline, idle, working, thinking, waiting, completed, error, 5h = 10/70/90/99, context = 85/95 — so you can test the pet without Claude Code. It is visible in debug builds, or in release builds started with `AI_PET_DEV_MODE=1`.

## Releases & auto-update

Releases are built by GitHub Actions (`.github/workflows/release.yml`) and published on GitHub Releases. Installed apps check `releases/latest/download/latest.json` about 20 s after launch and every 6 h; when a newer version exists, the tray shows **Install Update vX.Y.Z**, which downloads, verifies the signature, installs and restarts. The tray's **Check for Updates…** runs a check on demand.

To ship a release:

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. Commit, then `git tag vX.Y.Z && git push origin main --tags`.
3. When the workflow finishes, review the draft release and click **Publish**. Only published releases reach installed apps.

Update packages are signed with a minisign key (separate from Apple/Windows code signing). The public key is in `tauri.conf.json`; the private key lives outside the repo and must be set as repo secrets `TAURI_SIGNING_PRIVATE_KEY` (key file contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty if none). **Losing the private key means existing installs can no longer be updated.** Local `npm run tauri:build` also needs `TAURI_SIGNING_PRIVATE_KEY` set (a path to the key file works).

## Claude Code integration

Open the dashboard (tray → Open Dashboard) → **Claude Code** tab → **Connect Claude Code**:

1. checks Claude Code is installed,
2. resolves the config directory (`$CLAUDE_CONFIG_DIR` or `~/.claude`, via OS path APIs),
3. reads `settings.json` (never rewrites invalid JSON),
4. shows which of our entries are present,
5. **shows the exact change and the resulting file** for approval,
6. backs up the file, patches it (only our keys; everything else and key order preserved; refuses if the file changed since the preview),
7. runs a connection test.

**Disconnect** removes only entries tagged `--source=ai-coding-pet` and restores your original `statusLine`.

What gets added:

- `statusLine` → `"<app executable>" claude-statusline --source=ai-coding-pet`. If you already had a status line, it is **wrapped**: our collector forwards the JSON and then runs your original command, so your status line looks exactly as before. `padding`/`refreshInterval` are kept.
- `hooks` (all `async: true`, so they never slow Claude down, and they print nothing): `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Notification`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `PreCompact`, `SessionEnd`.

Commands use shell form (exec-form `args` needs Claude Code 2.1.139+). On Windows the path uses forward slashes; if Git Bash is absent (Claude Code then uses PowerShell) the command is written as `& '<path>' …`. Reconnect after moving/reinstalling the app, since the path is stored.

## How data is collected

```
Claude Code ──statusLine / hooks──▶ ai-coding-pet (CLI collector mode, same executable)
                                   │  HTTP POST 127.0.0.1:<port>, Bearer token
                                   ▼
                            Tauri backend (Rust) ──▶ event ──▶ React
                                   │                            │
                                SQLite ◀── throttled deltas ── UsageTracker
                                                                │
                            ClaudeProvider (RAW → AIStatus) ─▶ PetStateMachine ─▶ Pet
```

- **RAW_EVENT vs DERIVED_STATE.** Claude Code reports hook events and statusLine JSON; it does not report an "activity". `ClaudeActivity.ts` derives it (e.g. `PreToolUse` → `tool`, `Stop` → `completed`, `PermissionRequest` → `waiting`) and applies time-based decay (completed → idle after 6 s, stale "working" → idle). Every value carries a `source` (`claude_statusline`, `claude_hook`, `process_probe`, `derived`, `mock`, `unavailable`); estimated values show `≈` in the UI.
- **Offline detection** — a local process check for a `claude` process (the Claude desktop app is not matched), plus `SessionEnd`.
- **Three different numbers, never mixed up:**
  - *Context* — how full the current conversation's context window is (`context_window.used_percentage`); a gauge that drops after `/compact`.
  - *5-hour* and *Weekly* — share of your **subscription** limit (`rate_limits.five_hour/seven_day.used_percentage`). Not tokens.
- **Deltas, not double counting.** `cost.total_lines_*`, `total_cost_usd`, `total_api_duration_ms` are cumulative per session → we store `current − previous` with a per-session cursor persisted in SQLite (survives restarts). A decrease means a restart → counted from zero, never negative. `context_window.total_*_tokens` is a gauge and is **never summed**; token totals are estimated from `context_window.current_usage` once per distinct API call. New `session_id` → new session.
- **Plan-limit resets** — a drop like 72% → 4% (or a later `resets_at`) is logged as a reset event, not negative usage. After `resets_at` passes the UI shows ~0% (derived) until fresh data arrives.
- **Write throttling** — statusLine can fire several times a second; stats are flushed to SQLite every 15 s (and on session end), usage samples at most once a minute per metric.
- **Missing fields** (older versions, API-key users without `rate_limits`, early-session nulls) are handled null-safely and shown as "Unavailable".

## Privacy

- No servers, accounts, analytics or telemetry. Nothing is sent over the network.
- The collector listens on **127.0.0.1 only**, requires a 256-bit random token stored in an owner-only (`0600`) file, rejects browser requests (any `Origin` header), and caps payloads at 1 MiB.
- Stored: aggregate daily counters, per-session cursors (numbers only), plan-limit samples (30-day retention), settings. **Prompts, assistant messages, tool inputs/outputs, transcript paths and working directories are never stored or kept in memory** — the collector strips every field outside a small allowlist on arrival (`sanitize` in `collector/server.rs`).
- Data location: macOS `~/Library/Application Support/dev.aicodingpet.pet/`, Windows `%APPDATA%\dev.aicodingpet.pet\` (`pet.db`, `collector.json`, `claude-integration.json`, `backups/`).

## Architecture

```
src/
  providers/
    core/        types.ts (AIProvider, AIStatus, Metric+source), metric.ts, Emitter, PlaceholderProvider
    claude/      ClaudeTypes.ts (documented payloads), claudeParse.ts (null-safe),
                 ClaudeActivity.ts (RAW → DERIVED), ClaudeCollector.ts, ClaudeProvider.ts
    codex/ gemini/   placeholders
    registry.ts  provider factories
  pet/           PetStates.ts, PetStateMachine.ts (prioritised rule table), xp.ts, skins/ (renderer interface + SVG skin)
  services/      runtime.ts (wires everything, runs in the pet window), usageTracker.ts, usageDelta.ts, mockScenarios.ts
  stores/        aiStore, petStore, settingsStore (Zustand)
  platform/      petWindow.ts (popover window geometry, multi-monitor, DPI-aware)
  components/    Pet/, UsagePanel/, Dashboard/, Settings/, Connect/, DevMode/, common/
  lib/backend.ts typed bridge to Rust commands
src-tauri/src/
  collector/     server.rs (localhost receiver), cli.rs (collector mode + statusLine chaining)
  claude/        detection, settings preview/apply/backup, settings_patch.rs (pure, tested)
  platform/      click_through.rs (cursor hit-testing), placement.rs (restore on a connected monitor)
  db.rs          SQLite (rusqlite, bundled)
  tray.rs, windows.rs, process.rs, lib.rs
```

- **Pet state machine** — a declarative rule table (`PET_RULES`) with priorities: offline > error > waiting > completed > context-overwhelmed > thinking > tool > working > usage fatigue > context-confused > idle. Conditions that lose still decorate the pet as *modifiers* (e.g. coding **with sweat** at 88% of the 5h limit).
- **Skins** — a skin is any React component implementing `PetRendererProps` (`state`, `modifiers`, `animate`, `size`). Swap the SVG/CSS skin for a PNG sprite sheet, Lottie or Rive by adding one entry to `pet/skins/index.ts`.
- **Transparent pet window** — frameless, transparent, always-on-top, skip-taskbar; draggable; position restored only if still on a connected monitor, otherwise bottom-right of the primary work area. **Click-through**: the backend polls the global cursor and toggles `set_ignore_cursor_events` so only the pet itself catches clicks (macOS & Windows). The popover grows the window around the pet (flips below when there's no room above).

## Adding another Provider

1. Create `src/providers/<id>/<Name>Provider.ts` implementing `AIProvider` (`src/providers/core/types.ts`): emit `AIStatus` via `onStatus`, cumulative `UsageObservation`s via `onUsage`, and `session_start/turn_complete/session_end` via `onLifecycle`. Tag every metric with its `source`.
2. If the agent needs a collector, add a route: allow the provider id in `KNOWN_PROVIDERS` (`src-tauri/src/collector/server.rs`) and a CLI mode in `collector/cli.rs`; add an integration module like `src-tauri/src/claude/`.
3. Register the factory in `src/providers/registry.ts` and flip `implemented: true` in `PROVIDER_INFO`.
4. The pet, tracker, DB and dashboard need no changes.

## Roadmap

- P1 polish: signed/notarized builds, auto-update, onboarding window on first run
- P2: more pets & skins (sprite/Lottie/Rive), Codex CLI and Gemini CLI providers, achievements
- Per-project stats (from `workspace.project_dir`), multiple pets for concurrent sessions
- Linux support (Tauri supports it; click-through/transparency need testing on X11/Wayland)

## License

MIT (add a LICENSE file before publishing).
