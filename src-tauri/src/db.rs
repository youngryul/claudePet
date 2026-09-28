//! Local SQLite storage. Everything stays on this machine.
//!
//! The frontend computes *deltas* (see `src/services/usageTracker.ts`) and flushes them
//! in batches; this module only adds them up, so frequent statusLine updates never turn
//! into frequent disk writes.

use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS daily_usage (
  date TEXT NOT NULL,
  provider TEXT NOT NULL,
  coding_ms INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  turns INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  lines_added INTEGER NOT NULL DEFAULT 0,
  lines_removed INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, provider)
);
CREATE TABLE IF NOT EXISTS sessions (
  provider TEXT NOT NULL,
  session_id TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  model TEXT,
  ended INTEGER NOT NULL DEFAULT 0,
  cursor TEXT,
  PRIMARY KEY (provider, session_id)
);
CREATE TABLE IF NOT EXISTS usage_samples (
  ts INTEGER NOT NULL,
  provider TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  source TEXT NOT NULL,
  reset_detected INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_samples_ts ON usage_samples(ts);
CREATE TABLE IF NOT EXISTS pet_progress (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  xp INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT
);
INSERT OR IGNORE INTO pet_progress (id) VALUES (1);
"#;

impl Db {
    pub fn open(path: &std::path::Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Db(Mutex::new(conn)))
    }

    #[cfg(test)]
    pub fn in_memory() -> Self {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        Db(Mutex::new(conn))
    }

    pub fn kv_get(&self, key: &str) -> Option<String> {
        let c = self.0.lock().unwrap();
        c.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
            .optional()
            .ok()
            .flatten()
    }

    pub fn kv_set(&self, key: &str, value: &str) -> rusqlite::Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCursor {
    pub session_id: String,
    pub model: Option<String>,
    pub ended: bool,
    pub cursor: Value,
    pub last_seen: u64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageDeltaBatch {
    /// Local date (YYYY-MM-DD) computed by the frontend in the user's time zone.
    pub date: String,
    pub provider: String,
    pub coding_ms: i64,
    pub sessions: i64,
    pub turns: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub lines_added: i64,
    pub lines_removed: i64,
    pub cost_usd: f64,
    pub xp: i64,
    #[serde(default)]
    pub cursors: Vec<SessionCursor>,
}

impl UsageDeltaBatch {
    fn has_activity(&self) -> bool {
        self.coding_ms > 0 || self.sessions > 0 || self.turns > 0 || self.lines_added > 0
    }
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PetProgress {
    pub xp: i64,
    pub streak: i64,
    pub best_streak: i64,
    pub last_active_date: Option<String>,
    /// XP granted by this call for extending the streak (0 when not applicable).
    pub streak_bonus_xp: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DailyRow {
    pub date: String,
    pub coding_ms: i64,
    pub sessions: i64,
    pub turns: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub lines_added: i64,
    pub lines_removed: i64,
    pub cost_usd: f64,
    pub xp: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardData {
    pub today: DailyRow,
    pub totals: DailyRow,
    pub days: Vec<DailyRow>,
    pub progress: PetProgress,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSample {
    pub ts: u64,
    pub provider: String,
    pub metric: String,
    pub value: f64,
    pub source: String,
    pub reset_detected: bool,
}

pub const STREAK_BONUS_PER_DAY: i64 = 10;
pub const STREAK_BONUS_CAP_DAYS: i64 = 7;

fn parse_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

fn read_progress(c: &Connection) -> rusqlite::Result<PetProgress> {
    c.query_row(
        "SELECT xp, streak, best_streak, last_active_date FROM pet_progress WHERE id = 1",
        [],
        |r| {
            Ok(PetProgress {
                xp: r.get(0)?,
                streak: r.get(1)?,
                best_streak: r.get(2)?,
                last_active_date: r.get(3)?,
                streak_bonus_xp: 0,
            })
        },
    )
}

/// Streak semantics: activity on consecutive local dates. A gap resets to 1.
/// The first activity of each new day grants a bonus of 10 XP x streak (max 7 days).
fn next_streak(prev: &PetProgress, today: NaiveDate) -> (i64, i64) {
    match prev.last_active_date.as_deref().and_then(parse_date) {
        Some(last) if last == today => (prev.streak.max(1), 0),
        Some(last) if last.succ_opt() == Some(today) => {
            let s = prev.streak + 1;
            (s, STREAK_BONUS_PER_DAY * s.min(STREAK_BONUS_CAP_DAYS))
        }
        Some(last) if last > today => (prev.streak.max(1), 0), // clock went backwards
        _ => (1, STREAK_BONUS_PER_DAY),
    }
}

pub fn apply_usage(db: &Db, batch: &UsageDeltaBatch) -> Result<PetProgress, String> {
    let today = parse_date(&batch.date).ok_or("invalid date")?;
    let mut c = db.0.lock().unwrap();
    let tx = c.transaction().map_err(|e| e.to_string())?;

    let prev = read_progress(&tx).map_err(|e| e.to_string())?;
    let (streak, bonus) = if batch.has_activity() {
        next_streak(&prev, today)
    } else {
        (prev.streak, 0)
    };
    let xp_gain = batch.xp.max(0) + bonus;

    tx.execute(
        "INSERT INTO daily_usage (date, provider, coding_ms, sessions, turns, input_tokens,
            output_tokens, lines_added, lines_removed, cost_usd, xp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(date, provider) DO UPDATE SET
            coding_ms = coding_ms + excluded.coding_ms,
            sessions = sessions + excluded.sessions,
            turns = turns + excluded.turns,
            input_tokens = input_tokens + excluded.input_tokens,
            output_tokens = output_tokens + excluded.output_tokens,
            lines_added = lines_added + excluded.lines_added,
            lines_removed = lines_removed + excluded.lines_removed,
            cost_usd = cost_usd + excluded.cost_usd,
            xp = xp + excluded.xp",
        params![
            batch.date,
            batch.provider,
            batch.coding_ms.max(0),
            batch.sessions.max(0),
            batch.turns.max(0),
            batch.input_tokens.max(0),
            batch.output_tokens.max(0),
            batch.lines_added.max(0),
            batch.lines_removed.max(0),
            batch.cost_usd.max(0.0),
            xp_gain,
        ],
    )
    .map_err(|e| e.to_string())?;

    let last_active = if batch.has_activity() {
        Some(batch.date.clone())
    } else {
        prev.last_active_date.clone()
    };
    tx.execute(
        "UPDATE pet_progress SET xp = xp + ?1, streak = ?2, best_streak = MAX(best_streak, ?2),
            last_active_date = ?3 WHERE id = 1",
        params![xp_gain, streak, last_active],
    )
    .map_err(|e| e.to_string())?;

    for cur in &batch.cursors {
        tx.execute(
            "INSERT INTO sessions (provider, session_id, first_seen, last_seen, model, ended, cursor)
             VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6)
             ON CONFLICT(provider, session_id) DO UPDATE SET
                last_seen = excluded.last_seen, model = COALESCE(excluded.model, model),
                ended = excluded.ended, cursor = excluded.cursor",
            params![
                batch.provider,
                cur.session_id,
                cur.last_seen as i64,
                cur.model,
                cur.ended,
                cur.cursor.to_string()
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    let mut progress = read_progress(&tx).map_err(|e| e.to_string())?;
    progress.streak_bonus_xp = bonus;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(progress)
}

pub fn get_session_cursor(db: &Db, provider: &str, session_id: &str) -> Option<Value> {
    let c = db.0.lock().unwrap();
    c.query_row(
        "SELECT cursor FROM sessions WHERE provider = ?1 AND session_id = ?2",
        params![provider, session_id],
        |r| r.get::<_, Option<String>>(0),
    )
    .optional()
    .ok()
    .flatten()
    .flatten()
    .and_then(|s| serde_json::from_str(&s).ok())
}

fn row_from(r: &rusqlite::Row, date: String) -> rusqlite::Result<DailyRow> {
    Ok(DailyRow {
        date,
        coding_ms: r.get(0)?,
        sessions: r.get(1)?,
        turns: r.get(2)?,
        input_tokens: r.get(3)?,
        output_tokens: r.get(4)?,
        lines_added: r.get(5)?,
        lines_removed: r.get(6)?,
        cost_usd: r.get(7)?,
        xp: r.get(8)?,
    })
}

const SUMS: &str = "COALESCE(SUM(coding_ms),0), COALESCE(SUM(sessions),0), COALESCE(SUM(turns),0),
    COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(lines_added),0),
    COALESCE(SUM(lines_removed),0), COALESCE(SUM(cost_usd),0), COALESCE(SUM(xp),0)";

pub fn dashboard(db: &Db, today: &str, days: u32) -> Result<DashboardData, String> {
    let today_date = parse_date(today).ok_or("invalid date")?;
    let c = db.0.lock().unwrap();
    let day_row = |date: &str| -> rusqlite::Result<DailyRow> {
        c.query_row(
            &format!("SELECT {SUMS} FROM daily_usage WHERE date = ?1"),
            [date],
            |r| row_from(r, date.to_string()),
        )
    };
    let mut rows = vec![];
    for i in (0..days.max(1)).rev() {
        let d = today_date - chrono::Duration::days(i as i64);
        rows.push(day_row(&d.format("%Y-%m-%d").to_string()).map_err(|e| e.to_string())?);
    }
    let totals = c
        .query_row(&format!("SELECT {SUMS} FROM daily_usage"), [], |r| {
            row_from(r, "total".into())
        })
        .map_err(|e| e.to_string())?;
    let mut progress = read_progress(&c).map_err(|e| e.to_string())?;
    // A streak is broken if the last active day is before yesterday.
    if let Some(last) = progress.last_active_date.as_deref().and_then(parse_date) {
        if today_date.signed_duration_since(last).num_days() > 1 {
            progress.streak = 0;
        }
    }
    Ok(DashboardData {
        today: rows.last().cloned().unwrap_or_default(),
        totals,
        days: rows,
        progress,
    })
}

pub fn record_samples(db: &Db, samples: &[UsageSample]) -> Result<(), String> {
    let mut c = db.0.lock().unwrap();
    let tx = c.transaction().map_err(|e| e.to_string())?;
    for s in samples {
        tx.execute(
            "INSERT INTO usage_samples (ts, provider, metric, value, source, reset_detected)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                s.ts as i64,
                s.provider,
                s.metric,
                s.value,
                s.source,
                s.reset_detected
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    let cutoff = crate::paths::now_ms() as i64 - 30 * 24 * 3600 * 1000;
    tx.execute("DELETE FROM usage_samples WHERE ts < ?1", [cutoff])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn batch(date: &str, xp: i64) -> UsageDeltaBatch {
        UsageDeltaBatch {
            date: date.into(),
            provider: "claude".into(),
            coding_ms: 60_000,
            xp,
            ..Default::default()
        }
    }

    #[test]
    fn streak_increments_on_consecutive_days_and_resets_on_gap() {
        let db = Db::in_memory();
        assert_eq!(apply_usage(&db, &batch("2026-01-01", 5)).unwrap().streak, 1);
        assert_eq!(apply_usage(&db, &batch("2026-01-01", 5)).unwrap().streak, 1);
        let p = apply_usage(&db, &batch("2026-01-02", 5)).unwrap();
        assert_eq!((p.streak, p.streak_bonus_xp), (2, 20));
        let p = apply_usage(&db, &batch("2026-01-05", 5)).unwrap();
        assert_eq!((p.streak, p.best_streak), (1, 2));
    }

    #[test]
    fn empty_batches_do_not_touch_streak() {
        let db = Db::in_memory();
        let empty = UsageDeltaBatch {
            date: "2026-01-01".into(),
            provider: "claude".into(),
            ..Default::default()
        };
        let p = apply_usage(&db, &empty).unwrap();
        assert_eq!((p.streak, p.xp), (0, 0));
    }

    #[test]
    fn dashboard_sums_and_fills_missing_days() {
        let db = Db::in_memory();
        apply_usage(&db, &batch("2026-01-01", 5)).unwrap();
        apply_usage(&db, &batch("2026-01-03", 5)).unwrap();
        let d = dashboard(&db, "2026-01-03", 7).unwrap();
        assert_eq!(d.days.len(), 7);
        assert_eq!(d.days[4].coding_ms, 60_000);
        assert_eq!(d.days[5].coding_ms, 0);
        assert_eq!(d.today.coding_ms, 60_000);
        assert_eq!(d.totals.coding_ms, 120_000);
        let d = dashboard(&db, "2026-01-10", 7).unwrap();
        assert_eq!(d.progress.streak, 0);
    }

    #[test]
    fn session_cursor_roundtrip() {
        let db = Db::in_memory();
        let mut b = batch("2026-01-01", 0);
        b.cursors.push(SessionCursor {
            session_id: "s1".into(),
            model: Some("Opus".into()),
            ended: false,
            cursor: serde_json::json!({"linesAdded": 10}),
            last_seen: 1,
        });
        apply_usage(&db, &b).unwrap();
        assert_eq!(
            get_session_cursor(&db, "claude", "s1").unwrap()["linesAdded"],
            10
        );
        assert!(get_session_cursor(&db, "claude", "nope").is_none());
    }
}
