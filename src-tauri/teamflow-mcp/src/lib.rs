use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use thiserror::Error;

const TOOLS: &[&str] = &[
    "delegate_task_and_wait",
    "cancel_task",
    "get_task",
    "submit_review",
    "get_status",
    "export_tasks_json",
    "plan_tasks",
];

const TASK_STATUSES: &[&str] = &[
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

static RUN_COUNTER: AtomicU64 = AtomicU64::new(1);

type Result<T> = std::result::Result<T, TeamflowMcpError>;

#[derive(Debug, Error)]
pub enum TeamflowMcpError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Clone, Debug)]
pub struct TeamflowContext {
    root: PathBuf,
    runtime: PathBuf,
    workspace: PathBuf,
    db_path: PathBuf,
    tasks_json_path: PathBuf,
    active_run_path: PathBuf,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSpec {
    title: String,
    goal: String,
    scope: String,
    acceptance_criteria: Vec<String>,
    verify_commands: Vec<Value>,
    #[serde(default)]
    max_attempts: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanTasksArgs {
    project_goal: String,
    tasks: Vec<TaskSpec>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetTaskArgs {
    #[serde(default = "default_claude_agent")]
    agent: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmitReviewArgs {
    task_id: String,
    summary: String,
    #[serde(default, alias = "changed_files")]
    changed_files: Vec<String>,
    #[serde(default, alias = "commands_run")]
    commands_run: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelTaskArgs {
    task_id: String,
    reason: String,
    #[serde(default = "default_codex_agent")]
    agent: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DelegateTaskArgs {
    title: String,
    goal: String,
    scope: String,
    acceptance_criteria: Vec<String>,
    verify_commands: Vec<Value>,
    #[serde(default = "default_timeout_seconds")]
    timeout_seconds: f64,
    #[serde(default = "default_poll_seconds")]
    poll_seconds: f64,
    #[serde(default = "default_max_attempts")]
    max_attempts: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetStatusArgs {
    #[serde(default, alias = "run_id")]
    run_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandResult {
    command: String,
    cwd: String,
    timeout: u64,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    duration_ms: u128,
    timed_out: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VerificationResult {
    status: String,
    summary: String,
    commands: Vec<CommandResult>,
}

#[derive(Debug, Clone)]
struct ReviewDecision {
    status: String,
    summary: String,
    suggestions: Vec<String>,
    raw: String,
}

pub fn run() {
    let mut stdin = io::stdin();
    let mut buffer = String::new();
    if stdin.read_to_string(&mut buffer).is_err() {
        return;
    }
    for request in parse_mcp_messages(&buffer) {
        let response = handle_request(request);
        write_mcp_message(&response);
    }
}

fn parse_mcp_messages(input: &str) -> Vec<Value> {
    let mut requests = Vec::new();
    let mut remaining = input;
    while let Some(header_end) = remaining.find("\r\n\r\n").or_else(|| remaining.find("\n\n")) {
        let (headers, rest) = remaining.split_at(header_end);
        let body_start = if rest.starts_with("\r\n\r\n") { 4 } else { 2 };
        let content_length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                if name.eq_ignore_ascii_case("Content-Length") {
                    value.trim().parse::<usize>().ok()
                } else {
                    None
                }
            })
            .unwrap_or(0);
        let body = &rest[body_start..];
        if body.len() < content_length {
            break;
        }
        let (json_body, tail) = body.split_at(content_length);
        if let Ok(value) = serde_json::from_str(json_body) {
            requests.push(value);
        }
        remaining = tail;
    }

    if requests.is_empty() {
        for line in input.lines().filter(|line| !line.trim().is_empty()) {
            if let Ok(value) = serde_json::from_str::<Value>(line) {
                requests.push(value);
            }
        }
    }
    requests
}

fn handle_request(request: Value) -> Value {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request.get("method").and_then(Value::as_str).unwrap_or("");
    let result = match method {
        "initialize" => json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "teamflow-desktop", "version": "0.1.0"}
        }),
        "tools/list" => json!({
            "tools": TOOLS.iter().map(tool_definition).collect::<Vec<_>>()
        }),
        "tools/call" => {
            let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            call_tool(name, arguments)
        }
        _ => json!({"ok": true}),
    };
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}

fn tool_definition(name: &&str) -> Value {
    json!({
        "name": name,
        "description": format!("Teamflow Desktop MCP tool: {name}"),
        "inputSchema": {
            "type": "object",
            "additionalProperties": true
        }
    })
}

fn call_tool(name: &str, arguments: Value) -> Value {
    if !TOOLS.contains(&name) {
        return tool_error(format!("未知 Teamflow MCP 工具：{name}"));
    }
    let result = (|| -> Result<Value> {
        let ctx = TeamflowContext::new_from_env()?;
        match name {
            "plan_tasks" => {
                let args: PlanTasksArgs = serde_json::from_value(arguments)?;
                ctx.plan_tasks(&args.project_goal, args.tasks)
            }
            "get_task" => {
                let args: GetTaskArgs = serde_json::from_value(arguments)?;
                ctx.get_task(&args.agent)
            }
            "submit_review" => {
                let args: SubmitReviewArgs = serde_json::from_value(arguments)?;
                ctx.submit_review(&args.task_id, &args.summary, args.changed_files, args.commands_run)
            }
            "cancel_task" => {
                let args: CancelTaskArgs = serde_json::from_value(arguments)?;
                ctx.cancel_task(&args.task_id, &args.reason, &args.agent)
            }
            "get_status" => {
                let args: GetStatusArgs = serde_json::from_value(arguments)?;
                match args.run_id {
                    Some(run_id) => ctx.status_snapshot_for_run(&run_id),
                    None => ctx.status_snapshot(),
                }
            }
            "export_tasks_json" => ctx.export_tasks_json(),
            "delegate_task_and_wait" => {
                let args: DelegateTaskArgs = serde_json::from_value(arguments)?;
                ctx.delegate_task_and_wait(args)
            }
            _ => Err(TeamflowMcpError::Message(format!("未知 Teamflow MCP 工具：{name}"))),
        }
    })();

    match result {
        Ok(payload) => tool_ok(payload),
        Err(error) => tool_error(error.to_string()),
    }
}

fn tool_ok(payload: Value) -> Value {
    json!({
        "content": [
            {
                "type": "text",
                "text": serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".to_string())
            }
        ],
        "isError": false
    })
}

fn tool_error(message: String) -> Value {
    let payload = json!({"status": "error", "message": message});
    json!({
        "content": [
            {
                "type": "text",
                "text": serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".to_string())
            }
        ],
        "isError": true
    })
}

fn write_mcp_message(response: &Value) {
    let body = serde_json::to_string(response).unwrap_or_else(|_| "{}".to_string());
    let mut stdout = io::stdout();
    let _ = write!(stdout, "Content-Length: {}\r\n\r\n{}", body.len(), body);
    let _ = stdout.flush();
}

impl TeamflowContext {
    pub fn new_from_env() -> Result<Self> {
        let root = env::var("TEAMFLOW_ROOT").unwrap_or_else(|_| r"D:\MCP\teamflow".to_string());
        Self::new_for_root(root)
    }

    pub fn new_for_root(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        let runtime = root.join("runtime");
        let workspace = root.join("workspace");
        fs::create_dir_all(&runtime)?;
        fs::create_dir_all(&workspace)?;
        let ctx = Self {
            db_path: runtime.join("teamflow.sqlite3"),
            tasks_json_path: runtime.join("tasks.json"),
            active_run_path: runtime.join("active-run.json"),
            root,
            runtime,
            workspace,
        };
        ctx.initialize()?;
        Ok(ctx)
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
            create index if not exists idx_tasks_status_id on tasks(run_id, status, id);
            create index if not exists idx_events_task_id_id on events(run_id, task_id, id);
            create index if not exists idx_reviews_task_id_id on reviews(run_id, task_id, id);
            "#,
        )?;
        drop(conn);
        let _ = self.current_run_id()?;
        Ok(())
    }

    fn current_run_id(&self) -> Result<String> {
        if let Ok(run_id) = env::var("TEAMFLOW_RUN_ID") {
            let trimmed = run_id.trim();
            if !trimmed.is_empty() {
                self.ensure_run_exists(trimmed)?;
                return Ok(trimmed.to_string());
            }
        }
        if let Some(run_id) = self.read_active_run_id()? {
            self.ensure_run_exists(&run_id)?;
            return Ok(run_id);
        }
        let created = self.create_run()?;
        created
            .get("currentRunId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .ok_or_else(|| TeamflowMcpError::Message("创建默认会话失败。".to_string()))
    }

    fn read_active_run_id(&self) -> Result<Option<String>> {
        if !self.active_run_path.exists() {
            return Ok(None);
        }
        let payload: Value = serde_json::from_str(&fs::read_to_string(&self.active_run_path)?)?;
        Ok(payload
            .get("currentRunId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(ToOwned::to_owned))
    }

    fn create_run(&self) -> Result<Value> {
        let run_id = generate_run_id();
        let now_at = now();
        let conn = self.connect()?;
        conn.execute(
            "insert into runs(id, title, created_at, updated_at, last_activity_at, project_goal) values (?1, '', ?2, ?2, ?2, '')",
            params![run_id, now_at],
        )?;
        self.write_active_run(&run_id)?;
        self.export_tasks_json_for_run(&run_id)?;
        Ok(json!({"currentRunId": run_id, "createdAt": now_at}))
    }

    fn ensure_run_exists(&self, run_id: &str) -> Result<()> {
        let now_at = now();
        let conn = self.connect()?;
        conn.execute(
            "insert into runs(id, title, created_at, updated_at, last_activity_at, project_goal) values (?1, '', ?2, ?2, ?2, '') on conflict(id) do nothing",
            params![run_id, now_at],
        )?;
        Ok(())
    }

    fn write_active_run(&self, run_id: &str) -> Result<()> {
        let payload = json!({"currentRunId": run_id, "updatedAt": now()});
        fs::write(&self.active_run_path, serde_json::to_string_pretty(&payload)? + "\n")?;
        Ok(())
    }

    pub fn plan_tasks(&self, project_goal: &str, tasks: Vec<TaskSpec>) -> Result<Value> {
        validate_tasks(&tasks)?;
        let run_id = self.current_run_id()?;
        let now_at = now();
        let conn = self.connect()?;
        conn.execute("begin immediate", [])?;
        conn.execute("delete from tasks where run_id=?1", params![run_id])?;
        conn.execute("delete from events where run_id=?1", params![run_id])?;
        conn.execute("delete from reviews where run_id=?1", params![run_id])?;
        conn.execute(
            "update runs set project_goal=?1, updated_at=?2, last_activity_at=?2, title=case when coalesce(title, '')='' then ?1 else title end where id=?3",
            params![project_goal, now_at, run_id],
        )?;
        for (index, task) in tasks.iter().enumerate() {
            insert_task(&conn, &run_id, index + 1, task, now_at.as_str())?;
        }
        insert_event(
            &conn,
            &run_id,
            "tasks_planned",
            None,
            Some("codex"),
            &format!("Codex 已拆分 {} 个任务。", tasks.len()),
            json!({"projectGoal": project_goal, "totalTasks": tasks.len()}),
        )?;
        conn.execute("commit", [])?;
        self.export_tasks_json_for_run(&run_id)?;
        let snapshot = self.status_snapshot_for_run(&run_id)?;
        Ok(json!({
            "status": "ok",
            "currentRunId": run_id,
            "tasksWritten": tasks.len(),
            "tasksJson": self.tasks_json_path.to_string_lossy(),
            "snapshot": snapshot,
            "workflowMetrics": snapshot["workflowMetrics"]
        }))
    }

    pub fn get_task(&self, agent: &str) -> Result<Value> {
        let run_id = self.current_run_id()?;
        match self.claim_next_task(&run_id, agent)? {
            Some(task) => Ok(json!({"task": task, "message": format!("claimed {}", task.id)})),
            None => Ok(json!({"task": Value::Null, "message": "no pending task"})),
        }
    }

    fn claim_next_task(&self, run_id: &str, agent: &str) -> Result<Option<Task>> {
        let conn = self.connect()?;
        conn.execute("begin immediate", [])?;
        let blocker: Option<String> = conn
            .query_row(
                "select id from tasks where run_id=?1 and status in ('IN_PROGRESS','REVIEW_PENDING','DEGRADED_PASS','BLOCKED') order by id limit 1",
                params![run_id],
                |row| row.get(0),
            )
            .optional()?;
        if blocker.is_some() {
            conn.execute("commit", [])?;
            return Ok(None);
        }
        let task: Option<Task> = conn
            .query_row(
                "select * from tasks where run_id=?1 and status in ('LOCAL_FAILED','MIMO_REJECTED','PENDING') order by id limit 1",
                params![run_id],
                row_to_task,
            )
            .optional()?;
        let Some(task) = task else {
            conn.execute("commit", [])?;
            return Ok(None);
        };
        let attempts = task.attempts + 1;
        let now_at = now();
        conn.execute(
            "update tasks set status='IN_PROGRESS', assigned_agent=?1, attempts=?2, updated_at=?3 where run_id=?4 and id=?5",
            params![agent, attempts, now_at, run_id, task.id],
        )?;
        conn.execute(
            "update runs set updated_at=?1, last_activity_at=?1 where id=?2",
            params![now_at, run_id],
        )?;
        insert_event(
            &conn,
            run_id,
            "task_claimed",
            Some(&task.id),
            Some(agent),
            &format!("{agent} 已领取 {}", task.id),
            json!({"taskId": task.id, "agent": agent, "attempts": attempts}),
        )?;
        conn.execute("commit", [])?;
        self.export_tasks_json_for_run(run_id)?;
        self.get_task_for_run(run_id, &task.id)
    }

    pub fn submit_review(
        &self,
        task_id: &str,
        summary: &str,
        changed_files: Vec<String>,
        commands_run: Vec<String>,
    ) -> Result<Value> {
        self.submit_review_with_decision(task_id, summary, changed_files, commands_run, None)
    }

    fn submit_review_with_decision(
        &self,
        task_id: &str,
        summary: &str,
        changed_files: Vec<String>,
        commands_run: Vec<String>,
        review_override: Option<ReviewDecision>,
    ) -> Result<Value> {
        let run_id = self.current_run_id()?;
        let task = self
            .get_task_for_run(&run_id, task_id)?
            .ok_or_else(|| TeamflowMcpError::Message(format!("未知任务：{task_id}")))?;
        if task.status == "CANCELLED" {
            return Ok(json!({
                "status": "CANCELLED",
                "task": task,
                "localVerification": Value::Null,
                "mimo": Value::Null,
                "message": "任务已取消，请停止当前工作并重新领取任务。"
            }));
        }
        let allowed = ["IN_PROGRESS", "LOCAL_FAILED", "MIMO_REJECTED", "REVIEW_PENDING"];
        if !allowed.contains(&task.status.as_str()) {
            return Ok(json!({
                "status": "INVALID_STATE",
                "task": task,
                "localVerification": Value::Null,
                "mimo": Value::Null,
                "message": format!("当前状态 {} 不允许提交审查。", task.status)
            }));
        }

        let local = run_verify_commands(&task.verify_commands, &self.workspace);
        self.add_review(
            &run_id,
            task_id,
            "local",
            &local.status,
            &local.summary,
            json!({
                "changedFiles": changed_files,
                "commandsRun": commands_run,
                "workerSummary": summary,
                "localVerification": local
            }),
        )?;

        if local.status != "PASSED" {
            let failed = self.record_failed_attempt(&run_id, task_id, &task, "LOCAL_FAILED", &local.summary)?;
            let current = self
                .get_task_for_run(&run_id, task_id)?
                .ok_or_else(|| TeamflowMcpError::Message(format!("未知任务：{task_id}")))?;
            self.export_tasks_json_for_run(&run_id)?;
            return Ok(json!({
                "status": failed["status"],
                "task": current,
                "localVerification": local,
                "mimo": Value::Null,
                "attempts": current.attempts,
                "maxAttempts": current.max_attempts,
                "remainingAttempts": remaining_attempts(&current),
                "warning": failed["warning"],
                "message": failed["message"]
            }));
        }

        self.update_task_status(&run_id, task_id, "REVIEW_PENDING", None)?;
        let review_payload = json!({
            "task": task,
            "summary": summary,
            "changedFiles": changed_files,
            "commandsRun": commands_run,
            "localVerification": local,
            "diff": collect_git_diff(&self.workspace),
        });

        let decision_result = match review_override {
            Some(decision) => Ok(decision),
            None => review_mimo_with_retries(&review_payload),
        };

        match decision_result {
            Ok(decision) => {
                let normalized = normalize_review_status(&decision.status);
                self.add_review(
                    &run_id,
                    task_id,
                    "mimo",
                    &normalized,
                    &decision.summary,
                    json!({
                        "suggestions": decision.suggestions,
                        "raw": decision.raw,
                        "changedFiles": changed_files,
                        "commandsRun": commands_run,
                        "workerSummary": summary
                    }),
                )?;
                if normalized == "PASS" {
                    self.update_task_status(&run_id, task_id, "COMPLETED", None)?;
                    self.add_event(
                        &run_id,
                        "task_codex_confirmed",
                        Some(task_id),
                        Some("codex"),
                        &format!("Codex 已确认 {} 通过 MiMo 审查。", task_id),
                        json!({"taskId": task_id, "mimoStatus": "PASS"}),
                    )?;
                    let current = self
                        .get_task_for_run(&run_id, task_id)?
                        .ok_or_else(|| TeamflowMcpError::Message(format!("未知任务：{task_id}")))?;
                    self.export_tasks_json_for_run(&run_id)?;
                    Ok(json!({
                        "status": "COMPLETED",
                        "task": current,
                        "localVerification": local,
                        "mimo": {"status": "PASS", "summary": decision.summary, "suggestions": decision.suggestions},
                        "attempts": current.attempts,
                        "maxAttempts": current.max_attempts,
                        "remainingAttempts": remaining_attempts(&current),
                        "warning": "",
                        "message": "任务已通过本地验证和 MiMo 审查，Codex 已确认。"
                    }))
                } else {
                    let failed = self.record_failed_attempt(&run_id, task_id, &task, "MIMO_REJECTED", &decision.summary)?;
                    let current = self
                        .get_task_for_run(&run_id, task_id)?
                        .ok_or_else(|| TeamflowMcpError::Message(format!("未知任务：{task_id}")))?;
                    self.export_tasks_json_for_run(&run_id)?;
                    Ok(json!({
                        "status": failed["status"],
                        "task": current,
                        "localVerification": local,
                        "mimo": {"status": "REJECT", "summary": decision.summary, "suggestions": decision.suggestions},
                        "attempts": current.attempts,
                        "maxAttempts": current.max_attempts,
                        "remainingAttempts": remaining_attempts(&current),
                        "warning": failed["warning"],
                        "message": failed["message"]
                    }))
                }
            }
            Err(error) => {
                let detail = error.to_string();
                self.add_review(
                    &run_id,
                    task_id,
                    "mimo",
                    "UNAVAILABLE",
                    &detail,
                    json!({"error": detail}),
                )?;
                self.update_task_status(
                    &run_id,
                    task_id,
                    "DEGRADED_PASS",
                    Some(&format!("MiMo 不可用：{detail}")),
                )?;
                let current = self
                    .get_task_for_run(&run_id, task_id)?
                    .ok_or_else(|| TeamflowMcpError::Message(format!("未知任务：{task_id}")))?;
                self.export_tasks_json_for_run(&run_id)?;
                Ok(json!({
                    "status": "DEGRADED_PASS",
                    "task": current,
                    "localVerification": local,
                    "mimo": {"status": "UNAVAILABLE", "error": detail},
                    "attempts": current.attempts,
                    "maxAttempts": current.max_attempts,
                    "remainingAttempts": remaining_attempts(&current),
                    "warning": "MiMo 审查不可用，该任务进入风险通过状态。",
                    "message": "本地验证通过，但 MiMo 审查不可用，已标记为风险通过。"
                }))
            }
        }
    }

    pub fn cancel_task(&self, task_id: &str, reason: &str, agent: &str) -> Result<Value> {
        let run_id = self.current_run_id()?;
        let Some(task) = self.get_task_for_run(&run_id, task_id)? else {
            return Err(TeamflowMcpError::Message(format!("未知任务：{task_id}")));
        };
        if ["COMPLETED", "CANCELLED"].contains(&task.status.as_str()) {
            return Ok(json!({"status": task.status, "taskId": task_id, "task": task, "message": "任务已处于终态。"}));
        }
        self.update_task_status(&run_id, task_id, "CANCELLED", Some(reason))?;
        self.add_event(
            &run_id,
            "task_cancelled",
            Some(task_id),
            Some(agent),
            reason,
            json!({"reason": reason, "agent": agent}),
        )?;
        self.export_tasks_json_for_run(&run_id)?;
        let current = self
            .get_task_for_run(&run_id, task_id)?
            .ok_or_else(|| TeamflowMcpError::Message(format!("未知任务：{task_id}")))?;
        Ok(json!({"status": "CANCELLED", "taskId": task_id, "task": current, "message": format!("任务 {task_id} 已取消：{reason}")}))
    }

    fn delegate_task_and_wait(&self, args: DelegateTaskArgs) -> Result<Value> {
        let run_id = self.current_run_id()?;
        let task = self.append_task(
            &run_id,
            TaskSpec {
                title: args.title,
                goal: args.goal,
                scope: args.scope,
                acceptance_criteria: args.acceptance_criteria,
                verify_commands: args.verify_commands,
                max_attempts: Some(args.max_attempts),
            },
        )?;
        self.add_event(
            &run_id,
            "delegate_wait_started",
            Some(&task.id),
            Some("codex"),
            &format!("Codex 正在等待 {}", task.id),
            json!({"taskId": task.id}),
        )?;
        let deadline = Instant::now() + Duration::from_secs_f64(args.timeout_seconds.max(0.0));
        let poll = Duration::from_secs_f64(args.poll_seconds.max(0.01));
        loop {
            let current = self
                .get_task_for_run(&run_id, &task.id)?
                .ok_or_else(|| TeamflowMcpError::Message(format!("未知任务：{}", task.id)))?;
            if ["COMPLETED", "DEGRADED_PASS", "BLOCKED", "CANCELLED"].contains(&current.status.as_str()) {
                let result = self.delegation_result(&run_id, &current)?;
                self.add_event(
                    &run_id,
                    "delegate_wait_completed",
                    Some(&task.id),
                    Some("codex"),
                    result.get("message").and_then(Value::as_str).unwrap_or("等待结束"),
                    json!({"status": current.status}),
                )?;
                return Ok(result);
            }
            if Instant::now() >= deadline {
                return Ok(json!({
                    "status": "TIMEOUT",
                    "taskId": task.id,
                    "message": "任务执行超时，请进行人工干预。",
                    "task": current,
                    "events": self.task_events(&run_id, &task.id, 20)?,
                    "reviews": self.task_reviews(&run_id, &task.id)?,
                }));
            }
            thread::sleep(poll);
        }
    }

    fn append_task(&self, run_id: &str, task: TaskSpec) -> Result<Task> {
        validate_task_payload(&task, 1)?;
        let now_at = now();
        let conn = self.connect()?;
        conn.execute("begin immediate", [])?;
        let next_number: i64 = conn
            .query_row(
                "select coalesce(max(cast(substr(id, 6) as integer)), 0) + 1 from tasks where run_id=?1",
                params![run_id],
                |row| row.get(0),
            )
            .unwrap_or(1);
        insert_task(&conn, run_id, next_number as usize, &task, &now_at)?;
        let task_id = format!("task-{next_number:03}");
        conn.execute(
            "update runs set updated_at=?1, last_activity_at=?1 where id=?2",
            params![now_at, run_id],
        )?;
        insert_event(
            &conn,
            run_id,
            "task_delegated",
            Some(&task_id),
            Some("codex"),
            &format!("Codex 已派发 {}", task_id),
            json!({"title": task.title}),
        )?;
        conn.execute("commit", [])?;
        self.export_tasks_json_for_run(run_id)?;
        self.get_task_for_run(run_id, &task_id)?
            .ok_or_else(|| TeamflowMcpError::Message(format!("任务写入后未找到：{task_id}")))
    }

    pub fn status_snapshot(&self) -> Result<Value> {
        let run_id = self.current_run_id()?;
        self.status_snapshot_for_run(&run_id)
    }

    pub fn status_snapshot_for_run(&self, run_id: &str) -> Result<Value> {
        self.ensure_run_exists(run_id)?;
        let conn = self.connect()?;
        let project_goal: String = conn
            .query_row(
                "select project_goal from runs where id=?1",
                params![run_id],
                |row| row.get(0),
            )
            .unwrap_or_default();
        let tasks = self.tasks_for_run(run_id)?;
        let events = query_json_rows(
            &conn,
            "select id, at, type, task_id, agent, message, payload from events where run_id=?1 order by id desc limit 80",
            params![run_id],
            event_row_json,
        )?
        .into_iter()
        .rev()
        .collect::<Vec<_>>();
        let reviews = query_json_rows(
            &conn,
            "select id, at, task_id, kind, status, summary, payload from reviews where run_id=?1 order by id desc limit 80",
            params![run_id],
            review_row_json,
        )?
        .into_iter()
        .rev()
        .collect::<Vec<_>>();
        let counts = counts_for_tasks(&tasks);
        let workflow_metrics = workflow_metrics(&project_goal, &tasks, &counts);
        let dashboard_pipeline = dashboard_pipeline(&tasks);
        let current_task = current_task_for(&tasks);
        let claude_timeline_source = events
            .iter()
            .filter(|event| {
                event
                    .get("agent")
                    .and_then(Value::as_str)
                    .map(|agent| agent == "claude")
                    .unwrap_or(false)
                    || event.get("type").and_then(Value::as_str).unwrap_or("").contains("review")
            })
            .cloned()
            .collect::<Vec<_>>();
        Ok(json!({
            "currentRunId": run_id,
            "projectGoal": project_goal,
            "counts": counts,
            "progressPercent": workflow_metrics["progressPercent"],
            "currentTask": current_task,
            "tasks": tasks,
            "events": events,
            "reviews": reviews,
            "tasksJson": self.tasks_json_path.to_string_lossy(),
            "database": self.db_path.to_string_lossy(),
            "root": self.root.to_string_lossy(),
            "runtime": self.runtime.to_string_lossy(),
            "workspace": self.workspace.to_string_lossy(),
            "workflowMetrics": workflow_metrics,
            "dashboardPipeline": dashboard_pipeline,
            "claudeTimelineSource": claude_timeline_source,
        }))
    }

    pub fn export_tasks_json(&self) -> Result<Value> {
        let run_id = self.current_run_id()?;
        self.export_tasks_json_for_run(&run_id)
    }

    fn export_tasks_json_for_run(&self, run_id: &str) -> Result<Value> {
        let snapshot = self.status_snapshot_for_run(run_id)?;
        let data = json!({
            "currentRunId": run_id,
            "projectGoal": snapshot["projectGoal"],
            "exportedAt": now(),
            "sourceOfTruth": "sqlite",
            "database": self.db_path.to_string_lossy(),
            "workspace": self.workspace.to_string_lossy(),
            "tasks": snapshot["tasks"],
            "counts": snapshot["counts"],
            "progressPercent": snapshot["progressPercent"],
            "workflowMetrics": snapshot["workflowMetrics"],
            "dashboardPipeline": snapshot["dashboardPipeline"],
        });
        fs::write(&self.tasks_json_path, serde_json::to_string_pretty(&data)? + "\n")?;
        Ok(data)
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

    fn tasks_for_run(&self, run_id: &str) -> Result<Vec<Task>> {
        let conn = self.connect()?;
        let mut stmt = conn.prepare("select * from tasks where run_id=?1 order by id")?;
        let tasks = stmt
            .query_map(params![run_id], row_to_task)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(TeamflowMcpError::from)?;
        Ok(tasks)
    }

    fn update_task_status(&self, run_id: &str, task_id: &str, status: &str, last_error: Option<&str>) -> Result<()> {
        let now_at = now();
        let conn = self.connect()?;
        conn.execute(
            "update tasks set status=?1, last_error=?2, updated_at=?3 where run_id=?4 and id=?5",
            params![status, last_error, now_at, run_id, task_id],
        )?;
        conn.execute(
            "update runs set updated_at=?1, last_activity_at=?1 where id=?2",
            params![now_at, run_id],
        )?;
        insert_event(
            &conn,
            run_id,
            "task_status_changed",
            Some(task_id),
            None,
            &format!("{task_id} -> {status}"),
            json!({"status": status, "lastError": last_error}),
        )?;
        Ok(())
    }

    fn add_event(
        &self,
        run_id: &str,
        event_type: &str,
        task_id: Option<&str>,
        agent: Option<&str>,
        message: &str,
        payload: Value,
    ) -> Result<()> {
        let conn = self.connect()?;
        insert_event(&conn, run_id, event_type, task_id, agent, message, payload)?;
        conn.execute(
            "update runs set updated_at=?1, last_activity_at=?1 where id=?2",
            params![now(), run_id],
        )?;
        Ok(())
    }

    fn add_review(
        &self,
        run_id: &str,
        task_id: &str,
        kind: &str,
        status: &str,
        summary: &str,
        payload: Value,
    ) -> Result<()> {
        let conn = self.connect()?;
        let now_at = now();
        conn.execute(
            "insert into reviews(run_id, at, task_id, kind, status, summary, payload) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![run_id, now_at, task_id, kind, status, summary, serde_json::to_string(&payload)?],
        )?;
        insert_event(
            &conn,
            run_id,
            &format!("{kind}_review_recorded"),
            Some(task_id),
            Some("mimo"),
            summary,
            json!({"status": status}),
        )?;
        conn.execute(
            "update runs set updated_at=?1, last_activity_at=?1 where id=?2",
            params![now_at, run_id],
        )?;
        Ok(())
    }

    fn record_failed_attempt(
        &self,
        run_id: &str,
        task_id: &str,
        task: &Task,
        status: &str,
        feedback: &str,
    ) -> Result<Value> {
        let remaining = task.max_attempts - task.attempts;
        if remaining <= 0 {
            self.update_task_status(run_id, task_id, "BLOCKED", Some(feedback))?;
            return Ok(json!({
                "status": "BLOCKED",
                "warning": "",
                "message": "任务已达最大尝试次数，已阻塞，等待 Codex 或用户重新介入。"
            }));
        }
        self.update_task_status(run_id, task_id, status, Some(feedback))?;
        let warning = if remaining == 1 {
            "这是该任务的最后一次尝试机会；再次失败将进入阻塞。"
        } else {
            ""
        };
        Ok(json!({
            "status": status,
            "warning": warning,
            "message": format!("审查未通过，请根据反馈修改：{feedback}")
        }))
    }

    fn task_reviews(&self, run_id: &str, task_id: &str) -> Result<Vec<Value>> {
        let conn = self.connect()?;
        query_json_rows(
            &conn,
            "select id, at, task_id, kind, status, summary, payload from reviews where run_id=?1 and task_id=?2 order by id",
            params![run_id, task_id],
            review_row_json,
        )
    }

    fn task_events(&self, run_id: &str, task_id: &str, limit: i64) -> Result<Vec<Value>> {
        let conn = self.connect()?;
        let mut rows = query_json_rows(
            &conn,
            "select id, at, type, task_id, agent, message, payload from events where run_id=?1 and task_id=?2 order by id desc limit ?3",
            params![run_id, task_id, limit],
            event_row_json,
        )?;
        rows.reverse();
        Ok(rows)
    }

    fn delegation_result(&self, run_id: &str, task: &Task) -> Result<Value> {
        let message = match task.status.as_str() {
            "COMPLETED" => "任务已通过 MiMo 审查并经 Codex 确认，可继续下一项。",
            "DEGRADED_PASS" => "任务本地验证通过，但 MiMo 审查不可用，已标记风险通过。",
            "BLOCKED" => "任务已阻塞，请 Codex 或用户重新评估。",
            "CANCELLED" => "任务已取消，等待重新派发。",
            _ => "任务等待结束。",
        };
        Ok(json!({
            "status": if task.status == "CANCELLED" { "BLOCKED" } else { task.status.as_str() },
            "taskId": task.id,
            "message": message,
            "task": task,
            "events": self.task_events(run_id, &task.id, 20)?,
            "reviews": self.task_reviews(run_id, &task.id)?,
        }))
    }
}

fn insert_task(conn: &Connection, run_id: &str, index: usize, task: &TaskSpec, now_at: &str) -> Result<()> {
    conn.execute(
        "insert into tasks(run_id, id, title, goal, scope, acceptance_criteria, verify_commands, status, assigned_agent, attempts, max_attempts, last_error, created_at, updated_at) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'PENDING', null, 0, ?8, null, ?9, ?9)",
        params![
            run_id,
            format!("task-{index:03}"),
            task.title,
            task.goal,
            task.scope,
            serde_json::to_string(&task.acceptance_criteria)?,
            serde_json::to_string(&task.verify_commands)?,
            task.max_attempts.unwrap_or(3).max(1),
            now_at
        ],
    )?;
    Ok(())
}

fn insert_event(
    conn: &Connection,
    run_id: &str,
    event_type: &str,
    task_id: Option<&str>,
    agent: Option<&str>,
    message: &str,
    payload: Value,
) -> Result<()> {
    conn.execute(
        "insert into events(run_id, at, type, task_id, agent, message, payload) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![run_id, now(), event_type, task_id, agent, message, serde_json::to_string(&payload)?],
    )?;
    Ok(())
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

fn query_json_rows<P, F>(conn: &Connection, sql: &str, params: P, mut mapper: F) -> Result<Vec<Value>>
where
    P: rusqlite::Params,
    F: FnMut(&Row<'_>) -> rusqlite::Result<Value>,
{
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map(params, |row| mapper(row))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn event_row_json(row: &Row<'_>) -> rusqlite::Result<Value> {
    let payload: String = row.get("payload")?;
    Ok(json!({
        "id": row.get::<_, i64>("id")?,
        "at": row.get::<_, String>("at")?,
        "type": row.get::<_, String>("type")?,
        "taskId": row.get::<_, Option<String>>("task_id")?,
        "agent": row.get::<_, Option<String>>("agent")?,
        "message": row.get::<_, Option<String>>("message")?,
        "payload": serde_json::from_str::<Value>(&payload).unwrap_or_else(|_| json!({})),
    }))
}

fn review_row_json(row: &Row<'_>) -> rusqlite::Result<Value> {
    let payload: String = row.get("payload")?;
    Ok(json!({
        "id": row.get::<_, i64>("id")?,
        "at": row.get::<_, String>("at")?,
        "taskId": row.get::<_, String>("task_id")?,
        "kind": row.get::<_, String>("kind")?,
        "status": row.get::<_, String>("status")?,
        "summary": row.get::<_, String>("summary")?,
        "payload": serde_json::from_str::<Value>(&payload).unwrap_or_else(|_| json!({})),
    }))
}

fn counts_for_tasks(tasks: &[Task]) -> Value {
    let mut counts = BTreeMap::<String, i64>::new();
    for status in TASK_STATUSES {
        counts.insert((*status).to_string(), 0);
    }
    for task in tasks {
        *counts.entry(task.status.clone()).or_default() += 1;
    }
    counts.insert("total".to_string(), tasks.len() as i64);
    json!(counts)
}

fn workflow_metrics(project_goal: &str, tasks: &[Task], counts: &Value) -> Value {
    let total = tasks.len() as i64;
    let completed = counts.get("COMPLETED").and_then(Value::as_i64).unwrap_or(0);
    let exception = ["LOCAL_FAILED", "MIMO_REJECTED", "DEGRADED_PASS", "BLOCKED"]
        .iter()
        .map(|status| counts.get(*status).and_then(Value::as_i64).unwrap_or(0))
        .sum::<i64>();
    let progress = if total == 0 {
        0
    } else {
        ((completed as f64 / total as f64) * 100.0).round() as i64
    };
    let current = current_task_for(tasks);
    let current_goal = current
        .get("goal")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(project_goal);
    json!({
        "totalTasks": total,
        "completedTasks": completed,
        "exceptionTasks": exception,
        "progressPercent": progress,
        "deliveryProgress": completed,
        "currentGoal": current_goal,
        "currentTaskId": current.get("id").cloned().unwrap_or(Value::Null),
        "currentTaskTitle": current.get("title").cloned().unwrap_or(Value::Null),
    })
}

fn current_task_for(tasks: &[Task]) -> Value {
    let priorities = [
        "IN_PROGRESS",
        "REVIEW_PENDING",
        "MIMO_REJECTED",
        "LOCAL_FAILED",
        "BLOCKED",
        "DEGRADED_PASS",
        "PENDING",
    ];
    for status in priorities {
        if let Some(task) = tasks.iter().find(|task| task.status == status) {
            return json!(task);
        }
    }
    Value::Null
}

fn dashboard_pipeline(tasks: &[Task]) -> Value {
    let pending = tasks
        .iter()
        .map(|task| json!(task))
        .collect::<Vec<_>>();
    let developing = tasks
        .iter()
        .filter(|task| ["IN_PROGRESS", "LOCAL_FAILED", "MIMO_REJECTED", "BLOCKED"].contains(&task.status.as_str()))
        .map(|task| json!(task))
        .collect::<Vec<_>>();
    let review = tasks
        .iter()
        .filter(|task| ["REVIEW_PENDING", "COMPLETED", "DEGRADED_PASS", "CANCELLED"].contains(&task.status.as_str()))
        .map(|task| json!(task))
        .collect::<Vec<_>>();
    json!({"pending": pending, "developing": developing, "review": review})
}

fn validate_tasks(tasks: &[TaskSpec]) -> Result<()> {
    if !(5..=8).contains(&tasks.len()) {
        return Err(TeamflowMcpError::Message(
            "plan_tasks requires 5-8 atomic tasks".to_string(),
        ));
    }
    for (index, task) in tasks.iter().enumerate() {
        validate_task_payload(task, index + 1)?;
    }
    Ok(())
}

fn validate_task_payload(task: &TaskSpec, index: usize) -> Result<()> {
    if task.title.trim().is_empty() || task.goal.trim().is_empty() || task.scope.trim().is_empty() {
        return Err(TeamflowMcpError::Message(format!(
            "task {index} title/goal/scope must be non-empty"
        )));
    }
    if task.acceptance_criteria.is_empty() {
        return Err(TeamflowMcpError::Message(format!(
            "task {index} acceptanceCriteria must be non-empty"
        )));
    }
    if task.verify_commands.is_empty() {
        return Err(TeamflowMcpError::Message(format!(
            "task {index} verifyCommands must be non-empty"
        )));
    }
    Ok(())
}

fn run_verify_commands(commands: &[Value], workspace: &Path) -> VerificationResult {
    let mut results = Vec::new();
    if commands.is_empty() {
        return VerificationResult {
            status: "FAILED".to_string(),
            summary: "No verifyCommands were provided.".to_string(),
            commands: results,
        };
    }
    for spec in commands {
        let command = spec.get("command").and_then(Value::as_str).unwrap_or("").trim();
        if command.is_empty() {
            return VerificationResult {
                status: "FAILED".to_string(),
                summary: "verifyCommands contains an empty command.".to_string(),
                commands: results,
            };
        }
        let timeout = spec.get("timeout").and_then(Value::as_u64).unwrap_or(30).max(1);
        let cwd = resolve_cwd(workspace, spec.get("cwd").and_then(Value::as_str).unwrap_or("."));
        let _ = fs::create_dir_all(&cwd);
        let started = Instant::now();
        let output = if cfg!(windows) {
            Command::new("cmd")
                .arg("/C")
                .arg(command)
                .current_dir(&cwd)
                .output()
        } else {
            Command::new("sh")
                .arg("-lc")
                .arg(command)
                .current_dir(&cwd)
                .output()
        };
        let duration_ms = started.elapsed().as_millis();
        let result = match output {
            Ok(output) => CommandResult {
                command: command.to_string(),
                cwd: cwd.to_string_lossy().to_string(),
                timeout,
                exit_code: output.status.code(),
                stdout: trim_output(&String::from_utf8_lossy(&output.stdout), 12000),
                stderr: trim_output(&String::from_utf8_lossy(&output.stderr), 12000),
                duration_ms,
                timed_out: duration_ms > (timeout as u128 * 1000),
            },
            Err(error) => CommandResult {
                command: command.to_string(),
                cwd: cwd.to_string_lossy().to_string(),
                timeout,
                exit_code: None,
                stdout: String::new(),
                stderr: error.to_string(),
                duration_ms,
                timed_out: false,
            },
        };
        let failed = result.timed_out || result.exit_code.unwrap_or(-1) != 0;
        results.push(result.clone());
        if failed {
            let summary = if result.timed_out {
                format!("Command timed out after {timeout}s: {command}")
            } else {
                format!(
                    "Command failed with exit code {}: {command}",
                    result.exit_code.unwrap_or(-1)
                )
            };
            return VerificationResult {
                status: "FAILED".to_string(),
                summary,
                commands: results,
            };
        }
    }
    VerificationResult {
        status: "PASSED".to_string(),
        summary: "All verifyCommands passed.".to_string(),
        commands: results,
    }
}

fn resolve_cwd(workspace: &Path, cwd: &str) -> PathBuf {
    let path = PathBuf::from(cwd);
    if path.is_absolute() {
        path
    } else {
        workspace.join(path)
    }
}

fn review_mimo_with_retries(payload: &Value) -> Result<ReviewDecision> {
    let mut last_error = None;
    for _ in 0..3 {
        match review_mimo_once(payload) {
            Ok(decision) => return Ok(decision),
            Err(error) => last_error = Some(error.to_string()),
        }
    }
    Err(TeamflowMcpError::Message(
        last_error.unwrap_or_else(|| "MiMo 审查失败。".to_string()),
    ))
}

fn review_mimo_once(payload: &Value) -> Result<ReviewDecision> {
    let api_key = select_mimo_key().ok_or_else(|| {
        TeamflowMcpError::Message(
            "MiMo API key is not configured; set MIMO_API_KEY or ANTHROPIC_AUTH_TOKEN.".to_string(),
        )
    })?;
    let base_url = env::var("MIMO_BASE_URL")
        .or_else(|_| env::var("ANTHROPIC_BASE_URL"))
        .unwrap_or_else(|_| "https://token-plan-cn.xiaomimimo.com/anthropic".to_string());
    let model = env::var("MIMO_MODEL")
        .or_else(|_| env::var("ANTHROPIC_MODEL"))
        .unwrap_or_else(|_| "mimo-v2.5-pro".to_string());
    let body = build_anthropic_payload(&model, payload);
    let body_text = serde_json::to_string(&body)?;
    let url = format!("{}/v1/messages", base_url.trim_end_matches('/'));
    let output = Command::new("curl")
        .arg("--silent")
        .arg("--show-error")
        .arg("--fail")
        .arg("-X")
        .arg("POST")
        .arg(&url)
        .arg("-H")
        .arg("content-type: application/json")
        .arg("-H")
        .arg("anthropic-version: 2023-06-01")
        .arg("-H")
        .arg(format!("x-api-key: {api_key}"))
        .arg("-H")
        .arg(format!("authorization: Bearer {api_key}"))
        .arg("--data-binary")
        .arg(body_text)
        .output()
        .map_err(|error| TeamflowMcpError::Message(format!("无法启动 curl 调用 MiMo：{error}")))?;
    if !output.status.success() {
        let detail = trim_output(&String::from_utf8_lossy(&output.stderr), 1000);
        return Err(TeamflowMcpError::Message(format!("MiMo HTTP 调用失败：{detail}")));
    }
    let response: Value = serde_json::from_slice(&output.stdout)?;
    let content = extract_anthropic_text(&response);
    Ok(parse_review_decision(&content))
}

fn select_mimo_key() -> Option<String> {
    [
        "MIMO_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "XIAOMI_MIMO_API_KEY",
        "MIMO_KEY",
    ]
    .iter()
    .find_map(|name| env::var(name).ok().filter(|value| !value.trim().is_empty()))
}

fn build_anthropic_payload(model: &str, payload: &Value) -> Value {
    json!({
        "model": model,
        "max_tokens": 2048,
        "temperature": 0,
        "system": "You are Xiaomi MiMo acting as Teamflow's reviewer. Return a concise verdict: PASS or REJECT, followed by evidence and fix suggestions.",
        "messages": [
            {
                "role": "user",
                "content": build_review_prompt(payload),
            }
        ]
    })
}

fn build_review_prompt(payload: &Value) -> String {
    format!(
        "Review this task against the architecture intent.\n\nTask: {}\n\nClaude summary: {}\nChanged files: {}\nCommands run by Claude: {}\n\nLocal verification:\n{}\n\nDiff:\n{}\n\nReturn format:\nVERDICT: PASS|REJECT\nSUMMARY: one paragraph\nSUGGESTIONS: bullet list if rejected",
        payload.get("task").unwrap_or(&Value::Null),
        payload.get("summary").and_then(Value::as_str).unwrap_or(""),
        payload.get("changedFiles").unwrap_or(&Value::Null),
        payload.get("commandsRun").unwrap_or(&Value::Null),
        payload.get("localVerification").unwrap_or(&Value::Null),
        payload.get("diff").and_then(Value::as_str).unwrap_or("").chars().take(20000).collect::<String>(),
    )
}

fn extract_anthropic_text(response: &Value) -> String {
    let chunks = response
        .get("content")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    if item.get("type").and_then(Value::as_str) == Some("text") {
                        item.get("text").and_then(Value::as_str).map(ToOwned::to_owned)
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if chunks.is_empty() {
        response.to_string()
    } else {
        chunks.join("\n")
    }
}

fn parse_review_decision(content: &str) -> ReviewDecision {
    let text = content.trim();
    let upper = text.to_uppercase();
    let status = if upper.contains("VERDICT: PASS") || upper.starts_with("PASS") {
        "PASS"
    } else {
        "REJECT"
    };
    let suggestions = text
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.starts_with('-') || trimmed.starts_with('*') {
                Some(trimmed.trim_start_matches(['-', '*', ' ']).to_string())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    ReviewDecision {
        status: status.to_string(),
        summary: text.chars().take(2000).collect(),
        suggestions,
        raw: text.to_string(),
    }
}

fn normalize_review_status(value: &str) -> String {
    let upper = value.trim().to_uppercase();
    if ["PASS", "APPROVE", "APPROVED"].contains(&upper.as_str()) {
        "PASS".to_string()
    } else {
        "REJECT".to_string()
    }
}

fn collect_git_diff(workspace: &Path) -> String {
    let Ok(output) = Command::new("git")
        .args(["diff", "--", "."])
        .current_dir(workspace)
        .output()
    else {
        return String::new();
    };
    if !output.status.success() {
        return String::new();
    }
    trim_output(&String::from_utf8_lossy(&output.stdout), 30000)
}

fn remaining_attempts(task: &Task) -> i64 {
    (task.max_attempts - task.attempts).max(0)
}

fn trim_output(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        value.to_string()
    } else {
        value[value.len().saturating_sub(limit)..].to_string()
    }
}

fn generate_run_id() -> String {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_micros())
        .unwrap_or(0);
    let counter = RUN_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("run-{stamp}-{counter}")
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn default_claude_agent() -> String {
    "claude".to_string()
}

fn default_codex_agent() -> String {
    "codex".to_string()
}

fn default_timeout_seconds() -> f64 {
    3600.0
}

fn default_poll_seconds() -> f64 {
    2.0
}

fn default_max_attempts() -> i64 {
    3
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_tasks() -> Vec<TaskSpec> {
        (1..=5)
            .map(|index| TaskSpec {
                title: format!("任务 {index}"),
                goal: format!("完成第 {index} 个步骤"),
                scope: ".".to_string(),
                acceptance_criteria: vec!["验证通过".to_string()],
                verify_commands: vec![json!({"command": shell_success(), "cwd": ".", "timeout": 5})],
                max_attempts: Some(3),
            })
            .collect()
    }

    fn shell_success() -> String {
        if cfg!(windows) {
            "cmd /C exit 0".to_string()
        } else {
            "true".to_string()
        }
    }

    fn pass_decision() -> ReviewDecision {
        ReviewDecision {
            status: "PASS".to_string(),
            summary: "VERDICT: PASS\nSUMMARY: aligned".to_string(),
            suggestions: Vec::new(),
            raw: "VERDICT: PASS\nSUMMARY: aligned".to_string(),
        }
    }

    fn reject_decision() -> ReviewDecision {
        ReviewDecision {
            status: "REJECT".to_string(),
            summary: "VERDICT: REJECT\nSUMMARY: MiMo 发现逻辑问题".to_string(),
            suggestions: vec!["修复逻辑".to_string()],
            raw: "VERDICT: REJECT\nSUMMARY: MiMo 发现逻辑问题".to_string(),
        }
    }

    #[test]
    fn planned_tasks_are_claimed_sequentially_and_progress_waits_for_codex_confirmation() {
        let root = tempfile::tempdir().expect("temp root");
        let ctx = TeamflowContext::new_for_root(root.path()).expect("context");
        let planned = ctx.plan_tasks("构建完整工作流", sample_tasks()).expect("plan tasks");
        assert_eq!(planned["workflowMetrics"]["totalTasks"], 5);
        assert_eq!(planned["workflowMetrics"]["progressPercent"], 0);

        let first = ctx.get_task("claude").expect("claim first");
        assert_eq!(first["task"]["id"], "task-001");
        let blocked = ctx.get_task("claude").expect("second claim blocked");
        assert!(blocked["task"].is_null());

        let reviewed = ctx
            .submit_review_with_decision(
                "task-001",
                "已完成第一个任务",
                vec!["workspace/file.rs".to_string()],
                vec![shell_success()],
                Some(pass_decision()),
            )
            .expect("submit pass");
        assert_eq!(reviewed["status"], "COMPLETED");

        let status = ctx.status_snapshot().expect("status");
        assert_eq!(status["workflowMetrics"]["completedTasks"], 1);
        assert_eq!(status["workflowMetrics"]["progressPercent"], 20);

        let second = ctx.get_task("claude").expect("claim second");
        assert_eq!(second["task"]["id"], "task-002");
    }

    #[test]
    fn mimo_reject_counts_as_exception_and_retries_same_task_before_next_task() {
        let root = tempfile::tempdir().expect("temp root");
        let ctx = TeamflowContext::new_for_root(root.path()).expect("context");
        ctx.plan_tasks("构建完整工作流", sample_tasks()).expect("plan tasks");
        let first = ctx.get_task("claude").expect("claim first");
        assert_eq!(first["task"]["id"], "task-001");

        let reviewed = ctx
            .submit_review_with_decision(
                "task-001",
                "实现存在问题",
                vec![],
                vec![shell_success()],
                Some(reject_decision()),
            )
            .expect("submit reject");
        assert_eq!(reviewed["status"], "MIMO_REJECTED");

        let status = ctx.status_snapshot().expect("status");
        assert_eq!(status["workflowMetrics"]["completedTasks"], 0);
        assert_eq!(status["workflowMetrics"]["exceptionTasks"], 1);

        let retry = ctx.get_task("claude").expect("retry same task");
        assert_eq!(retry["task"]["id"], "task-001");
        assert_eq!(retry["task"]["attempts"], 2);
    }

    #[test]
    fn degraded_pass_counts_as_exception_and_pauses_next_task() {
        let root = tempfile::tempdir().expect("temp root");
        let ctx = TeamflowContext::new_for_root(root.path()).expect("context");
        ctx.plan_tasks("构建完整工作流", sample_tasks()).expect("plan tasks");
        let first = ctx.get_task("claude").expect("claim first");
        assert_eq!(first["task"]["id"], "task-001");

        let run_id = ctx.current_run_id().expect("current run");
        ctx.update_task_status(&run_id, "task-001", "DEGRADED_PASS", Some("MiMo 不可用"))
            .expect("mark degraded");

        let status = ctx.status_snapshot().expect("status");
        assert_eq!(status["workflowMetrics"]["completedTasks"], 0);
        assert_eq!(status["workflowMetrics"]["exceptionTasks"], 1);
        assert_eq!(status["workflowMetrics"]["progressPercent"], 0);

        let blocked = ctx.get_task("claude").expect("claim blocked by degraded pass");
        assert!(blocked["task"].is_null());
    }
}
