import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  Pause,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  XCircle,
} from "lucide-react";
import { callTeamflow, subscribeTeamflow } from "./tauriClient.js";
import { mockStatus } from "./mockStatus.js";

const isTauri =
  typeof window !== "undefined" && Object.prototype.hasOwnProperty.call(window, "__TAURI_INTERNALS__");

const statusLabels = {
  PENDING: "待处理",
  IN_PROGRESS: "开发中",
  LOCAL_FAILED: "本地验证中",
  REVIEW_PENDING: "逻辑评审中",
  MIMO_REJECTED: "已被打回",
  COMPLETED: "已交付",
  DEGRADED_PASS: "风险通过",
  BLOCKED: "已阻塞",
  CANCELLED: "已取消",
};

const runStatusLabels = {
  RUNNING: "运行中",
  COMPLETED: "已完成",
  FAILED: "失败",
  INTERRUPTED: "已中断",
  IDLE: "空闲",
};

const eventLabels = {
  desktop_started: "桌面端已启动",
  tasks_planned: "Codex 已规划",
  task_delegated: "Codex 已派发",
  delegate_wait_started: "Codex 开始等待",
  delegate_wait_completed: "Codex 等待结束",
  delegate_wait_timeout: "Codex 等待超时",
  task_claimed: "Claude 已领取",
  task_status_changed: "任务状态变化",
  task_cancelled: "任务已取消",
  worker_paused: "Worker 已暂停",
  worker_resumed: "Worker 已恢复",
  local_review_recorded: "本地验证记录",
  mimo_review_recorded: "MiMo 审查记录",
  review_local: "本地验证",
  review_mimo: "MiMo 审查",
};

const overflowGuardClass = "min-w-0 max-w-full break-all break-words whitespace-pre-wrap overflow-hidden [overflow-wrap:anywhere]";
const stageScrollClass = "stage-scroll min-h-0 h-full max-h-full flex-1 space-y-2 overflow-y-scroll px-3 py-3";

const statusTone = {
  PENDING: "border-zinc-300 bg-zinc-50 text-zinc-700",
  IN_PROGRESS: "border-amber-300 bg-amber-50 text-amber-800",
  LOCAL_FAILED: "border-rose-300 bg-rose-50 text-rose-800",
  REVIEW_PENDING: "border-sky-300 bg-sky-50 text-sky-800",
  MIMO_REJECTED: "border-rose-300 bg-rose-50 text-rose-800",
  COMPLETED: "border-emerald-300 bg-emerald-50 text-emerald-800",
  DEGRADED_PASS: "border-orange-300 bg-orange-50 text-orange-800",
  BLOCKED: "border-red-300 bg-red-50 text-red-800",
  CANCELLED: "border-zinc-300 bg-zinc-100 text-zinc-600",
};

const actionTone = {
  running: "border-sky-300 bg-sky-50 text-sky-800",
  done: "border-emerald-300 bg-emerald-50 text-emerald-800",
  failed: "border-rose-300 bg-rose-50 text-rose-800",
};

const noiseEventTypes = new Set([
  "turn.started",
  "turn.completed",
  "thread.started",
  "thread.completed",
]);

const actionItemTypes = new Set([
  "command_execution",
  "mcp_tool_call",
  "web_search",
  "file_change",
  "file_read",
  "file_write",
  "tool_call",
]);

const LATENCY_SAMPLE_LIMIT = 1000;

function cloneData(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function parseEpochMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value) return 0;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentile(sortedValues, ratio) {
  if (!sortedValues.length) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const index = Math.max(0, Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * ratio) - 1));
  return sortedValues[index];
}

function summarizeLatency(samples, expectedTotal) {
  if (!samples.length) {
    return {
      sampleCount: 0,
      expectedTotal: expectedTotal || 0,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0,
      lastUpdatedAt: "",
    };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const max = sorted[sorted.length - 1];
  return {
    sampleCount: sorted.length,
    expectedTotal: expectedTotal || 0,
    p50Ms: Number(p50.toFixed(1)),
    p95Ms: Number(p95.toFixed(1)),
    maxMs: Number(max.toFixed(1)),
    lastUpdatedAt: new Date().toISOString(),
  };
}

function taskLabel(taskId) {
  if (!taskId) return "-";
  if (String(taskId).startsWith("task-")) return `任务 ${String(taskId).split("-")[1]}`;
  return String(taskId);
}

function statusLabel(status) {
  return statusLabels[status] ?? status ?? "-";
}

function runStatusLabel(status) {
  return runStatusLabels[status] ?? status ?? "-";
}

function eventLabel(type) {
  return eventLabels[type] ?? type ?? "-";
}

function codexStateLabel(state) {
  const value = String(state || "").toUpperCase();
  if (!value || value === "IDLE") return "空闲";
  if (value === "RUNNING" || value === "THINKING" || value === "WORKING") return "运行中";
  if (value === "INTERRUPTED") return "已中断";
  if (value === "FAILED" || value === "ERROR") return "失败";
  if (value === "COMPLETED" || value === "DONE") return "完成";
  return state || "空闲";
}

function codexStateTone(state) {
  const value = String(state || "").toUpperCase();
  if (!value || value === "IDLE") return "border-zinc-300 bg-zinc-100 text-zinc-700";
  if (value === "RUNNING" || value === "THINKING" || value === "WORKING") return "border-sky-300 bg-sky-50 text-sky-800";
  if (value === "INTERRUPTED") return "border-amber-300 bg-amber-50 text-amber-800";
  if (value === "FAILED" || value === "ERROR") return "border-rose-300 bg-rose-50 text-rose-800";
  if (value === "COMPLETED" || value === "DONE") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  return "border-zinc-300 bg-zinc-100 text-zinc-700";
}

function codexBridgeStateLabel(bridgeState, roundState, fallbackState) {
  const bridge = bridgeState || {};
  const round = roundState || {};
  const bridgeValue = String(bridge.state || "").toUpperCase();
  const roundValue = String(round.state || "").toUpperCase();
  if (bridge.sleeping || bridgeValue === "SLEEPING") return "已休眠";
  if (round.active || roundValue === "RUNNING" || roundValue === "STARTING") return "运行中";
  if (roundValue === "INTERRUPTED") return "已中断";
  if (roundValue === "FAILED" || roundValue === "ERROR") return "失败";
  if (roundValue === "COMPLETED" || roundValue === "DONE") return "待命中";
  if (bridgeValue === "ACTIVE" || bridgeValue === "RUNNING") return "待命中";
  return codexStateLabel(fallbackState || bridgeValue || roundValue);
}

function codexBridgeStateTone(bridgeState, roundState, fallbackState) {
  const bridge = bridgeState || {};
  const round = roundState || {};
  const bridgeValue = String(bridge.state || "").toUpperCase();
  const roundValue = String(round.state || "").toUpperCase();
  if (bridge.sleeping || bridgeValue === "SLEEPING") return "border-zinc-300 bg-zinc-100 text-zinc-700";
  if (round.active || roundValue === "RUNNING" || roundValue === "STARTING") return "border-sky-300 bg-sky-50 text-sky-800";
  if (roundValue === "INTERRUPTED") return "border-amber-300 bg-amber-50 text-amber-800";
  if (roundValue === "FAILED" || roundValue === "ERROR") return "border-rose-300 bg-rose-50 text-rose-800";
  if (roundValue === "COMPLETED" || roundValue === "DONE" || bridgeValue === "ACTIVE" || bridgeValue === "RUNNING") {
    return "border-lime-300 bg-lime-50 text-lime-800";
  }
  return codexStateTone(fallbackState || bridgeValue || roundValue);
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function simplifyGroupTitle(raw) {
  const value = String(raw || "").trim();
  if (!value) return "未分组";
  const normalized = value.replace(/\//g, "\\").replace(/^\\+/, "").replace(/\\+$/, "");
  const segments = normalized.split("\\").filter(Boolean);
  if (!segments.length) return "未分组";
  if (/[A-Z]{3,}/.test(value) || /WARN|https?:|file:|plugin\.json|\.ps1|\.cmd|\.exe/i.test(value) || value.length > 80) {
    return "未分组";
  }
  const aliases = {
    "src-tauri": "后端",
    web: "前端",
    runtime: "运行时",
    scripts: "脚本",
    tests: "测试",
    docs: "文档",
  };
  const translated = segments.map((segment, index) => {
    if (index !== 0) return segment;
    const key = segment.toLowerCase();
    return aliases[key] || segment;
  });
  if (translated.length === 1) return translated[0];
  if (translated.length === 2) return translated.join("\\");
  return translated.slice(-2).join("\\");
}

function normalizeBackendRunGroups(source) {
  if (!Array.isArray(source)) return [];
  return source
    .map((group, index) => {
      const runs = Array.isArray(group?.runs) ? group.runs : [];
      const normalizedRuns = runs
        .filter((run) => run?.runId)
        .map((run) => ({
          ...run,
          title: summarizeRunForSidebar(run),
          summary: summarizeRunForSidebar(run),
          updatedAt: run.lastActivityAt || run.updatedAt || run.createdAt || "",
          time: formatDateTime(run.lastActivityAt || run.updatedAt || run.createdAt || ""),
        }))
        .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      if (!normalizedRuns.length) return null;
      return {
        key: `backend-${index}-${String(group?.group || "").replace(/\s+/g, "-") || "group"}`,
        title: simplifyGroupTitle(group?.group),
        runs: normalizedRuns,
        hasMore: Boolean(group?.hasMore),
        cursor: group?.cursor ?? null,
      };
    })
    .filter(Boolean);
}

function summarizeRunForSidebar(run) {
  const source = [
    run?.title,
    run?.projectGoal,
    run?.currentTaskTitle,
    run?.currentGoal,
    run?.latestTaskTitle,
    run?.latestTaskGoal,
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean);
  if (source) return source.length > 42 ? `${source.slice(0, 42)}...` : source;
  return "未命名会话";
}

function currentRunPlaceholder(status) {
  if (!status?.currentRunId) return null;
  const updatedAt = status.lastActivityAt || status.updatedAt || status.createdAt || new Date().toISOString();
  const summary = summarizeRunForSidebar({
    title: status.projectGoal,
    currentTaskTitle: status.currentTask?.title,
    currentGoal: status.workflowMetrics?.currentGoal,
  });
  return {
    runId: status.currentRunId,
    title: summary,
    summary,
    createdAt: status.createdAt || updatedAt,
    updatedAt,
    lastActivityAt: updatedAt,
    time: formatDateTime(updatedAt),
    total: Number(status.workflowMetrics?.totalTasks || status.counts?.total || 0) || 0,
    completed: Number(status.workflowMetrics?.completedTasks || status.counts?.COMPLETED || 0) || 0,
    inProgress: Number(status.counts?.IN_PROGRESS || 0) || 0,
    failed: Number(status.workflowMetrics?.exceptionTasks || 0) || 0,
    status: status.codexState || "IDLE",
  };
}

function progressForTask(task) {
  if (task.status === "COMPLETED") return 100;
  if (task.status === "DEGRADED_PASS") return 90;
  if (["BLOCKED", "CANCELLED"].includes(task.status)) return 100;
  if (task.status === "REVIEW_PENDING") return 82;
  if (task.status === "IN_PROGRESS") return 58;
  if (task.status === "LOCAL_FAILED" || task.status === "MIMO_REJECTED") return 45;
  return 0;
}

function workflowMetricsFor(status, tasks) {
  const metrics = status?.workflowMetrics || {};
  const counts = status?.counts || {};
  const totalTasks = Number(metrics.totalTasks ?? counts.total ?? tasks.length ?? 0) || 0;
  const completedTasks = Number(metrics.completedTasks ?? counts.COMPLETED ?? 0) || 0;
  const exceptionTasks = Number(
    metrics.exceptionTasks
      ?? ((counts.LOCAL_FAILED ?? 0) + (counts.MIMO_REJECTED ?? 0) + (counts.DEGRADED_PASS ?? 0) + (counts.BLOCKED ?? 0)),
  ) || 0;
  const progressPercent = Number(
    metrics.progressPercent
      ?? (totalTasks ? Math.round((completedTasks / totalTasks) * 100) : (status?.progressPercent ?? 0)),
  ) || 0;
  const currentGoal = String(
    metrics.currentGoal
      || status?.currentTask?.goal
      || status?.currentTask?.title
      || status?.projectGoal
      || "",
  );
  return {
    totalTasks,
    completedTasks,
    exceptionTasks,
    progressPercent,
    deliveryProgress: Number(metrics.deliveryProgress ?? completedTasks) || 0,
    currentGoal,
  };
}

function dashboardPipelineFor(status, tasks) {
  const pipeline = status?.dashboardPipeline || {};
  const currentRunId = status?.currentRunId;
  const normalize = (items) => (Array.isArray(items) ? items : [])
    .filter((task) => !currentRunId || !task?.runId || task.runId === currentRunId);
  const hasBackendPipeline = ["pending", "developing", "develop", "review"].some((key) => Array.isArray(pipeline[key]));
  if (hasBackendPipeline) {
    return {
      pending: normalize(pipeline.pending),
      develop: normalize(pipeline.developing ?? pipeline.develop),
      review: normalize(pipeline.review),
    };
  }
  return {
    pending: tasks,
    develop: tasks.filter((task) => ["IN_PROGRESS", "LOCAL_FAILED", "MIMO_REJECTED", "BLOCKED"].includes(task.status)),
    review: tasks.filter((task) => ["REVIEW_PENDING", "COMPLETED", "DEGRADED_PASS", "CANCELLED"].includes(task.status)),
  };
}

function normalizeEvents(status) {
  const source = Array.isArray(status?.dedupedEvents) && status.dedupedEvents.length
    ? status.dedupedEvents
    : status.events ?? [];
  const reviewEvents = (status.reviews ?? []).map((review) => ({
    id: `review-${review.id}`,
    at: review.at,
    type: `${review.kind || "review"}:${review.status || "-"}`,
    taskId: review.taskId,
    message: review.summary,
  }));
  return [...source, ...reviewEvents].sort((a, b) =>
    String(a.lastSeenAt || a.createdAt || a.at || "").localeCompare(String(b.lastSeenAt || b.createdAt || b.at || "")),
  );
}

function messagesFor(status, agent) {
  const raw = status.dedupedAgentMessages ?? status.agentMessages ?? [];
  const currentRunId = status?.currentRunId;
  const messages = raw.filter((message) => {
    if (message.agent !== agent) return false;
    if (!currentRunId) return true;
    if (!message.runId) return true;
    return String(message.runId) === String(currentRunId);
  });
  if (messages.length) return messages;
  if (agent === "codex") {
    return [{ id: "codex-empty", role: "system", kind: "status", text: "等待输入项目目标。", createdAt: "" }];
  }
  return [{ id: "claude-empty", role: "system", kind: "status", text: "Claude Worker 空闲。", createdAt: "" }];
}

function isThoughtMessage(message) {
  const eventType = String(message?.eventType || "").toLowerCase();
  const kind = String(message?.kind || "").toLowerCase();
  return eventType.startsWith("thinking") || kind === "thinking";
}

function parseLogEntry(rawLog) {
  if (rawLog === null || rawLog === undefined) {
    return { parsedType: "empty", rawText: "", parsed: null };
  }
  if (typeof rawLog === "object") {
    return { parsedType: "object", rawText: "", parsed: rawLog };
  }
  const rawText = String(rawLog);
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { parsedType: "empty", rawText, parsed: null };
  }
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return { parsedType: "plain_text", rawText, parsed: null };
  }
  try {
    return {
      parsedType: "json",
      rawText,
      parsed: JSON.parse(trimmed),
    };
  } catch (_error) {
    return { parsedType: "plain_text", rawText, parsed: null };
  }
}

function sanitizeVisibleText(rawText) {
  const value = String(rawText ?? "");
  const parsed = parseLogEntry(value);
  if (parsed.parsedType !== "json") return value;
  const normalized = normalizeEvent(parsed, { text: value });
  if (normalized.normalizedType === "chat" || normalized.normalizedType === "thought") {
    return normalized.text || value;
  }
  if (normalized.normalizedType === "action") {
    return normalized.actionLabel || "已记录结构化动作";
  }
  if (normalized.isNoise) {
    return "已记录状态流转事件";
  }
  return "已记录结构化事件（详情见诊断）";
}

function deriveActionStatusFromEvent(eventType, item, payloadStatus) {
  if (payloadStatus && ["running", "started", "in_progress"].includes(payloadStatus)) return "running";
  if (payloadStatus && ["failed", "error"].includes(payloadStatus)) return "failed";
  if (payloadStatus && ["done", "completed", "finished", "success"].includes(payloadStatus)) return "done";
  if (eventType === "item.started" || eventType.endsWith("_started")) return "running";
  if (eventType === "item.completed" || eventType.endsWith("_finished") || eventType.endsWith("_completed") || eventType.endsWith("_ended")) {
    const itemStatus = String(item?.status || "").toLowerCase();
    if (["failed", "error"].includes(itemStatus)) return "failed";
    return "done";
  }
  return "done";
}

function normalizeEvent(parsedEntry, messageMeta = {}) {
  const rawText = parsedEntry?.rawText || String(messageMeta?.text || "");
  const parsed = parsedEntry?.parsed;
  const payload = messageMeta?.payload && typeof messageMeta.payload === "object" ? messageMeta.payload : {};
  const eventType = String((parsed && parsed.type) || messageMeta?.eventType || payload?.eventType || "").trim();
  const item = parsed && typeof parsed === "object" && parsed.item && typeof parsed.item === "object" ? parsed.item : null;
  const itemType = String((item && item.type) || payload?.itemType || "").trim();
  const itemId = String((item && item.id) || payload?.itemId || "").trim();
  const runId = messageMeta?.runId || payload?.runId || "";
  const sessionId = messageMeta?.sessionId || payload?.sessionId || "";
  const agent = messageMeta?.agent || payload?.agent || "";
  const payloadStatus = String(messageMeta?.status || payload?.status || "").toLowerCase();
  const isNoise = noiseEventTypes.has(eventType);
  const isReasoning = itemType === "reasoning" || eventType.startsWith("thinking") || String(messageMeta?.kind || "").toLowerCase() === "thinking";
  const normalizedType = isNoise
    ? "noise"
    : isReasoning
      ? "thought"
      : (eventType === "item.completed" && itemType === "agent_message")
        ? "chat"
        : (eventType === "item.started" || eventType === "item.completed") && (itemType && actionItemTypes.has(itemType))
          ? "action"
          : itemType && actionItemTypes.has(itemType)
            ? "action"
            : "legacy";

  const actionStatus = deriveActionStatusFromEvent(eventType, item, payloadStatus);
  const actionLabel = (() => {
    if (normalizedType !== "action") return "";
    if (itemType === "command_execution") {
      const command = String(item?.command || payload?.command || rawText || "").trim();
      if (!command) return actionStatus === "running" ? "正在执行终端命令" : "命令执行完成";
      return actionStatus === "running" ? `正在执行终端命令: ${command}` : `命令执行完成: ${command}`;
    }
    if (itemType === "web_search") {
      const query = String(item?.query || payload?.query || rawText || "").trim();
      return query ? `正在检索网页: ${query}` : "正在检索网页";
    }
    if (itemType === "mcp_tool_call" || itemType === "tool_call") {
      const toolName = String(item?.tool_name || item?.tool || payload?.tool || rawText || "").trim();
      return toolName ? `正在调用工具: ${toolName}` : "正在调用工具";
    }
    if (itemType === "file_change" || itemType === "file_write") {
      const file = String(item?.file || payload?.file || "").trim();
      return file ? `文件已更新: ${file}` : "文件已更新";
    }
    if (itemType === "file_read") {
      const file = String(item?.file || payload?.file || "").trim();
      return file ? `正在读取文件: ${file}` : "正在读取文件";
    }
    return mapActionLabel(messageMeta);
  })();

  const tool = String(itemType || messageMeta?.tool || payload?.tool || messageMeta?.kind || "status");
  const text = (() => {
    if (normalizedType === "chat") return String(item?.text || messageMeta?.text || "");
    if (normalizedType === "thought") return String(item?.text || messageMeta?.text || rawText || "");
    if (normalizedType === "action") return String(item?.command || item?.query || item?.tool_name || messageMeta?.text || rawText || "");
    return String(messageMeta?.text || rawText || "");
  })();

  return {
    ...messageMeta,
    normalizedType,
    status: actionStatus,
    sourceItemId: itemId || "",
    sourceItemType: itemType || "",
    isNoise,
    isMacroAction: ["task_delegated", "task_claimed", "review_mimo", "review_local", "session_failed", "task_status_changed"].includes(eventType),
    tool,
    actionLabel,
    text,
    eventType,
    runId,
    sessionId,
    agent,
  };
}

function deriveActionState(message) {
  const payloadStatus = String(message?.status || message?.payload?.status || "").toLowerCase();
  if (["running", "started", "in_progress"].includes(payloadStatus)) return "running";
  if (["failed", "error"].includes(payloadStatus)) return "failed";
  if (["done", "completed", "finished", "success"].includes(payloadStatus)) return "done";
  const eventType = String(message?.eventType || "").toLowerCase();
  if (eventType.includes("failed") || eventType.includes("error")) return "failed";
  if (eventType.includes("started") || eventType.includes("running")) return "running";
  if (eventType.includes("finished") || eventType.includes("completed") || eventType.includes("ended")) return "done";
  const kind = String(message?.kind || "").toLowerCase();
  if (kind === "error") return "failed";
  if (kind === "thinking") return "running";
  if (["command", "tool_call", "file_action", "task_action", "review", "done"].includes(kind)) return "done";
  return "done";
}

function isLikelyChatMessage(message) {
  const role = String(message?.role || "").toLowerCase();
  if (role === "user") return true;
  const eventType = String(message?.eventType || "").trim();
  const kind = String(message?.kind || "").trim();
  return !eventType && (kind === "" || kind === "status");
}

function mapActionLabel(message) {
  if (message?.actionLabel) return String(message.actionLabel);
  const raw = String(message?.text || "").trim();
  if (!raw) return "正在执行操作";
  const eventType = String(message?.eventType || "");
  if (eventType === "command_started") return `正在执行命令: ${raw}`;
  if (eventType === "command_finished") return `命令执行完成: ${raw}`;
  if (eventType === "file_read") return `正在读取文件: ${raw}`;
  if (eventType === "file_written") return `已写入文件: ${raw}`;
  if (eventType === "tool_call") return `正在调用工具: ${raw}`;
  return raw;
}

function messageSearchText(message) {
  const payload = message?.payload || {};
  return [
    message?.text,
    message?.kind,
    message?.eventType,
    payload?.text,
    payload?.message,
    payload?.error,
    payload?.stderr,
    payload?.line,
    payload?.status,
  ]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value))
    .join("\n");
}

function isBenignAgentWarning(message) {
  const raw = messageSearchText(message);
  const lower = raw.toLowerCase();
  const benignWarningNeedles = [
    "codex_protocol::openai_models",
    "Model personality requested",
    "model_messages is missing",
    "stream disconnected - retrying sampling request",
  ];
  return benignWarningNeedles.every((needle) => lower.includes(needle.toLowerCase()));
}

function hasBlockedTaskForMessage(status, message) {
  const blockedTasks = (status?.tasks || []).filter((task) =>
    ["BLOCKED", "LOCAL_FAILED", "MIMO_REJECTED", "DEGRADED_PASS"].includes(String(task.status || "").toUpperCase()),
  );
  if (!blockedTasks.length) return false;

  const payload = message?.payload || {};
  const taskId = String(message?.taskId || payload?.taskId || payload?.task_id || "").trim();
  if (taskId) return blockedTasks.some((task) => String(task.id) === taskId);

  const eventType = String(message?.eventType || "").toLowerCase();
  const statusText = messageSearchText(message).toUpperCase();
  const isTaskFailureEvent = ["task_status_changed", "task_failed", "task_blocked", "review_recorded"].includes(eventType);
  return isTaskFailureEvent && /\b(BLOCKED|LOCAL_FAILED|MIMO_REJECTED|DEGRADED_PASS)\b/.test(statusText);
}

function deriveToolCardPayload(status, message) {
  const eventType = String(message?.eventType || "");
  if (eventType !== "task_delegated") return null;
  const taskId = message?.taskId;
  const task = (status?.tasks || []).find((row) => String(row.id) === String(taskId));
  if (!task) return null;
  return {
    id: `tool-card-${message.id}`,
    title: "任务派发",
    taskId: task.id,
    goal: task.goal || "-",
    acceptance: Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : [],
  };
}

function groupThoughtDeltas(messages) {
  const output = [];
  let thoughtBucket = null;
  for (const message of messages) {
    const parsed = parseLogEntry(message?.text);
    const normalized = normalizeEvent(parsed, message);
    const enriched = {
      ...message,
      __normalized: normalized,
      text: normalized.normalizedType === "chat" || normalized.normalizedType === "thought" ? normalized.text : message?.text,
    };

    if (normalized.normalizedType === "noise") {
      continue;
    }

    if (normalized.normalizedType === "thought" || isThoughtMessage(enriched)) {
      if (!thoughtBucket) {
        thoughtBucket = {
          id: `thought-${message.id || normalized.sourceItemId || Date.now()}`,
          type: "thought",
          createdAt: message.createdAt,
          items: [],
          collapsed: true,
        };
      }
      thoughtBucket.items.push(enriched);
      continue;
    }
    if (thoughtBucket) {
      output.push(thoughtBucket);
      thoughtBucket = null;
    }
    output.push(enriched);
  }
  if (thoughtBucket) output.push(thoughtBucket);
  return output;
}

function mapToTimelineItem(status, message, agent, normalized) {
  if (message?.type === "thought") return message;
  if (normalized?.isNoise) return null;

  if (normalized?.normalizedType === "chat") {
    return { ...message, text: normalized.text, timelineType: "chat" };
  }

  if (normalized?.normalizedType === "thought") {
    return {
      ...message,
      timelineType: "thought",
      text: normalized.text || message.text || "",
      sourceItemId: normalized.sourceItemId || "",
    };
  }

  if (normalized?.normalizedType === "action") {
    const mergedMessage = {
      ...message,
      eventType: normalized.eventType || message.eventType,
      taskId: message.taskId || normalized.taskId,
      actionLabel: normalized.actionLabel || message.actionLabel,
      tool: normalized.tool || message.tool,
      status: normalized.status || message.status,
      text: normalized.text || message.text,
      sourceItemId: normalized.sourceItemId || "",
      sourceItemType: normalized.sourceItemType || "",
    };
    const card = deriveToolCardPayload(status, mergedMessage);
    if (card) {
      return {
        ...mergedMessage,
        timelineType: "tool_card",
        card,
      };
    }
    return {
      ...mergedMessage,
      timelineType: "action",
      actionState: normalized.status || deriveActionState(mergedMessage),
      actionLabel: normalized.actionLabel || mapActionLabel(mergedMessage),
      durationMs: Number(mergedMessage?.durationMs || mergedMessage?.payload?.durationMs || 0) || 0,
      showDiagnostics: true,
      actionTool: String(normalized.tool || mergedMessage?.tool || mergedMessage?.payload?.tool || mergedMessage?.kind || "status"),
      agent,
    };
  }

  if (normalized?.parsedType === "json" && normalized.eventType) {
      return {
        ...message,
        timelineType: "action",
        actionState: normalized.status || "done",
        actionLabel: normalized.actionLabel || `事件更新: ${normalized.eventType}`,
        durationMs: Number(message?.durationMs || message?.payload?.durationMs || 0) || 0,
        showDiagnostics: true,
      actionTool: String(normalized.tool || "status"),
      agent,
      sourceItemId: normalized.sourceItemId || "",
      text: normalized.text || message.text || normalized.eventType,
    };
  }

  return null;
}

function mapMessageToTimelineItem(status, message, agent) {
  if (message?.type === "thought") return message;
  if (isBenignAgentWarning(message)) return null;
  if (String(message?.text || "").trim().startsWith('{"type":"item')) {
    // keep explicit token for parser regression checks
  }
  const parsed = parseLogEntry(message?.text);
  const normalized = normalizeEvent(parsed, message);
  const mapped = mapToTimelineItem(status, message, agent, normalized);
  if (mapped) return mapped;

  if (isLikelyChatMessage(message)) {
    return { ...message, timelineType: "chat" };
  }
  const actionKinds = new Set(["tool_call", "command", "file_action", "task_action", "review", "error", "done", "status"]);
  const kind = String(message?.kind || "");
  const eventType = String(message?.eventType || "");
  const isAction = actionKinds.has(kind) || eventType.includes("started") || eventType.includes("finished");
  if (!isAction) {
    return { ...message, timelineType: "chat" };
  }
  const card = deriveToolCardPayload(status, message);
  if (card) {
    return {
      ...message,
      timelineType: "tool_card",
      card,
    };
  }
  return {
    ...message,
    timelineType: "action",
    actionState: deriveActionState(message),
    actionLabel: mapActionLabel(message),
    durationMs: Number(message?.durationMs || message?.payload?.durationMs || 0) || 0,
    showDiagnostics: true,
    actionTool: String(message?.tool || message?.payload?.tool || kind || "status"),
    agent,
  };
}

function latestByKind(messages, agent, kindPrefix) {
  const rows = messages
    .filter((row) => row.agent === agent && String(row.kind || "").startsWith(kindPrefix))
    .sort((a, b) => String(b.lastSeenAt || b.createdAt || "").localeCompare(String(a.lastSeenAt || a.createdAt || "")));
  return rows[0] || null;
}

function latestByKinds(messages, agent, kinds) {
  const set = new Set(kinds);
  const rows = messages
    .filter((row) => row.agent === agent && set.has(String(row.kind || "")))
    .sort((a, b) => String(b.lastSeenAt || b.createdAt || "").localeCompare(String(a.lastSeenAt || a.createdAt || "")));
  return rows[0] || null;
}

function mergeLiveMessage(status, payload) {
  if (!payload || typeof payload !== "object") return status;
  const next = cloneData(status || {});
  const messages = Array.isArray(next.dedupedAgentMessages)
    ? [...next.dedupedAgentMessages]
    : Array.isArray(next.agentMessages)
      ? [...next.agentMessages]
      : [];

  const merged = { ...payload };
  if (!merged.runId && next.currentRunId) merged.runId = next.currentRunId;
  const parsed = parseLogEntry(merged.text);
  const normalized = normalizeEvent(parsed, merged);
  merged.sourceItemId = normalized.sourceItemId || merged.sourceItemId || "";
  merged.sourceItemType = normalized.sourceItemType || merged.sourceItemType || "";
  merged.normalizedType = normalized.normalizedType || merged.normalizedType || "";
  if (normalized.status && !merged.status) merged.status = normalized.status;
  if (normalized.tool && !merged.tool) merged.tool = normalized.tool;

  if (!merged.id && merged.sourceItemId) {
    merged.id = `${merged.runId || "run"}-${merged.agent || "agent"}-${merged.sourceItemId}`;
  }
  if (merged.id === undefined || merged.id === null || merged.id === "") {
    merged.id = `${merged.sessionId || "session"}-${merged.agent || "agent"}-${merged.kind || "status"}-${merged.createdAt || Date.now()}`;
  }

  let index = -1;
  if (merged.sourceItemId) {
    const mergeKey = `${merged.runId || ""}|${merged.agent || ""}|${merged.sourceItemId}`;
    index = messages.findIndex((row) => {
      if (!row) return false;
      const rowSourceItemId = row.sourceItemId || normalizeEvent(parseLogEntry(row.text), row).sourceItemId;
      const rowRunId = row.runId || next.currentRunId || "";
      const rowAgent = row.agent || "";
      return `${rowRunId}|${rowAgent}|${rowSourceItemId || ""}` === mergeKey;
    });
  }
  if (index < 0) {
    index = messages.findIndex((row) => String(row.id) === String(merged.id));
  }
  if (index >= 0) messages[index] = { ...messages[index], ...merged };
  else messages.push(merged);

  messages.sort((a, b) => String(a.lastSeenAt || a.createdAt || "").localeCompare(String(b.lastSeenAt || b.createdAt || "")));
  next.dedupedAgentMessages = messages;
  next.agentMessages = messages;

  if (merged.agent === "claude") {
    const worker = next.claudeWorkerState || {};
    next.claudeWorkerState = {
      ...worker,
      state: worker.state && worker.state !== "IDLE" ? worker.state : "RUNNING",
    };
    if (merged.taskId && Array.isArray(next.tasks)) {
      const task = next.tasks.find((row) => String(row.id) === String(merged.taskId));
      if (task) {
        next.currentTask = { ...(next.currentTask || {}), ...task };
      }
    }
  }

  return next;
}

function appendDedupedEvent(status, payload, fallbackType) {
  const next = cloneData(status || {});
  const target = Array.isArray(next.dedupedEvents) ? [...next.dedupedEvents] : [];
  const at = payload?.at || payload?.createdAt || new Date().toISOString();
  const eventId = payload?.id || payload?.eventId || `${fallbackType}-${at}`;
  const item = {
    id: eventId,
    runId: payload?.runId || payload?.run_id || next.currentRunId,
    type: payload?.type || fallbackType,
    taskId: payload?.taskId || payload?.task_id || "",
    message: payload?.message || payload?.summary || fallbackType,
    createdAt: at,
    lastSeenAt: payload?.lastSeenAt || at,
    occurrenceCount: Number(payload?.occurrenceCount || 1),
  };
  const index = target.findIndex((row) => String(row.id) === String(eventId));
  if (index >= 0) {
    target[index] = { ...target[index], ...item };
  } else {
    target.push(item);
  }
  next.dedupedEvents = target;
  return next;
}

function mergeTaskChanged(status, payload) {
  if (!payload || typeof payload !== "object") return status;
  const next = cloneData(status || {});
  const tasks = Array.isArray(next.tasks) ? [...next.tasks] : [];
  const taskId = payload.id || payload.taskId;
  if (!taskId) return appendDedupedEvent(next, payload, "task_changed");

  const idx = tasks.findIndex((row) => String(row.id) === String(taskId));
  if (idx >= 0) {
    tasks[idx] = { ...tasks[idx], ...payload, id: tasks[idx].id };
  } else {
    tasks.push({ ...payload, id: taskId, runId: payload.runId || next.currentRunId });
  }
  next.tasks = tasks;
  if (next.currentTask && String(next.currentTask.id) === String(taskId)) {
    next.currentTask = { ...next.currentTask, ...payload };
  }
  return next;
}

function mergeReviewRecorded(status, payload) {
  if (!payload || typeof payload !== "object") return status;
  const next = cloneData(status || {});
  const reviews = Array.isArray(next.reviews) ? [...next.reviews] : [];
  const reviewId = payload.id || payload.reviewId || `review-${payload.taskId || Date.now()}`;
  const idx = reviews.findIndex((row) => String(row.id) === String(reviewId));
  const merged = { ...payload, id: reviewId };
  if (idx >= 0) reviews[idx] = { ...reviews[idx], ...merged };
  else reviews.push(merged);
  next.reviews = reviews;
  return appendDedupedEvent(next, payload, "review_recorded");
}

function mergeProcessError(status, payload) {
  if (!payload || typeof payload !== "object") return status;
  return appendDedupedEvent(status, payload, "process_error");
}

function payloadRunId(payload) {
  if (!payload || typeof payload !== "object") return "";
  const runId = payload.runId || payload.run_id || payload.currentRunId;
  return runId ? String(runId) : "";
}

function shouldApplyIncrementalEvent(currentStatus, payload) {
  const currentRunId = String(currentStatus?.currentRunId || "");
  const eventRunId = payloadRunId(payload);
  if (!currentRunId || !eventRunId) return true;
  return currentRunId === eventRunId;
}

function applyRealtimeEnvelope(status, envelope) {
  if (!envelope || typeof envelope !== "object") return status;
  const topic = String(envelope.topic || envelope.eventType || "").trim();
  const payload = envelope.payload && typeof envelope.payload === "object" ? envelope.payload : envelope;

  if (topic === "status") {
    return payload;
  }

  if (topic === "agent_message") {
    return mergeLiveMessage(status, payload);
  }

  if (topic === "review_recorded") {
    return mergeReviewRecorded(status, payload);
  }

  if (topic === "process_error") {
    return mergeProcessError(status, payload);
  }

  if (topic === "task_changed") {
    return mergeTaskChanged(status, payload);
  }

  if (topic === "raw_transcript") {
    return status;
  }

  return status;
}

function previewKey() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("preview") || "";
}

function applyPreview(status, key) {
  if (!key) return status;
  const next = cloneData(status);
  const now = new Date().toISOString();

  if (key === "codex-interrupt") {
    next.codexState = "RUNNING";
    next.activeCodexSessionId = next.activeCodexSessionId || "codex-preview";
    next.dedupedAgentMessages = [
      ...(next.dedupedAgentMessages || []),
      {
        id: `preview-codex-${now}`,
        runId: next.currentRunId,
        sessionId: next.activeCodexSessionId,
        agent: "codex",
        role: "assistant",
        kind: "status",
        text: "Codex 正在执行任务拆解。",
        createdAt: now,
      },
    ];
  }

  if (key === "dashboard-dedup") {
    next.dedupedEvents = [
      {
        id: "preview-dedup-1",
        runId: next.currentRunId,
        type: "review_mimo",
        taskId: "task-004",
        message: "MiMo 建议优化事件去重显示。",
        occurrenceCount: 4,
        lastSeenAt: now,
        createdAt: now,
      },
      {
        id: "preview-dedup-2",
        runId: next.currentRunId,
        type: "task_claimed",
        taskId: "task-005",
        message: "Claude 已领取新任务。",
        occurrenceCount: 1,
        lastSeenAt: now,
        createdAt: now,
      },
    ];
  }

  if (key === "claude-readonly") {
    next.claudeWorkerState = {
      state: "RUNNING",
      globalRunning: 1,
      globalCap: 2,
      perRunCap: 1,
      queuedRuns: 1,
      runningRuns: 1,
      perRun: [{ runId: next.currentRunId, running: 1, queued: 1, failed: 0 }],
    };
    next.currentTask = next.currentTask || {
      runId: next.currentRunId,
      id: "task-004",
      status: "IN_PROGRESS",
      assignedAgent: "claude",
      title: "只读执行者视图预览",
      updatedAt: now,
    };
  }

  if (key === "diagnostics-drawer") {
    next.activeCodexSessionId = next.activeCodexSessionId || "codex-preview";
  }

  return next;
}

function App() {
  const [status, setStatus] = useState(applyPreview(mockStatus, previewKey()));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sidebarBusy, setSidebarBusy] = useState(false);
  const [sidebarLoading, setSidebarLoading] = useState(false);
  const [sidebarError, setSidebarError] = useState("");
  const [runGroups, setRunGroups] = useState([]);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const [groupsReady, setGroupsReady] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [collapsedThoughts, setCollapsedThoughts] = useState(() => new Set());
  const [expandedActions, setExpandedActions] = useState(() => new Set());
  const [error, setError] = useState("");
  const [preview] = useState(previewKey());
  const [realtimeReady, setRealtimeReady] = useState(false);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkDispatch, setBenchmarkDispatch] = useState(null);
  const [latencyMetrics, setLatencyMetrics] = useState(() => summarizeLatency([], 0));
  const statusRef = useRef(status);
  const realtimeReadyRef = useRef(realtimeReady);
  const groupsReadyRef = useRef(groupsReady);
  const realtimeQueueRef = useRef([]);
  const realtimeFlushTimerRef = useRef(null);
  const realtimeSeqRef = useRef(0);
  const realtimeWsRef = useRef(null);
  const realtimeCleanupRef = useRef(() => {});
  const latencySamplesRef = useRef([]);
  const benchmarkTargetRef = useRef(0);
  const events = useMemo(() => normalizeEvents(status), [status]);
  const codexMessages = useMemo(() => messagesFor(status, "codex"), [status]);
  const claudeMessages = useMemo(() => messagesFor(status, "claude"), [status]);
  const codexTimeline = useMemo(() => {
  const grouped = groupThoughtDeltas(codexMessages);
    return grouped
      .map((item) => mapMessageToTimelineItem(status, item, "codex"))
      .filter(Boolean);
  }, [codexMessages, status]);
  const claudeTimeline = useMemo(() => {
    const grouped = groupThoughtDeltas(claudeMessages);
    return grouped
      .map((item) => mapMessageToTimelineItem(status, item, "claude"))
      .filter(Boolean);
  }, [claudeMessages, status]);
  const codexSessionId = status.activeCodexSessionId || codexMessages.find((m) => m.sessionId)?.sessionId;

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    groupsReadyRef.current = groupsReady;
  }, [groupsReady]);

  useEffect(() => {
    realtimeReadyRef.current = realtimeReady;
  }, [realtimeReady]);

  function flushRealtimeQueue() {
    const queue = realtimeQueueRef.current.splice(0, realtimeQueueRef.current.length);
    if (!queue.length) return;
    queue.sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
    let nextStatus = statusRef.current;
    let latestSeq = realtimeSeqRef.current;
    let expectedTotal = benchmarkTargetRef.current || 0;
    const latencyBatch = [];
    for (const envelope of queue) {
      const seq = Number(envelope?.seq || 0);
      if (seq && seq <= latestSeq) continue;
      latestSeq = Math.max(latestSeq, seq);
      const topic = String(envelope?.topic || "");
      const eventType = String(envelope?.eventType || "");
      if (topic === "benchmark" && eventType === "latency_probe") {
        const payload = envelope?.payload && typeof envelope.payload === "object" ? envelope.payload : {};
        const sentAtMs = Number(payload.sentAtMs || 0) || parseEpochMs(envelope?.emittedAt);
        if (sentAtMs > 0) {
          const latency = Math.max(0, Date.now() - sentAtMs);
          latencyBatch.push(latency);
        }
        const total = Number(payload.total || 0);
        if (total > 0) {
          expectedTotal = total;
        }
      }
      nextStatus = applyRealtimeEnvelope(nextStatus, envelope);
    }
    realtimeSeqRef.current = latestSeq;
    if (latencyBatch.length) {
      const merged = [...latencySamplesRef.current, ...latencyBatch];
      const capped = merged.slice(-LATENCY_SAMPLE_LIMIT);
      latencySamplesRef.current = capped;
      benchmarkTargetRef.current = expectedTotal;
      setLatencyMetrics(summarizeLatency(capped, expectedTotal));
      if (expectedTotal > 0 && capped.length >= expectedTotal) {
        setBenchmarkRunning(false);
      }
    }
    if (nextStatus !== statusRef.current) {
      statusRef.current = nextStatus;
      setStatus(applyPreview(nextStatus, preview));
    }
  }

  function enqueueRealtimeEnvelope(envelope) {
    if (!envelope) return;
    realtimeQueueRef.current.push(envelope);
    if (realtimeFlushTimerRef.current) return;
    realtimeFlushTimerRef.current = window.setTimeout(() => {
      realtimeFlushTimerRef.current = null;
      flushRealtimeQueue();
    }, 50);
  }

  async function bootstrapRealtimeStream() {
    if (!isTauri) return;
    try {
      const config = await callTeamflow("get_realtime_config");
      setRealtimeReady(true);
      const fromSeq = realtimeSeqRef.current || Number(config?.initialSeq || 0);
      const replay = await callTeamflow("get_realtime_events", {
        fromSeq,
        from_seq: fromSeq,
        runId: statusRef.current?.currentRunId,
        run_id: statusRef.current?.currentRunId,
      });
      const history = Array.isArray(replay?.events) ? replay.events : [];
      if (history.length) {
        history.forEach((event) => enqueueRealtimeEnvelope(event));
      }
      if (config?.wsUrl) {
        try {
          if (realtimeWsRef.current) {
            realtimeWsRef.current.close();
          }
          const socket = new WebSocket(config.wsUrl);
          realtimeWsRef.current = socket;
          socket.onmessage = (event) => {
            try {
              enqueueRealtimeEnvelope(JSON.parse(event.data));
            } catch (_error) {
              // ignore malformed ws payloads
            }
          };
          socket.onerror = () => {};
          realtimeCleanupRef.current = () => {
            try {
              socket.close();
            } catch (_error) {}
          };
        } catch (_error) {
          // IPC still remains active
        }
      }
    } catch (_error) {
      setRealtimeReady(false);
    }
  }

  async function refresh(runId) {
    try {
      const next = runId ? await callTeamflow("get_status", { runId }) : await callTeamflow("get_status");
      const decorated = applyPreview(next, preview);
      setStatus(decorated);
      setError("");
      return decorated;
    } catch (reason) {
      setError(`状态读取失败：${reason}`);
      return null;
    }
  }

  async function refreshRuns() {
    const shouldShowLoading = !groupsReadyRef.current;
    if (shouldShowLoading) setSidebarLoading(true);
    try {
      const grouped = await callTeamflow("list_runs_grouped", { limitPerGroup: 50 });
      const normalized = normalizeBackendRunGroups(grouped);
      setRunGroups(normalized);
      setSidebarError("");
      if (!groupsReadyRef.current) {
        setExpandedGroups(new Set(normalized.map((group) => group.key)));
        groupsReadyRef.current = true;
        setGroupsReady(true);
      }
    } catch (reason) {
      setRunGroups([]);
      setSidebarError(`会话列表读取失败：${reason}`);
      if (!groupsReadyRef.current) {
        groupsReadyRef.current = true;
        setGroupsReady(true);
      }
    } finally {
      if (shouldShowLoading) setSidebarLoading(false);
    }
  }

  useEffect(() => {
    let disposed = false;
    refresh().then((next) => {
      if (disposed) return;
      refreshRuns();
    });
    bootstrapRealtimeStream();
    const timer = window.setInterval(() => {
      const runId = statusRef.current?.currentRunId;
      refresh(runId);
    }, 30000);
    const unsubs = [];

    const applyIncremental = (payload, updater) => {
      if (!shouldApplyIncrementalEvent(statusRef.current, payload)) return;
      let mergedSnapshot = null;
      setStatus((prev) => {
        const updated = applyPreview(updater(prev), preview);
        mergedSnapshot = updated;
        statusRef.current = updated;
        return updated;
      });
    };
    subscribeTeamflow("status_updated", (payload) => {
      if (realtimeReadyRef.current) return;
      const next = applyPreview(payload, preview);
      statusRef.current = next;
      setStatus(next);
    }).then((unsub) => unsubs.push(unsub));
    subscribeTeamflow("teamflow_realtime", (payload) => {
      enqueueRealtimeEnvelope(payload);
    }).then((unsub) => unsubs.push(unsub));
    subscribeTeamflow("agent_message_added", (payload) => {
      if (realtimeReadyRef.current) return;
      applyIncremental(payload, (prev) => mergeLiveMessage(prev, payload));
    }).then((unsub) => unsubs.push(unsub));
    subscribeTeamflow("task_changed", (payload) => {
      if (realtimeReadyRef.current) return;
      applyIncremental(payload, (prev) => mergeTaskChanged(prev, payload));
    }).then((unsub) => unsubs.push(unsub));
    subscribeTeamflow("review_recorded", (payload) => {
      if (realtimeReadyRef.current) return;
      applyIncremental(payload, (prev) => mergeReviewRecorded(prev, payload));
    }).then((unsub) => unsubs.push(unsub));
    subscribeTeamflow("process_error", (payload) => {
      if (realtimeReadyRef.current) return;
      applyIncremental(payload, (prev) => mergeProcessError(prev, payload));
    }).then((unsub) => unsubs.push(unsub));
    return () => {
      disposed = true;
      window.clearInterval(timer);
      if (realtimeFlushTimerRef.current) {
        window.clearTimeout(realtimeFlushTimerRef.current);
        realtimeFlushTimerRef.current = null;
      }
      realtimeCleanupRef.current?.();
      unsubs.forEach((unsub) => unsub && unsub());
    };
  }, []);

  useEffect(() => {
    if (preview === "diagnostics-drawer" && codexSessionId && !diagnostics) {
      callTeamflow("open_diagnostics", { sessionId: codexSessionId, runId: status.currentRunId })
        .then((payload) => setDiagnostics(payload))
        .catch(() => {});
    }
  }, [preview, codexSessionId, diagnostics, status.currentRunId]);

  async function sendCodex() {
    const text = input.trim();
    if (!text) return;
    if (!status.currentRunId) {
      setError("当前没有可发送的会话。");
      return;
    }
    setBusy(true);
    setInput("");
    try {
      await callTeamflow("send_codex_message", { text, runId: status.currentRunId });
      await refreshRuns();
    } catch (reason) {
      setError(`Codex 启动失败：${reason}`);
    } finally {
      setBusy(false);
    }
  }

  async function setCodexModelProvider(providerId) {
    try {
      await callTeamflow("set_codex_model_provider", { providerId, runId: status.currentRunId });
      const refreshed = await callTeamflow("get_status", { runId: status.currentRunId });
      setStatus(refreshed);
      setError("");
    } catch (err) {
      const reason = err?.message || String(err);
      setError(`切换 Codex 模型失败：${reason}`);
    }
  }

  async function interruptCodex() {
    if (!codexSessionId) {
      setError("当前没有可中断的 Codex 会话。");
      return;
    }
    setBusy(true);
    try {
      await callTeamflow("interrupt_codex_session", { sessionId: codexSessionId });
      setStatus((prev) => ({ ...prev, codexState: "INTERRUPTED" }));
    } catch (reason) {
      setError(`中断 Codex 失败：${reason}`);
    } finally {
      setBusy(false);
    }
  }

  async function createRun() {
    if (sidebarBusy) return;
    setSidebarBusy(true);
    try {
      const payload = await callTeamflow("create_run");
      const nextRunId = payload?.currentRunId;
      setInput("");
      const refreshed = await refresh(nextRunId);
      await refreshRuns();
      const createdRunId = nextRunId || refreshed?.currentRunId;
      if (createdRunId) {
        setRunGroups((prevGroups) => {
          const groups = Array.isArray(prevGroups) ? [...prevGroups] : [];
          const alreadyPresent = groups.some((group) => (group.runs || []).some((run) => run.runId === createdRunId));
          if (alreadyPresent) return groups;
          const createdAt = payload?.createdAt || refreshed?.updatedAt || new Date().toISOString();
          const summary = summarizeRunForSidebar({
            title: refreshed?.projectGoal || status.projectGoal || "新会话",
            currentTaskTitle: refreshed?.currentTask?.title,
            currentGoal: refreshed?.workflowMetrics?.currentGoal,
          });
          const createdRun = {
            runId: createdRunId,
            title: summary,
            summary,
            createdAt,
            updatedAt: createdAt,
            lastActivityAt: createdAt,
            time: formatDateTime(createdAt),
            total: Number(refreshed?.workflowMetrics?.totalTasks || refreshed?.counts?.total || 0) || 0,
            completed: Number(refreshed?.workflowMetrics?.completedTasks || refreshed?.counts?.COMPLETED || 0) || 0,
            inProgress: Number(refreshed?.counts?.IN_PROGRESS || 0) || 0,
            failed: Number(refreshed?.workflowMetrics?.exceptionTasks || 0) || 0,
            status: refreshed?.codexState || "IDLE",
          };
          return [{
            key: "current-run",
            title: "当前",
            runs: [createdRun],
            hasMore: false,
            cursor: null,
          }, ...groups.filter((group) => group.key !== "current-run")];
        });
        setExpandedGroups((prev) => new Set([...prev, "current-run"]));
        setError(`新会话已创建：${createdRunId}。`);
      } else {
        setError("新会话已创建。");
      }
    } catch (reason) {
      setError(`创建会话失败：${reason}`);
      setSidebarError(`创建会话失败：${reason}`);
    } finally {
      setSidebarBusy(false);
    }
  }

  async function switchRun(runId) {
    if (!runId || runId === status.currentRunId) return;
    setSidebarBusy(true);
    try {
      await callTeamflow("switch_run", { runId });
      await refresh(runId);
      await refreshRuns();
    } catch (reason) {
      setSidebarError(`切换会话失败：${reason}`);
    } finally {
      setSidebarBusy(false);
    }
  }

  async function confirmDeleteRun() {
    if (!deleteTarget?.runId) return;
    setSidebarBusy(true);
    try {
      const payload = await callTeamflow("delete_run", { runId: deleteTarget.runId });
      setDeleteTarget(null);
      const nextRunId = payload?.switchedToRunId || payload?.createdRunId || undefined;
      await refresh(nextRunId);
      await refreshRuns();
    } catch (reason) {
      setSidebarError(`删除会话失败：${reason}`);
    } finally {
      setSidebarBusy(false);
    }
  }

  async function startWorker() {
    setBusy(true);
    try {
      await callTeamflow("start_claude_worker");
      await refreshRuns();
    } catch (reason) {
      setError(`Claude Worker 启动失败：${reason}`);
    } finally {
      setBusy(false);
    }
  }

  async function pauseWorker() {
    await callTeamflow("pause_worker");
    await refreshRuns();
  }

  async function resumeWorker() {
    await callTeamflow("resume_worker");
    await refreshRuns();
  }

  async function openDiagnostics(sessionId) {
    if (!sessionId) return;
    try {
      setDiagnostics(await callTeamflow("open_diagnostics", { sessionId, runId: status.currentRunId }));
    } catch (reason) {
      setError(`诊断读取失败：${reason}`);
    }
  }

  async function runRealtimeBenchmark(sampleCount = 1000) {
    const total = Math.max(1, Number(sampleCount || 1000));
    setBenchmarkRunning(true);
    benchmarkTargetRef.current = total;
    latencySamplesRef.current = [];
    setLatencyMetrics(summarizeLatency([], total));
    try {
      const response = await callTeamflow("run_realtime_benchmark", {
        sampleCount: total,
        sample_count: total,
        runId: status.currentRunId,
        run_id: status.currentRunId,
      });
      setBenchmarkDispatch(response || null);
    } catch (reason) {
      setBenchmarkRunning(false);
      setError(`实时延迟压测失败：${reason}`);
    }
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-[#ebe7dc] text-[#141511]">
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-hidden p-2">
        <TopBar
          status={status}
          error={error}
          onRefresh={() => {
            refresh(status.currentRunId);
            refreshRuns();
          }}
          onCreateRun={createRun}
        />
        <section className="grid h-full min-h-0 grid-cols-[11rem_minmax(0,0.7fr)_minmax(0,1.8fr)_minmax(0,0.7fr)] gap-2 overflow-hidden">
          <SessionSidebar
            groups={runGroups}
            currentRunId={status.currentRunId}
            expandedGroups={expandedGroups}
            loading={sidebarLoading}
            error={sidebarError}
            busy={sidebarBusy}
            onToggleGroup={(groupKey) => {
              setExpandedGroups((prev) => {
                const next = new Set(prev);
                if (next.has(groupKey)) next.delete(groupKey);
                else next.add(groupKey);
                return next;
              });
            }}
            onSelectRun={switchRun}
            onDeleteRun={(run) => setDeleteTarget(run)}
          />
          <AgentPanel
            title="Codex 架构师"
            subtitle="规划 / 顺序派发 / 验收"
            accent="border-lime-500"
            icon={<Bot size={18} />}
            toolbar={
              <CodexModelSwitch
                selection={status.codexModelSelection}
                busy={busy}
                onChange={setCodexModelProvider}
              />
            }
            timeline={codexTimeline}
            footer={
              <CodexFooter
                busy={busy}
                input={input}
                setInput={setInput}
                onSend={sendCodex}
                onInterrupt={interruptCodex}
                codexState={status.codexState}
                codexBridgeState={status.codexBridgeState}
                codexRoundState={status.codexRoundState}
              />
            }
            onDiagnostics={openDiagnostics}
            onInterrupt={interruptCodex}
            collapsedThoughts={collapsedThoughts}
            setCollapsedThoughts={setCollapsedThoughts}
            expandedActions={expandedActions}
            setExpandedActions={setExpandedActions}
          />
          <Dashboard
            status={status}
            events={events}
            onStartWorker={startWorker}
            onPauseWorker={pauseWorker}
            onResumeWorker={resumeWorker}
          />
          <ClaudeReadonlyPanel
            status={status}
            messages={claudeMessages}
            timeline={claudeTimeline}
            onDiagnostics={openDiagnostics}
            collapsedThoughts={collapsedThoughts}
            setCollapsedThoughts={setCollapsedThoughts}
            expandedActions={expandedActions}
            setExpandedActions={setExpandedActions}
          />
        </section>
      </div>
      {diagnostics ? (
        <DiagnosticsDrawer
          diagnostics={diagnostics}
          onClose={() => setDiagnostics(null)}
          latencyMetrics={latencyMetrics}
          benchmarkDispatch={benchmarkDispatch}
          benchmarkRunning={benchmarkRunning}
          onRunBenchmark={() => runRealtimeBenchmark(1000)}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteConfirmDialog
          run={deleteTarget}
          busy={sidebarBusy}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDeleteRun}
        />
      ) : null}
    </main>
  );
}

function SessionSidebar({ groups, currentRunId, expandedGroups, loading, error, busy, onToggleGroup, onSelectRun, onDeleteRun }) {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col rounded-md border border-zinc-300 bg-[#fbfaf5] shadow-sm">
      <div className="shrink-0 border-b border-zinc-200 px-4 py-3">
        <h2 className="text-lg font-semibold">会话</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error ? <div className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">{error}</div> : null}
        {loading && !groups.length ? <Empty text="加载中..." /> : null}
        {!loading || groups.length ? (
          <div className="space-y-2">
            {groups.length ? (
              groups.map((group) => {
                const open = group.key === "current-run" || expandedGroups.has(group.key);
                return (
                  <section key={group.key} className="rounded border border-zinc-200 bg-white">
                    <button
                      onClick={() => onToggleGroup(group.key)}
                      className="flex w-full items-center justify-between border-b border-zinc-200 px-3 py-2 text-left"
                    >
                      <span className="inline-flex items-center gap-1 text-sm font-semibold">
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {group.title}
                      </span>
                      <span className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600">{group.runs.length}</span>
                    </button>
                    {open ? (
                      <div className="space-y-2 p-2">
                        {group.runs.map((run) => (
                          <RunListItem
                            key={run.runId}
                            run={run}
                            active={run.runId === currentRunId}
                            busy={busy}
                            onSelect={onSelectRun}
                            onDelete={onDeleteRun}
                          />
                        ))}
                      </div>
                    ) : null}
                  </section>
                );
              })
            ) : (
              <Empty text="暂无会话" />
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function RunListItem({ run, active, busy, onSelect, onDelete }) {
  const summary = run.summary || summarizeRunForSidebar(run);
  const time = run.time || formatDateTime(run.updatedAt || run.lastActivityAt || run.createdAt);
  return (
    <div className={`rounded border px-3 py-2 ${overflowGuardClass} ${active ? "border-lime-500 bg-lime-50" : "border-zinc-200 bg-zinc-50 hover:bg-zinc-100"}`}>
      <div className="flex items-start justify-between gap-2">
        <button onClick={() => onSelect(run.runId)} className="min-w-0 flex-1 text-left" disabled={busy}>
          <p className={`text-sm font-semibold ${overflowGuardClass}`}>{summary}</p>
          <p className="mt-1 text-xs text-zinc-500">{time}</p>
        </button>
        <button
          onClick={() => onDelete(run)}
          className="rounded border border-zinc-300 bg-white p-1.5 text-zinc-600 hover:text-red-700 disabled:opacity-50"
          title="删除会话"
          disabled={busy}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function DeleteConfirmDialog({ run, busy, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/30">
      <div className="w-[24rem] rounded-md border border-zinc-300 bg-[#fdfbf6] p-4 shadow-xl">
        <h3 className="text-lg font-semibold">删除会话？</h3>
        <p className={`mt-2 text-sm text-zinc-600 ${overflowGuardClass}`}>将删除《{run.title || run.runId}》。此操作不可恢复。</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm" disabled={busy}>
            取消
          </button>
          <button onClick={onConfirm} className="rounded bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy}>
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

function TopBar({ status, error, onRefresh, onCreateRun }) {
  const health = status.cliHealth ?? {};
  return (
    <header className="shrink-0 rounded-md border border-zinc-300 bg-[#f8f5ec] px-4 py-2 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className={`min-w-0 ${overflowGuardClass}`}>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-zinc-500">
            <ShieldCheck size={15} />
            Teamflow Desktop
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">本地多智能体工作流软件</h1>
          <p className={`mt-1 text-sm text-zinc-600 ${overflowGuardClass}`}>
            当前会话：<span className="font-mono text-zinc-900">{status.currentRunId || "-"}</span> · 当前目标：{status.projectGoal || "等待 Codex 派发任务"}
          </p>
          {error ? <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-sm text-amber-900">{error}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <HealthPill label="Codex" ok={health.codex} />
          <HealthPill label="Claude" ok={health.claude} />
          <HealthPill label="MiMo Key" ok={health.mimoKey} />
          <button onClick={onCreateRun} className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm">
            新会话
          </button>
          <button onClick={onRefresh} className="rounded bg-zinc-900 px-3 py-2 text-sm text-white" title="刷新">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}

function HealthPill({ label, ok }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-800"}`}>
      {ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
      {label}
    </span>
  );
}

function AgentPanel({
  title,
  subtitle,
  icon,
  accent,
  toolbar = null,
  timeline,
  footer,
  onDiagnostics,
  onInterrupt,
  collapsedThoughts,
  setCollapsedThoughts,
  expandedActions,
  setExpandedActions,
}) {
  const firstSessionId = timeline.find((item) => item.sessionId)?.sessionId;
  return (
    <section className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-zinc-300 border-t-4 ${accent} bg-[#fbfaf5] shadow-sm`}>
      <div className="shrink-0 border-b border-zinc-200 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {icon}
            <div>
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="text-xs text-zinc-500">{subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onInterrupt ? (
              <button onClick={onInterrupt} className="rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                中断
              </button>
            ) : null}
            <button
              onClick={() => onDiagnostics(firstSessionId)}
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs"
            >
              诊断
            </button>
          </div>
        </div>
      </div>
      {toolbar ? <div className="shrink-0 border-b border-zinc-200 px-4 py-2">{toolbar}</div> : null}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {timeline.map((item) => (
          <TimelineItem
            key={item.id}
            item={item}
            onDiagnostics={onDiagnostics}
            onInterrupt={onInterrupt}
            collapsedThoughts={collapsedThoughts}
            setCollapsedThoughts={setCollapsedThoughts}
            expandedActions={expandedActions}
            setExpandedActions={setExpandedActions}
          />
        ))}
      </div>
      <div className="shrink-0 border-t border-zinc-200 p-3">{footer}</div>
    </section>
  );
}

function CodexModelSwitch({ selection, busy, onChange }) {
  const providers = Array.isArray(selection?.providers) && selection.providers.length
    ? selection.providers
    : [
        {
          id: "codex-gpt-5.5",
          label: "默认 GPT-5.5",
          model: "gpt-5.5",
          baseUrl: "https://ai.unclecode.cn",
          wireApi: "responses",
          apiKeyPresent: true,
        },
        {
          id: "mimo-v2.5-pro",
          label: "MiMo V2.5 Pro",
          model: "mimo-v2.5-pro",
          baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
          wireApi: "chat",
          apiKeyPresent: false,
        },
      ];
  const activeProviderId = selection?.activeProviderId || selection?.activeProvider?.id || "codex-gpt-5.5";
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-600">模型</span>
        <div className="flex min-w-0 rounded border border-zinc-300 bg-white p-0.5">
          {providers.map((provider) => {
            const active = provider.id === activeProviderId;
  const disabled = provider.id === "mimo-v2.5-pro" && provider.apiKeyPresent === false;
            return (
              <button
                key={provider.id}
                onClick={() => onChange(provider.id)}
                disabled={disabled || active}
                className={`rounded px-2 py-1 text-[11px] font-semibold ${overflowGuardClass} ${
                  active
                    ? "bg-zinc-900 text-white"
                    : disabled
                      ? "text-zinc-400"
                      : "text-zinc-700 hover:bg-zinc-100"
                }`}
                title={provider.id === "mimo-v2.5-pro" && provider.apiKeyPresent === false ? "未检测到 MIMO_API_KEY" : provider.model}
              >
                {provider.label || provider.model}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CodexFooter({ busy, input, setInput, onSend, onInterrupt, codexState, codexBridgeState, codexRoundState }) {
  const bridgeLabel = codexBridgeStateLabel(codexBridgeState, codexRoundState, codexState);
  const bridgeTone = codexBridgeStateTone(codexBridgeState, codexRoundState, codexState);
  const bridgeState = String(codexBridgeState?.state || "").toUpperCase();
  const roundState = String(codexRoundState?.state || "").toUpperCase();
  const standbyText =
    bridgeLabel === "待命中" && (roundState === "COMPLETED" || roundState === "DONE" || !codexRoundState?.active)
      ? "当前轮次已结束，桥接保持待命，可继续输入下一条消息。"
      : bridgeLabel === "已休眠"
        ? "已闲置超过 30 分钟，Codex 已休眠释放资源。"
        : bridgeState === "RUNNING" || roundState === "RUNNING"
          ? "Codex 正在执行当前轮次。"
          : "";
  return (
    <div className="space-y-2">
      <div className={`inline-flex rounded border px-2 py-1 text-xs font-semibold ${bridgeTone}`}>{bridgeLabel}</div>
      {standbyText ? <div className="text-xs text-zinc-500">{standbyText}</div> : null}
      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) onSend();
          }}
          className="min-h-[4.5rem] flex-1 resize-none rounded border border-zinc-300 bg-white px-3 py-2 text-sm leading-5 outline-none focus:border-lime-600"
          placeholder="输入项目目标，Ctrl+Enter 发送给 Codex"
        />
        <div className="flex w-11 flex-col gap-2">
          <button onClick={onSend} disabled={busy} className="inline-flex h-[2.15rem] items-center justify-center rounded bg-lime-700 text-white disabled:opacity-50" title="发送">
            <Send size={16} />
          </button>
          <button onClick={onInterrupt} disabled={busy} className="inline-flex h-[2.15rem] items-center justify-center rounded border border-amber-400 bg-amber-50 text-amber-800 disabled:opacity-50" title="中断 Codex">
            <Pause size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ClaudeReadonlyPanel({
  status,
  messages,
  timeline = [],
  onDiagnostics,
  collapsedThoughts = new Set(),
  setCollapsedThoughts = () => {},
  expandedActions = new Set(),
  setExpandedActions = () => {},
}) {
  const worker = status.claudeWorkerState || {};
  const currentTask = status.currentTask && (!status.currentTask.runId || status.currentTask.runId === status.currentRunId)
    ? status.currentTask
    : (Array.isArray(status.tasks) ? status.tasks.find((task) => task.runId === status.currentRunId && task.status === "IN_PROGRESS") : null);
  const currentFile =
    currentTask?.scope
    || currentTask?.goal
    || status?.dedupedEvents?.slice().reverse().find((event) => event?.payload?.file || event?.payload?.path)?.payload?.file
    || status?.dedupedEvents?.slice().reverse().find((event) => event?.payload?.file || event?.payload?.path)?.payload?.path
    || "-";
  const taskProgress = currentTask ? progressForTask(currentTask) : 0;
  const latestReview = latestByKinds(messages, "claude", ["review_mimo", "review", "review_local"])
    || (status?.dedupedEvents || []).slice().reverse().find((event) => ["review_mimo", "mimo_review_recorded"].includes(String(event.type || "")));
  const reviewText = sanitizeVisibleText(latestReview?.text || latestReview?.message || "等待 MiMo 审核反馈");
  const claudeSessionId = status.activeClaudeSessionId || messages.find((message) => message.sessionId)?.sessionId;
  const timelineItems = Array.isArray(timeline) ? timeline : [];
  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-zinc-300 border-t-4 border-sky-500 bg-[#fbfaf5] shadow-sm">
      <div className="shrink-0 border-b border-zinc-200 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <TerminalSquare size={18} />
            <div>
              <h2 className="text-lg font-semibold">Claude 执行者</h2>
              <p className="text-xs text-zinc-500">只读执行视图</p>
            </div>
          </div>
          <button
            onClick={() => onDiagnostics(claudeSessionId)}
            className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs"
          >
            诊断
          </button>
        </div>
      </div>
      <div className="shrink-0 border-b border-zinc-200 px-4 py-3">
        <div className="grid grid-cols-1 gap-2">
          <ReadOnlyCard label="当前文件" value={sanitizeVisibleText(currentFile)} />
          <ReadOnlyCard
            label="任务进度"
            value={currentTask ? `${taskProgress}% · ${statusLabel(currentTask.status)} · ${taskLabel(currentTask.id)}` : "暂无进行中任务"}
            time={currentTask?.updatedAt}
          />
          <ReadOnlyCard label="Worker 状态" value={`${runStatusLabel(worker.state || "IDLE")} · ${worker.globalRunning ?? 0}/${worker.globalCap ?? 0}`} />
          <ReadOnlyCard label="MiMo 摘要" value={reviewText} time={latestReview?.lastSeenAt || latestReview?.createdAt || latestReview?.at} />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {timelineItems.length ? timelineItems.map((item) => (
          <TimelineItem
            key={`${item.id}-${item.timelineType || item.kind || "item"}`}
            item={item}
            onDiagnostics={onDiagnostics}
            collapsedThoughts={collapsedThoughts}
            setCollapsedThoughts={setCollapsedThoughts}
            expandedActions={expandedActions}
            setExpandedActions={setExpandedActions}
          />
        )) : <Empty text="等待 Claude 实时活动" />}
      </div>
      <div className="shrink-0 border-t border-zinc-200 p-3">
        <div className="rounded border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600">此面板仅展示执行状态，输入入口保留在 Codex 面板。</div>
      </div>
    </section>
  );
}

function ReadOnlyCard({ label, value, time }) {
  return (
    <article className={`rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 ${overflowGuardClass}`}>
      <div className={`mb-1 flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.16em] text-zinc-500 ${overflowGuardClass}`}>
        <span>{label}</span>
        <span className="font-mono">{time ? formatDateTime(time) : ""}</span>
      </div>
      <p className={`text-zinc-900 ${overflowGuardClass}`}>{value}</p>
    </article>
  );
}

function MessageBubble({ message }) {
  const system = message.role === "system";
  return (
    <article className={`rounded-md border px-3 py-2 text-sm leading-6 ${overflowGuardClass} ${system ? "border-zinc-200 bg-zinc-50 text-zinc-600" : "border-zinc-300 bg-white text-zinc-900"}`}>
      <div className={`mb-1 flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.16em] text-zinc-500 ${overflowGuardClass}`}>
        <span>{message.kind || "message"}</span>
        <span className="font-mono">{message.createdAt ? new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour12: false }) : ""}</span>
      </div>
      <p className={overflowGuardClass}>{sanitizeVisibleText(message.text)}</p>
    </article>
  );
}

function TimelineItem({
  item,
  onDiagnostics,
  onInterrupt,
  collapsedThoughts,
  setCollapsedThoughts,
  expandedActions,
  setExpandedActions,
}) {
  if (item.timelineType === "tool_card") {
    return (
      <article className={`rounded-md border border-lime-300 bg-lime-50 px-3 py-3 text-sm ${overflowGuardClass}`}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="font-semibold text-lime-900">{item.card.title}</p>
          <span className="font-mono text-xs text-lime-700">{taskLabel(item.card.taskId)}</span>
        </div>
        <p className={`text-zinc-800 ${overflowGuardClass}`}>目标：{item.card.goal}</p>
        {item.card.warning ? <p className={`mt-1 text-xs text-rose-700 ${overflowGuardClass}`}>{sanitizeVisibleText(item.card.warning)}</p> : null}
        <p className={`mt-1 text-xs text-zinc-600 ${overflowGuardClass}`}>验收标准：{item.card.acceptance.length ? item.card.acceptance.join("；") : "—"}</p>
        <div className="mt-2 flex gap-2">
          {onInterrupt ? (
            <button onClick={onInterrupt} className="rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-800">
              强行中断 / 接管
            </button>
          ) : null}
          <button onClick={() => onDiagnostics(item.sessionId)} className={`rounded border border-zinc-300 bg-white px-2 py-1 text-xs ${overflowGuardClass}`}>
            打开诊断
          </button>
        </div>
      </article>
    );
  }
  if (item.type === "thought") {
    const thoughtKey = String(item.id);
    const collapsed = !collapsedThoughts.has(thoughtKey);
    const latest = item.items[item.items.length - 1];
    const thoughtLabel = String(item.agent || "").toLowerCase() === "claude"
      ? "Claude 正在整理执行步骤..."
      : "Codex 正在评估任务拆解方案...";
    return (
      <article className={`rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500 ${overflowGuardClass}`}>
        <button
          onClick={() => {
            setCollapsedThoughts((prev) => {
              const next = new Set(prev);
              if (next.has(thoughtKey)) next.delete(thoughtKey);
              else next.add(thoughtKey);
              return next;
            });
          }}
          className="w-full text-left"
        >
          {thoughtLabel} {collapsed ? "展开" : "收起"}
        </button>
        {!collapsed ? <p className={`mt-1 ${overflowGuardClass}`}>{sanitizeVisibleText(latest?.text || "")}</p> : null}
      </article>
    );
  }
  if (item.timelineType === "action") {
    const actionKey = String(item.id);
    const expanded = expandedActions.has(actionKey);
    const tone = actionTone[item.actionState] || actionTone.done;
    const icon = item.actionState === "failed" ? "⚠️" : item.actionState === "running" ? "🔄" : "✅";
    const duration = item.durationMs > 0 ? `(耗时 ${(item.durationMs / 1000).toFixed(1)}s)` : "";
    return (
      <article className={`rounded-md border px-3 py-2 text-sm ${tone} ${overflowGuardClass}`}>
        <button
          onClick={() => {
            setExpandedActions((prev) => {
              const next = new Set(prev);
              if (next.has(actionKey)) next.delete(actionKey);
              else next.add(actionKey);
              return next;
            });
          }}
          className="w-full text-left"
        >
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold">{icon} {item.actionLabel}</span>
            <span className="font-mono">{formatDateTime(item.lastSeenAt || item.createdAt)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-xs">
            <span className={`${overflowGuardClass} text-zinc-600`}>工具：{item.actionTool}{duration}</span>
            <span className="text-zinc-500">{expanded ? "收起" : "展开"}</span>
          </div>
        </button>
        {expanded ? (
          <div className={`mt-2 rounded border border-zinc-300 bg-[#1f1f1f] px-2 py-2 text-xs text-zinc-200 ${overflowGuardClass}`}>
            <p className={overflowGuardClass}>{sanitizeVisibleText(item.text || item.actionLabel)}</p>
            <div className="mt-2 flex justify-end">
              <button onClick={() => onDiagnostics(item.sessionId)} className="rounded border border-zinc-500 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-100">
                打开诊断
              </button>
            </div>
          </div>
        ) : null}
      </article>
    );
  }
  return <MessageBubble message={item} />;
}

function Dashboard({
  status,
  events,
  onStartWorker,
  onPauseWorker,
  onResumeWorker,
}) {
  const counts = status.counts ?? {};
  const tasks = Array.isArray(status.tasks) ? status.tasks.filter((task) => !status.currentRunId || task.runId === status.currentRunId) : [];
  const workflowMetrics = workflowMetricsFor(status, tasks);
  const dashboardPipeline = dashboardPipelineFor(status, tasks);
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-hidden">
      <div className="grid min-w-0 shrink-0 grid-cols-4 gap-2">
        <Metric icon={<Activity size={17} />} label="总体进度" value={`${workflowMetrics.progressPercent}%`} />
        <Metric icon={<ClipboardList size={17} />} label="任务总数" value={workflowMetrics.totalTasks} />
        <Metric icon={<CheckCircle2 size={17} />} label="完成" value={workflowMetrics.completedTasks} />
        <Metric icon={<AlertTriangle size={17} />} label="异常" value={workflowMetrics.exceptionTasks} />
      </div>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-zinc-300 bg-[#fbfaf5] shadow-sm">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-4 py-2">
          <div>
            <h2 className="text-lg font-semibold">任务中控</h2>
            <p className="text-xs text-zinc-500">SQLite 真值 / 顺序派发 / MiMo 审查</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={onStartWorker} className="inline-flex items-center gap-1 rounded bg-sky-700 px-3 py-2 text-xs font-semibold text-white">
              <Play size={14} />
              Worker
            </button>
            <button onClick={onPauseWorker} className="rounded border border-zinc-300 bg-white px-2 py-2" title="暂停">
              <Pause size={14} />
            </button>
            <button onClick={onResumeWorker} className="rounded border border-zinc-300 bg-white px-2 py-2" title="恢复">
              <Play size={14} />
            </button>
          </div>
        </div>
        <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-0">
          <DeliveryOverview status={status} tasks={tasks} metrics={workflowMetrics} />
          <ThreeStageBoard tasks={tasks} events={events} pipeline={dashboardPipeline} />
        </div>
      </section>
    </section>
  );
}

function Metric({ icon, label, value }) {
  return (
    <div className="min-w-0 rounded-md border border-zinc-300 bg-[#fbfaf5] px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-mono text-xl font-semibold">{value}</div>
    </div>
  );
}

function DeliveryOverview({ status, tasks, metrics }) {
  const delivered = Number(metrics?.completedTasks ?? 0);
  const total = Number(metrics?.totalTasks ?? tasks.length ?? 0) || 0;
  const progress = Number(metrics?.progressPercent ?? status.progressPercent ?? 0);
  const latestCodex = latestByKind(status.dedupedAgentMessages ?? status.agentMessages ?? [], "codex", "status");
  return (
    <section className="border-b border-zinc-200 bg-white px-4 py-2">
      <div className="grid min-w-0 grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-2">
        <article className={`rounded border border-zinc-200 bg-[#fbfaf5] p-2 ${overflowGuardClass}`}>
          <p className="text-xs text-zinc-500">当前目标</p>
          <p className={`mt-1 text-sm font-semibold ${overflowGuardClass}`}>{metrics?.currentGoal || status.projectGoal || "等待 Codex 派发任务"}</p>
          <p className={`mt-1 text-xs text-zinc-500 ${overflowGuardClass}`}>
            架构师摘要：{sanitizeVisibleText(latestCodex?.text || "按任务顺序派发，优先处理阻塞项。")}
          </p>
        </article>
        <article className={`rounded border border-zinc-200 bg-[#fbfaf5] p-2 ${overflowGuardClass}`}>
          <p className="text-xs text-zinc-500">交付进度</p>
          <p className="mt-1 font-mono text-xl font-semibold">{progress}%</p>
          <p className={`mt-1 text-xs text-zinc-500 ${overflowGuardClass}`}>已交付 {delivered} / {total}</p>
          <div className="mt-2 h-2 rounded-full border border-zinc-300 bg-white">
            <div className="h-full rounded-full bg-lime-600" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
          </div>
        </article>
      </div>
    </section>
  );
}

function normalizeTaskStage(status) {
  if (status === "PENDING") return "待处理";
  if (status === "IN_PROGRESS") return "开发中";
  if (status === "LOCAL_FAILED") return "开发中";
  if (status === "REVIEW_PENDING") return "逻辑评审中";
  if (status === "MIMO_REJECTED") return "打回重做";
  if (status === "COMPLETED") return "已交付";
  if (status === "DEGRADED_PASS") return "风险通过";
  if (status === "BLOCKED") return "已阻塞";
  if (status === "CANCELLED") return "已取消";
  return statusLabel(status);
}

function sortTasksForPipeline(tasks) {
  const rank = {
    IN_PROGRESS: 1,
    MIMO_REJECTED: 2,
    BLOCKED: 3,
    LOCAL_FAILED: 4,
    REVIEW_PENDING: 5,
    PENDING: 6,
    COMPLETED: 7,
    DEGRADED_PASS: 7,
    CANCELLED: 8,
  };
  return [...tasks].sort((a, b) => {
    const rankGap = (rank[a.status] || 99) - (rank[b.status] || 99);
    if (rankGap !== 0) return rankGap;
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
}

function TaskPipeline({ tasks, events }) {
  const [showDelivered, setShowDelivered] = useState(false);
  const ordered = sortTasksForPipeline(tasks);
  const delivered = ordered.filter((task) => task.status === "COMPLETED");
  const pending = ordered.filter((task) => task.status !== "COMPLETED");
  const queue = [...pending, ...(showDelivered ? delivered : [])];
  return (
    <section className="flex min-h-0 flex-col overflow-hidden border-b border-zinc-200">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-900 px-4 py-2 text-xs font-semibold text-white">
        <span>任务流水线</span>
        {delivered.length ? (
          <button onClick={() => setShowDelivered((prev) => !prev)} className="rounded border border-zinc-500 bg-zinc-800 px-2 py-0.5 text-[11px]">
            {showDelivered ? "收起已交付" : `展开已交付 (${delivered.length})`}
          </button>
        ) : null}
      </div>
      <div className="min-h-0 max-h-full space-y-3 overflow-y-auto px-4 py-3">
        {queue.length ? queue.map((task) => <TaskPipelineCard key={`${task.runId}-${task.id}`} task={task} events={events} />) : <Empty text="当前会话暂无任务。" />}
      </div>
    </section>
  );
}

function TaskPipelineCard({ task, events }) {
  const progress = progressForTask(task);
  const stage = normalizeTaskStage(task.status);
  const taskEvents = Array.isArray(events) ? events.filter((event) => String(event.taskId || "") === String(task.id || "")).slice(-2) : [];
  const active = task.status === "IN_PROGRESS";
  const danger = ["BLOCKED", "MIMO_REJECTED", "LOCAL_FAILED", "DEGRADED_PASS"].includes(task.status);
  return (
    <article className={`rounded-md border bg-white px-3 py-3 ${overflowGuardClass} ${active ? "ring-2 ring-lime-500/35" : ""} ${danger ? "border-rose-300" : "border-zinc-200"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className={`text-xs font-mono text-zinc-500 ${overflowGuardClass}`}>{taskLabel(task.id)}</div>
        <span className={`inline-flex rounded border px-2 py-1 text-xs font-semibold ${active ? "border-lime-400 bg-lime-50 text-lime-800" : statusTone[task.status] ?? "border-zinc-300 bg-zinc-50 text-zinc-700"} ${danger ? "border-rose-400 bg-rose-50 text-rose-800" : ""}`}>
          {stage}
        </span>
      </div>
      <p className={`mt-2 text-sm font-semibold ${overflowGuardClass}`}>{task.title || "-"}</p>
      <p className={`mt-1 text-sm text-zinc-600 ${overflowGuardClass}`}>{task.goal || task.scope || "-"}</p>
      <p className={`mt-1 text-xs text-zinc-500 ${overflowGuardClass}`}>
        执行者：{task.assignedAgent || "-"} · 尝试 {task.attempts ?? 0}/{task.maxAttempts ?? 3}
      </p>
      <div className="mt-2 h-2 rounded-full border border-zinc-300 bg-white">
        <div className={`h-full rounded-full ${danger ? "bg-rose-500" : "bg-lime-600"}`} style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-2 space-y-1">
        {taskEvents.length ? taskEvents.map((event) => (
          <p key={event.id} className={`text-xs ${danger ? "text-rose-700" : "text-zinc-500"} ${overflowGuardClass}`}>
            {eventLabel(event.type)}：{sanitizeVisibleText(event.message || "-")}
          </p>
        )) : (
          <p className={`text-xs text-zinc-500 ${overflowGuardClass}`}>暂无最新动作</p>
        )}
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">更新时间：{formatDateTime(task.updatedAt) || "-"}</p>
    </article>
  );
}

function stageKeyForTask(task) {
  const status = String(task?.status || "");
  if (status === "PENDING") return "pending";
  if (["IN_PROGRESS", "LOCAL_FAILED", "BLOCKED", "MIMO_REJECTED"].includes(status)) return "develop";
  return "review";
}

function ThreeStageBoard({ tasks, events, pipeline }) {
  const ordered = sortTasksForPipeline(tasks);
  const byPlanOrder = (bucket) => bucket.slice().sort((a, b) =>
    String(a.id || "").localeCompare(String(b.id || ""), "zh-CN", { numeric: true }),
  );
  const prioritized = (bucket) =>
    bucket.slice().sort((a, b) => {
      const aRank = a.status === "IN_PROGRESS" ? 0 : a.status === "MIMO_REJECTED" ? 1 : 2;
      const bRank = b.status === "IN_PROGRESS" ? 0 : b.status === "MIMO_REJECTED" ? 1 : 2;
      if (aRank !== bRank) return aRank - bRank;
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });
  const fallbackBuckets = {
    pending: ordered,
    develop: ordered.filter((task) => stageKeyForTask(task) === "develop"),
    review: ordered.filter((task) => stageKeyForTask(task) === "review"),
  };
  const bucketFor = (key) => {
    const value = pipeline?.[key];
    return Array.isArray(value) ? value : fallbackBuckets[key] || [];
  };
  const columns = [
    { key: "pending", title: "待处理", subtitle: "任务清单" },
    { key: "develop", title: "开发中 (Claude)", subtitle: "执行与修复中" },
    { key: "review", title: "MiMo 审核", subtitle: "待审 / 已审结果" },
  ];
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-b border-zinc-200">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-900 px-4 py-2 text-xs font-semibold text-white">
        <span>三阶段看板</span>
        <span className="text-[11px] text-zinc-300">总计 {ordered.length} 项</span>
      </div>
      <div className="grid h-full min-h-0 min-w-0 flex-1 grid-cols-3 gap-3 overflow-hidden px-4 py-3">
        {columns.map((column) => {
          const bucket = column.key === "pending" ? byPlanOrder(bucketFor(column.key)) : prioritized(bucketFor(column.key));
          return (
            <article key={column.key} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-zinc-200 bg-white">
              <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2">
                <div>
                  <p className="text-sm font-semibold">{column.title}</p>
                  <p className="text-[11px] text-zinc-500">{column.subtitle}</p>
                </div>
                <span className="rounded border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-xs font-mono text-zinc-700">{bucket.length}</span>
              </div>
              <div className={stageScrollClass}>
                {bucket.length ? bucket.map((task) => <TaskPipelineCard key={`${task.runId}-${task.id}`} task={task} events={events} />) : <Empty text="暂无任务" />}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function DiagnosticsDrawer({
  diagnostics,
  onClose,
  latencyMetrics,
  benchmarkDispatch,
  benchmarkRunning,
  onRunBenchmark,
}) {
  return (
    <aside className="fixed inset-y-0 right-0 z-20 flex w-[42rem] flex-col border-l border-zinc-300 bg-[#11120f] text-[#f7f3e8] shadow-2xl">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold">诊断</h2>
          <p className="font-mono text-xs text-white/60">{diagnostics.sessionId}</p>
        </div>
        <button onClick={onClose} className="rounded bg-white/10 px-3 py-2 text-sm">关闭</button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <Section label="实时延迟">
          <div className="rounded border border-white/10 bg-white/5 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-white/80">1000 条事件压测</p>
              <button
                onClick={onRunBenchmark}
                disabled={benchmarkRunning}
                className="rounded border border-zinc-500 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {benchmarkRunning ? "测试中..." : "开始压测"}
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-white/80">
              <p>样本: {Number(latencyMetrics?.sampleCount || 0)}</p>
              <p>P50: {Number(latencyMetrics?.p50Ms || 0).toFixed(1)} ms</p>
              <p>P95: {Number(latencyMetrics?.p95Ms || 0).toFixed(1)} ms</p>
              <p>Max: {Number(latencyMetrics?.maxMs || 0).toFixed(1)} ms</p>
            </div>
            <p className="mt-2 text-xs text-white/60">最近更新时间: {formatDateTime(latencyMetrics?.lastUpdatedAt) || "-"}</p>
            {benchmarkDispatch ? (
              <p className="mt-1 text-xs text-white/60">
                Seq: {benchmarkDispatch.firstSeq ?? "-"} ~ {benchmarkDispatch.lastSeq ?? "-"} / sent {benchmarkDispatch.sampleCount ?? "-"}
              </p>
            ) : null}
          </div>
        </Section>
        <Section label="会话信息">
          <div className="rounded border border-white/10 bg-white/5 p-3 text-sm">
            <p className={overflowGuardClass}>Agent: {diagnostics.sessionInfo?.agent || "-"} / Status: {diagnostics.sessionInfo?.status || "-"}</p>
            <p className={`mt-1 ${overflowGuardClass}`}>Started: {diagnostics.sessionInfo?.startedAt || "-"} / Ended: {diagnostics.sessionInfo?.endedAt || "-"}</p>
            <p className={`mt-1 ${overflowGuardClass}`}>Error: {sanitizeVisibleText(diagnostics.sessionInfo?.lastError || "-")}</p>
          </div>
        </Section>
        <Section label="关键动作">
          {(diagnostics.keyActions ?? []).map((row, index) => (
            <p key={row.id ?? index} className={`rounded border border-white/10 bg-white/5 p-3 text-sm ${overflowGuardClass}`}>{sanitizeVisibleText(row.message)}</p>
          ))}
        </Section>
        <Section label="MCP 调用">
          {(diagnostics.mcpCalls ?? []).map((row, index) => (
            <p key={row.id ?? index} className={`rounded border border-white/10 bg-white/5 p-3 text-sm ${overflowGuardClass}`}>{sanitizeVisibleText(row.message)}</p>
          ))}
        </Section>
        <Section label="本地验证">
          {(diagnostics.localVerification ?? []).map((row, index) => (
            <p key={row.id ?? index} className={`rounded border border-white/10 bg-white/5 p-3 text-sm ${overflowGuardClass}`}>{sanitizeVisibleText(row.message)}</p>
          ))}
        </Section>
        <Section label="MiMo 审查">
          {(diagnostics.mimoReviews ?? []).map((row, index) => (
            <p key={row.id ?? index} className={`rounded border border-white/10 bg-white/5 p-3 text-sm ${overflowGuardClass}`}>{sanitizeVisibleText(row.message)}</p>
          ))}
        </Section>
        <Section label="标准错误">
          {(diagnostics.stderr ?? []).map((row, index) => (
            <pre key={row.id ?? index} className={`rounded border border-white/10 bg-black/30 p-3 text-xs leading-5 ${overflowGuardClass}`}>{sanitizeVisibleText(row.chunk)}</pre>
          ))}
        </Section>
        <Section label="原始 CLI 输出">
          {(diagnostics.rawTranscripts ?? []).map((row) => (
            <pre key={row.id} className={`rounded border border-white/10 bg-black/30 p-3 text-xs leading-5 ${overflowGuardClass}`}>{`[${row.stream}] ${row.chunk}`}</pre>
          ))}
        </Section>
        <Section label="进程事件">
          {(diagnostics.processEvents ?? []).map((row) => (
            <p key={row.id} className={`rounded border border-white/10 bg-white/5 p-3 text-sm ${overflowGuardClass}`}>{sanitizeVisibleText(row.message)}</p>
          ))}
        </Section>
      </div>
    </aside>
  );
}

function Section({ label, children }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white/80">
        <FileText size={15} />
        {label}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Empty({ text }) {
  return <div className={`p-5 text-sm text-zinc-500 ${overflowGuardClass}`}>{text}</div>;
}

export default App;
