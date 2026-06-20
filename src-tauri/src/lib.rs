use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use single_instance::SingleInstance;
use std::collections::{HashMap, VecDeque};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use thiserror::Error;
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;
#[cfg(windows)]
use winreg::{enums::*, RegKey};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const TASK_STATUSES: [&str; 9] = [
    "PENDING",
    "IN_PROGRESS",
    "LOCAL_FAILED",
    "REVIEW_PENDING",
    "MIMO_REJECTED",
    "COMPLETED",
    "DEGRADED_PASS",
    "BLOCKED",
    "CANCELLED",
];

const CLAIMABLE_STATUSES: [&str; 3] = ["PENDING", "LOCAL_FAILED", "MIMO_REJECTED"];
const RUN_GROUP_UNGROUPED: &str = "未分组";
const WORKER_GLOBAL_CAP_DEFAULT: usize = 2;
const WORKER_PER_RUN_CAP_DEFAULT: usize = 1;
const REALTIME_EVENT_NAME: &str = "teamflow_realtime";
const REALTIME_WS_PORT: u16 = 48765;
const REALTIME_BUFFER_CAP: usize = 4096;
const CODEX_IDLE_USER_TIMEOUT_SECS: i64 = 30 * 60;
const CODEX_IDLE_ACTIVITY_GRACE_SECS: i64 = 5 * 60;
const CODEX_IDLE_SCAN_SECS: u64 = 10;
const CODEX_DEFAULT_PROVIDER_ID: &str = "codex-gpt-5.5";
const CODEX_DEFAULT_MODEL: &str = "gpt-5.5";
const CODEX_DEFAULT_OPENAI_BASE_URL: &str = "https://ai.unclecode.cn";
const CODEX_DEFAULT_WIRE_API: &str = "responses";
const CODEX_MIMO_PROVIDER_ID: &str = "mimo-v2.5-pro";
const CODEX_MIMO_MODEL: &str = "mimo-v2.5-pro";
const CODEX_MIMO_OPENAI_BASE_URL: &str = "https://token-plan-cn.xiaomimimo.com/v1";
const CODEX_MIMO_ANTHROPIC_BASE_URL: &str = "https://token-plan-cn.xiaomimimo.com/anthropic";
const PYTHON_EXEC_CANDIDATES: [&str; 3] = ["python.exe", "python3.exe", "python"];

#[derive(Clone, Debug, PartialEq, Eq)]
struct MimoEnvSelection {
    mimo_api_key: Option<(String, String)>,
    anthropic_auth_token: Option<(String, String)>,
    base_url: String,
    model: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexModelProvider {
    id: String,
    label: String,
    provider: String,
    model: String,
    base_url: Option<String>,
    anthropic_base_url: Option<String>,
    env_key: Option<String>,
    wire_api: Option<String>,
    is_default: bool,
    api_key_present: bool,
}
#[derive(Debug, Error)]
enum TeamflowError {
    #[error("数据库错误：{0}")]
    Database(#[from] rusqlite::Error),
    #[error("文件读写错误：{0}")]
    Io(#[from] std::io::Error),
    #[error("JSON 解析错误：{0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Message(String),
}

impl serde::Serialize for TeamflowError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

type Result<T> = std::result::Result<T, TeamflowError>;

#[derive(Clone)]
struct AppState {
    store: Store,
    worker_paused: Arc<Mutex<bool>>,
    worker_loop_running: Arc<Mutex<bool>>,
    worker_rr_cursor: Arc<Mutex<usize>>,
    sessions: Arc<Mutex<HashMap<String, SessionRuntime>>>,
    codex_bridges: Arc<Mutex<HashMap<String, Arc<Mutex<CodexBridgeRuntime>>>>>,
    codex_idle_monitor_started: Arc<AtomicBool>,
    realtime: Arc<RealtimeHub>,
    _instance_guard: Arc<SingleInstance>,
}

#[derive(Debug, Clone)]
struct SessionRuntime {
    session_id: String,
    run_id: String,
    agent: String,
    pid: u32,
}

#[derive(Debug, Clone)]
struct CodexRoundRuntime {
    prompt: String,
    started_at: i64,
    ended_at: Option<i64>,
    pid: Option<u32>,
    status: String,
    exit_code: Option<i32>,
    interrupt_requested: bool,
}

#[derive(Debug)]
struct CodexBridgeRuntime {
    run_id: String,
    session_id: String,
    bridge_dir: PathBuf,
    queue: VecDeque<String>,
    worker_running: bool,
    sleeping: bool,
    session_bootstrapped: bool,
    current_round: Option<CodexRoundRuntime>,
    last_round: Option<CodexRoundRuntime>,
    last_user_input_at: i64,
    last_backend_activity_at: i64,
    last_round_started_at: Option<i64>,
    last_round_ended_at: Option<i64>,
    current_pid: Option<u32>,
    interrupt_requested: bool,
}

#[derive(Clone)]
struct Store {
    root: PathBuf,
    runtime: PathBuf,
    workspace: PathBuf,
    db_path: PathBuf,
    tasks_json_path: PathBuf,
    active_run_path: PathBuf,
    ui_settings_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Task {
    run_id: String,
    id: String,
    title: String,
    goal: String,
    scope: String,
    acceptance_criteria: Vec<String>,
    verify_commands: Vec<Value>,
    status: String,
    assigned_agent: Option<String>,
    attempts: i64,
    max_attempts: i64,
    last_error: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentMessage {
    id: i64,
    run_id: String,
    session_id: String,
    agent: String,
    role: String,
    kind: String,
    text: String,
    task_id: Option<String>,
    created_at: String,
    occurrence_count: i64,
    first_seen_at: String,
    last_seen_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunSummary {
    run_id: String,
    title: String,
    project_goal: String,
    created_at: String,
    updated_at: String,
    last_activity_at: String,
    total: i64,
    completed: i64,
    in_progress: i64,
    failed: i64,
    status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunGroup {
    group: String,
    runs: Vec<RunSummary>,
    has_more: bool,
    cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteRunResult {
    run_id: String,
    deleted: HashMap<String, i64>,
    interrupted_sessions: Vec<String>,
    switched_to_run_id: Option<String>,
    created_run_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunWorkerSummary {
    run_id: String,
    running: i64,
    queued: i64,
    failed: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerPoolSummary {
    state: String,
    global_running: i64,
    global_cap: i64,
    per_run_cap: i64,
    queued_runs: i64,
    running_runs: i64,
    per_run: Vec<RunWorkerSummary>,
}

#[derive(Debug, Clone)]
struct ClaimableTask {
    run_id: String,
    task: Task,
}

#[derive(Debug, Clone)]
struct ParsedOutput {
    kind: String,
    event_type: String,
    message: String,
    summary: String,
    payload: Value,
    task_id: Option<String>,
}

#[derive(Clone)]
struct RealtimeHub {
    seq: Arc<AtomicU64>,
    tx: broadcast::Sender<String>,
    backlog: Arc<Mutex<VecDeque<Value>>>,
    ws_started: Arc<AtomicBool>,
}

#[derive(Debug, Clone)]
struct CodexLaunchPaths {
    node_exe: PathBuf,
    codex_js: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RealtimeConfig {
    event_name: String,
    ws_url: String,
    initial_seq: u64,
    mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RealtimeBenchmarkSummary {
    sample_count: u64,
    first_seq: u64,
    last_seq: u64,
    started_at_ms: i64,
    ended_at_ms: i64,
}

impl Store {
    fn new(root: PathBuf) -> Result<Self> {
        let runtime = root.join("runtime");
        let workspace = root.join("workspace");
        fs::create_dir_all(&runtime)?;
        fs::create_dir_all(&workspace)?;
        let store = Self {
            db_path: runtime.join("teamflow.sqlite3"),
            tasks_json_path: runtime.join("tasks.json"),
            active_run_path: runtime.join("active-run.json"),
            ui_settings_path: runtime.join("ui-settings.json"),
            root,
            runtime,
            workspace,
        };
        store.initialize()?;
        Ok(store)
    }

    fn connect(&self) -> Result<Connection> {
        let conn = Connection::open(&self.db_path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(conn)
    }

    fn initialize(&self) -> Result<()> {
        let conn = self.connect()?;
        conn.execute_batch(
            r#"
            create table if not exists runs (
              id text primary key,
              title text not null default '',
              created_at text not null,
              updated_at text not null,
              last_activity_at text not null,
              project_goal text not null default ''
            );
            create table if not exists tasks (
              run_id text not null,
              id text not null,
              title text not null,
              goal text not null,
              scope text not null,
              acceptance_criteria text not null,
              verify_commands text not null,
              status text not null,
              assigned_agent text,
              attempts integer not null default 0,
              max_attempts integer not null default 3,
              last_error text,
              created_at text not null,
              updated_at text not null,
              primary key(run_id, id)
            );
            create table if not exists events (
              id integer primary key autoincrement,
              run_id text not null,
              at text not null,
              type text not null,
              task_id text,
              agent text,
              message text,
              payload text not null
            );
            create table if not exists reviews (
              id integer primary key autoincrement,
              run_id text not null,
              at text not null,
              task_id text not null,
              kind text not null,
              status text not null,
              summary text not null,
              payload text not null
            );
            create table if not exists agent_sessions (
              id text primary key,
              run_id text not null,
              agent text not null,
              status text not null,
              started_at text not null,
              ended_at text,
              prompt text,
              last_error text
            );
            create table if not exists agent_messages (
              id integer primary key autoincrement,
              run_id text not null,
              session_id text not null,
              agent text not null,
              role text not null,
              kind text not null,
              text text not null,
              task_id text,
              created_at text not null,
              fingerprint text not null default '',
              occurrence_count integer not null default 1,
              first_seen_at text not null default '',
              last_seen_at text not null default ''
            );
            create table if not exists raw_transcripts (
              id integer primary key autoincrement,
              run_id text not null,
              session_id text not null,
              agent text not null,
              stream text not null,
              chunk text not null,
              created_at text not null
            );
            create table if not exists process_events (
              id integer primary key autoincrement,
              run_id text not null,
              session_id text,
              agent text,
              type text not null,
              message text not null,
              created_at text not null,
              payload text not null,
              fingerprint text not null default '',
              occurrence_count integer not null default 1,
              first_seen_at text not null default '',
              last_seen_at text not null default ''
            );
            create table if not exists codex_model_settings (
              run_id text primary key,
              provider_id text not null,
              updated_at text not null
            );
            "#,
        )?;

        self.migrate_columns()?;
        self.ensure_indexes()?;
        if self.active_run()?.is_none() {
            self.create_run()?;
        }
        self.ensure_claude_mcp_config()?;
        Ok(())
    }

    fn migrate_columns(&self) -> Result<()> {
        let conn = self.connect()?;
        self.ensure_column(&conn, "runs", "title", "text not null default ''")?;
        self.ensure_column(
            &conn,
            "runs",
            "last_activity_at",
            "text not null default ''",
        )?;
        self.ensure_column(&conn, "agent_sessions", "last_error", "text")?;
        self.ensure_column(
            &conn,
            "agent_messages",
            "fingerprint",
            "text not null default ''",
        )?;
        self.ensure_column(
            &conn,
            "agent_messages",
            "occurrence_count",
            "integer not null default 1",
        )?;
        self.ensure_column(
            &conn,
            "agent_messages",
            "first_seen_at",
            "text not null default ''",
        )?;
        self.ensure_column(
            &conn,
            "agent_messages",
            "last_seen_at",
            "text not null default ''",
        )?;
        self.ensure_column(
            &conn,
            "process_events",
            "fingerprint",
            "text not null default ''",
        )?;
        self.ensure_column(
            &conn,
            "process_events",
            "occurrence_count",
            "integer not null default 1",
        )?;
        self.ensure_column(
            &conn,
            "process_events",
            "first_seen_at",
            "text not null default ''",
        )?;
        self.ensure_column(
            &conn,
            "process_events",
            "last_seen_at",
            "text not null default ''",
        )?;
        conn.execute_batch(
            r#"
            create table if not exists codex_model_settings (
              run_id text primary key,
              provider_id text not null,
              updated_at text not null
            );
            "#,
        )?;
        Ok(())
    }

    fn ensure_indexes(&self) -> Result<()> {
        let conn = self.connect()?;
        conn.execute_batch(
            r#"
            create index if not exists idx_runs_activity on runs(last_activity_at desc);
            create index if not exists idx_tasks_status_id on tasks(run_id, status, id);
            create index if not exists idx_events_task on events(run_id, task_id, id);
            create index if not exists idx_reviews_task on reviews(run_id, task_id, id);
            create index if not exists idx_agent_sessions on agent_sessions(run_id, agent, started_at);
            create index if not exists idx_agent_sessions_run_status on agent_sessions(run_id, status);
            create index if not exists idx_agent_messages_session on agent_messages(run_id, session_id, id);
            create index if not exists idx_raw_transcripts_session on raw_transcripts(run_id, session_id, id);
            create index if not exists idx_process_events_session on process_events(run_id, session_id, id);
            create index if not exists idx_process_events_fp on process_events(run_id, fingerprint);
            "#,
        )?;
        Ok(())
    }

    fn ensure_column(&self, conn: &Connection, table: &str, column: &str, ddl: &str) -> Result<()> {
        let mut stmt = conn.prepare(&format!("pragma table_info('{table}')"))?;
        let mut exists = false;
        let rows = stmt.query_map([], |row| row.get::<_, String>("name"))?;
        for item in rows {
            let name = item?;
            if name == column {
                exists = true;
                break;
            }
        }
        if !exists {
            conn.execute(
                &format!("alter table {table} add column {column} {ddl}"),
                [],
            )?;
        }
        Ok(())
    }

    fn ensure_claude_mcp_config(&self) -> Result<()> {
        let config_path = self.runtime.join("claude-mcp.json");
        let sidecar = resolve_sidecar_path(&self.root)
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|| "teamflow-mcp".to_string());
        let mimo_env = select_mimo_env();
        let mut env_payload = serde_json::Map::new();
        env_payload.insert(
            "TEAMFLOW_ROOT".to_string(),
            json!(self.root.to_string_lossy().to_string()),
        );
        env_payload.insert(
            "USER_ROOT".to_string(),
            json!(env::var("USER_ROOT").unwrap_or_else(|_| r"C:\Users\28219".to_string())),
        );
        env_payload.insert("MIMO_BASE_URL".to_string(), json!(mimo_env.base_url.clone()));
        env_payload.insert(
            "ANTHROPIC_BASE_URL".to_string(),
            json!(mimo_env.base_url.clone()),
        );
        env_payload.insert("MIMO_MODEL".to_string(), json!(mimo_env.model.clone()));
        env_payload.insert("ANTHROPIC_MODEL".to_string(), json!(mimo_env.model.clone()));
        if let Some((_, key)) = mimo_env.mimo_api_key {
            env_payload.insert("MIMO_API_KEY".to_string(), json!(key));
        }
        if let Some((_, key)) = mimo_env.anthropic_auth_token {
            env_payload.insert("ANTHROPIC_AUTH_TOKEN".to_string(), json!(key));
        }

        let config = json!({
            "mcpServers": {
                "teamflow-desktop": {
                    "type": "stdio",
                    "command": sidecar,
                    "args": [],
                    "env": env_payload
                }
            }
        });
        fs::write(config_path, serde_json::to_string_pretty(&config)? + "\n")?;
        Ok(())
    }

    fn active_run(&self) -> Result<Option<String>> {
        if !self.active_run_path.exists() {
            return Ok(None);
        }
        let payload: Value = serde_json::from_str(&fs::read_to_string(&self.active_run_path)?)?;
        Ok(payload
            .get("currentRunId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned))
    }

    fn require_run(&self) -> Result<String> {
        self.active_run()?
            .ok_or_else(|| TeamflowError::Message("当前没有 active run。".to_string()))
    }

    fn write_active_run(&self, run_id: &str) -> Result<()> {
        let payload = json!({
            "currentRunId": run_id,
            "updatedAt": now()
        });
        fs::write(
            &self.active_run_path,
            serde_json::to_string_pretty(&payload)? + "\n",
        )?;
        Ok(())
    }

    fn create_run(&self) -> Result<Value> {
        let run_id = format!(
            "run-{}-{}",
            Utc::now().format("%Y%m%d-%H%M%S"),
            &Uuid::new_v4().to_string()[..6]
        );
        let created = now();
        let conn = self.connect()?;
        conn.execute(
            "insert into runs(id, title, created_at, updated_at, last_activity_at, project_goal) values (?1, '', ?2, ?2, ?2, '')",
            params![run_id, created],
        )?;
        self.write_active_run(&run_id)?;
        self.export_tasks_json()?;
        Ok(json!({"currentRunId": run_id, "createdAt": created}))
    }

    fn list_runs(&self, limit: i64) -> Result<Vec<RunSummary>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare(
            r#"
            select
              r.id,
              r.title,
              r.project_goal,
              r.created_at,
              r.updated_at,
              r.last_activity_at,
              (select count(1) from tasks t where t.run_id=r.id) as total,
              (select count(1) from tasks t where t.run_id=r.id and t.status='COMPLETED') as completed,
              (select count(1) from tasks t where t.run_id=r.id and t.status='IN_PROGRESS') as in_progress,
              (select count(1) from tasks t where t.run_id=r.id and t.status in ('LOCAL_FAILED','MIMO_REJECTED','DEGRADED_PASS','BLOCKED')) as failed,
              (
                exists(select 1 from tasks t where t.run_id=r.id)
                or exists(select 1 from events e where e.run_id=r.id)
                or exists(select 1 from reviews v where v.run_id=r.id)
                or exists(select 1 from agent_sessions s where s.run_id=r.id)
                or exists(select 1 from agent_messages m where m.run_id=r.id)
                or exists(select 1 from raw_transcripts rt where rt.run_id=r.id)
                or exists(select 1 from process_events pe where pe.run_id=r.id)
              ) as has_history
            from runs r
            order by r.last_activity_at desc, r.created_at desc
            limit ?1
            "#,
        )?;
        let rows = stmt.query_map(params![limit], |row| {
            let total: i64 = row.get("total")?;
            let completed: i64 = row.get("completed")?;
            let in_progress: i64 = row.get("in_progress")?;
            let failed: i64 = row.get("failed")?;
            let status = if in_progress > 0 {
                "RUNNING"
            } else if failed > 0 {
                "FAILED"
            } else if total > 0 && completed >= total {
                "COMPLETED"
            } else {
                "IDLE"
            };
            let has_history: i64 = row.get("has_history")?;
            Ok((RunSummary {
                run_id: row.get("id")?,
                title: row.get::<_, String>("title")?,
                project_goal: row.get("project_goal")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
                last_activity_at: row.get("last_activity_at")?,
                total,
                completed,
                in_progress,
                failed,
                status: status.to_string(),
            }, has_history))
        })?;
        let all_rows = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        let mut summaries = all_rows
            .into_iter()
            .filter(|(_, has_history)| *has_history > 0)
            .map(|(summary, _)| summary)
            .collect::<Vec<_>>();

        for summary in &mut summaries {
            summary.title = self
                .resolve_run_display_title(&conn, &summary.run_id, &summary.title, &summary.project_goal)?
                .unwrap_or_default();
            summary.project_goal = clean_display_text(&summary.project_goal, 120).unwrap_or_default();
        }

        Ok(summaries)
    }

    fn list_runs_grouped(&self, limit_per_group: i64) -> Result<Vec<RunGroup>> {
        let limit_per_group = limit_per_group.max(1);
        let runs = self.list_runs(300)?;
        let conn = self.connect()?;
        let mut groups: HashMap<String, Vec<RunSummary>> = HashMap::new();
        for run in runs {
            let group = self.resolve_run_group(&conn, &run.run_id)?;
            groups.entry(group).or_default().push(run);
        }

        let mut group_names = groups.keys().cloned().collect::<Vec<_>>();
        group_names.sort();
        let mut output = Vec::new();
        for group in group_names {
            if let Some(mut items) = groups.remove(&group) {
                items.sort_by(|a, b| b.last_activity_at.cmp(&a.last_activity_at));
                let has_more = items.len() as i64 > limit_per_group;
                let limited = items
                    .into_iter()
                    .take(limit_per_group as usize)
                    .collect::<Vec<_>>();
                output.push(RunGroup {
                    group,
                    runs: limited,
                    has_more,
                    cursor: None,
                });
            }
        }
        Ok(output)
    }

    fn resolve_run_group(&self, conn: &Connection, run_id: &str) -> Result<String> {
        let mut process_events = conn.prepare(
            "select payload from process_events where run_id=?1 order by id desc limit 100",
        )?;
        let process_rows = process_events.query_map(params![run_id], |row| row.get::<_, String>(0))?;
        for row in process_rows {
            let payload = row?;
            if let Some(group) = self.extract_group_from_payload(&payload) {
                return Ok(group);
            }
        }

        let mut messages = conn.prepare(
            "select text from agent_messages where run_id=?1 and kind in ('file_change','file_write','file_read','tool_call','mcp') order by id desc limit 100",
        )?;
        let message_rows = messages.query_map(params![run_id], |row| row.get::<_, String>(0))?;
        for row in message_rows {
            let text = row?;
            if let Some(group) = self.extract_group_from_text(&text) {
                return Ok(group);
            }
        }

        let mut scopes = conn.prepare(
            "select scope from tasks where run_id=?1 and scope <> '' order by updated_at desc, id desc limit 100",
        )?;
        let scope_rows = scopes.query_map(params![run_id], |row| row.get::<_, String>(0))?;
        for row in scope_rows {
            let scope = row?;
            if let Some(group) = self.normalize_group_path(&scope) {
                return Ok(group);
            }
        }

        Ok(RUN_GROUP_UNGROUPED.to_string())
    }

    fn extract_group_from_payload(&self, payload: &str) -> Option<String> {
        let value: Value = serde_json::from_str(payload).ok()?;
        let file = value
            .get("file")
            .and_then(Value::as_str)
            .or_else(|| value.get("path").and_then(Value::as_str))
            .or_else(|| value.get("payload").and_then(|v| v.get("file")).and_then(Value::as_str))
            .or_else(|| value.get("payload").and_then(|v| v.get("path")).and_then(Value::as_str))?;
        self.normalize_group_path(file)
    }

    fn extract_group_from_text(&self, text: &str) -> Option<String> {
        self.normalize_group_path(text)
    }

    fn normalize_group_path(&self, raw: &str) -> Option<String> {
        let cleaned = raw
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .trim_matches('`');
        if cleaned.is_empty()
            || cleaned.contains('\n')
            || cleaned.contains('\r')
            || cleaned.contains("://")
            || looks_like_log_prefix(cleaned)
        {
            return None;
        }
        let cleaned = cleaned.replace('/', "\\");
        let path = PathBuf::from(&cleaned);
        if path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
        {
            return None;
        }
        let relative = if path.is_absolute() {
            path.strip_prefix(&self.workspace).ok().map(PathBuf::from)
        } else {
            if cleaned.contains(':') {
                return None;
            }
            Some(path)
        }?;
        let parent = relative.parent()?;
        let group = parent.to_string_lossy().replace('/', "\\");
        if group.trim().is_empty() || group == "." {
            Some(RUN_GROUP_UNGROUPED.to_string())
        } else {
            let segments = group
                .split('\\')
                .filter(|segment| !segment.trim().is_empty() && *segment != ".")
                .collect::<Vec<_>>();
            if segments.is_empty() {
                Some(RUN_GROUP_UNGROUPED.to_string())
            } else if segments.len() == 1 {
                Some(segments[0].to_string())
            } else {
                Some(segments.join("\\"))
            }
        }
    }

    fn switch_run(&self, run_id: &str) -> Result<Value> {
        let conn = self.connect()?;
        let exists = conn
            .query_row("select id from runs where id=?1", params![run_id], |row| {
                row.get::<_, String>(0)
            })
            .optional()?;
        if exists.is_none() {
            return Err(TeamflowError::Message(format!("找不到会话：{run_id}")));
        }
        self.write_active_run(run_id)?;
        self.ensure_claude_mcp_config()?;
        self.export_tasks_json()?;
        Ok(json!({"currentRunId": run_id, "switchedAt": now()}))
    }

    fn get_run_overview(&self, run_id: &str) -> Result<Value> {
        let summary = self
            .list_runs(500)?
            .into_iter()
            .find(|item| item.run_id == run_id)
            .ok_or_else(|| TeamflowError::Message(format!("找不到会话：{run_id}")))?;
        Ok(serde_json::to_value(summary)?)
    }

    fn touch_run(&self, run_id: &str) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "update runs set updated_at=?1, last_activity_at=?1 where id=?2",
            params![now(), run_id],
        )?;
        Ok(())
    }

    fn update_run_title_if_empty(&self, run_id: &str, text: &str) -> Result<()> {
        let conn = self.connect()?;
        let title: String = conn
            .query_row(
                "select title from runs where id=?1",
                params![run_id],
                |row| row.get(0),
            )
            .unwrap_or_default();
        if title.trim().is_empty() {
            if let Some(clean_title) = clean_display_text(text, 40) {
                conn.execute(
                    "update runs set title=?1, updated_at=?2 where id=?3",
                    params![clean_title, now(), run_id],
                )?;
            }
        }
        Ok(())
    }

    fn resolve_run_display_title(
        &self,
        conn: &Connection,
        run_id: &str,
        stored_title: &str,
        project_goal: &str,
    ) -> Result<Option<String>> {
        if let Some(title) = clean_display_text(stored_title, 60) {
            return Ok(Some(title));
        }
        if let Some(goal) = clean_display_text(project_goal, 80) {
            return Ok(Some(goal));
        }

        let mut stmt = conn.prepare(
            "select title, goal from tasks where run_id=?1 order by updated_at desc, id desc limit 100",
        )?;
        let rows = stmt.query_map(params![run_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (task_title, task_goal) = row?;
            if let Some(title) = clean_display_text(&task_title, 60) {
                return Ok(Some(title));
            }
            if let Some(goal) = clean_display_text(&task_goal, 80) {
                return Ok(Some(goal));
            }
        }
        Ok(None)
    }

    fn add_event_for_run(
        &self,
        run_id: &str,
        event_type: &str,
        task_id: Option<&str>,
        agent: Option<&str>,
        message: &str,
        payload: Value,
    ) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "insert into events(run_id, at, type, task_id, agent, message, payload) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                run_id,
                now(),
                event_type,
                task_id,
                agent,
                message,
                serde_json::to_string(&payload)?
            ],
        )?;
        self.touch_run(run_id)?;
        Ok(())
    }

    fn add_event(
        &self,
        event_type: &str,
        task_id: Option<&str>,
        agent: Option<&str>,
        message: &str,
        payload: Value,
    ) -> Result<()> {
        let run_id = self.require_run()?;
        self.add_event_for_run(&run_id, event_type, task_id, agent, message, payload)
    }

    fn append_process_event_for_run(
        &self,
        run_id: &str,
        session_id: Option<&str>,
        agent: Option<&str>,
        event_type: &str,
        message: &str,
        task_id: Option<&str>,
        payload: Value,
    ) -> Result<Value> {
        let mut payload_obj = payload;
        if let Some(task) = task_id {
            payload_obj["taskId"] = Value::String(task.to_string());
        }
        let fingerprint = build_fingerprint(
            run_id,
            session_id,
            event_type,
            task_id,
            &normalize_text(message),
        );
        let conn = self.connect()?;
        let existing: Option<(i64, i64, String)> = conn
            .query_row(
                "select id, occurrence_count, first_seen_at from process_events where run_id=?1 and fingerprint=?2 limit 1",
                params![run_id, &fingerprint],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let now_at = now();
        let row_id = if let Some((id, count, first_seen)) = existing {
            conn.execute(
                "update process_events set occurrence_count=?1, last_seen_at=?2, created_at=?2, payload=?3, message=?4, session_id=?5, agent=?6 where id=?7",
                params![
                    count + 1,
                    now_at,
                    serde_json::to_string(&payload_obj)?,
                    message,
                    session_id,
                    agent,
                    id
                ],
            )?;
            if first_seen.is_empty() {
                conn.execute(
                    "update process_events set first_seen_at=?1 where id=?2",
                    params![now_at, id],
                )?;
            }
            id
        } else {
            conn.execute(
                "insert into process_events(run_id, session_id, agent, type, message, created_at, payload, fingerprint, occurrence_count, first_seen_at, last_seen_at) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?6, ?6)",
                params![
                    run_id,
                    session_id,
                    agent,
                    event_type,
                    message,
                    now_at,
                    serde_json::to_string(&payload_obj)?,
                    fingerprint
                ],
            )?;
            conn.last_insert_rowid()
        };
        self.touch_run(run_id)?;
        Ok(json!({"id": row_id}))
    }

    fn append_process_event(
        &self,
        session_id: Option<&str>,
        agent: Option<&str>,
        event_type: &str,
        message: &str,
        task_id: Option<&str>,
        payload: Value,
    ) -> Result<Value> {
        let run_id = self.require_run()?;
        self.append_process_event_for_run(
            &run_id,
            session_id,
            agent,
            event_type,
            message,
            task_id,
            payload,
        )
    }

    fn start_session_for_run(&self, run_id: &str, agent: &str, prompt: Option<&str>) -> Result<String> {
        let session_id = format!("{agent}-{}", Uuid::new_v4());
        let conn = self.connect()?;
        conn.execute(
            "insert into agent_sessions(id, run_id, agent, status, started_at, prompt) values (?1, ?2, ?3, 'RUNNING', ?4, ?5)",
            params![session_id, run_id, agent, now(), prompt],
        )?;
        self.touch_run(run_id)?;
        Ok(session_id)
    }

    fn ensure_codex_bridge_session_for_run(&self, run_id: &str) -> Result<String> {
        let conn = self.connect()?;
        let existing = conn
            .query_row(
                r#"
                select id
                from agent_sessions
                where run_id=?1 and agent='codex'
                order by
                  case when prompt='Codex 常驻桥接会话' then 0 else 1 end,
                  started_at desc
                limit 1
                "#,
                params![run_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;

        let session_id = if let Some(session_id) = existing {
            conn.execute(
                "update agent_sessions set status='RUNNING', ended_at=null, last_error=null, prompt='Codex 常驻桥接会话' where run_id=?1 and id=?2",
                params![run_id, session_id],
            )?;
            session_id
        } else {
            drop(conn);
            return self.start_session_for_run(run_id, "codex", Some("Codex 常驻桥接会话"));
        };

        conn.execute(
            "update agent_sessions set status='COMPLETED', ended_at=coalesce(ended_at, ?3), last_error=coalesce(last_error, '已合并到本会话 Codex bridge。') where run_id=?1 and agent='codex' and id<>?2 and status='RUNNING'",
            params![run_id, session_id, now()],
        )?;
        self.touch_run(run_id)?;
        Ok(session_id)
    }

    fn finish_session_for_run(
        &self,
        run_id: &str,
        session_id: &str,
        status: &str,
        last_error: Option<&str>,
    ) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "update agent_sessions set status=?1, ended_at=?2, last_error=?3 where run_id=?4 and id=?5",
            params![status, now(), last_error, run_id, session_id],
        )?;
        self.touch_run(run_id)?;
        Ok(())
    }

    fn session_status_for_run(&self, run_id: &str, session_id: &str) -> Result<Option<String>> {
        let conn = self.connect()?;
        conn.query_row(
            "select status from agent_sessions where run_id=?1 and id=?2",
            params![run_id, session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(Into::into)
    }

    fn append_transcript_for_run(
        &self,
        run_id: &str,
        session_id: &str,
        agent: &str,
        stream: &str,
        chunk: &str,
    ) -> Result<()> {
        let conn = self.connect()?;
        conn.execute(
            "insert into raw_transcripts(run_id, session_id, agent, stream, chunk, created_at) values (?1, ?2, ?3, ?4, ?5, ?6)",
            params![run_id, session_id, agent, stream, chunk, now()],
        )?;
        self.touch_run(run_id)?;
        Ok(())
    }

    fn append_agent_message_for_run(
        &self,
        run_id: &str,
        session_id: &str,
        agent: &str,
        role: &str,
        kind: &str,
        text: &str,
        task_id: Option<&str>,
    ) -> Result<AgentMessage> {
        let normalized = normalize_text(text);
        let fingerprint = build_fingerprint(run_id, Some(session_id), kind, task_id, &normalized);
        let now_at = now();
        let conn = self.connect()?;
        let existing = conn
            .query_row(
                "select id, occurrence_count, first_seen_at from agent_messages where run_id=?1 and fingerprint=?2 limit 1",
                params![run_id, &fingerprint],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        let id = if let Some((id, count, first_seen)) = existing {
            conn.execute(
                "update agent_messages set occurrence_count=?1, last_seen_at=?2, created_at=?2, text=?3, role=?4, kind=?5, task_id=?6 where id=?7",
                params![count + 1, now_at, text, role, kind, task_id, id],
            )?;
            if first_seen.is_empty() {
                conn.execute(
                    "update agent_messages set first_seen_at=?1 where id=?2",
                    params![now_at, id],
                )?;
            }
            id
        } else {
            conn.execute(
                "insert into agent_messages(run_id, session_id, agent, role, kind, text, task_id, created_at, fingerprint, occurrence_count, first_seen_at, last_seen_at) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?8, ?8)",
                params![run_id, session_id, agent, role, kind, text, task_id, now_at, fingerprint],
            )?;
            conn.last_insert_rowid()
        };
        self.touch_run(run_id)?;
        self.load_agent_message(id)
    }

    fn load_agent_message(&self, id: i64) -> Result<AgentMessage> {
        let conn = self.connect()?;
        conn.query_row(
            "select id, run_id, session_id, agent, role, kind, text, task_id, created_at, occurrence_count, first_seen_at, last_seen_at from agent_messages where id=?1",
            params![id],
            |row| {
                Ok(AgentMessage {
                    id: row.get("id")?,
                    run_id: row.get("run_id")?,
                    session_id: row.get("session_id")?,
                    agent: row.get("agent")?,
                    role: row.get("role")?,
                    kind: row.get("kind")?,
                    text: row.get("text")?,
                    task_id: row.get("task_id")?,
                    created_at: row.get("created_at")?,
                    occurrence_count: row.get("occurrence_count")?,
                    first_seen_at: row.get("first_seen_at")?,
                    last_seen_at: row.get("last_seen_at")?,
                })
            },
        )
        .map_err(Into::into)
    }

    fn claimable_tasks_all_runs(&self) -> Result<Vec<ClaimableTask>> {
        let conn = self.connect()?;
        let mut statement = conn.prepare(
            r#"
            select t.*
            from tasks t
            where t.status in ('PENDING','LOCAL_FAILED','MIMO_REJECTED')
              and not exists(
                select 1 from tasks blocker
                where blocker.run_id=t.run_id
                      and blocker.status in ('IN_PROGRESS','REVIEW_PENDING','DEGRADED_PASS','BLOCKED')
              )
            order by t.updated_at asc, t.id asc
            "#,
        )?;
        let rows = statement
            .query_map([], row_to_task)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows
            .into_iter()
            .map(|task| ClaimableTask {
                run_id: task.run_id.clone(),
                task,
            })
            .collect())
    }

    fn cancel_task(&self, task_id: &str, reason: &str) -> Result<Task> {
        let run_id = self.require_run()?;
        let conn = self.connect()?;
        conn.execute(
            "update tasks set status='CANCELLED', last_error=?1, updated_at=?2 where run_id=?3 and id=?4 and status not in ('COMPLETED','CANCELLED')",
            params![reason, now(), run_id, task_id],
        )?;
        self.add_event(
            "task_cancelled",
            Some(task_id),
            Some("codex"),
            reason,
            json!({"reason": reason}),
        )?;
        self.get_task(task_id)?
            .ok_or_else(|| TeamflowError::Message(format!("未知任务：{task_id}")))
    }

    fn get_task(&self, task_id: &str) -> Result<Option<Task>> {
        let run_id = self.require_run()?;
        let conn = self.connect()?;
        conn.query_row(
            "select * from tasks where run_id=?1 and id=?2",
            params![run_id, task_id],
            row_to_task,
        )
        .optional()
        .map_err(Into::into)
    }

    fn get_task_for_run(&self, run_id: &str, task_id: &str) -> Result<Option<Task>> {
        let conn = self.connect()?;
        conn.query_row(
            "select * from tasks where run_id=?1 and id=?2",
            params![run_id, task_id],
            row_to_task,
        )
        .optional()
        .map_err(Into::into)
    }

    fn latest_running_session(&self, agent: &str) -> Result<Option<String>> {
        let run_id = self.require_run()?;
        let conn = self.connect()?;
        conn.query_row(
            "select id from agent_sessions where run_id=?1 and agent=?2 and status='RUNNING' order by started_at desc limit 1",
            params![run_id, agent],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(Into::into)
    }

    fn latest_running_session_for_run(&self, run_id: &str, agent: &str) -> Result<Option<String>> {
        let conn = self.connect()?;
        conn.query_row(
            "select id from agent_sessions where run_id=?1 and agent=?2 and status='RUNNING' order by started_at desc limit 1",
            params![run_id, agent],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(Into::into)
    }

    fn latest_session_state_for_run(&self, run_id: &str, agent: &str) -> Result<String> {
        let conn = self.connect()?;
        let state = conn
            .query_row(
                "select status from agent_sessions where run_id=?1 and agent=?2 order by started_at desc limit 1",
                params![run_id, agent],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(state.unwrap_or_else(|| "IDLE".to_string()))
    }

    fn status_snapshot_for_run(&self, run_id: &str) -> Result<Value> {
        let conn = self.connect()?;
        let codex_provider_id = self.codex_model_provider_id_for_run(run_id)?;

        let tasks: Vec<Task> = {
            let mut statement = conn.prepare("select * from tasks where run_id=?1 order by id")?;
            let rows = statement
                .query_map(params![run_id], row_to_task)?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            rows
        };

        let events = query_json_rows(
            &conn,
            "select id, at, type, task_id, agent, message, payload from events where run_id=?1 order by id desc limit 40",
            params![run_id],
            event_row_json,
        )?
        .into_iter()
        .rev()
        .collect::<Vec<_>>();

        let deduped_events = query_json_rows(
            &conn,
            "select id, session_id, agent, type, message, payload, created_at, occurrence_count, first_seen_at, last_seen_at from process_events where run_id=?1 order by id desc limit 120",
            params![run_id],
            process_event_row_json,
        )?
        .into_iter()
        .rev()
        .collect::<Vec<_>>();

        let reviews = query_json_rows(
            &conn,
            "select id, at, task_id, kind, status, summary, payload from reviews where run_id=?1 order by id desc limit 30",
            params![run_id],
            review_row_json,
        )?
        .into_iter()
        .rev()
        .collect::<Vec<_>>();

        let messages = query_json_rows(
            &conn,
            "select id, run_id, session_id, agent, role, kind, text, task_id, created_at, occurrence_count, first_seen_at, last_seen_at from agent_messages where run_id=?1 order by id desc limit 120",
            params![run_id],
            message_row_json,
        )?
        .into_iter()
        .rev()
        .collect::<Vec<_>>();

        let project_goal: String = conn
            .query_row(
                "select project_goal from runs where id=?1",
                params![run_id],
                |row| row.get(0),
            )
            .unwrap_or_default();

        let mut counts = serde_json::Map::new();
        for status in TASK_STATUSES {
            counts.insert(status.to_string(), json!(0));
        }
        for task in &tasks {
            let value = counts.get(&task.status).and_then(Value::as_i64).unwrap_or(0) + 1;
            counts.insert(task.status.clone(), json!(value));
        }
        counts.insert("total".to_string(), json!(tasks.len()));

        let done = counts.get("COMPLETED").and_then(Value::as_i64).unwrap_or(0);
        let progress = if tasks.is_empty() {
            0
        } else {
            ((done as f64 / tasks.len() as f64) * 100.0).round() as i64
        };

        let current_task = tasks
            .iter()
            .find(|task| task.status == "IN_PROGRESS")
            .or_else(|| tasks.iter().find(|task| task.status == "REVIEW_PENDING"))
            .or_else(|| tasks.iter().find(|task| task.status == "MIMO_REJECTED"))
            .or_else(|| tasks.iter().find(|task| task.status == "LOCAL_FAILED"))
            .or_else(|| tasks.iter().find(|task| task.status == "BLOCKED"))
            .or_else(|| tasks.iter().find(|task| task.status == "DEGRADED_PASS"))
            .or_else(|| tasks.iter().find(|task| CLAIMABLE_STATUSES.contains(&task.status.as_str())));
        let current_task_value = current_task.map(|task| json!(task));
        let current_goal = current_task
            .map(|task| {
                if task.goal.trim().is_empty() {
                    project_goal.clone()
                } else {
                    task.goal.clone()
                }
            })
            .unwrap_or_else(|| project_goal.clone());
        let workflow_metrics = json!({
            "totalTasks": counts.get("total").and_then(Value::as_i64).unwrap_or(0),
            "completedTasks": counts.get("COMPLETED").and_then(Value::as_i64).unwrap_or(0),
            "exceptionTasks": counts.get("LOCAL_FAILED").and_then(Value::as_i64).unwrap_or(0)
                + counts.get("MIMO_REJECTED").and_then(Value::as_i64).unwrap_or(0)
                + counts.get("DEGRADED_PASS").and_then(Value::as_i64).unwrap_or(0)
                + counts.get("BLOCKED").and_then(Value::as_i64).unwrap_or(0),
            "progressPercent": progress,
            "deliveryProgress": counts.get("COMPLETED").and_then(Value::as_i64).unwrap_or(0),
            "currentGoal": current_goal,
            "currentTaskId": current_task.map(|task| task.id.clone()).unwrap_or_default(),
            "currentTaskTitle": current_task.map(|task| task.title.clone()).unwrap_or_default(),
        });
        let dashboard_pipeline = json!({
            "pending": tasks.iter().cloned().collect::<Vec<_>>(),
            "developing": tasks.iter().filter(|task| matches!(task.status.as_str(), "IN_PROGRESS" | "LOCAL_FAILED" | "MIMO_REJECTED" | "BLOCKED")).cloned().collect::<Vec<_>>(),
            "review": tasks.iter().filter(|task| matches!(task.status.as_str(), "REVIEW_PENDING" | "COMPLETED" | "DEGRADED_PASS" | "CANCELLED")).cloned().collect::<Vec<_>>(),
        });
        let claude_timeline_source = messages
            .iter()
            .filter(|message| message.get("agent").and_then(Value::as_str) == Some("claude"))
            .cloned()
            .collect::<Vec<_>>();

        let codex_active = self.latest_running_session_for_run(run_id, "codex")?;
        let claude_active = self.latest_running_session_for_run(run_id, "claude")?;
        let codex_state = self.latest_session_state_for_run(run_id, "codex")?;
        let claude_state = self.latest_session_state_for_run(run_id, "claude")?;

        Ok(json!({
            "currentRunId": run_id,
            "projectGoal": project_goal,
            "counts": counts,
            "progressPercent": progress,
            "currentTask": current_task_value,
            "tasks": tasks,
            "events": deduped_events,
            "rawEvents": events,
            "reviews": reviews,
            "agentMessages": messages,
            "dedupedEvents": deduped_events,
            "dedupedAgentMessages": messages,
            "activeCodexSessionId": codex_active,
            "activeClaudeSessionId": claude_active,
            "codexState": codex_state,
            "claudeWorkerState": claude_state,
            "workflowMetrics": workflow_metrics,
            "dashboardPipeline": dashboard_pipeline,
            "claudeTimelineSource": claude_timeline_source,
            "codexModelSelection": codex_model_selection_payload(&codex_provider_id),
            "tasksJson": self.tasks_json_path,
            "database": self.db_path,
            "workspace": self.workspace,
            "cliHealth": self.cli_health()
        }))
    }

    fn status_snapshot(&self) -> Result<Value> {
        let run_id = self.require_run()?;
        self.status_snapshot_for_run(&run_id)
    }

    fn default_ui_settings(&self) -> Value {
        json!({
            "workMode": "coding",
            "defaultPermissions": true,
            "fullAccess": true,
            "fileOpenDestination": "VS Code",
            "terminalShell": "PowerShell",
            "theme": "system",
            "language": "zh-CN",
            "browserEnabled": true,
            "computerUseEnabled": false,
            "personalName": "",
            "replyStyle": "balanced",
            "pluginMarketplace": true,
            "keyboardPreset": "default",
            "mcpEnabled": true,
            "hooksEnabled": false,
            "gitAutoDetect": true,
            "environmentProfile": "local",
            "worktreeMode": "single",
            "archivedVisible": false,
            "telemetryEnabled": false,
            "compactSidebar": false,
            "autoTitleRuns": true,
            "confirmBeforeDelete": true,
            "browserHeadless": true,
            "computerUseConfirm": true,
            "hooksDirectory": "",
            "gitCommitStyle": "manual",
            "defaultBranchPrefix": "codex/",
            "petEnabled": false,
            "petStyle": "quiet"
        })
    }

    fn ui_settings(&self) -> Result<Value> {
        let defaults = self.default_ui_settings();
        if !self.ui_settings_path.exists() {
            return Ok(defaults);
        }
        let stored: Value = serde_json::from_str(&fs::read_to_string(&self.ui_settings_path)?)?;
        Ok(merge_json_objects(defaults, stored))
    }

    fn write_ui_settings(&self, settings: Value) -> Result<Value> {
        let merged = merge_json_objects(self.default_ui_settings(), settings);
        fs::write(
            &self.ui_settings_path,
            serde_json::to_string_pretty(&merged)? + "\n",
        )?;
        Ok(merged)
    }

    fn set_ui_setting(&self, key: &str, value: Value) -> Result<Value> {
        if key.trim().is_empty() {
            return Err(TeamflowError::Message("设置键不能为空。".to_string()));
        }
        let mut settings = self.ui_settings()?;
        let object = settings
            .as_object_mut()
            .ok_or_else(|| TeamflowError::Message("设置格式无效。".to_string()))?;
        object.insert(key.to_string(), value);
        self.write_ui_settings(settings)
    }

    fn codex_model_provider_id_for_run(&self, run_id: &str) -> Result<String> {
        let conn = self.connect()?;
        let provider_id = conn
            .query_row(
                "select provider_id from codex_model_settings where run_id=?1",
                params![run_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .unwrap_or_else(|| CODEX_DEFAULT_PROVIDER_ID.to_string());
        Ok(normalize_codex_model_provider_id(&provider_id))
    }

    fn set_codex_model_provider_for_run(&self, run_id: &str, provider_id: &str) -> Result<Value> {
        let provider_id = normalize_codex_model_provider_id(provider_id);
        let conn = self.connect()?;
        conn.execute(
            r#"
            insert into codex_model_settings(run_id, provider_id, updated_at)
            values (?1, ?2, ?3)
            on conflict(run_id) do update set
              provider_id=excluded.provider_id,
              updated_at=excluded.updated_at
            "#,
            params![run_id, provider_id, now()],
        )?;
        self.touch_run(run_id)?;
        Ok(codex_model_selection_payload(&provider_id))
    }

    fn cli_health(&self) -> Value {
        let codex_paths = resolve_codex_launch_paths();
        let codex_path = codex_paths.as_ref().map(|paths| {
            format!(
                "{} -> {}",
                paths.node_exe.to_string_lossy(),
                paths.codex_js.to_string_lossy()
            )
        });
        let claude_path = resolve_command_path(&["claude", "claude.cmd", "claude.exe"])
            .map(|path| path.to_string_lossy().to_string());
        let sidecar_path =
            resolve_sidecar_path(&self.root).map(|path| path.to_string_lossy().to_string());
        let mut notes = Vec::new();

        if codex_paths.is_none() {
            notes.push("未找到 Codex CLI，请确认 node.exe 与 @openai/codex 已正确安装。");
        }
        if claude_path.is_none() {
            notes.push("未找到 Claude Code CLI，请确认 claude 已安装并可在 PATH 中使用。");
        }
        if sidecar_path.is_none() {
            notes.push("未找到 Teamflow MCP sidecar，请先运行 npm run prepare:sidecar。");
        }
        let mimo_env = select_mimo_env();
        let mimo_key_name = mimo_env.mimo_api_key.as_ref().map(|(name, _)| name.clone());
        let anthropic_key_name = mimo_env
            .anthropic_auth_token
            .as_ref()
            .map(|(name, _)| name.clone());
        let mimo_key = mimo_env.mimo_api_key.is_some() || mimo_env.anthropic_auth_token.is_some();
        if !mimo_key {
            notes.push("未检测到 MiMo API key，MiMo 审查将无法完成。");
        }

        json!({
            "codex": codex_path.is_some(),
            "claude": claude_path.is_some(),
            "mimoKey": mimo_key,
            "mimoKeySource": mimo_key_name,
            "mimoApiKeyPresent": mimo_env.mimo_api_key.is_some(),
            "anthropicAuthTokenPresent": mimo_env.anthropic_auth_token.is_some(),
            "anthropicAuthTokenSource": anthropic_key_name,
            "mimoBaseUrl": mimo_env.base_url,
            "mimoModel": mimo_env.model,
            "codexPath": codex_path,
            "claudePath": claude_path,
            "sidecarPrepared": sidecar_path.is_some(),
            "sidecarPath": sidecar_path,
            "notes": notes
        })
    }

    fn export_tasks_json_for_run(&self, run_id: &str) -> Result<Value> {
        let snapshot = self.status_snapshot_for_run(run_id)?;
        let data = json!({
            "currentRunId": snapshot["currentRunId"],
            "projectGoal": snapshot["projectGoal"],
            "exportedAt": now(),
            "sourceOfTruth": "sqlite",
            "database": self.db_path,
            "tasks": snapshot["tasks"],
            "counts": snapshot["counts"],
            "progressPercent": snapshot["progressPercent"]
        });
        fs::write(
            &self.tasks_json_path,
            serde_json::to_string_pretty(&data)? + "\n",
        )?;
        Ok(data)
    }

    fn export_tasks_json(&self) -> Result<Value> {
        let run_id = self.require_run()?;
        self.export_tasks_json_for_run(&run_id)
    }

    fn diagnostics_for_run(&self, run_id: &str, session_id: &str) -> Result<Value> {
        let conn = self.connect()?;
        let session = conn
            .query_row(
                "select id, agent, status, started_at, ended_at, prompt, last_error from agent_sessions where run_id=?1 and id=?2",
                params![run_id, session_id],
                |row| {
                    Ok(json!({
                        "sessionId": row.get::<_, String>("id")?,
                        "agent": row.get::<_, String>("agent")?,
                        "status": row.get::<_, String>("status")?,
                        "startedAt": row.get::<_, String>("started_at")?,
                        "endedAt": row.get::<_, Option<String>>("ended_at")?,
                        "prompt": row.get::<_, Option<String>>("prompt")?,
                        "lastError": row.get::<_, Option<String>>("last_error")?,
                    }))
                },
            )
            .optional()?
            .ok_or_else(|| TeamflowError::Message(format!("找不到会话：{session_id}")))?;

        let transcripts = query_json_rows(
            &conn,
            "select id, session_id, agent, stream, chunk, created_at from raw_transcripts where run_id=?1 and session_id=?2 order by id",
            params![run_id, session_id],
            transcript_row_json,
        )?;
        let process_events = query_json_rows(
            &conn,
            "select id, session_id, agent, type, message, payload, created_at, occurrence_count, first_seen_at, last_seen_at from process_events where run_id=?1 and session_id=?2 order by id",
            params![run_id, session_id],
            process_event_row_json,
        )?;

        let key_actions = process_events
            .iter()
            .filter(|row| {
                row.get("type")
                    .and_then(Value::as_str)
                    .map(|kind| {
                        matches!(
                            kind,
                            "thinking_started"
                                | "thinking_updated"
                                | "thinking_ended"
                                | "tool_call"
                                | "command_started"
                                | "command_finished"
                                | "file_read"
                                | "file_written"
                                | "task_delegated"
                                | "task_claimed"
                                | "review_local"
                                | "review_mimo"
                                | "session_interrupted"
                                | "session_completed"
                                | "session_failed"
                        )
                    })
                    .unwrap_or(false)
            })
            .cloned()
            .collect::<Vec<_>>();

        let mcp_calls = process_events
            .iter()
            .filter(|row| row.get("type").and_then(Value::as_str) == Some("tool_call"))
            .cloned()
            .collect::<Vec<_>>();
        let local_verification = process_events
            .iter()
            .filter(|row| row.get("type").and_then(Value::as_str) == Some("review_local"))
            .cloned()
            .collect::<Vec<_>>();
        let mimo_reviews = process_events
            .iter()
            .filter(|row| row.get("type").and_then(Value::as_str) == Some("review_mimo"))
            .cloned()
            .collect::<Vec<_>>();
        let stderr = transcripts
            .iter()
            .filter(|row| row.get("stream").and_then(Value::as_str) == Some("stderr"))
            .cloned()
            .collect::<Vec<_>>();
        let exit_info = process_events
            .iter()
            .rev()
            .find(|row| {
                matches!(
                    row.get("type").and_then(Value::as_str),
                    Some("session_completed" | "session_failed" | "session_interrupted")
                )
            })
            .cloned();

        Ok(json!({
            "sessionId": session_id,
            "sessionInfo": {
                "agent": session["agent"],
                "status": session["status"],
                "startedAt": session["startedAt"],
                "endedAt": session["endedAt"],
                "prompt": session["prompt"],
                "lastError": session["lastError"],
                "exit": exit_info
            },
            "keyActions": key_actions,
            "mcpCalls": mcp_calls,
            "localVerification": local_verification,
            "mimoReviews": mimo_reviews,
            "stderr": stderr,
            "rawTranscripts": transcripts,
            "processEvents": process_events
        }))
    }

    fn diagnostics(&self, session_id: &str) -> Result<Value> {
        let run_id = self.require_run()?;
        self.diagnostics_for_run(&run_id, session_id)
    }

    fn delete_run_data(&self, run_id: &str) -> Result<HashMap<String, i64>> {
        let conn = self.connect()?;
        conn.execute_batch("begin immediate")?;

        let mut deleted = HashMap::new();
        let tables = vec![
            "tasks",
            "events",
            "reviews",
            "agent_sessions",
            "agent_messages",
            "raw_transcripts",
            "process_events",
            "runs",
        ];

        for table in &tables {
            let sql = format!("delete from {table} where run_id=?1");
            let rows = if *table == "runs" {
                conn.execute("delete from runs where id=?1", params![run_id])?
            } else {
                conn.execute(&sql, params![run_id])?
            };
            deleted.insert((*table).to_string(), rows as i64);
        }
        conn.execute_batch("commit")?;
        Ok(deleted)
    }

    fn most_recent_run(&self) -> Result<Option<String>> {
        let conn = self.connect()?;
        conn.query_row(
            "select id from runs order by last_activity_at desc, created_at desc limit 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(Into::into)
    }

    fn worker_pool_summary(&self, paused: bool, running: bool) -> Result<WorkerPoolSummary> {
        let conn = self.connect()?;
        let mut statement = conn.prepare(
            r#"
            select
              r.id as run_id,
              (select count(1) from agent_sessions s where s.run_id=r.id and s.agent='claude' and s.status='RUNNING') as running,
              (select count(1) from tasks t where t.run_id=r.id and t.status in ('PENDING','LOCAL_FAILED','MIMO_REJECTED')
                and not exists(
                  select 1 from tasks blocker
                    where blocker.run_id=t.run_id
                      and blocker.status in ('IN_PROGRESS','REVIEW_PENDING','DEGRADED_PASS','BLOCKED')
                )) as queued,
              (select count(1) from tasks t where t.run_id=r.id and t.status in ('LOCAL_FAILED','MIMO_REJECTED','DEGRADED_PASS','BLOCKED')) as failed
            from runs r
            order by r.last_activity_at desc
            "#,
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok(RunWorkerSummary {
                    run_id: row.get("run_id")?,
                    running: row.get("running")?,
                    queued: row.get("queued")?,
                    failed: row.get("failed")?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let global_running = rows.iter().map(|item| item.running).sum::<i64>();
        let running_runs = rows.iter().filter(|item| item.running > 0).count() as i64;
        let queued_runs = rows.iter().filter(|item| item.queued > 0).count() as i64;
        let state = if paused {
            "PAUSED"
        } else if running {
            "RUNNING"
        } else {
            "IDLE"
        };
        Ok(WorkerPoolSummary {
            state: state.to_string(),
            global_running,
            global_cap: WORKER_GLOBAL_CAP_DEFAULT as i64,
            per_run_cap: WORKER_PER_RUN_CAP_DEFAULT as i64,
            queued_runs,
            running_runs,
            per_run: rows,
        })
    }
}

fn row_to_task(row: &Row<'_>) -> rusqlite::Result<Task> {
    let acceptance: String = row.get("acceptance_criteria")?;
    let verify: String = row.get("verify_commands")?;
    Ok(Task {
        run_id: row.get("run_id")?,
        id: row.get("id")?,
        title: row.get("title")?,
        goal: row.get("goal")?,
        scope: row.get("scope")?,
        acceptance_criteria: serde_json::from_str(&acceptance).unwrap_or_default(),
        verify_commands: serde_json::from_str(&verify).unwrap_or_default(),
        status: row.get("status")?,
        assigned_agent: row.get("assigned_agent")?,
        attempts: row.get("attempts")?,
        max_attempts: row.get("max_attempts")?,
        last_error: row.get("last_error")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn query_json_rows<P, F>(
    conn: &Connection,
    sql: &str,
    params: P,
    mut mapper: F,
) -> Result<Vec<Value>>
where
    P: rusqlite::Params,
    F: FnMut(&Row<'_>) -> rusqlite::Result<Value>,
{
    let mut statement = conn.prepare(sql)?;
    let rows = statement
        .query_map(params, |row| mapper(row))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn event_row_json(row: &Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, i64>("id")?,
        "at": row.get::<_, String>("at")?,
        "type": row.get::<_, String>("type")?,
        "taskId": row.get::<_, Option<String>>("task_id")?,
        "agent": row.get::<_, Option<String>>("agent")?,
        "message": row.get::<_, Option<String>>("message")?,
        "payload": parse_json(row.get::<_, String>("payload")?)
    }))
}

fn review_row_json(row: &Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, i64>("id")?,
        "at": row.get::<_, String>("at")?,
        "taskId": row.get::<_, String>("task_id")?,
        "kind": row.get::<_, String>("kind")?,
        "status": row.get::<_, String>("status")?,
        "summary": row.get::<_, String>("summary")?,
        "payload": parse_json(row.get::<_, String>("payload")?)
    }))
}

fn message_row_json(row: &Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, i64>("id")?,
        "runId": row.get::<_, String>("run_id")?,
        "sessionId": row.get::<_, String>("session_id")?,
        "agent": row.get::<_, String>("agent")?,
        "role": row.get::<_, String>("role")?,
        "kind": row.get::<_, String>("kind")?,
        "text": row.get::<_, String>("text")?,
        "taskId": row.get::<_, Option<String>>("task_id")?,
        "createdAt": row.get::<_, String>("created_at")?,
        "occurrenceCount": row.get::<_, i64>("occurrence_count")?,
        "firstSeenAt": row.get::<_, String>("first_seen_at")?,
        "lastSeenAt": row.get::<_, String>("last_seen_at")?
    }))
}

fn transcript_row_json(row: &Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, i64>("id")?,
        "sessionId": row.get::<_, String>("session_id")?,
        "agent": row.get::<_, String>("agent")?,
        "stream": row.get::<_, String>("stream")?,
        "chunk": row.get::<_, String>("chunk")?,
        "createdAt": row.get::<_, String>("created_at")?
    }))
}

fn process_event_row_json(row: &Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, i64>("id")?,
        "sessionId": row.get::<_, Option<String>>("session_id")?,
        "agent": row.get::<_, Option<String>>("agent")?,
        "type": row.get::<_, String>("type")?,
        "message": row.get::<_, String>("message")?,
        "payload": parse_json(row.get::<_, String>("payload")?),
        "createdAt": row.get::<_, String>("created_at")?,
        "occurrenceCount": row.get::<_, i64>("occurrence_count")?,
        "firstSeenAt": row.get::<_, String>("first_seen_at")?,
        "lastSeenAt": row.get::<_, String>("last_seen_at")?
    }))
}

fn parse_json(text: String) -> Value {
    serde_json::from_str(&text).unwrap_or_else(|_| json!({}))
}

fn merge_json_objects(mut base: Value, overlay: Value) -> Value {
    if let (Some(base_obj), Some(overlay_obj)) = (base.as_object_mut(), overlay.as_object()) {
        for (key, value) in overlay_obj {
            base_obj.insert(key.clone(), value.clone());
        }
        return base;
    }
    overlay
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn env_var_any_scope(name: &str) -> Option<String> {
    if let Ok(value) = env::var(name) {
        if !value.trim().is_empty() {
            return Some(value);
        }
    }
    persistent_env_var_cached(name)
}

fn select_mimo_env() -> MimoEnvSelection {
    select_mimo_env_from_lookup(|name| env_var_any_scope(name))
}

fn codex_model_providers() -> Vec<CodexModelProvider> {
    let mimo_key_present = env_var_any_scope("MIMO_API_KEY")
        .or_else(|| env_var_any_scope("XIAOMI_MIMO_API_KEY"))
        .or_else(|| env_var_any_scope("MIMO_KEY"))
        .is_some();
    vec![
        CodexModelProvider {
            id: CODEX_DEFAULT_PROVIDER_ID.to_string(),
            label: "默认 GPT-5.5".to_string(),
            provider: "codex".to_string(),
            model: CODEX_DEFAULT_MODEL.to_string(),
            base_url: Some(CODEX_DEFAULT_OPENAI_BASE_URL.to_string()),
            anthropic_base_url: None,
            env_key: None,
            wire_api: Some(CODEX_DEFAULT_WIRE_API.to_string()),
            is_default: true,
            api_key_present: true,
        },
        CodexModelProvider {
            id: CODEX_MIMO_PROVIDER_ID.to_string(),
            label: "MiMo V2.5 Pro".to_string(),
            provider: "mimo".to_string(),
            model: CODEX_MIMO_MODEL.to_string(),
            base_url: Some(CODEX_MIMO_OPENAI_BASE_URL.to_string()),
            anthropic_base_url: Some(CODEX_MIMO_ANTHROPIC_BASE_URL.to_string()),
            env_key: Some("MIMO_API_KEY".to_string()),
            wire_api: Some("chat".to_string()),
            is_default: false,
            api_key_present: mimo_key_present,
        },
    ]
}

fn normalize_codex_model_provider_id(provider_id: &str) -> String {
    match provider_id.trim() {
        CODEX_MIMO_PROVIDER_ID | "mimo" | "mimo-v2.5" | "mimo-v2.5pro" => {
            CODEX_MIMO_PROVIDER_ID.to_string()
        }
        _ => CODEX_DEFAULT_PROVIDER_ID.to_string(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CodexMessageTransport {
    Bridge,
    MimoDirect,
}

fn codex_message_transport_for_provider(provider_id: &str) -> CodexMessageTransport {
    if normalize_codex_model_provider_id(provider_id) == CODEX_MIMO_PROVIDER_ID {
        CodexMessageTransport::MimoDirect
    } else {
        CodexMessageTransport::Bridge
    }
}

fn codex_model_provider_by_id(provider_id: &str) -> CodexModelProvider {
    let normalized = normalize_codex_model_provider_id(provider_id);
    codex_model_providers()
        .into_iter()
        .find(|provider| provider.id == normalized)
        .unwrap_or_else(|| codex_model_providers().remove(0))
}

fn codex_model_selection_payload(provider_id: &str) -> Value {
    let active = codex_model_provider_by_id(provider_id);
    json!({
        "activeProviderId": active.id,
        "activeProvider": active,
        "providers": codex_model_providers()
    })
}

fn select_mimo_env_from_lookup<F>(mut lookup: F) -> MimoEnvSelection
where
    F: FnMut(&str) -> Option<String>,
{
    let mut from_names = |names: &[&str]| {
        names
            .iter()
            .find_map(|name| lookup(name).map(|value| ((*name).to_string(), value)))
    };
    let anthropic_auth_token = from_names(&["ANTHROPIC_AUTH_TOKEN"])
        .or_else(|| from_names(&["ANTHROPIC_API_KEY"]))
        .or_else(|| from_names(&["MIMO_API_KEY", "XIAOMI_MIMO_API_KEY", "MIMO_KEY"]));
    let mimo_api_key = from_names(&["MIMO_API_KEY", "XIAOMI_MIMO_API_KEY", "MIMO_KEY"])
        .or_else(|| from_names(&["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"]));
    let base_url = lookup("MIMO_BASE_URL")
        .or_else(|| lookup("ANTHROPIC_BASE_URL"))
        .unwrap_or_else(|| "https://token-plan-cn.xiaomimimo.com/anthropic".to_string());
    let model = lookup("MIMO_MODEL")
        .or_else(|| lookup("ANTHROPIC_MODEL"))
        .unwrap_or_else(|| "mimo-v2.5-pro".to_string());
    MimoEnvSelection {
        mimo_api_key,
        anthropic_auth_token,
        base_url,
        model,
    }
}

fn persistent_env_var_cached(name: &str) -> Option<String> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = cache.lock() {
        if let Some(value) = guard.get(name) {
            return value.clone();
        }
    }
    let resolved = persistent_env_var(name);
    if let Ok(mut guard) = cache.lock() {
        guard.insert(name.to_string(), resolved.clone());
    }
    resolved
}

#[cfg(windows)]
fn persistent_env_var(name: &str) -> Option<String> {
    for value in [read_user_env_var(name), read_machine_env_var(name)] {
        if !value.is_empty() {
            return Some(value);
        }
    }
    None
}

#[cfg(not(windows))]
fn persistent_env_var(_name: &str) -> Option<String> {
    None
}

#[cfg(windows)]
fn read_user_env_var(name: &str) -> String {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Environment")
        .ok()
        .and_then(|key| key.get_value::<String, _>(name).ok())
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

#[cfg(windows)]
fn read_machine_env_var(name: &str) -> String {
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")
        .ok()
        .and_then(|key| key.get_value::<String, _>(name).ok())
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

fn normalize_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

fn compact_text(text: &str, limit: usize) -> String {
    let normalized = text.replace('\n', " ").replace('\r', " ");
    if normalized.chars().count() <= limit {
        normalized
    } else {
        let shortened: String = normalized.chars().take(limit).collect();
        format!("{shortened}...")
    }
}

fn clean_display_text(text: &str, limit: usize) -> Option<String> {
    let trimmed = text.trim().trim_matches('"').trim_matches('\'').trim_matches('`');
    if trimmed.is_empty()
        || trimmed.contains('\n')
        || trimmed.contains('\r')
        || looks_like_log_prefix(trimmed)
        || looks_like_pure_path_or_url(trimmed)
    {
        return None;
    }
    let normalized = compact_text(trimmed, limit);
    let compacted = normalized.trim();
    if compacted.is_empty() {
        None
    } else {
        Some(compacted.to_string())
    }
}

fn looks_like_log_prefix(text: &str) -> bool {
    let upper = text.trim_start().chars().take(16).collect::<String>().to_uppercase();
    upper.starts_with("WARN")
        || upper.starts_with("ERROR")
        || upper.starts_with("INFO")
        || upper.starts_with("DEBUG")
        || upper.starts_with("TRACE")
        || upper.starts_with("FATAL")
        || upper.starts_with("HTTP")
        || upper.starts_with("HTTPS")
        || upper.starts_with("GET ")
        || upper.starts_with("POST ")
        || upper.starts_with("PUT ")
        || upper.starts_with("DELETE ")
}

fn looks_like_pure_path_or_url(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.contains("://") || trimmed.starts_with("\\\\") || trimmed.starts_with('/') {
        return true;
    }
    if trimmed.len() >= 3 {
        let bytes = trimmed.as_bytes();
        if bytes[1] == b':' && bytes[0].is_ascii_alphabetic() && (bytes[2] == b'\\' || bytes[2] == b'/') {
            return true;
        }
    }
    if trimmed.contains('\\') || trimmed.contains('/') {
        let lower = trimmed.to_lowercase();
        let separator_count = trimmed.chars().filter(|ch| *ch == '\\' || *ch == '/').count();
        let has_whitespace = trimmed.chars().any(|ch| ch.is_whitespace());
        if separator_count >= 2 && !has_whitespace {
            return true;
        }
        if lower.contains("node_modules")
            || lower.contains(".codex")
            || lower.contains(".agents")
            || lower.contains("plugin.json")
            || lower.contains(".ps1")
            || lower.contains(".cmd")
            || lower.contains(".exe")
        {
            return true;
        }
    }
    false
}

fn normalized_kind(raw: &str) -> &'static str {
    match raw {
        "thinking"
        | "thinking_started"
        | "thinking_updated"
        | "thinking_ended"
        | "reasoning"
        | "analysis" => "thinking",
        "tool_call" | "mcp" => "tool_call",
        "command_started" | "command_finished" => "command",
        "file_read" | "file_written" => "file_action",
        "task_delegated" | "task_claimed" => "task_action",
        "review_local" | "review_mimo" => "review",
        "session_failed" | "error" => "error",
        "session_completed" | "done" => "done",
        _ => "status",
    }
}

fn action_status_for_event(event_type: &str) -> &'static str {
    if matches!(
        event_type,
        "thinking_started" | "thinking_updated" | "command_started" | "status"
    ) {
        "running"
    } else if matches!(event_type, "session_failed" | "error") {
        "failed"
    } else if matches!(event_type, "thinking_ended") {
        "done"
    } else if event_type.ends_with("_finished")
        || event_type.ends_with("_completed")
        || event_type == "session_completed"
        || event_type == "done"
    {
        "done"
    } else {
        "done"
    }
}

fn action_tool_for_event(event_type: &str) -> &'static str {
    match event_type {
        "tool_call" => "tool",
        "command_started" | "command_finished" => "terminal",
        "file_read" | "file_written" => "file",
        "task_delegated" | "task_claimed" => "task",
        "review_local" | "review_mimo" => "review",
        "thinking" | "thinking_started" | "thinking_updated" | "thinking_ended" => "thinking",
        "session_failed" | "session_completed" => "session",
        _ => "status",
    }
}

fn action_label_for_event(event_type: &str, message: &str) -> String {
    let fallback = compact_text(message, 120);
    match event_type {
        "tool_call" => format!("正在调用工具：{fallback}"),
        "command_started" => format!("正在执行命令：{fallback}"),
        "command_finished" => format!("命令执行完成：{fallback}"),
        "file_read" => format!("正在读取文件：{fallback}"),
        "file_written" => format!("已写入文件：{fallback}"),
        "task_delegated" => format!("已派发任务：{fallback}"),
        "task_claimed" => format!("已领取任务：{fallback}"),
        "review_local" => format!("本地验证：{fallback}"),
        "review_mimo" => format!("MiMo 审查：{fallback}"),
        "thinking_started" => "正在评估任务拆解方案...".to_string(),
        "thinking_updated" => "正在持续评估方案...".to_string(),
        "thinking_ended" => "方案评估完成".to_string(),
        "session_failed" => format!("会话失败：{fallback}"),
        "session_completed" => format!("会话完成：{fallback}"),
        _ => fallback,
    }
}

fn extract_duration_ms(payload: &Value) -> Option<i64> {
    let candidates = [
        payload.get("durationMs"),
        payload.get("duration_ms"),
        payload.get("duration"),
        payload
            .get("timings")
            .and_then(|timings| timings.get("durationMs")),
    ];
    for value in candidates.into_iter().flatten() {
        if let Some(ms) = value.as_i64() {
            return Some(ms);
        }
        if let Some(seconds) = value.as_f64() {
            if seconds > 0.0 {
                return Some((seconds * 1000.0).round() as i64);
            }
        }
    }
    None
}

fn is_macro_action_event(event_type: &str) -> bool {
    matches!(
        event_type,
        "task_delegated"
            | "task_claimed"
            | "review_local"
            | "review_mimo"
            | "session_failed"
            | "session_completed"
    )
}

fn build_fingerprint(
    run_id: &str,
    session_id: Option<&str>,
    kind: &str,
    task_id: Option<&str>,
    normalized_message: &str,
) -> String {
    format!(
        "{run_id}|{}|{kind}|{}|{normalized_message}",
        session_id.unwrap_or("-"),
        task_id.unwrap_or("-")
    )
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

fn extract_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) if !text.trim().is_empty() => Some(text.clone()),
        Value::Array(items) => {
            let texts = items.iter().filter_map(extract_text).collect::<Vec<_>>();
            if texts.is_empty() {
                None
            } else {
                Some(texts.join("\n"))
            }
        }
        Value::Object(map) => {
            let keys = ["text", "message", "content", "delta", "summary", "result"];
            for key in keys {
                if let Some(found) = map.get(key).and_then(extract_text) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

fn parse_output(agent: &str, stream: &str, line: &str) -> ParsedOutput {
    // semantic aliases: thinking / tool_call / command / file_action / task_action / review / error / done / status
    let parsed = serde_json::from_str::<Value>(line).ok();
    let mut payload = parsed.clone().unwrap_or_else(|| json!({"raw": line}));
    let message = parsed
        .as_ref()
        .and_then(extract_text)
        .unwrap_or_else(|| line.to_string());
    let blob = format!(
        "{} {} {}",
        agent.to_lowercase(),
        message.to_lowercase(),
        line.to_lowercase()
    );

    let task_id = parsed
        .as_ref()
        .and_then(|value| {
            value
                .get("taskId")
                .or_else(|| value.get("task_id"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .or_else(|| {
            parsed.as_ref().and_then(|value| {
                value
                    .get("payload")
                    .and_then(|payload| payload.get("taskId").or_else(|| payload.get("task_id")))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
        });

    let mut event_type = "status".to_string();
    if stream == "stderr"
        || contains_any(
            &blob,
            &["error", "failed", "exception", "permission", "denied", "timeout", "stderr"],
        )
    {
        event_type = "session_failed".to_string();
    } else if let Some(value) = parsed.as_ref() {
        let raw_type = value
            .get("type")
            .or_else(|| value.get("event").and_then(|event| event.get("type")))
            .or_else(|| value.get("kind"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_lowercase();

        if contains_any(&raw_type, &["thinking", "reasoning", "analysis"]) {
            event_type = "thinking".to_string();
        } else if contains_any(&raw_type, &["tool", "mcp"]) {
            event_type = "tool_call".to_string();
        } else if contains_any(&raw_type, &["command_started", "item.started"]) {
            event_type = "command_started".to_string();
        } else if contains_any(&raw_type, &["command_finished", "item.completed"]) {
            event_type = "command_finished".to_string();
        } else if contains_any(&raw_type, &["file_read", "read_file", "fileread"]) {
            event_type = "file_read".to_string();
        } else if contains_any(&raw_type, &["file_written", "write_file", "filechange", "file_change"]) {
            event_type = "file_written".to_string();
        } else if contains_any(&raw_type, &["task_delegated", "delegate"]) {
            event_type = "task_delegated".to_string();
        } else if contains_any(&raw_type, &["task_claimed", "claim"]) {
            event_type = "task_claimed".to_string();
        } else if contains_any(&raw_type, &["review_local", "local_review"]) {
            event_type = "review_local".to_string();
        } else if contains_any(&raw_type, &["review_mimo", "mimo_review"]) {
            event_type = "review_mimo".to_string();
        } else if contains_any(&raw_type, &["session_completed", "done", "result"]) {
            event_type = "session_completed".to_string();
        } else if contains_any(&raw_type, &["session_failed"]) {
            event_type = "session_failed".to_string();
        }
    }

    if event_type == "status" {
        event_type = if contains_any(&blob, &["thinking", "reasoning", "analysis", "thinking"]) {
            "thinking".to_string()
        } else if contains_any(
            &blob,
            &[
                "tool_call",
                "mcp",
                "delegate_task_and_wait",
                "get_task",
                "submit_review",
            ],
        ) {
            "tool_call".to_string()
        } else if contains_any(&blob, &["command", "npm ", "cargo ", "pytest", "python -m", "powershell"]) {
            if contains_any(&blob, &["finished", "completed", "done", "exit code"]) {
                "command_finished".to_string()
            } else {
                "command_started".to_string()
            }
        } else if contains_any(&blob, &["read_file", "file read", "open file", ".rs", ".jsx", ".ps1"]) {
            "file_read".to_string()
        } else if contains_any(&blob, &["write_file", "apply_patch", "edited", "modified"]) {
            "file_written".to_string()
        } else if contains_any(&blob, &["task claimed", "get_task"]) {
            "task_claimed".to_string()
        } else if contains_any(&blob, &["task delegated", "delegate"]) {
            "task_delegated".to_string()
        } else if contains_any(&blob, &["mimo", "review"]) {
            if contains_any(&blob, &["local verification", "local review", "local"]) {
                "review_local".to_string()
            } else {
                "review_mimo".to_string()
            }
        } else if contains_any(&blob, &["success", "completed", "finished", "exit code 0"]) {
            "session_completed".to_string()
        } else {
            "status".to_string()
        };
    }

    let inferred_duration_ms = extract_duration_ms(&payload);
    let kind = normalized_kind(&event_type).to_string();
    if let Some(obj) = payload.as_object_mut() {
        if obj.get("kind").is_none() {
            obj.insert("kind".to_string(), Value::String(kind.clone()));
        }
        if obj.get("eventType").is_none() {
            obj.insert("eventType".to_string(), Value::String(event_type.clone()));
        }
        if obj.get("status").is_none() {
            obj.insert(
                "status".to_string(),
                Value::String(action_status_for_event(&event_type).to_string()),
            );
        }
        if obj.get("tool").is_none() {
            obj.insert(
                "tool".to_string(),
                Value::String(action_tool_for_event(&event_type).to_string()),
            );
        }
        if obj.get("actionLabel").is_none() {
            obj.insert(
                "actionLabel".to_string(),
                Value::String(action_label_for_event(&event_type, &message)),
            );
        }
        if obj.get("isMacroAction").is_none() {
            obj.insert(
                "isMacroAction".to_string(),
                Value::Bool(is_macro_action_event(&event_type)),
            );
        }
        if obj.get("durationMs").is_none() {
            if let Some(duration_ms) = inferred_duration_ms {
                obj.insert("durationMs".to_string(), Value::Number(duration_ms.into()));
            }
        }
    }

    ParsedOutput {
        kind: kind.clone(),
        event_type: event_type.clone(),
        message: message.clone(),
        summary: format!("{kind}/{event_type}: {}", compact_text(&message, 160)),
        payload,
        task_id,
    }
}


fn resolve_command_path(candidates: &[&str]) -> Option<PathBuf> {
    static RESOLVED: OnceLock<Mutex<HashMap<String, Option<PathBuf>>>> = OnceLock::new();
    let cache = RESOLVED.get_or_init(|| Mutex::new(HashMap::new()));
    // Avoid spawning where.exe repeatedly: scan PATH directly to prevent window flicker.
    let path_env = env::var_os("PATH")?;
    let path_dirs = env::split_paths(&path_env).collect::<Vec<_>>();
    if path_dirs.is_empty() {
        return None;
    }

    let pathext = env::var("PATHEXT")
        .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string())
        .split(';')
        .filter_map(|ext| {
            let trimmed = ext.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_ascii_lowercase())
            }
        })
        .collect::<Vec<_>>();

    for candidate in candidates {
        if let Ok(guard) = cache.lock() {
            if let Some(hit) = guard.get(*candidate) {
                if let Some(path) = hit {
                    return Some(path.clone());
                }
            }
        }
        let candidate_path = PathBuf::from(candidate);

        // Absolute or relative path with directory component: check directly.
        if candidate_path.components().count() > 1 && candidate_path.exists() {
            if let Ok(mut guard) = cache.lock() {
                guard.insert((*candidate).to_string(), Some(candidate_path.clone()));
            }
            return Some(candidate_path);
        }

        let candidate_lower = candidate.to_ascii_lowercase();
        let has_ext = candidate_path.extension().is_some();

        for dir in &path_dirs {
            let direct = dir.join(candidate);
            if direct.exists() {
                if let Ok(mut guard) = cache.lock() {
                    guard.insert((*candidate).to_string(), Some(direct.clone()));
                }
                return Some(direct);
            }
            if !has_ext {
                for ext in &pathext {
                    let suffix = ext.strip_prefix('.').unwrap_or(ext);
                    let with_ext = dir.join(format!("{candidate}.{suffix}"));
                    if with_ext.exists() {
                        if let Ok(mut guard) = cache.lock() {
                            guard.insert((*candidate).to_string(), Some(with_ext.clone()));
                        }
                        return Some(with_ext);
                    }
                }
            } else if candidate_lower.ends_with(".cmd")
                || candidate_lower.ends_with(".exe")
                || candidate_lower.ends_with(".bat")
                || candidate_lower.ends_with(".com")
            {
                if direct.exists() {
                    if let Ok(mut guard) = cache.lock() {
                        guard.insert((*candidate).to_string(), Some(direct.clone()));
                    }
                    return Some(direct);
                }
            }
        }
        if let Ok(mut guard) = cache.lock() {
            guard.insert((*candidate).to_string(), None);
        }
    }

    None
}

fn resolve_sidecar_path(root: &Path) -> Option<PathBuf> {
    if let Ok(explicit) = env::var("TEAMFLOW_MCP_COMMAND") {
        let path = PathBuf::from(explicit);
        if path.exists() {
            return Some(path);
        }
    }

    let mut bin_dirs = Vec::new();
    if let Ok(current_exe) = env::current_exe() {
        if let Some(current_dir) = current_exe.parent() {
            bin_dirs.push(current_dir.to_path_buf());
        }
    }
    bin_dirs.push(root.join("src-tauri"));

    for bin_dir in bin_dirs {
        let plain_sidecar = bin_dir.join("teamflow-mcp.exe");
        if plain_sidecar.exists() {
            return Some(plain_sidecar);
        }
        let Ok(entries) = fs::read_dir(&bin_dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path.file_name()?.to_string_lossy();
            if name.starts_with("teamflow-mcp-") && name.ends_with(".exe") {
                return Some(path);
            }
        }
    }
    None
}

fn resolve_existing_path_with_extension(
    candidates: &[PathBuf],
    allowed_extensions: &[&str],
) -> Option<PathBuf> {
    let allowed = allowed_extensions
        .iter()
        .map(|ext| ext.trim_start_matches('.').to_ascii_lowercase())
        .collect::<Vec<_>>();
    for candidate in candidates {
        if !candidate.is_file() {
            continue;
        }
        let extension = candidate
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .unwrap_or_default();
        if allowed.iter().any(|value| value == &extension) {
            return Some(candidate.clone());
        }
    }
    None
}

fn apply_hidden_window(command: &mut Command) {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn terminate_pid(pid: u32) {
    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/T", "/F"]);
        apply_hidden_window(&mut command);
        let _ = command.output();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }
}

fn terminate_pid_gracefully_then_force(pid: u32) {
    #[cfg(windows)]
    {
        let mut graceful = Command::new("taskkill");
        graceful.args(["/PID", &pid.to_string(), "/T"]);
        apply_hidden_window(&mut graceful);
        let graceful_ok = graceful.status().map(|status| status.success()).unwrap_or(false);
        if !graceful_ok {
            terminate_pid(pid);
        }
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").args([&pid.to_string()]).output();
        terminate_pid(pid);
    }
}

fn normalize_status_for_ui(status: &mut Value, worker_summary: &WorkerPoolSummary) -> Result<()> {
    let deduped_events = status
        .get("dedupedEvents")
        .and_then(Value::as_array)
        .cloned()
        .or_else(|| status.get("events").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    let deduped_messages = status
        .get("dedupedAgentMessages")
        .and_then(Value::as_array)
        .cloned()
        .or_else(|| status.get("agentMessages").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    let codex_state = status
        .get("codexState")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("IDLE")
        .to_string();

    if let Some(obj) = status.as_object_mut() {
        obj.insert("codexState".to_string(), Value::String(codex_state));
        obj.insert(
            "claudeWorkerState".to_string(),
            serde_json::to_value(worker_summary)?,
        );
        if !obj
            .get("dedupedEvents")
            .map(Value::is_array)
            .unwrap_or(false)
        {
            obj.insert("dedupedEvents".to_string(), Value::Array(deduped_events));
        }
        if !obj
            .get("dedupedAgentMessages")
            .map(Value::is_array)
            .unwrap_or(false)
        {
            obj.insert(
                "dedupedAgentMessages".to_string(),
                Value::Array(deduped_messages),
            );
        }
    }
    Ok(())
}

fn emit_status(app: &AppHandle, store: &Store, realtime: Option<&RealtimeHub>) {
    if let Ok(status) = store.status_snapshot() {
        let _ = app.emit("status_updated", status.clone());
        if let Some(bus) = realtime {
            bus.emit(
                app,
                None,
                None,
                Some("system"),
                "status",
                "status_updated",
                None,
                status,
            );
        }
    }
}

impl RealtimeHub {
    fn new() -> Self {
        let (tx, _) = broadcast::channel(2048);
        Self {
            seq: Arc::new(AtomicU64::new(0)),
            tx,
            backlog: Arc::new(Mutex::new(VecDeque::with_capacity(REALTIME_BUFFER_CAP))),
            ws_started: Arc::new(AtomicBool::new(false)),
        }
    }

    fn config(&self) -> RealtimeConfig {
        RealtimeConfig {
            event_name: REALTIME_EVENT_NAME.to_string(),
            ws_url: format!("ws://127.0.0.1:{REALTIME_WS_PORT}/teamflow/realtime"),
            initial_seq: self.seq.load(Ordering::Relaxed),
            mode: "ipc+ws".to_string(),
        }
    }

    fn emit(
        &self,
        app: &AppHandle,
        run_id: Option<&str>,
        session_id: Option<&str>,
        agent: Option<&str>,
        topic: &str,
        event_type: &str,
        source_item_id: Option<&str>,
        payload: Value,
    ) {
        let _ = self.emit_with_seq(
            app,
            run_id,
            session_id,
            agent,
            topic,
            event_type,
            source_item_id,
            payload,
        );
    }

    fn emit_with_seq(
        &self,
        app: &AppHandle,
        run_id: Option<&str>,
        session_id: Option<&str>,
        agent: Option<&str>,
        topic: &str,
        event_type: &str,
        source_item_id: Option<&str>,
        payload: Value,
    ) -> u64 {
        let seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
        let envelope = json!({
            "seq": seq,
            "emittedAt": now(),
            "runId": run_id.unwrap_or_default(),
            "sessionId": session_id.unwrap_or_default(),
            "agent": agent.unwrap_or_default(),
            "topic": topic,
            "eventType": event_type,
            "sourceItemId": source_item_id.unwrap_or_default(),
            "payload": payload
        });

        if let Ok(mut queue) = self.backlog.lock() {
            queue.push_back(envelope.clone());
            while queue.len() > REALTIME_BUFFER_CAP {
                queue.pop_front();
            }
        }

        let _ = app.emit(REALTIME_EVENT_NAME, envelope.clone());
        if let Ok(serialized) = serde_json::to_string(&envelope) {
            let _ = self.tx.send(serialized);
        }
        seq
    }

    fn replay_from(&self, from_seq: u64, run_id: Option<&str>) -> Vec<Value> {
        let run_filter = run_id.map(|s| s.to_string());
        let mut rows = Vec::new();
        if let Ok(queue) = self.backlog.lock() {
            for item in queue.iter() {
                let seq = item.get("seq").and_then(Value::as_u64).unwrap_or(0);
                if seq <= from_seq {
                    continue;
                }
                if let Some(run) = &run_filter {
                    let item_run = item.get("runId").and_then(Value::as_str).unwrap_or_default();
                    if !run.is_empty() && !item_run.is_empty() && item_run != run {
                        continue;
                    }
                }
                rows.push(item.clone());
            }
        }
        rows
    }

    fn ensure_ws_server(&self) {
        if self.ws_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let addr = format!("127.0.0.1:{REALTIME_WS_PORT}");
        let tx = self.tx.clone();
        tauri::async_runtime::spawn(async move {
            let listener = match TcpListener::bind(&addr).await {
                Ok(listener) => listener,
                Err(_) => return,
            };
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    continue;
                };
                let tx_client = tx.clone();
                tauri::async_runtime::spawn(async move {
                    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
                        Ok(ws) => ws,
                        Err(_) => return,
                    };
                    let (mut write, mut read) = ws_stream.split();
                    let mut rx = tx_client.subscribe();
                    let writer = tauri::async_runtime::spawn(async move {
                        loop {
                            match rx.recv().await {
                                Ok(text) => {
                                    if write.send(Message::Text(text.into())).await.is_err() {
                                        break;
                                    }
                                }
                                Err(_) => break,
                            }
                        }
                    });

                    while let Some(msg) = read.next().await {
                        if msg.is_err() {
                            break;
                        }
                    }
                    writer.abort();
                });
            }
        });
    }
}

fn register_runtime(state: &AppState, runtime: SessionRuntime) {
    if let Ok(mut map) = state.sessions.lock() {
        map.insert(runtime.session_id.clone(), runtime);
    }
}

fn unregister_runtime(state: &AppState, session_id: &str) {
    if let Ok(mut map) = state.sessions.lock() {
        map.remove(session_id);
    }
}

fn touch_codex_bridge_backend_activity(state: &AppState, run_id: &str) {
    if let Ok(bridges) = state.codex_bridges.lock() {
        if let Some(bridge) = bridges.get(run_id) {
            if let Ok(mut runtime) = bridge.lock() {
                runtime.last_backend_activity_at = Utc::now().timestamp();
            }
        }
    }
}

fn resolve_node_exe_candidate_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(program_files) = env::var_os("ProgramFiles") {
        candidates.push(PathBuf::from(program_files).join("nodejs").join("node.exe"));
    }
    if let Some(program_files_x86) = env::var_os("ProgramFiles(x86)") {
        candidates.push(PathBuf::from(program_files_x86).join("nodejs").join("node.exe"));
    }
    if let Some(local_app_data) = env::var_os("LocalAppData") {
        candidates.push(
            PathBuf::from(local_app_data)
                .join("Programs")
                .join("nodejs")
                .join("node.exe"),
        );
    }
    if let Some(path) = resolve_command_path(&["node.exe"]) {
        candidates.push(path);
    }
    candidates
}

fn resolve_codex_js_candidate_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(appdata) = env::var_os("APPDATA") {
        candidates.push(
            PathBuf::from(appdata)
                .join("npm")
                .join("node_modules")
                .join("@openai")
                .join("codex")
                .join("bin")
                .join("codex.js"),
        );
    }
    if let Some(user_profile) = env::var_os("USERPROFILE") {
        candidates.push(
            PathBuf::from(user_profile)
                .join("AppData")
                .join("Roaming")
                .join("npm")
                .join("node_modules")
                .join("@openai")
                .join("codex")
                .join("bin")
                .join("codex.js"),
        );
    }
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(local_app_data)
                .join("npm")
                .join("node_modules")
                .join("@openai")
                .join("codex")
                .join("bin")
                .join("codex.js"),
        );
    }
    candidates
}

fn resolve_codex_launch_paths_uncached() -> Option<CodexLaunchPaths> {
    let node_exe = resolve_existing_path_with_extension(&resolve_node_exe_candidate_paths(), &["exe"])?;
    let codex_js = resolve_existing_path_with_extension(&resolve_codex_js_candidate_paths(), &["js"])?;
    Some(CodexLaunchPaths { node_exe, codex_js })
}

fn resolve_codex_launch_paths() -> Option<CodexLaunchPaths> {
    static RESOLVED: OnceLock<Option<CodexLaunchPaths>> = OnceLock::new();
    RESOLVED.get_or_init(resolve_codex_launch_paths_uncached).clone()
}

fn resolve_python_exe_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(program_files) = env::var_os("ProgramFiles") {
        let program_files = PathBuf::from(program_files);
        candidates.push(program_files.join("Python313").join("python.exe"));
        candidates.push(program_files.join("Python312").join("python.exe"));
        candidates.push(program_files.join("Python311").join("python.exe"));
    }
    if let Some(program_files_x86) = env::var_os("ProgramFiles(x86)") {
        let program_files_x86 = PathBuf::from(program_files_x86);
        candidates.push(program_files_x86.join("Python313-32").join("python.exe"));
        candidates.push(program_files_x86.join("Python312-32").join("python.exe"));
    }
    if let Some(local_app_data) = env::var_os("LocalAppData") {
        let local_app_data = PathBuf::from(local_app_data);
        candidates.push(local_app_data.join("Programs").join("Python").join("Python313").join("python.exe"));
        candidates.push(local_app_data.join("Programs").join("Python").join("Python312").join("python.exe"));
    }
    for candidate in PYTHON_EXEC_CANDIDATES {
        if let Some(path) = resolve_command_path(&[candidate]) {
            candidates.push(path);
        }
    }
    candidates
}

fn resolve_python_exe() -> Option<PathBuf> {
    resolve_existing_path_with_extension(&resolve_python_exe_candidates(), &["exe"])
}

fn build_mimo_context_messages(
    state: &AppState,
    run_id: &str,
    session_id: &str,
    prompt: &str,
) -> Result<Value> {
    let conn = state.store.connect()?;
    let mut statement = conn.prepare(
        "select role, kind, text from agent_messages where run_id=?1 and session_id=?2 order by id desc limit 12",
    )?;
    let mut rows = statement.query(params![run_id, session_id])?;
    let mut history = Vec::<Value>::new();
    while let Some(row) = rows.next()? {
        let role: String = row.get(0)?;
        let kind: String = row.get(1)?;
        let text: String = row.get(2)?;
        if role == "system" && (kind == "status" || text.contains("后台 CLI 会话已启动")) {
            continue;
        }
        let normalized_role = match role.as_str() {
            "user" => "user",
            "assistant" => "assistant",
            _ => "system",
        };
        history.push(json!({
            "role": normalized_role,
            "content": compact_text(&text, 8000),
        }));
    }
    history.reverse();
    history.push(json!({
        "role": "user",
        "content": compact_text(prompt, 8000),
    }));
    let task_context = state.store.get_run_overview(run_id).unwrap_or_else(|_| json!({}));
    Ok(json!({
        "messages": history,
        "taskContext": task_context,
    }))
}

fn invoke_mimo_direct(
    state: &AppState,
    run_id: &str,
    session_id: &str,
    prompt: &str,
    model: &str,
) -> Result<String> {
    let python = resolve_python_exe()
        .ok_or_else(|| TeamflowError::Message("未找到 Python，请确认 Python 已安装并在 PATH 中。".to_string()))?;
    let script = state.store.root.join("src").join("teamflow_v2").join("mimo.py");
    if !script.exists() {
        return Err(TeamflowError::Message("未找到 MiMo 直连脚本。".to_string()));
    }
    let context = build_mimo_context_messages(state, run_id, session_id, prompt)?;
    let base_url = env_var_any_scope("MIMO_BASE_URL").unwrap_or_else(|| CODEX_MIMO_OPENAI_BASE_URL.to_string());
    let api_key = env_var_any_scope("MIMO_API_KEY")
        .or_else(|| env_var_any_scope("XIAOMI_MIMO_API_KEY"))
        .or_else(|| env_var_any_scope("ANTHROPIC_AUTH_TOKEN"))
        .or_else(|| env_var_any_scope("ANTHROPIC_API_KEY"))
        .or_else(|| env_var_any_scope("MIMO_KEY"))
        .ok_or_else(|| TeamflowError::Message("未检测到 MiMo API key。".to_string()))?;
    let mut command = Command::new(python);
    command
        .arg(script)
        .arg("--base-url")
        .arg(base_url)
        .arg("--api-key")
        .arg(api_key)
        .arg("--model")
        .arg(model)
        .arg("--timeout")
        .arg("120")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(&state.store.workspace);
    apply_hidden_window(&mut command);
    let mut child = command.spawn()?;
    if let Some(stdin) = child.stdin.as_mut() {
        use std::io::Write;
        stdin.write_all(serde_json::to_string(&context)?.as_bytes())?;
        stdin.write_all(b"\n")?;
    }
    let output = child.wait_with_output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(TeamflowError::Message(format!("MiMo 直连调用失败：{}", compact_text(&stderr, 800))));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let parsed: Value = serde_json::from_str(stdout.trim()).map_err(|error| {
        TeamflowError::Message(format!("MiMo 直连响应解析失败：{error}；输出：{}", compact_text(&stdout, 400)))
    })?;
    let text = parsed
        .get("text")
        .and_then(Value::as_str)
        .or_else(|| parsed.get("raw").and_then(Value::as_object).and_then(|raw| raw.get("choices")).and_then(Value::as_array).and_then(|choices| choices.first()).and_then(Value::as_object).and_then(|choice| choice.get("message")).and_then(Value::as_object).and_then(|message| message.get("content")).and_then(Value::as_str))
        .unwrap_or_default()
        .to_string();
    Ok(text)
}

fn get_or_create_codex_bridge(state: &AppState, run_id: &str) -> Result<Arc<Mutex<CodexBridgeRuntime>>> {
    let mut bridges = state
        .codex_bridges
        .lock()
        .map_err(|_| TeamflowError::Message("Codex bridge 状态锁已损坏。".to_string()))?;
    if let Some(existing) = bridges.get(run_id) {
        return Ok(existing.clone());
    }
    let bridge_dir = state.store.runtime.join("codex-bridges").join(run_id);
    fs::create_dir_all(&bridge_dir)?;
    let bridge_marker = bridge_dir.join("bridge.json");
    let session_id = state.store.ensure_codex_bridge_session_for_run(run_id)?;
    let runtime = Arc::new(Mutex::new(CodexBridgeRuntime {
        run_id: run_id.to_string(),
        session_id,
        bridge_dir,
        queue: VecDeque::new(),
        worker_running: false,
        sleeping: false,
        session_bootstrapped: bridge_marker.exists(),
        current_round: None,
        last_round: None,
        last_user_input_at: Utc::now().timestamp(),
        last_backend_activity_at: Utc::now().timestamp(),
        last_round_started_at: None,
        last_round_ended_at: None,
        current_pid: None,
        interrupt_requested: false,
    }));
    bridges.insert(run_id.to_string(), runtime.clone());
    Ok(runtime)
}

fn codex_bridge_marker_path(runtime: &CodexBridgeRuntime) -> PathBuf {
    runtime.bridge_dir.join("bridge.json")
}

fn codex_bridge_round_args(
    prompt: &str,
    workspace: &Path,
    user_root: &str,
    resume: bool,
    model: &str,
) -> Vec<String> {
    let mut args = Vec::new();
    if resume {
        args.push("exec".to_string());
        args.push("resume".to_string());
        args.push("--last".to_string());
        args.push("--json".to_string());
        args.push("-m".to_string());
        args.push(model.to_string());
        args.push("--skip-git-repo-check".to_string());
        args.push("--dangerously-bypass-approvals-and-sandbox".to_string());
        args.push(prompt.to_string());
    } else {
        args.push("exec".to_string());
        args.push("--json".to_string());
        args.push("-m".to_string());
        args.push(model.to_string());
        args.push("--skip-git-repo-check".to_string());
        args.push("-C".to_string());
        args.push(workspace.to_string_lossy().to_string());
        args.push("--add-dir".to_string());
        args.push(user_root.to_string());
        args.push("--dangerously-bypass-approvals-and-sandbox".to_string());
        args.push(prompt.to_string());
    }
    args
}

fn codex_bridge_feature_flags(provider_id: &str) -> Vec<String> {
    if normalize_codex_model_provider_id(provider_id) == CODEX_MIMO_PROVIDER_ID {
        // MiMo uses API-key auth; Codex plugin startup sync is not supported there.
        vec![
            "--disable".to_string(),
            "plugins".to_string(),
            "--disable".to_string(),
            "remote_plugin".to_string(),
        ]
    } else {
        Vec::new()
    }
}

fn codex_bridge_model_provider_args(provider_id: &str) -> Vec<String> {
    let provider = codex_model_provider_by_id(provider_id);
    let mut args = vec![
        "-c".to_string(),
        r#"model_provider="codex""#.to_string(),
    ];

    if let Some(base_url) = provider.base_url.as_deref() {
        args.push("-c".to_string());
        args.push(format!(r#"model_providers.codex.base_url="{}""#, base_url));
    }

    if let Some(wire_api) = provider.wire_api.as_deref() {
        args.push("-c".to_string());
        args.push(format!(r#"model_providers.codex.wire_api="{}""#, wire_api));
    }

    args
}

fn codex_bridge_launch_args(
    provider_id: &str,
    prompt: &str,
    workspace: &Path,
    user_root: &str,
    resume: bool,
    model: &str,
) -> Vec<String> {
    let mut args = codex_bridge_feature_flags(provider_id);
    args.extend(codex_bridge_model_provider_args(provider_id));
    args.extend(codex_bridge_round_args(
        prompt, workspace, user_root, resume, model,
    ));
    args
}

fn codex_bridge_session_id_for_run(state: &AppState, run_id: &str) -> Option<String> {
    state
        .codex_bridges
        .lock()
        .ok()
        .and_then(|map| map.get(run_id).cloned())
        .and_then(|bridge| bridge.lock().ok().map(|runtime| runtime.session_id.clone()))
}

fn codex_bridge_runtime_for_run(
    state: &AppState,
    run_id: &str,
) -> Option<Arc<Mutex<CodexBridgeRuntime>>> {
    state
        .codex_bridges
        .lock()
        .ok()
        .and_then(|map| map.get(run_id).cloned())
}

fn codex_round_snapshot<'a>(runtime: &'a CodexBridgeRuntime) -> Option<&'a CodexRoundRuntime> {
    runtime
        .current_round
        .as_ref()
        .or(runtime.last_round.as_ref())
}

fn codex_bridge_state_json(state: &AppState, run_id: &str) -> Value {
    let Some(bridge) = codex_bridge_runtime_for_run(state, run_id) else {
        return json!({
            "runId": run_id,
            "state": "idle",
            "sleeping": true,
            "workerRunning": false,
            "queueLength": 0,
            "roundState": "idle",
            "roundActive": false
        });
    };
    let runtime = bridge.lock().ok();
    let queue_len = runtime.as_ref().map(|r| r.queue.len()).unwrap_or(0);
    let worker_running = runtime.as_ref().map(|r| r.worker_running).unwrap_or(false);
    let sleeping = runtime.as_ref().map(|r| r.sleeping).unwrap_or(true);
    let round = runtime.as_ref().and_then(|runtime| codex_round_snapshot(&**runtime));
    let round_active = runtime
        .as_ref()
        .map(|r| r.current_round.is_some())
        .unwrap_or(false);
    json!({
        "runId": run_id,
        "sessionId": runtime.as_ref().map(|r| r.session_id.clone()),
        "state": if sleeping { "sleeping" } else if worker_running { "running" } else { "active" },
        "sleeping": sleeping,
        "workerRunning": worker_running,
        "queueLength": queue_len,
        "lastUserInputAt": runtime.as_ref().and_then(|r| Some(r.last_user_input_at)),
        "lastBackendActivityAt": runtime.as_ref().and_then(|r| Some(r.last_backend_activity_at)),
        "currentPid": runtime.as_ref().and_then(|r| r.current_pid),
        "lastRoundStartedAt": runtime.as_ref().and_then(|r| r.last_round_started_at),
        "lastRoundEndedAt": runtime.as_ref().and_then(|r| r.last_round_ended_at),
        "roundState": round
            .map(|r| r.status.clone())
            .unwrap_or_else(|| "idle".to_string()),
        "roundActive": round_active
    })
}

fn codex_round_state_json(state: &AppState, run_id: &str) -> Value {
    let Some(bridge) = codex_bridge_runtime_for_run(state, run_id) else {
        return json!({
            "runId": run_id,
            "state": "idle",
            "active": false,
            "source": "none"
        });
    };
    let runtime = bridge.lock().ok();
    let round = runtime.as_ref().and_then(|runtime| codex_round_snapshot(&**runtime)).cloned();
    let source = runtime
        .as_ref()
        .map(|r| {
            if r.current_round.is_some() {
                "current"
            } else if r.last_round.is_some() {
                "last"
            } else {
                "none"
            }
        })
        .unwrap_or("none");
    let active = runtime.as_ref().map(|r| r.current_round.is_some()).unwrap_or(false);
    json!({
        "runId": run_id,
        "state": round.as_ref().map(|r| r.status.clone()).unwrap_or_else(|| "idle".to_string()),
        "active": active,
        "source": source,
        "prompt": round.as_ref().map(|r| compact_text(&r.prompt, 200)),
        "startedAt": round.as_ref().map(|r| r.started_at),
        "endedAt": round.as_ref().and_then(|r| r.ended_at),
        "pid": round.as_ref().and_then(|r| r.pid),
        "exitCode": round.as_ref().and_then(|r| r.exit_code),
        "interruptRequested": round.as_ref().map(|r| r.interrupt_requested).unwrap_or(false)
    })
}

fn finish_codex_round_state(
    state: &AppState,
    run_id: &str,
    status: &str,
    exit_code: Option<i32>,
) {
    if let Some(bridge) = codex_bridge_runtime_for_run(state, run_id) {
        if let Ok(mut runtime) = bridge.lock() {
            let current_pid = runtime.current_pid;
            let finished_at = Utc::now().timestamp();
            let completed_round = runtime.current_round.as_mut().map(|round| {
                round.ended_at = Some(finished_at);
                round.status = status.to_string();
                round.exit_code = exit_code;
                round.interrupt_requested = status == "interrupted";
                round.pid = current_pid;
                round.clone()
            });
            runtime.worker_running = false;
            runtime.last_round_ended_at = Some(finished_at);
            runtime.interrupt_requested = false;
            runtime.sleeping = false;
            if let Some(round) = completed_round {
                runtime.last_round = Some(round);
            }
            runtime.current_round = None;
            runtime.current_pid = None;
        }
    }
}

fn finalize_codex_round(
    app: &AppHandle,
    state: &AppState,
    run_id: &str,
    session_id: &str,
    event_type: &str,
    message: &str,
    payload: Value,
) -> Result<()> {
    state.store.append_process_event_for_run(
        run_id,
        Some(session_id),
        Some("codex"),
        event_type,
        message,
        None,
        payload.clone(),
    )?;
    if let Ok(agent_msg) = state.store.append_agent_message_for_run(
        run_id,
        session_id,
        "codex",
        "system",
        event_type,
        message,
        None,
    ) {
        let emitted = serde_json::to_value(agent_msg).unwrap_or(json!({}));
        let _ = app.emit("agent_message_added", emitted.clone());
        state.realtime.emit(
            app,
            Some(run_id),
            Some(session_id),
            Some("codex"),
            "agent_message",
            event_type,
            None,
            emitted,
        );
    }
    let process_payload = json!({
        "runId": run_id,
        "sessionId": session_id,
        "agent": "codex",
        "type": event_type,
        "message": message,
        "payload": payload
    });
    let _ = app.emit("task_changed", process_payload.clone());
    state.realtime.emit(
        app,
        Some(run_id),
        Some(session_id),
        Some("codex"),
        "status",
        event_type,
        None,
        process_payload,
    );
    Ok(())
}

fn spawn_mimo_round(
    app: AppHandle,
    state: AppState,
    run_id: String,
    session_id: String,
    prompt: String,
    model: String,
) {
    std::thread::spawn(move || {
        match invoke_mimo_direct(&state, &run_id, &session_id, &prompt, &model) {
            Ok(text) => {
                let response_text = if text.trim().is_empty() {
                    "MiMo 没有返回内容。".to_string()
                } else {
                    text
                };
                if let Ok(agent_msg) = state.store.append_agent_message_for_run(
                    &run_id,
                    &session_id,
                    "codex",
                    "assistant",
                    "status",
                    &response_text,
                    None,
                ) {
                    let emitted = serde_json::to_value(agent_msg).unwrap_or(json!({}));
                    let _ = app.emit("agent_message_added", emitted.clone());
                    state.realtime.emit(
                        &app,
                        Some(&run_id),
                        Some(&session_id),
                        Some("codex"),
                        "agent_message",
                        "status",
                        None,
                        emitted,
                    );
                }
                let _ = finalize_codex_round(
                    &app,
                    &state,
                    &run_id,
                    &session_id,
                    "round_completed",
                    "MiMo 当前轮次已结束，可继续发送下一条消息。",
                    json!({"provider": "mimo", "model": model}),
                );
                emit_status(&app, &state.store, Some(&state.realtime));
            }
            Err(error) => {
                let error_text = error.to_string();
                let text = format!("MiMo 请求失败：{}", compact_text(&error_text, 400));
                let _ = finalize_codex_round(
                    &app,
                    &state,
                    &run_id,
                    &session_id,
                    "session_failed",
                    &text,
                    json!({"provider": "mimo", "model": model, "error": error_text}),
                );
                emit_status(&app, &state.store, Some(&state.realtime));
            }
        }
    });
}

fn spawn_codex_round(
    app: AppHandle,
    state: AppState,
    run_id: String,
    session_id: String,
    prompt: String,
) {
    let launch = match resolve_codex_launch_paths() {
        Some(paths) => paths,
        None => {
            let text = "未找到 Codex CLI，请确认 node.exe 与 @openai/codex 已正确安装。";
            let _ = finalize_codex_round(
                &app,
                &state,
                &run_id,
                &session_id,
                "round_failed",
                text,
                json!({"error": "codex_not_found"}),
            );
            finish_codex_round_state(&state, &run_id, "failed", None);
            emit_status(&app, &state.store, Some(&state.realtime));
            return;
        }
    };

    let (bridge_dir, resume_session) = match codex_bridge_runtime_for_run(&state, &run_id)
        .and_then(|bridge| bridge.lock().ok().map(|runtime| (runtime.bridge_dir.clone(), runtime.session_bootstrapped)))
    {
        Some(info) => info,
        None => (state.store.runtime.join("codex-bridges").join(&run_id), false),
    };
    let workspace = state.store.workspace.clone();
    let user_root = env::var("USER_ROOT").unwrap_or_else(|_| r"C:\Users\28219".to_string());
    std::thread::spawn(move || {
        let mut command = Command::new(&launch.node_exe);
        command
            .arg(&launch.codex_js);
        let codex_provider = state
            .store
            .codex_model_provider_id_for_run(&run_id)
            .map(|provider_id| codex_model_provider_by_id(&provider_id))
            .unwrap_or_else(|_| codex_model_provider_by_id(CODEX_DEFAULT_PROVIDER_ID));
        for arg in codex_bridge_launch_args(
            &codex_provider.id,
            &prompt,
            &workspace,
            &user_root,
            resume_session,
            &codex_provider.model,
        ) {
            command.arg(arg);
        }
        if codex_provider.id == CODEX_MIMO_PROVIDER_ID {
            let mimo_key = env_var_any_scope("MIMO_API_KEY")
                .or_else(|| env_var_any_scope("XIAOMI_MIMO_API_KEY"))
                .or_else(|| env_var_any_scope("MIMO_KEY"));
            command
                .env("MIMO_API_KEY", mimo_key.clone().unwrap_or_default())
                .env("OPENAI_API_KEY", mimo_key.clone().unwrap_or_default())
                .env("ANTHROPIC_AUTH_TOKEN", mimo_key.unwrap_or_default())
                .env("OPENAI_BASE_URL", CODEX_MIMO_OPENAI_BASE_URL)
                .env("ANTHROPIC_BASE_URL", CODEX_MIMO_ANTHROPIC_BASE_URL)
                .env("MIMO_BASE_URL", CODEX_MIMO_OPENAI_BASE_URL)
                .env("MIMO_MODEL", CODEX_MIMO_MODEL)
                .env("ANTHROPIC_MODEL", CODEX_MIMO_MODEL);
        } else {
            command
                .env_remove("MIMO_API_KEY")
                .env_remove("XIAOMI_MIMO_API_KEY")
                .env_remove("ANTHROPIC_AUTH_TOKEN")
                .env_remove("MIMO_BASE_URL")
                .env_remove("ANTHROPIC_BASE_URL")
                .env_remove("MIMO_MODEL")
                .env_remove("ANTHROPIC_MODEL");
        }
        command
            .current_dir(&bridge_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        apply_hidden_window(&mut command);

        let mut child: Child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let text = format!("Codex round 启动失败：{error}");
                let _ = finalize_codex_round(
                    &app,
                    &state,
                    &run_id,
                    &session_id,
                    "round_failed",
                    &text,
                    json!({"error": error.to_string()}),
                );
                finish_codex_round_state(&state, &run_id, "failed", None);
                emit_status(&app, &state.store, Some(&state.realtime));
                return;
            }
        };

        let pid = child.id();
        let mut should_interrupt_after_spawn = false;
        if let Some(bridge) = codex_bridge_runtime_for_run(&state, &run_id) {
            if let Ok(mut runtime) = bridge.lock() {
                runtime.current_pid = Some(pid);
                runtime.last_round_started_at = Some(Utc::now().timestamp());
                runtime.current_round = Some(CodexRoundRuntime {
                    prompt: prompt.clone(),
                    started_at: Utc::now().timestamp(),
                    ended_at: None,
                    pid: Some(pid),
                    status: "running".to_string(),
                    exit_code: None,
                    interrupt_requested: false,
                });
                runtime.last_backend_activity_at = Utc::now().timestamp();
                should_interrupt_after_spawn = runtime.interrupt_requested;
            }
        }
        if should_interrupt_after_spawn {
            terminate_pid_gracefully_then_force(pid);
        }
        if let Some(stdout) = child.stdout.take() {
            spawn_stream_reader(
                app.clone(),
                state.clone(),
                run_id.clone(),
                session_id.clone(),
                "codex",
                "stdout",
                stdout,
            );
        }
        if let Some(stderr) = child.stderr.take() {
            spawn_stream_reader(
                app.clone(),
                state.clone(),
                run_id.clone(),
                session_id.clone(),
                "codex",
                "stderr",
                stderr,
            );
        }

        let code = child
            .wait()
            .ok()
            .and_then(|status| status.code())
            .unwrap_or(-1);
        let interrupted = codex_bridge_runtime_for_run(&state, &run_id)
            .and_then(|bridge| bridge.lock().ok().map(|runtime| runtime.interrupt_requested))
            .unwrap_or(false);
        if let Some(bridge) = codex_bridge_runtime_for_run(&state, &run_id) {
            if let Ok(mut runtime) = bridge.lock() {
                runtime.current_pid = None;
                runtime.last_round_ended_at = Some(Utc::now().timestamp());
                if let Some(round) = runtime.current_round.as_mut() {
                    round.ended_at = Some(Utc::now().timestamp());
                    round.exit_code = Some(code);
                    round.status = if interrupted {
                        "interrupted".to_string()
                    } else if code == 0 {
                        "completed".to_string()
                    } else {
                        "failed".to_string()
                    };
                    round.interrupt_requested = interrupted;
                }
            }
        }

        if interrupted {
            let _ = finalize_codex_round(
                &app,
                &state,
                &run_id,
                &session_id,
                "round_interrupted",
                "已中断当前 Codex 轮次，可继续发送下一条消息。",
                json!({"pid": pid, "code": code}),
            );
        } else if code == 0 {
            if let Some(bridge) = codex_bridge_runtime_for_run(&state, &run_id) {
                if let Ok(mut runtime) = bridge.lock() {
                    runtime.session_bootstrapped = true;
                    let marker_path = codex_bridge_marker_path(&runtime);
                    let _ = fs::write(
                        marker_path,
                        serde_json::to_string_pretty(&json!({
                            "runId": run_id,
                            "sessionId": session_id,
                            "bootstrappedAt": now(),
                            "resume": true
                        }))
                        .unwrap_or_else(|_| "{}".to_string())
                            + "\n",
                    );
                }
            }
            let _ = finalize_codex_round(
                &app,
                &state,
                &run_id,
                &session_id,
                "round_completed",
                "Codex 当前轮次已结束，桥接保持待命，可继续输入下一条消息。",
                json!({"code": code}),
            );
        } else {
            let _ = finalize_codex_round(
                &app,
                &state,
                &run_id,
                &session_id,
                "round_failed",
                &format!("Codex 当前轮次退出，退出码 {code}"),
                json!({"code": code}),
            );
        }
        finish_codex_round_state(
            &state,
            &run_id,
            if interrupted {
                "interrupted"
            } else if code == 0 {
                "completed"
            } else {
                "failed"
            },
            Some(code),
        );

        if let Some(bridge) = codex_bridge_runtime_for_run(&state, &run_id) {
            let mut should_restart = false;
            if let Ok(mut runtime) = bridge.lock() {
                runtime.sleeping = false;
                should_restart = !runtime.queue.is_empty();
            }
            emit_status(&app, &state.store, Some(&state.realtime));
            if should_restart {
                start_codex_queue_worker(app.clone(), state.clone(), run_id.clone());
            }
        } else {
            emit_status(&app, &state.store, Some(&state.realtime));
        }
    });
}

fn start_codex_queue_worker(app: AppHandle, state: AppState, run_id: String) {
    let Some(bridge) = codex_bridge_runtime_for_run(&state, &run_id) else {
        return;
    };
    let should_start = {
        let mut runtime = match bridge.lock() {
            Ok(runtime) => runtime,
            Err(_) => return,
        };
        if runtime.worker_running || runtime.sleeping {
            false
        } else if let Some(prompt) = runtime.queue.pop_front() {
            runtime.worker_running = true;
            runtime.last_backend_activity_at = Utc::now().timestamp();
            runtime.current_round = Some(CodexRoundRuntime {
                prompt: prompt.clone(),
                started_at: Utc::now().timestamp(),
                ended_at: None,
                pid: None,
                status: "starting".to_string(),
                exit_code: None,
                interrupt_requested: false,
            });
            let session_id = runtime.session_id.clone();
            drop(runtime);
            spawn_codex_round(app, state, run_id, session_id, prompt);
            true
        } else {
            false
        }
    };
    if !should_start {
        return;
    }
}

fn ensure_codex_bridge(app: &AppHandle, state: &AppState, run_id: &str) -> Result<String> {
    let bridge = get_or_create_codex_bridge(state, run_id)?;
    let session_id = bridge
        .lock()
        .map_err(|_| TeamflowError::Message("Codex bridge 状态锁已损坏。".to_string()))?
        .session_id
        .clone();
    start_codex_queue_worker(app.clone(), state.clone(), run_id.to_string());
    Ok(session_id)
}

fn codex_interrupt_current_round(state: &AppState, run_id: &str) -> Result<Option<u32>> {
    let Some(bridge) = codex_bridge_runtime_for_run(state, run_id) else {
        return Ok(None);
    };
    let mut runtime = bridge
        .lock()
        .map_err(|_| TeamflowError::Message("Codex bridge 状态锁已损坏。".to_string()))?;
    if runtime.current_round.is_some() || runtime.current_pid.is_some() || runtime.worker_running {
        runtime.interrupt_requested = true;
        if let Some(round) = runtime.current_round.as_mut() {
            round.interrupt_requested = true;
        }
    }
    Ok(runtime.current_pid)
}

fn ensure_codex_idle_monitor(app: AppHandle, state: AppState) {
    if state
        .codex_idle_monitor_started
        .swap(true, Ordering::SeqCst)
    {
        return;
    }
    std::thread::spawn(move || loop {
        let now_ts = Utc::now().timestamp();
        let timed_out_runs = state
            .codex_bridges
            .lock()
            .ok()
            .map(|map| {
                map.values()
                    .filter_map(|bridge| {
                        bridge.lock().ok().and_then(|runtime| {
                            let idle_user = now_ts - runtime.last_user_input_at >= CODEX_IDLE_USER_TIMEOUT_SECS;
                            let idle_backend = now_ts - runtime.last_backend_activity_at >= CODEX_IDLE_ACTIVITY_GRACE_SECS;
                            if idle_user && idle_backend && !runtime.worker_running && runtime.current_pid.is_none() && runtime.queue.is_empty() {
                                Some(runtime.run_id.clone())
                            } else {
                                None
                            }
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for run_id in timed_out_runs {
            if let Some(bridge) = codex_bridge_runtime_for_run(&state, &run_id) {
                if let Ok(mut runtime) = bridge.lock() {
                    runtime.sleeping = true;
                    runtime.current_round = None;
                    runtime.current_pid = None;
                    runtime.worker_running = false;
                }
            }
            let _ = state.store.append_process_event_for_run(
                &run_id,
                codex_bridge_session_id_for_run(&state, &run_id).as_deref(),
                Some("codex"),
                "bridge_sleeping",
                "会话已闲置超过 30 分钟，Codex 已休眠释放资源。",
                None,
                json!({
                    "idleUserSeconds": CODEX_IDLE_USER_TIMEOUT_SECS,
                    "idleActivityGraceSeconds": CODEX_IDLE_ACTIVITY_GRACE_SECS
                }),
            );
            let _ = app.emit(
                "process_event",
                json!({
                    "runId": run_id,
                    "type": "bridge_sleeping",
                    "message": "会话已闲置超过 30 分钟，Codex 已休眠释放资源。"
                }),
            );
            emit_status(&app, &state.store, Some(&state.realtime));
        }
        std::thread::sleep(Duration::from_secs(CODEX_IDLE_SCAN_SECS));
    });
}

fn spawn_stream_reader<R: std::io::Read + Send + 'static>(
    app: AppHandle,
    state: AppState,
    run_id: String,
    session_id: String,
    agent: &'static str,
    stream: &'static str,
    reader: R,
) {
    std::thread::spawn(move || {
        let mut thinking_open = false;
        for line in BufReader::new(reader)
            .lines()
            .map_while(std::result::Result::ok)
        {
            if line.trim().is_empty() {
                continue;
            }
            if agent == "codex" {
                touch_codex_bridge_backend_activity(&state, &run_id);
            }
            let _ = state
                .store
                .append_transcript_for_run(&run_id, &session_id, agent, stream, &line);
            let mut parsed = parse_output(agent, stream, &line);

            if parsed.event_type == "thinking" {
                parsed.event_type = if thinking_open {
                    "thinking_updated".to_string()
                } else {
                    thinking_open = true;
                    "thinking_started".to_string()
                };
            } else if thinking_open {
                thinking_open = false;
                let _ = state.store.append_process_event_for_run(
                    &run_id,
                    Some(&session_id),
                    Some(agent),
                    "thinking_ended",
                    "思考结束",
                    parsed.task_id.as_deref(),
                    json!({"raw": "thinking ended"}),
                );
            }

            let _ = state.store.append_process_event_for_run(
                &run_id,
                Some(&session_id),
                Some(agent),
                &parsed.event_type,
                &parsed.summary,
                parsed.task_id.as_deref(),
                parsed.payload.clone(),
            );
            if let Ok(message) = state.store.append_agent_message_for_run(
                &run_id,
                &session_id,
                agent,
                "assistant",
                &parsed.kind,
                &parsed.message,
                parsed.task_id.as_deref(),
            ) {
                let mut emitted = serde_json::to_value(message).unwrap_or(json!({}));
                if let Some(obj) = emitted.as_object_mut() {
                    obj.insert("eventType".to_string(), Value::String(parsed.event_type.clone()));
                    if let Some(value) = parsed.payload.get("status") {
                        obj.insert("status".to_string(), value.clone());
                    }
                    if let Some(value) = parsed.payload.get("tool") {
                        obj.insert("tool".to_string(), value.clone());
                    }
                    if let Some(value) = parsed.payload.get("actionLabel") {
                        obj.insert("actionLabel".to_string(), value.clone());
                    }
                    if let Some(value) = parsed.payload.get("durationMs") {
                        obj.insert("durationMs".to_string(), value.clone());
                    }
                    if let Some(value) = parsed.payload.get("isMacroAction") {
                        obj.insert("isMacroAction".to_string(), value.clone());
                    }
                }
                let _ = app.emit("agent_message_added", emitted.clone());
                state.realtime.emit(
                    &app,
                    Some(&run_id),
                    Some(&session_id),
                    Some(agent),
                    "agent_message",
                    &parsed.event_type,
                    None,
                    emitted,
                );
            }
            if matches!(parsed.event_type.as_str(), "review_local" | "review_mimo") {
                let payload = json!({
                    "runId": run_id,
                    "taskId": parsed.task_id.clone(),
                    "sessionId": session_id,
                    "agent": agent,
                    "type": parsed.event_type.clone(),
                    "message": parsed.summary
                });
                let _ = app.emit("review_recorded", payload.clone());
                state.realtime.emit(
                    &app,
                    Some(&run_id),
                    Some(&session_id),
                    Some(agent),
                    "review_recorded",
                    &parsed.event_type,
                    parsed.task_id.as_deref(),
                    payload,
                );
            }
            if matches!(parsed.event_type.as_str(), "session_failed") {
                let payload = json!({
                    "runId": run_id,
                    "taskId": parsed.task_id.clone(),
                    "sessionId": session_id,
                    "agent": agent,
                    "type": parsed.event_type.clone(),
                    "message": parsed.summary
                });
                let _ = app.emit("process_error", payload.clone());
                state.realtime.emit(
                    &app,
                    Some(&run_id),
                    Some(&session_id),
                    Some(agent),
                    "process_error",
                    &parsed.event_type,
                    parsed.task_id.as_deref(),
                    payload,
                );
            }
            if matches!(parsed.event_type.as_str(), "task_delegated" | "task_claimed") {
                let payload = json!({
                    "runId": run_id,
                    "taskId": parsed.task_id.clone(),
                    "sessionId": session_id,
                    "agent": agent,
                    "type": parsed.event_type.clone(),
                    "message": parsed.summary
                });
                let _ = app.emit("task_changed", payload.clone());
                state.realtime.emit(
                    &app,
                    Some(&run_id),
                    Some(&session_id),
                    Some(agent),
                    "task_changed",
                    &parsed.event_type,
                    parsed.task_id.as_deref(),
                    payload,
                );
            }
            let transcript_payload = json!({"sessionId": session_id, "agent": agent, "stream": stream, "chunk": line});
            let _ = app.emit("raw_transcript_appended", transcript_payload.clone());
            state.realtime.emit(
                &app,
                Some(&run_id),
                Some(&session_id),
                Some(agent),
                "raw_transcript",
                "raw_transcript_appended",
                None,
                transcript_payload,
            );
        }
        if thinking_open {
            let _ = state.store.append_process_event_for_run(
                &run_id,
                Some(&session_id),
                Some(agent),
                "thinking_ended",
                "思考结束",
                None,
                json!({"raw": "thinking ended"}),
            );
        }
        emit_status(&app, &state.store, Some(&state.realtime));
    });
}

fn spawn_session(
    app: AppHandle,
    state: AppState,
    run_id: String,
    session_id: String,
    agent: &'static str,
    mut command: Command,
) {
    let _ = state.store.append_process_event_for_run(
        &run_id,
        Some(&session_id),
        Some(agent),
        "status",
        "会话信息：后台 CLI 会话已启动",
        None,
        json!({"panel": "会话信息"}),
    );
    let _ = state.store.append_process_event_for_run(
        &run_id,
        Some(&session_id),
        Some(agent),
        "status",
        "本地验证与 MiMo 审查日志将写入诊断抽屉",
        None,
        json!({"panel": "本地验证 / MiMo 审查"}),
    );
    let _ = state.store.append_agent_message_for_run(
        &run_id,
        &session_id,
        agent,
        "system",
        "status",
        "后台 CLI 会话已启动，Teamflow 正在转译输出。",
        None,
    );
    let _ = state.store.append_process_event_for_run(
        &run_id,
        Some(&session_id),
        Some(agent),
        "status",
        "后台 CLI 会话已启动。",
        None,
        json!({"phase": "launch"}),
    );
    emit_status(&app, &state.store, Some(&state.realtime));

    std::thread::spawn(move || {
        apply_hidden_window(&mut command);
        let mut child: Child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let text = format!("{agent} CLI 启动失败：{error}");
                let _ = state.store.append_process_event_for_run(
                    &run_id,
                    Some(&session_id),
                    Some(agent),
                    "session_failed",
                    &text,
                    None,
                    json!({"error": error.to_string(), "hint": "缺少启动命令或路径不可用"}),
                );
                if let Ok(message) = state
                    .store
                    .append_agent_message_for_run(
                        &run_id,
                        &session_id,
                        agent,
                        "system",
                        "session_failed",
                        &text,
                        None,
                    )
                {
                    let emitted = serde_json::to_value(message).unwrap_or(json!({}));
                    let _ = app.emit("agent_message_added", emitted.clone());
                    state.realtime.emit(
                        &app,
                        Some(&run_id),
                        Some(&session_id),
                        Some(agent),
                        "agent_message",
                        "session_failed",
                        None,
                        emitted,
                    );
                }
                let process_payload = json!({"runId": run_id, "sessionId": session_id, "agent": agent, "message": text, "type": "session_failed"});
                let _ = app.emit("process_error", process_payload.clone());
                state.realtime.emit(
                    &app,
                    Some(&run_id),
                    Some(&session_id),
                    Some(agent),
                    "process_error",
                    "session_failed",
                    None,
                    process_payload,
                );
                let _ = state
                    .store
                    .finish_session_for_run(&run_id, &session_id, "FAILED", Some("启动失败"));
                emit_status(&app, &state.store, Some(&state.realtime));
                return;
            }
        };

        let pid = child.id();
        register_runtime(
            &state,
            SessionRuntime {
                session_id: session_id.clone(),
                run_id: run_id.clone(),
                agent: agent.to_string(),
                pid,
            },
        );

        if let Some(stdout) = child.stdout.take() {
            spawn_stream_reader(
                app.clone(),
                state.clone(),
                run_id.clone(),
                session_id.clone(),
                agent,
                "stdout",
                stdout,
            );
        }
        if let Some(stderr) = child.stderr.take() {
            spawn_stream_reader(
                app.clone(),
                state.clone(),
                run_id.clone(),
                session_id.clone(),
                agent,
                "stderr",
                stderr,
            );
        }

        let code = child
            .wait()
            .ok()
            .and_then(|status| status.code())
            .unwrap_or(-1);
        unregister_runtime(&state, &session_id);
        let current_status = state
            .store
            .session_status_for_run(&run_id, &session_id)
            .ok()
            .flatten();
        let final_status = if current_status.as_deref() == Some("INTERRUPTED") {
            "INTERRUPTED"
        } else if code == 0 {
            "COMPLETED"
        } else {
            "FAILED"
        };
        let event_type = match final_status {
            "INTERRUPTED" => "session_interrupted",
            "COMPLETED" => "session_completed",
            _ => "session_failed",
        };
        let text = format!("{agent} CLI 会话结束，退出码 {code}");
        let _ = state.store.finish_session_for_run(
            &run_id,
            &session_id,
            final_status,
            if code == 0 { None } else { Some(&text) },
        );
        let _ = state.store.append_process_event_for_run(
            &run_id,
            Some(&session_id),
            Some(agent),
            event_type,
            &text,
            None,
            json!({"code": code}),
        );
        if let Ok(message) =
            state
                .store
                .append_agent_message_for_run(
                    &run_id,
                    &session_id,
                    agent,
                    "system",
                    event_type,
                    &text,
                    None,
                )
        {
            let emitted = serde_json::to_value(message).unwrap_or(json!({}));
            let _ = app.emit("agent_message_added", emitted.clone());
            state.realtime.emit(
                &app,
                Some(&run_id),
                Some(&session_id),
                Some(agent),
                "agent_message",
                event_type,
                None,
                emitted,
            );
        }
        emit_status(&app, &state.store, Some(&state.realtime));
    });
}

fn spawn_claude_for_run(app: &AppHandle, state: &AppState, run_id: &str, task: &Task) -> Result<String> {
    let claude_path = resolve_command_path(&[
        "C:\\Users\\28219\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe",
        "claude.exe",
        "claude.cmd",
        "claude",
    ])
    .ok_or_else(|| {
        TeamflowError::Message(
            "未找到 Claude Code CLI，请确认 claude 已安装并可在 PATH 中使用。".to_string(),
        )
    })?;
    state.store.ensure_claude_mcp_config()?;
    let task_summary = format!("{} {}", task.id, task.title);
    let prompt = format!(
        "你是 Teamflow Desktop 的 Claude 执行者。必须通过 Teamflow MCP 依次执行 get_task -> 实现 -> submit_review。当前候选任务：{task_summary}"
    );
    let session_id = state
        .store
        .start_session_for_run(run_id, "claude", Some(&prompt))?;
    let mcp_config = state.store.runtime.join("claude-mcp.json");
    let mut command = Command::new(claude_path);
    let args = vec![
        "-p".to_string(),
        prompt,
        "--output-format=stream-json".to_string(),
        "--mcp-config".to_string(),
        mcp_config.to_string_lossy().to_string(),
        "--strict-mcp-config".to_string(),
        "--permission-mode".to_string(),
        "bypassPermissions".to_string(),
        "--add-dir".to_string(),
        env::var("USER_ROOT").unwrap_or_else(|_| r"C:\Users\28219".to_string()),
    ];
    command
        .args(&args)
        .env("TEAMFLOW_RUN_ID", run_id)
        .current_dir(&state.store.workspace)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    let mimo_env = select_mimo_env();
    if let Some((_, key)) = mimo_env.mimo_api_key.as_ref() {
        command
            .env("MIMO_API_KEY", key)
            .env("XIAOMI_MIMO_API_KEY", key);
    }
    if let Some((_, key)) = mimo_env.anthropic_auth_token.as_ref() {
        command.env("ANTHROPIC_AUTH_TOKEN", key);
    }
    command
        .env("MIMO_BASE_URL", &mimo_env.base_url)
        .env("ANTHROPIC_BASE_URL", &mimo_env.base_url)
        .env("MIMO_MODEL", &mimo_env.model)
        .env("ANTHROPIC_MODEL", &mimo_env.model);
    spawn_session(
        app.clone(),
        state.clone(),
        run_id.to_string(),
        session_id.clone(),
        "claude",
        command,
    );
    Ok(session_id)
}

fn scheduler_pick_next_run(state: &AppState, claimable: &[ClaimableTask]) -> Option<ClaimableTask> {
    if claimable.is_empty() {
        return None;
    }
    let mut run_order = Vec::<String>::new();
    for item in claimable {
        if !run_order.iter().any(|run| run == &item.run_id) {
            run_order.push(item.run_id.clone());
        }
    }
    if run_order.is_empty() {
        return None;
    }

    let mut next_index = if let Ok(mut cursor) = state.worker_rr_cursor.lock() {
        let index = *cursor % run_order.len();
        *cursor = (*cursor + 1) % run_order.len();
        index
    } else {
        0
    };

    for _ in 0..run_order.len() {
        let selected_run = &run_order[next_index];
        if let Some(task) = claimable
            .iter()
            .find(|item| &item.run_id == selected_run)
            .cloned()
        {
            if count_running_claude_for_run(state, selected_run) < WORKER_PER_RUN_CAP_DEFAULT {
                return Some(task);
            }
        }
        next_index = (next_index + 1) % run_order.len();
    }
    None
}

fn count_running_claude_global(state: &AppState) -> usize {
    state
        .sessions
        .lock()
        .ok()
        .map(|map| map.values().filter(|item| item.agent == "claude").count())
        .unwrap_or(0)
}

fn count_running_claude_for_run(state: &AppState, run_id: &str) -> usize {
    state
        .sessions
        .lock()
        .ok()
        .map(|map| {
            map.values()
                .filter(|item| item.agent == "claude" && item.run_id == run_id)
                .count()
        })
        .unwrap_or(0)
}

fn maybe_spawn_claude_from_pool(app: &AppHandle, state: &AppState) -> Result<Option<String>> {
    let paused = *state
        .worker_paused
        .lock()
        .map_err(|_| TeamflowError::Message("Claude Worker 状态锁已损坏。".to_string()))?;
    if paused {
        return Ok(None);
    }

    if count_running_claude_global(state) >= WORKER_GLOBAL_CAP_DEFAULT {
        return Ok(None);
    }

    let claimable = state.store.claimable_tasks_all_runs()?;
    let Some(candidate) = scheduler_pick_next_run(state, &claimable) else {
        let _ = state.store.add_event(
            "claude_worker_idle",
            None,
            Some("claude"),
            "Claude Worker 空闲中，当前没有可领取任务。",
            json!({}),
        );
        emit_status(app, &state.store, Some(&state.realtime));
        return Ok(None);
    };

    let session_id = spawn_claude_for_run(app, state, &candidate.run_id, &candidate.task)?;
    Ok(Some(session_id))
}

fn update_task_state_for_run(
    app: &AppHandle,
    state: &AppState,
    run_id: &str,
    task_id: &str,
    status: &str,
    event_type: &str,
    message: &str,
    payload: Value,
    clear_last_error: bool,
    last_error: Option<&str>,
) -> Result<Task> {
    let conn = state.store.connect()?;
    if clear_last_error {
        conn.execute(
            "update tasks set status=?1, last_error=null, updated_at=?2 where run_id=?3 and id=?4",
            params![status, now(), run_id, task_id],
        )?;
    } else {
        conn.execute(
            "update tasks set status=?1, last_error=?2, updated_at=?3 where run_id=?4 and id=?5",
            params![status, last_error, now(), run_id, task_id],
        )?;
    }

    state.store.add_event_for_run(
        run_id,
        event_type,
        Some(task_id),
        Some("codex"),
        message,
        payload.clone(),
    )?;
    state.store.append_process_event_for_run(
        run_id,
        None,
        Some("system"),
        event_type,
        message,
        Some(task_id),
        payload.clone(),
    )?;
    let task = state
        .store
        .get_task_for_run(run_id, task_id)?
        .ok_or_else(|| TeamflowError::Message(format!("未知任务：{task_id}")))?;
    let payload = json!({
        "runId": run_id,
        "taskId": task_id,
        "status": status,
        "type": event_type,
        "message": message,
        "payload": payload
    });
    let _ = app.emit("task_changed", payload.clone());
    state.realtime.emit(
        app,
        Some(run_id),
        None,
        Some("system"),
        "task_action",
        event_type,
        Some(task_id),
        payload,
    );
    emit_status(app, &state.store, Some(&state.realtime));
    Ok(task)
}

fn stop_runtime_sessions_for_run(state: &AppState, run_id: &str) -> Result<Vec<String>> {
    let runtimes = state
        .sessions
        .lock()
        .map_err(|_| TeamflowError::Message("会话状态锁已损坏。".to_string()))?
        .values()
        .filter(|item| item.run_id == run_id)
        .cloned()
        .collect::<Vec<_>>();
    let mut interrupted = Vec::new();
    for runtime in runtimes {
        terminate_pid(runtime.pid);
        interrupted.push(runtime.session_id);
    }
    Ok(interrupted)
}

fn parse_worker_poll_seconds() -> u64 {
    env::var("TEAMFLOW_WORKER_POLL_SECONDS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(2)
}

fn ensure_worker_loop(app: AppHandle, state: AppState) {
    let mut should_start = false;
    if let Ok(mut guard) = state.worker_loop_running.lock() {
        if !*guard {
            *guard = true;
            should_start = true;
        }
    }
    if !should_start {
        return;
    }
    std::thread::spawn(move || loop {
        if let Ok(paused) = state.worker_paused.lock() {
            if *paused {
                std::thread::sleep(Duration::from_secs(parse_worker_poll_seconds()));
                continue;
            }
        }
        let running = state
            .sessions
            .lock()
            .ok()
            .map(|map| map.values().any(|item| item.agent == "claude"))
            .unwrap_or(false);
        if !running || count_running_claude_global(&state) < WORKER_GLOBAL_CAP_DEFAULT {
            let _ = maybe_spawn_claude_from_pool(&app, &state);
        }
        std::thread::sleep(Duration::from_secs(parse_worker_poll_seconds()));
    });
}

#[tauri::command]
async fn create_run(app: AppHandle, state: State<'_, AppState>) -> Result<Value> {
    let run = state.store.create_run()?;
    emit_status(&app, &state.store, Some(&state.realtime));
    Ok(run)
}

#[tauri::command]
async fn list_runs(state: State<'_, AppState>, limit: Option<i64>) -> Result<Vec<RunSummary>> {
    state.store.list_runs(limit.unwrap_or(20))
}

#[tauri::command]
async fn list_runs_grouped(
    state: State<'_, AppState>,
    limit_per_group: Option<i64>,
) -> Result<Vec<RunGroup>> {
    state
        .store
        .list_runs_grouped(limit_per_group.unwrap_or(20))
}

#[tauri::command]
async fn switch_run(app: AppHandle, state: State<'_, AppState>, run_id: String) -> Result<Value> {
    let payload = state.store.switch_run(&run_id)?;
    emit_status(&app, &state.store, Some(&state.realtime));
    Ok(payload)
}

#[tauri::command]
async fn get_run_overview(state: State<'_, AppState>, run_id: String) -> Result<Value> {
    state.store.get_run_overview(&run_id)
}

#[tauri::command]
async fn get_status(state: State<'_, AppState>, run_id: Option<String>) -> Result<Value> {
    let selected_run = run_id.unwrap_or(state.store.require_run()?);
    let mut status = state.store.status_snapshot_for_run(&selected_run)?;
    let worker_paused = *state
        .worker_paused
        .lock()
        .map_err(|_| TeamflowError::Message("Claude Worker 状态锁已损坏。".to_string()))?;
    let worker_running = *state
        .worker_loop_running
        .lock()
        .map_err(|_| TeamflowError::Message("Claude Worker 状态锁已损坏。".to_string()))?;
    let worker_summary = state.store.worker_pool_summary(worker_paused, worker_running)?;
    normalize_status_for_ui(&mut status, &worker_summary)?;
    if let Some(obj) = status.as_object_mut() {
        obj.insert(
            "codexBridgeState".to_string(),
            codex_bridge_state_json(state.inner(), &selected_run),
        );
        obj.insert(
            "codexRoundState".to_string(),
            codex_round_state_json(state.inner(), &selected_run),
        );
    }
    Ok(status)
}

#[tauri::command]
async fn set_codex_model_provider(
    app: AppHandle,
    state: State<'_, AppState>,
    provider_id: String,
    run_id: Option<String>,
) -> Result<Value> {
    let selected_run = run_id.unwrap_or(state.store.require_run()?);
    let selection = state
        .store
        .set_codex_model_provider_for_run(&selected_run, &provider_id)?;
    state.store.append_process_event_for_run(
        &selected_run,
        codex_bridge_session_id_for_run(state.inner(), &selected_run).as_deref(),
        Some("codex"),
        "codex_model_changed",
        "Codex 模型已切换。",
        None,
        selection.clone(),
    )?;
    emit_status(&app, &state.store, Some(&state.realtime));
    Ok(selection)
}

#[tauri::command]
async fn get_ui_settings(state: State<'_, AppState>) -> Result<Value> {
    state.store.ui_settings()
}

#[tauri::command]
async fn set_ui_setting(state: State<'_, AppState>, key: String, value: Value) -> Result<Value> {
    state.store.set_ui_setting(&key, value)
}

#[tauri::command]
async fn set_ui_settings(state: State<'_, AppState>, settings: Value) -> Result<Value> {
    state.store.write_ui_settings(settings)
}

#[tauri::command]
async fn run_desktop_command(
    app: AppHandle,
    window: tauri::WebviewWindow,
    command: String,
) -> Result<()> {
    match command.as_str() {
        "minimize" => window
            .minimize()
            .map_err(|error| TeamflowError::Message(format!("窗口最小化失败：{error}")))?,
        "toggleMaximize" => {
            let is_maximized = window
                .is_maximized()
                .map_err(|error| TeamflowError::Message(format!("读取窗口状态失败：{error}")))?;
            if is_maximized {
                window
                    .unmaximize()
                    .map_err(|error| TeamflowError::Message(format!("窗口还原失败：{error}")))?;
            } else {
                window
                    .maximize()
                    .map_err(|error| TeamflowError::Message(format!("窗口最大化失败：{error}")))?;
            }
        }
        "close" => window
            .close()
            .map_err(|error| TeamflowError::Message(format!("窗口关闭失败：{error}")))?,
        "quit" => app.exit(0),
        _ => {}
    }
    Ok(())
}

#[tauri::command]
async fn get_realtime_config(state: State<'_, AppState>) -> Result<RealtimeConfig> {
    Ok(state.realtime.config())
}

#[tauri::command]
async fn get_realtime_events(
    state: State<'_, AppState>,
    from_seq: Option<u64>,
    run_id: Option<String>,
) -> Result<Value> {
    let from = from_seq.unwrap_or(0);
    let rows = state.realtime.replay_from(from, run_id.as_deref());
    let latest_seq = state.realtime.seq.load(Ordering::Relaxed);
    Ok(json!({
        "events": rows,
        "latestSeq": latest_seq
    }))
}

#[tauri::command]
async fn run_realtime_benchmark(
    app: AppHandle,
    state: State<'_, AppState>,
    sample_count: Option<u64>,
    run_id: Option<String>,
) -> Result<RealtimeBenchmarkSummary> {
    let total = sample_count.unwrap_or(20).clamp(1, 10_000);
    let started_at_ms = Utc::now().timestamp_millis();
    let mut first_seq = 0;
    let mut last_seq = 0;

    for index in 0..total {
        let sent_at_ms = Utc::now().timestamp_millis();
        let source_item_id = format!("benchmark-{}-{}", started_at_ms, index + 1);
        let seq = state.realtime.emit_with_seq(
            &app,
            run_id.as_deref(),
            None,
            Some("system"),
            "benchmark",
            "latency_probe",
            Some(&source_item_id),
            json!({
                "sentAtMs": sent_at_ms,
                "index": index + 1,
                "total": total
            }),
        );
        if first_seq == 0 {
            first_seq = seq;
        }
        last_seq = seq;
    }
    let ended_at_ms = Utc::now().timestamp_millis();

    Ok(RealtimeBenchmarkSummary {
        sample_count: total,
        first_seq,
        last_seq,
        started_at_ms,
        ended_at_ms,
    })
}

#[tauri::command]
async fn send_codex_message(
    app: AppHandle,
    state: State<'_, AppState>,
    text: String,
    run_id: Option<String>,
) -> Result<String> {
    let prompt = text.trim();
    if prompt.is_empty() {
        return Err(TeamflowError::Message("请输入任务目标。".to_string()));
    }
    let run_id = run_id.unwrap_or(state.store.require_run()?);
    state.store.update_run_title_if_empty(&run_id, prompt)?;
    let provider_id = state.store.codex_model_provider_id_for_run(&run_id)?;
    let transport = codex_message_transport_for_provider(&provider_id);
    let session_id = match transport {
        CodexMessageTransport::Bridge => ensure_codex_bridge(&app, state.inner(), &run_id)?,
        CodexMessageTransport::MimoDirect => state.store.ensure_codex_bridge_session_for_run(&run_id)?,
    };
    let user_message = state
        .store
        .append_agent_message_for_run(&run_id, &session_id, "codex", "user", "status", prompt, None)?;
    let emitted_user = serde_json::to_value(user_message).unwrap_or(json!({}));
    let _ = app.emit("agent_message_added", emitted_user.clone());
    state.realtime.emit(
        &app,
        Some(&run_id),
        Some(&session_id),
        Some("codex"),
        "agent_message",
        "status",
        None,
        emitted_user,
    );
    if matches!(transport, CodexMessageTransport::MimoDirect) {
        let mimo_provider = codex_model_provider_by_id(&provider_id);
        let _ = state.store.append_process_event_for_run(
            &run_id,
            Some(&session_id),
            Some("codex"),
            "status",
            "MiMo 已接收你的消息，正在生成回复。",
            None,
            json!({
                "status": "running",
                "actionLabel": "MiMo 正在处理新指令",
                "provider": "mimo"
            }),
        )?;
        spawn_mimo_round(
            app.clone(),
            state.inner().clone(),
            run_id.clone(),
            session_id.clone(),
            prompt.to_string(),
            mimo_provider.model,
        );
        emit_status(&app, &state.store, Some(&state.realtime));
        return Ok(session_id);
    }
    let bridge = codex_bridge_runtime_for_run(state.inner(), &run_id)
        .ok_or_else(|| TeamflowError::Message("当前会话没有可用的 Codex bridge。".to_string()))?;
    {
        let mut runtime = bridge
            .lock()
            .map_err(|_| TeamflowError::Message("Codex bridge 状态锁已损坏。".to_string()))?;
        runtime.last_user_input_at = Utc::now().timestamp();
        runtime.last_backend_activity_at = Utc::now().timestamp();
        runtime.sleeping = false;
        runtime.interrupt_requested = false;
        runtime.queue.push_back(prompt.to_string());
    }
    let _ = state.store.append_process_event_for_run(
        &run_id,
        Some(&session_id),
        Some("codex"),
        "status",
        "Codex 已接收你的消息，正在执行中。",
        None,
        json!({"status": "running", "actionLabel": "Codex 正在处理新指令"}),
    )?;
    start_codex_queue_worker(app.clone(), state.inner().clone(), run_id.clone());
    emit_status(&app, &state.store, Some(&state.realtime));
    Ok(session_id)
}

#[tauri::command]
async fn interrupt_codex_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: Option<String>,
) -> Result<Value> {
    let target_session_id = if let Some(id) = session_id {
        id
    } else {
        state
            .store
            .latest_running_session("codex")?
            .ok_or_else(|| TeamflowError::Message("当前没有正在运行的 Codex 会话。".to_string()))?
    };

    let conn = state.store.connect()?;
    let run_id: String = conn
        .query_row(
            "select run_id from agent_sessions where id=?1 limit 1",
            params![target_session_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| TeamflowError::Message("找不到对应的 Codex 会话。".to_string()))?;

    let pid = codex_interrupt_current_round(state.inner(), &run_id)?;
    if let Some(pid) = pid {
        terminate_pid_gracefully_then_force(pid);
        if let Some(bridge) = codex_bridge_runtime_for_run(state.inner(), &run_id) {
            if let Ok(mut runtime) = bridge.lock() {
                runtime.current_pid = None;
                runtime.interrupt_requested = true;
                if let Some(round) = runtime.current_round.as_mut() {
                    round.status = "interrupted".to_string();
                    round.interrupt_requested = true;
                    round.ended_at = Some(Utc::now().timestamp());
                    round.pid = Some(pid);
                }
            }
        }
        state.store.append_process_event_for_run(
            &run_id,
            Some(&target_session_id),
            Some("codex"),
            "round_interrupted",
            "已中断当前 Codex 轮次，可在本会话继续输入新任务。",
            None,
            json!({"pid": pid, "reason": "user_interrupt"}),
        )?;
        if let Ok(agent_msg) = state.store.append_agent_message_for_run(
            &run_id,
            &target_session_id,
            "codex",
            "system",
            "round_interrupted",
            "已中断当前 Codex 轮次，可在本会话继续输入新任务。",
            None,
        ) {
            let emitted = serde_json::to_value(agent_msg).unwrap_or(json!({}));
            let _ = app.emit("agent_message_added", emitted.clone());
            state.realtime.emit(
                &app,
                Some(&run_id),
                Some(&target_session_id),
                Some("codex"),
                "agent_message",
                "round_interrupted",
                None,
                emitted,
            );
        }
        emit_status(&app, &state.store, Some(&state.realtime));
        return Ok(json!({"sessionId": target_session_id, "interrupted": true, "pid": pid}));
    }

    if let Some(bridge) = codex_bridge_runtime_for_run(state.inner(), &run_id) {
        if let Ok(mut runtime) = bridge.lock() {
            runtime.sleeping = false;
        }
    }
    emit_status(&app, &state.store, Some(&state.realtime));
    Ok(json!({"sessionId": target_session_id, "interrupted": false}))
}

#[tauri::command]
async fn start_claude_worker(app: AppHandle, state: State<'_, AppState>) -> Result<String> {
    ensure_worker_loop(app.clone(), state.inner().clone());
    match maybe_spawn_claude_from_pool(&app, state.inner())? {
        Some(session_id) => Ok(session_id),
        None => Ok("claude-idle".to_string()),
    }
}

#[tauri::command]
async fn pause_worker(app: AppHandle, state: State<'_, AppState>) -> Result<Value> {
    *state
        .worker_paused
        .lock()
        .map_err(|_| TeamflowError::Message("Claude Worker 状态锁已损坏。".to_string()))? = true;
    state.store.add_event(
        "worker_paused",
        None,
        Some("system"),
        "Claude Worker 已暂停。",
        json!({}),
    )?;
    emit_status(&app, &state.store, Some(&state.realtime));
    Ok(json!({"paused": true}))
}

#[tauri::command]
async fn resume_worker(app: AppHandle, state: State<'_, AppState>) -> Result<Value> {
    *state
        .worker_paused
        .lock()
        .map_err(|_| TeamflowError::Message("Claude Worker 状态锁已损坏。".to_string()))? = false;
    state.store.add_event(
        "worker_resumed",
        None,
        Some("system"),
        "Claude Worker 已恢复。",
        json!({}),
    )?;
    ensure_worker_loop(app.clone(), state.inner().clone());
    emit_status(&app, &state.store, Some(&state.realtime));
    Ok(json!({"paused": false}))
}

#[tauri::command]
async fn cancel_task(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    reason: String,
    run_id: Option<String>,
) -> Result<Task> {
    let task = if let Some(run_id) = run_id {
        let conn = state.store.connect()?;
        conn.execute(
            "update tasks set status='CANCELLED', last_error=?1, updated_at=?2 where run_id=?3 and id=?4 and status not in ('COMPLETED','CANCELLED')",
            params![reason, now(), run_id, task_id],
        )?;
        state.store.add_event_for_run(
            &run_id,
            "task_cancelled",
            Some(&task_id),
            Some("codex"),
            &reason,
            json!({"reason": reason}),
        )?;
        state
            .store
            .get_task_for_run(&run_id, &task_id)?
            .ok_or_else(|| TeamflowError::Message(format!("未知任务：{task_id}")))?
    } else {
        state.store.cancel_task(&task_id, &reason)?
    };
    emit_status(&app, &state.store, Some(&state.realtime));
    Ok(task)
}

#[tauri::command]
async fn continue_task(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    run_id: Option<String>,
) -> Result<Task> {
    let run_id = run_id.unwrap_or(state.store.require_run()?);
    update_task_state_for_run(
        &app,
        state.inner(),
        &run_id,
        &task_id,
        "PENDING",
        "task_continued",
        "任务已继续，等待执行者重新领取。",
        json!({"action": "continue"}),
        true,
        None,
    )
}

#[tauri::command]
async fn retry_task_with_instruction(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    instruction: String,
    run_id: Option<String>,
) -> Result<Task> {
    let run_id = run_id.unwrap_or(state.store.require_run()?);
    let hint = compact_text(instruction.trim(), 200);
    update_task_state_for_run(
        &app,
        state.inner(),
        &run_id,
        &task_id,
        "PENDING",
        "task_retry_requested",
        "任务已加入纠偏说明并重新排队。",
        json!({"action": "retry", "instruction": hint}),
        false,
        Some(instruction.trim()),
    )
}

#[tauri::command]
async fn mark_task_completed(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    run_id: Option<String>,
) -> Result<Task> {
    let run_id = run_id.unwrap_or(state.store.require_run()?);
    update_task_state_for_run(
        &app,
        state.inner(),
        &run_id,
        &task_id,
        "COMPLETED",
        "task_marked_completed",
        "任务已由用户标记完成。",
        json!({"action": "mark_completed"}),
        true,
        None,
    )
}

#[tauri::command]
async fn terminate_task_and_codex(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    session_id: Option<String>,
    run_id: Option<String>,
) -> Result<Value> {
    let run_id = run_id.unwrap_or(state.store.require_run()?);
    let task = update_task_state_for_run(
        &app,
        state.inner(),
        &run_id,
        &task_id,
        "CANCELLED",
        "task_cancelled",
        "任务已终止，并将中断当前 Codex 轮次。",
        json!({"action": "terminate"}),
        false,
        Some("用户终止了任务"),
    )?;

    let interrupted = if let Some(pid) = codex_interrupt_current_round(state.inner(), &run_id)? {
        terminate_pid_gracefully_then_force(pid);
        json!({"sessionId": session_id, "interrupted": true, "pid": pid})
    } else {
        json!({"sessionId": session_id, "interrupted": false})
    };

    emit_status(&app, &state.store, Some(&state.realtime));
    Ok(json!({
        "runId": run_id,
        "taskId": task.id,
        "taskStatus": task.status,
        "interrupted": interrupted
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("teamflow-{name}-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    fn test_app_state() -> AppState {
        let instance = SingleInstance::new(&format!("teamflow-test-{}", Uuid::new_v4()))
            .expect("create single instance guard");
        AppState {
            store: Store {
                root: PathBuf::new(),
                runtime: PathBuf::new(),
                workspace: PathBuf::new(),
                db_path: PathBuf::new(),
                tasks_json_path: PathBuf::new(),
                active_run_path: PathBuf::new(),
            },
            worker_paused: Arc::new(Mutex::new(false)),
            worker_loop_running: Arc::new(Mutex::new(false)),
            worker_rr_cursor: Arc::new(Mutex::new(0)),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            codex_bridges: Arc::new(Mutex::new(HashMap::new())),
            codex_idle_monitor_started: Arc::new(AtomicBool::new(false)),
            realtime: Arc::new(RealtimeHub::new()),
            _instance_guard: Arc::new(instance),
        }
    }

    fn test_store(name: &str) -> Store {
        Store::new(test_root(name)).expect("create test store")
    }

    fn run_id_from(value: &Value) -> String {
        value
            .get("currentRunId")
            .and_then(Value::as_str)
            .expect("currentRunId")
            .to_string()
    }

    fn read_run_title(store: &Store, run_id: &str) -> String {
        let conn = store.connect().expect("open db");
        conn.query_row(
            "select title from runs where id=?1",
            params![run_id],
            |row| row.get::<_, String>(0),
        )
        .expect("read run title")
    }

    fn insert_test_task(store: &Store, run_id: &str, task_id: &str, status: &str, goal: &str) {
        let conn = store.connect().expect("open db");
        let now_at = now();
        conn.execute(
            "insert into tasks(run_id, id, title, goal, scope, acceptance_criteria, verify_commands, status, assigned_agent, attempts, max_attempts, last_error, created_at, updated_at) values (?1, ?2, ?3, ?4, '.', ?5, ?6, ?7, null, 0, 3, null, ?8, ?8)",
            params![
                run_id,
                task_id,
                format!("Task {task_id}"),
                goal,
                serde_json::to_string(&vec!["ok"]).expect("acceptance json"),
                serde_json::to_string(&vec![json!({"command": "echo ok"})]).expect("verify json"),
                status,
                now_at
            ],
        )
        .expect("insert test task");
    }

    fn insert_bridge(
        state: &AppState,
        bridge: CodexBridgeRuntime,
    ) -> Arc<Mutex<CodexBridgeRuntime>> {
        let bridge = Arc::new(Mutex::new(bridge));
        state
            .codex_bridges
            .lock()
            .expect("bridge map lock")
            .insert(bridge.lock().expect("bridge lock").run_id.clone(), bridge.clone());
        bridge
    }

    #[test]
    fn parse_output_json_prefers_structured_kind_and_event_type() {
        let line = r#"{"type":"tool_call","message":"call mcp"}"#;
        let parsed = parse_output("codex", "stdout", line);
        assert_eq!(parsed.kind, "tool_call");
        assert_eq!(parsed.event_type, "tool_call");
    }

    #[test]
    fn parse_output_text_fallback_maps_to_normalized_kind() {
        let parsed = parse_output("claude", "stdout", "running command: cargo check");
        assert_eq!(parsed.kind, "command");
        assert_eq!(parsed.event_type, "command_started");
    }

    #[test]
    fn parse_output_stderr_maps_to_error_kind() {
        let parsed = parse_output("claude", "stderr", "permission denied");
        assert_eq!(parsed.kind, "error");
        assert_eq!(parsed.event_type, "session_failed");
    }

    #[test]
    fn normalized_kind_covers_public_aliases() {
        assert_eq!(normalized_kind("thinking_started"), "thinking");
        assert_eq!(normalized_kind("command_finished"), "command");
        assert_eq!(normalized_kind("file_written"), "file_action");
        assert_eq!(normalized_kind("task_claimed"), "task_action");
        assert_eq!(normalized_kind("review_mimo"), "review");
        assert_eq!(normalized_kind("session_completed"), "done");
        assert_eq!(normalized_kind("session_failed"), "error");
        assert_eq!(normalized_kind("unknown"), "status");
    }

    #[test]
    fn select_mimo_env_keeps_anthropic_token_when_mimo_key_differs() {
        let selected = select_mimo_env_from_lookup(|name| match name {
            "MIMO_API_KEY" => Some("mimo-key".to_string()),
            "ANTHROPIC_AUTH_TOKEN" => Some("anthropic-token".to_string()),
            _ => None,
        });

        assert_eq!(
            selected.mimo_api_key,
            Some(("MIMO_API_KEY".to_string(), "mimo-key".to_string()))
        );
        assert_eq!(
            selected.anthropic_auth_token,
            Some((
                "ANTHROPIC_AUTH_TOKEN".to_string(),
                "anthropic-token".to_string()
            ))
        );
    }

    #[test]
    fn select_mimo_env_uses_each_key_as_fallback_for_the_other_channel() {
        let only_mimo = select_mimo_env_from_lookup(|name| match name {
            "MIMO_API_KEY" => Some("shared-mimo-key".to_string()),
            _ => None,
        });
        assert_eq!(
            only_mimo.anthropic_auth_token,
            Some(("MIMO_API_KEY".to_string(), "shared-mimo-key".to_string()))
        );

        let only_anthropic = select_mimo_env_from_lookup(|name| match name {
            "ANTHROPIC_AUTH_TOKEN" => Some("shared-anthropic-key".to_string()),
            _ => None,
        });
        assert_eq!(
            only_anthropic.mimo_api_key,
            Some((
                "ANTHROPIC_AUTH_TOKEN".to_string(),
                "shared-anthropic-key".to_string()
            ))
        );
    }

    #[test]
    fn update_run_title_if_empty_ignores_noise_like_prompts() {
        let store = test_store("run-title-noise");
        let run_id = run_id_from(&store.create_run().expect("create run"));

        let noisy_prompts = [
            r#"WARN  2026-05-04 12:00:00  C:\Users\28219\.agents\skills\plugin\tool.ps1"#,
            r#"https://example.com/agent/files/output.txt"#,
            r#"C:\Users\28219\.agents\skills\codex\launch.ps1"#,
        ];

        for noisy in noisy_prompts {
            store
                .update_run_title_if_empty(&run_id, noisy)
                .expect("ignore noisy prompt");
            assert_eq!(read_run_title(&store, &run_id), "");
        }

        store
            .update_run_title_if_empty(&run_id, "修复会话侧栏分组显示")
            .expect("accept genuine prompt");
        assert_eq!(read_run_title(&store, &run_id), "修复会话侧栏分组显示");
    }

    #[test]
    fn resolve_run_group_ignores_noise_and_uses_workspace_history() {
        let store = test_store("run-group-noise");
        let run_id = run_id_from(&store.create_run().expect("create run"));

        store
            .append_process_event_for_run(
                &run_id,
                Some("session-noise"),
                Some("codex"),
                "status",
                "WARN  C:\\Users\\28219\\.agents\\skills\\plugin\\tool.ps1",
                None,
                json!({"file": r#"WARN C:\Users\28219\.agents\skills\plugin\tool.ps1"#}),
            )
            .expect("write noisy process event");
        store
            .append_agent_message_for_run(
                &run_id,
                "session-noise",
                "codex",
                "system",
                "file_write",
                "https://example.com/plugin/output.ts",
                None,
            )
            .expect("write noisy message");

        let conn = store.connect().expect("open db");
        assert_eq!(
            store.resolve_run_group(&conn, &run_id).expect("resolve noisy group"),
            RUN_GROUP_UNGROUPED
        );

        let workspace_file = store.workspace.join("features").join("session_sidebar.rs");
        store
            .append_process_event_for_run(
                &run_id,
                Some("session-real"),
                Some("codex"),
                "status",
                "写入真实工作区文件",
                None,
                json!({"file": workspace_file.to_string_lossy().to_string()}),
            )
            .expect("write real process event");

        assert_eq!(
            store.resolve_run_group(&conn, &run_id).expect("resolve real group"),
            "features"
        );
    }

    #[test]
    fn list_runs_grouped_keeps_noise_in_ungrouped_only() {
        let store = test_store("run-group-list");

        let real_run = run_id_from(&store.create_run().expect("create real run"));
        let noisy_run = run_id_from(&store.create_run().expect("create noisy run"));

        let real_file = store.workspace.join("src").join("workspace.rs");
        store
            .append_process_event_for_run(
                &real_run,
                Some("session-real"),
                Some("codex"),
                "status",
                "写入真实工作区文件",
                None,
                json!({"file": real_file.to_string_lossy().to_string()}),
            )
            .expect("write real file event");

        store
            .append_process_event_for_run(
                &noisy_run,
                Some("session-noise"),
                Some("codex"),
                "status",
                "WARN  C:\\Users\\28219\\.agents\\skills\\plugin\\tool.ps1",
                None,
                json!({"file": r#"WARN C:\Users\28219\.agents\skills\plugin\tool.ps1"#}),
            )
            .expect("write noisy file event");

        let groups = store.list_runs_grouped(20).expect("list grouped runs");
        let names = groups.iter().map(|group| group.group.as_str()).collect::<Vec<_>>();
        assert!(names.contains(&"src"));
        assert!(names.contains(&RUN_GROUP_UNGROUPED));
        assert!(!names.iter().any(|name| name.contains("agents") || name.contains("http")));

        let real_group = groups.iter().find(|group| group.group == "src").expect("real group");
        assert!(real_group.runs.iter().any(|run| run.run_id == real_run));
        let ungrouped = groups
            .iter()
            .find(|group| group.group == RUN_GROUP_UNGROUPED)
            .expect("ungrouped bucket");
        assert!(ungrouped.runs.iter().any(|run| run.run_id == noisy_run));
    }

    #[test]
    fn status_snapshot_uses_workflow_truth_metrics_and_pipeline_fields() {
        let store = test_store("workflow-metrics");
        let run_id = run_id_from(&store.create_run().expect("create run"));
        let conn = store.connect().expect("open db");
        conn.execute(
            "update runs set project_goal='总目标：验证工作流口径' where id=?1",
            params![run_id],
        )
        .expect("set goal");
        drop(conn);

        insert_test_task(&store, &run_id, "task-001", "COMPLETED", "已确认任务");
        insert_test_task(&store, &run_id, "task-002", "DEGRADED_PASS", "风险通过任务");
        insert_test_task(&store, &run_id, "task-003", "MIMO_REJECTED", "打回任务");
        insert_test_task(&store, &run_id, "task-004", "IN_PROGRESS", "Claude 当前目标");
        insert_test_task(&store, &run_id, "task-005", "PENDING", "排队任务");

        let status = store
            .status_snapshot_for_run(&run_id)
            .expect("status snapshot");

        assert_eq!(status["workflowMetrics"]["totalTasks"], 5);
        assert_eq!(status["workflowMetrics"]["completedTasks"], 1);
        assert_eq!(status["workflowMetrics"]["exceptionTasks"], 2);
        assert_eq!(status["workflowMetrics"]["progressPercent"], 20);
        assert_eq!(status["workflowMetrics"]["currentGoal"], "Claude 当前目标");
        assert_eq!(status["currentTask"]["id"], "task-004");
        assert_eq!(status["dashboardPipeline"]["pending"].as_array().unwrap().len(), 5);
        assert_eq!(status["dashboardPipeline"]["developing"].as_array().unwrap().len(), 2);
        assert_eq!(status["dashboardPipeline"]["review"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn codex_model_selection_defaults_and_persists_per_run() {
        let store = test_store("codex-model-selection");
        let run_id = run_id_from(&store.create_run().expect("create run"));

        let initial = store
            .status_snapshot_for_run(&run_id)
            .expect("initial status");
        assert_eq!(
            initial["codexModelSelection"]["activeProviderId"],
            CODEX_DEFAULT_PROVIDER_ID
        );

        let selection = store
            .set_codex_model_provider_for_run(&run_id, CODEX_MIMO_PROVIDER_ID)
            .expect("set mimo provider");
        assert_eq!(selection["activeProvider"]["model"], CODEX_MIMO_MODEL);
        assert_eq!(
            selection["activeProvider"]["baseUrl"],
            CODEX_MIMO_OPENAI_BASE_URL
        );

        let updated = store
            .status_snapshot_for_run(&run_id)
            .expect("updated status");
        assert_eq!(
            updated["codexModelSelection"]["activeProviderId"],
            CODEX_MIMO_PROVIDER_ID
        );

        let reset = store
            .set_codex_model_provider_for_run(&run_id, CODEX_DEFAULT_PROVIDER_ID)
            .expect("reset gpt provider");
        assert_eq!(reset["activeProviderId"], CODEX_DEFAULT_PROVIDER_ID);
        assert_eq!(
            reset["activeProvider"]["baseUrl"],
            CODEX_DEFAULT_OPENAI_BASE_URL
        );
        assert_eq!(
            reset["activeProvider"]["wireApi"],
            CODEX_DEFAULT_WIRE_API
        );

        let restored = store
            .status_snapshot_for_run(&run_id)
            .expect("restored status");
        assert_eq!(
            restored["codexModelSelection"]["activeProviderId"],
            CODEX_DEFAULT_PROVIDER_ID
        );
    }

    #[test]
    fn claimable_tasks_pause_when_run_has_active_review_or_blocked_task() {
        let store = test_store("claimable-gate");
        let run_id = run_id_from(&store.create_run().expect("create run"));
        insert_test_task(&store, &run_id, "task-001", "IN_PROGRESS", "active");
        insert_test_task(&store, &run_id, "task-002", "PENDING", "queued");

        assert!(store
            .claimable_tasks_all_runs()
            .expect("claimable while active")
            .is_empty());

        let conn = store.connect().expect("open db");
        conn.execute(
            "update tasks set status='COMPLETED' where run_id=?1 and id='task-001'",
            params![run_id],
        )
        .expect("complete active");
        drop(conn);

        let claimable = store
            .claimable_tasks_all_runs()
            .expect("claimable after complete");
        assert_eq!(claimable.len(), 1);
        assert_eq!(claimable[0].task.id, "task-002");
    }

    #[test]
    fn claimable_tasks_pause_when_run_has_degraded_pass() {
        let store = test_store("claimable-degraded-gate");
        let run_id = run_id_from(&store.create_run().expect("create run"));
        insert_test_task(&store, &run_id, "task-001", "DEGRADED_PASS", "risk");
        insert_test_task(&store, &run_id, "task-002", "PENDING", "queued");

        assert!(store
            .claimable_tasks_all_runs()
            .expect("claimable while degraded")
            .is_empty());

        let status = store
            .status_snapshot_for_run(&run_id)
            .expect("status snapshot");
        assert_eq!(status["workflowMetrics"]["completedTasks"], 0);
        assert_eq!(status["workflowMetrics"]["exceptionTasks"], 1);
        assert_eq!(status["workflowMetrics"]["progressPercent"], 0);
        assert_eq!(status["currentTask"]["id"], "task-001");
    }

    #[test]
    fn resolve_run_group_treats_warn_like_paths_as_noise() {
        let store = test_store("run-group-noise-path");
        let run_id = run_id_from(&store.create_run().expect("create run"));

        let conn = store.connect().expect("open db");
        assert_eq!(
            store
                .resolve_run_group(
                    &conn,
                    &run_id,
                )
                .expect("resolve empty group"),
            RUN_GROUP_UNGROUPED
        );

        store
            .append_process_event_for_run(
                &run_id,
                Some("session-noise"),
                Some("codex"),
                "status",
                "WARN  C:\\Users\\28219\\.codex\\.tmp\\plugins\\plugins\\build-ios-apps\\.codex-plugin\\plugin.json",
                None,
                json!({"file": r#"WARN C:\Users\28219\.codex\.tmp\plugins\plugins\build-ios-apps\.codex-plugin\plugin.json"#}),
            )
            .expect("write noisy plugin path");

        assert_eq!(
            store
                .resolve_run_group(&conn, &run_id)
                .expect("noise stays ungrouped"),
            RUN_GROUP_UNGROUPED
        );
    }

    #[test]
    fn ensure_codex_bridge_session_reuses_single_session_per_run() {
        let store = test_store("codex-bridge-single-session");
        let run_id = run_id_from(&store.create_run().expect("create run"));

        let first = store
            .ensure_codex_bridge_session_for_run(&run_id)
            .expect("create first bridge session");
        let second = store
            .ensure_codex_bridge_session_for_run(&run_id)
            .expect("reuse bridge session");

        assert_eq!(first, second);

        let conn = store.connect().expect("open db");
        let codex_count: i64 = conn
            .query_row(
                "select count(1) from agent_sessions where run_id=?1 and agent='codex'",
                params![run_id],
                |row| row.get(0),
            )
            .expect("count codex sessions");
        let running_count: i64 = conn
            .query_row(
                "select count(1) from agent_sessions where run_id=?1 and agent='codex' and status='RUNNING'",
                params![run_id],
                |row| row.get(0),
            )
            .expect("count running codex sessions");

        assert_eq!(codex_count, 1);
        assert_eq!(running_count, 1);
    }

    #[test]
    fn codex_message_transport_switches_to_mimo_direct_for_mimo_provider() {
        assert_eq!(
            codex_message_transport_for_provider(CODEX_DEFAULT_PROVIDER_ID),
            CodexMessageTransport::Bridge
        );
        assert_eq!(
            codex_message_transport_for_provider(CODEX_MIMO_PROVIDER_ID),
            CodexMessageTransport::MimoDirect
        );
        assert_eq!(
            codex_message_transport_for_provider("mimo-v2.5"),
            CodexMessageTransport::MimoDirect
        );
    }

    #[test]
    fn codex_interrupt_current_round_does_not_poison_next_idle_round() {
        let state = test_app_state();
        let run_id = "run-test";
        insert_bridge(
            &state,
            CodexBridgeRuntime {
                run_id: run_id.to_string(),
                session_id: "codex-session".to_string(),
                bridge_dir: PathBuf::new(),
                queue: VecDeque::new(),
                worker_running: false,
                sleeping: false,
                session_bootstrapped: false,
                current_round: None,
                last_round: None,
                last_user_input_at: 0,
                last_backend_activity_at: 0,
                last_round_started_at: None,
                last_round_ended_at: None,
                current_pid: None,
                interrupt_requested: false,
            },
        );

        let pid = codex_interrupt_current_round(&state, run_id).expect("interrupt call");
        assert_eq!(pid, None);

        let bridge_map = state.codex_bridges.lock().expect("bridge map lock");
        let bridge = bridge_map.get(run_id).expect("bridge");
        let runtime = bridge.lock().expect("bridge lock");
        assert!(!runtime.interrupt_requested);
    }

    #[test]
    fn finish_round_keeps_bridge_active_and_preserves_last_round() {
        let state = test_app_state();
        let run_id = "run-test";
        insert_bridge(
            &state,
            CodexBridgeRuntime {
                run_id: run_id.to_string(),
                session_id: "codex-session".to_string(),
                bridge_dir: PathBuf::new(),
                queue: VecDeque::new(),
                worker_running: true,
                sleeping: false,
                session_bootstrapped: false,
                current_round: Some(CodexRoundRuntime {
                    prompt: "build the bridge".to_string(),
                    started_at: 11,
                    ended_at: None,
                    pid: Some(4242),
                    status: "running".to_string(),
                    exit_code: None,
                    interrupt_requested: false,
                }),
                last_round: None,
                last_user_input_at: 0,
                last_backend_activity_at: 0,
                last_round_started_at: Some(11),
                last_round_ended_at: None,
                current_pid: Some(4242),
                interrupt_requested: false,
            },
        );

        finish_codex_round_state(&state, run_id, "completed", Some(0));

        let bridge = codex_bridge_state_json(&state, run_id);
        assert_eq!(bridge["state"], "active");
        assert_eq!(bridge["workerRunning"], false);
        assert_eq!(bridge["roundState"], "completed");
        assert_eq!(bridge["roundActive"], false);

        let round = codex_round_state_json(&state, run_id);
        assert_eq!(round["state"], "completed");
        assert_eq!(round["active"], false);
        assert_eq!(round["exitCode"], 0);
        assert_eq!(round["prompt"], "build the bridge");
    }

    #[test]
    fn codex_bridge_round_args_keep_repo_check_disabled_and_resume_previous_runs() {
        let workspace = Path::new(r"D:\MCP\teamflow\workspace");
        let args = codex_bridge_round_args("build the bridge", workspace, r"C:\Users\28219", false, CODEX_DEFAULT_MODEL);
        assert_eq!(args[0], "exec");
        assert!(args.iter().any(|arg| arg == "--json"));
        let model_index = args.iter().position(|arg| arg == "-m").expect("model flag");
        let prompt_index = args.iter().position(|arg| arg == "build the bridge").expect("prompt");
        assert_eq!(args[model_index + 1], CODEX_DEFAULT_MODEL);
        assert!(model_index < prompt_index);
        assert!(args.iter().any(|arg| arg == "--skip-git-repo-check"));
        assert!(args.iter().any(|arg| arg == "-C"));
        assert!(args.iter().any(|arg| arg == r"D:\MCP\teamflow\workspace"));
        assert!(args.iter().any(|arg| arg == "--add-dir"));
        assert!(args.iter().any(|arg| arg == r"C:\Users\28219"));

        let resumed = codex_bridge_round_args("continue", workspace, r"C:\Users\28219", true, CODEX_MIMO_MODEL);
        assert_eq!(resumed[0], "exec");
        assert_eq!(resumed[1], "resume");
        assert_eq!(resumed[2], "--last");
        assert!(resumed.iter().any(|arg| arg == "--json"));
        let resumed_model_index = resumed.iter().position(|arg| arg == "-m").expect("resumed model flag");
        let resumed_prompt_index = resumed.iter().position(|arg| arg == "continue").expect("resumed prompt");
        assert_eq!(resumed[resumed_model_index + 1], CODEX_MIMO_MODEL);
        assert!(resumed_model_index < resumed_prompt_index);
        assert!(resumed.iter().any(|arg| arg == "--skip-git-repo-check"));
        assert!(!resumed.iter().any(|arg| arg == "--add-dir"));
        assert!(!resumed.iter().any(|arg| arg == "-C"));
    }

    #[test]
    fn codex_bridge_launch_args_disable_plugins_for_mimo_provider() {
        let workspace = Path::new(r"D:\MCP\teamflow\workspace");
        let args = codex_bridge_launch_args(
            CODEX_MIMO_PROVIDER_ID,
            "build the bridge",
            workspace,
            r"C:\Users\28219",
            false,
            CODEX_MIMO_MODEL,
        );
        let disable_plugins = args.windows(2).any(|pair| pair == ["--disable", "plugins"]);
        let disable_remote_plugin = args
            .windows(2)
            .any(|pair| pair == ["--disable", "remote_plugin"]);
        let provider_model = args.iter().position(|arg| arg == "model_provider=\"codex\"");
        let provider_base_url = args
            .iter()
            .position(|arg| arg == &format!(r#"model_providers.codex.base_url="{}""#, CODEX_MIMO_OPENAI_BASE_URL));
        let provider_wire_api = args
            .iter()
            .position(|arg| arg == r#"model_providers.codex.wire_api="chat""#);
        let exec_index = args.iter().position(|arg| arg == "exec").expect("exec arg");
        let disable_index = args.iter().position(|arg| arg == "--disable").expect("disable arg");
        let config_index = args.iter().position(|arg| arg == "-c").expect("config arg");

        assert!(disable_plugins);
        assert!(disable_remote_plugin);
        assert!(provider_model.is_some());
        assert!(provider_base_url.is_some());
        assert!(provider_wire_api.is_some());
        assert!(disable_index < exec_index);
        assert!(config_index < exec_index);
    }

    #[test]
    fn codex_bridge_launch_args_restore_default_gpt_settings() {
        let workspace = Path::new(r"D:\MCP\teamflow\workspace");
        let args = codex_bridge_launch_args(
            CODEX_DEFAULT_PROVIDER_ID,
            "build the bridge",
            workspace,
            r"C:\Users\28219",
            false,
            CODEX_DEFAULT_MODEL,
        );
        assert!(args.windows(2).all(|pair| pair != ["--disable", "plugins"]));
        assert!(args.windows(2).all(|pair| pair != ["--disable", "remote_plugin"]));
        assert!(args.iter().any(|arg| arg == "model_provider=\"codex\""));
        assert!(args.iter().any(|arg| arg == &format!(r#"model_providers.codex.base_url="{}""#, CODEX_DEFAULT_OPENAI_BASE_URL)));
        assert!(args.iter().any(|arg| arg == &format!(r#"model_providers.codex.wire_api="{}""#, CODEX_DEFAULT_WIRE_API)));
    }
}

#[tauri::command]
async fn open_diagnostics(
    state: State<'_, AppState>,
    session_id: String,
    run_id: Option<String>,
) -> Result<Value> {
    if let Some(run_id) = run_id {
        return state.store.diagnostics_for_run(&run_id, &session_id);
    }
    state.store.diagnostics(&session_id)
}

#[tauri::command]
async fn get_run_status(state: State<'_, AppState>, run_id: String) -> Result<Value> {
    state.store.status_snapshot_for_run(&run_id)
}

#[tauri::command]
async fn delete_run(
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
) -> Result<DeleteRunResult> {
    let interrupted_sessions = stop_runtime_sessions_for_run(state.inner(), &run_id)?;

    let deleted = state.store.delete_run_data(&run_id)?;
    let current_run = state.store.active_run()?;
    let mut switched_to_run_id = None;
    let mut created_run_id = None;
    if current_run.as_deref() == Some(&run_id) {
        if let Some(next_run) = state.store.most_recent_run()? {
            state.store.switch_run(&next_run)?;
            switched_to_run_id = Some(next_run);
        } else {
            let created = state.store.create_run()?;
            created_run_id = created
                .get("currentRunId")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
        }
    }
    emit_status(&app, &state.store, Some(&state.realtime));
    Ok(DeleteRunResult {
        run_id,
        deleted,
        interrupted_sessions,
        switched_to_run_id,
        created_run_id,
    })
}

#[tauri::command]
async fn export_tasks_json(state: State<'_, AppState>) -> Result<Value> {
    state.store.export_tasks_json()
}

fn app_root() -> PathBuf {
    env::var("TEAMFLOW_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(r"D:\MCP\teamflow"))
}

pub fn run() {
    let instance = SingleInstance::new("teamflow-desktop-single-instance")
        .expect("failed to create single instance guard");
    if !instance.is_single() {
        return;
    }
    let root = app_root();
    let store = Store::new(root.clone()).expect("failed to initialize Teamflow Desktop store");
    let state = AppState {
        store,
        worker_paused: Arc::new(Mutex::new(false)),
        worker_loop_running: Arc::new(Mutex::new(false)),
        worker_rr_cursor: Arc::new(Mutex::new(0)),
        sessions: Arc::new(Mutex::new(HashMap::new())),
        codex_bridges: Arc::new(Mutex::new(HashMap::new())),
        codex_idle_monitor_started: Arc::new(AtomicBool::new(false)),
        realtime: Arc::new(RealtimeHub::new()),
        _instance_guard: Arc::new(instance),
    };

    tauri::Builder::default()
        .manage(state)
        .setup(move |app| {
            let state = app.state::<AppState>();
            state.realtime.ensure_ws_server();
            ensure_codex_idle_monitor(app.handle().clone(), app.state::<AppState>().inner().clone());
            let _ = state.store.add_event(
                "app_boot_started",
                None,
                Some("system"),
                "Teamflow Desktop 正在启动。",
                json!({"root": root.to_string_lossy().to_string()}),
            );
            let _ = state.store.append_process_event(
                None,
                Some("system"),
                "app_boot_ready",
                "Teamflow Desktop 启动完成。",
                None,
                json!({"root": root.to_string_lossy().to_string()}),
            );
            ensure_worker_loop(app.handle().clone(), state.inner().clone());
            emit_status(app.handle(), &state.store, Some(&state.realtime));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_run,
            list_runs,
            list_runs_grouped,
            switch_run,
            get_run_overview,
            get_run_status,
            get_realtime_config,
            get_realtime_events,
            run_realtime_benchmark,
            get_status,
            set_codex_model_provider,
            get_ui_settings,
            set_ui_setting,
            set_ui_settings,
            run_desktop_command,
            send_codex_message,
            interrupt_codex_session,
            start_claude_worker,
            pause_worker,
            resume_worker,
            cancel_task,
            continue_task,
            retry_task_with_instruction,
            mark_task_completed,
            terminate_task_and_codex,
            delete_run,
            open_diagnostics,
            export_tasks_json
        ])
        .run(tauri::generate_context!())
        .expect("error while running Teamflow Desktop");
}



