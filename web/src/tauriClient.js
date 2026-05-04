import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  mockDeleteResult,
  mockDiagnostics,
  mockRunGroups,
  mockRunStatus,
  mockStatus,
} from "./mockStatus.js";

const isTauri =
  typeof window !== "undefined" && Object.prototype.hasOwnProperty.call(window, "__TAURI_INTERNALS__");

function cloneData(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

let runtimeMockStatus = cloneData(mockStatus);
let runtimeMockRunGroups = cloneData(mockRunGroups);
let runtimeMockRunStatus = cloneData(mockRunStatus);
let runtimeMockDeleteResult = cloneData(mockDeleteResult);
let mockRealtimeSeq = 0;
let runtimeMockRealtimeBacklog = [];
const mockRealtimeListeners = new Set();
const taskStatuses = [
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

function pushMockRealtime(envelope) {
  runtimeMockRealtimeBacklog.push(envelope);
  if (runtimeMockRealtimeBacklog.length > 4096) {
    runtimeMockRealtimeBacklog = runtimeMockRealtimeBacklog.slice(-4096);
  }
  for (const listener of mockRealtimeListeners) {
    listener(envelope);
  }
}

function flattenRuns(groups) {
  return groups.flatMap((group) => group.runs ?? []);
}

function findRun(runId) {
  return flattenRuns(runtimeMockRunGroups).find((item) => item.runId === runId);
}

function updateMockTask(taskId, runId, patch) {
  const targetRunId = runId || runtimeMockStatus.currentRunId;
  const tasks = Array.isArray(runtimeMockStatus.tasks) ? [...runtimeMockStatus.tasks] : [];
  const index = tasks.findIndex(
    (task) =>
      String(task.id) === String(taskId)
      && String(task.runId || targetRunId) === String(targetRunId),
  );
  if (index >= 0) {
    tasks[index] = {
      ...tasks[index],
      ...patch,
      id: tasks[index].id,
      runId: tasks[index].runId || targetRunId,
    };
  } else {
    tasks.push({
      id: taskId,
      runId: targetRunId,
      title: "浜哄伐鎿嶄綔浠诲姟",
      goal: "",
      assignedAgent: "claude",
      attempts: 0,
      maxAttempts: 3,
      ...patch,
    });
  }
  runtimeMockStatus = { ...runtimeMockStatus, tasks };
  runtimeMockRunStatus = { ...runtimeMockRunStatus, tasks };
  if (runtimeMockStatus.currentTask && String(runtimeMockStatus.currentTask.id) === String(taskId)) {
    runtimeMockStatus = {
      ...runtimeMockStatus,
      currentTask: { ...runtimeMockStatus.currentTask, ...patch },
    };
  }
}

function updateMockCodexBridge(patch = {}) {
  const { roundState: roundPatch, ...bridgePatch } = patch;
  const bridgeState = { ...(runtimeMockStatus.codexBridgeState || {}), ...bridgePatch };
  const roundState = { ...(runtimeMockStatus.codexRoundState || {}), ...(roundPatch || {}) };
  runtimeMockStatus = {
    ...runtimeMockStatus,
    codexBridgeState: bridgeState,
    codexRoundState: roundState,
    codexState: patch.codexState ?? runtimeMockStatus.codexState,
    activeCodexSessionId: bridgePatch.sessionId || runtimeMockStatus.activeCodexSessionId,
  };
}

function deriveMockStatusForRun(runId) {
  const targetRunId = runId || runtimeMockStatus.currentRunId;
  const tasks = (runtimeMockStatus.tasks || []).filter((task) => !targetRunId || task.runId === targetRunId);
  const counts = Object.fromEntries(taskStatuses.map((status) => [status, 0]));
  for (const task of tasks) {
    counts[task.status] = (counts[task.status] || 0) + 1;
  }
  counts.total = tasks.length;
  const completedTasks = counts.COMPLETED || 0;
  const exceptionTasks =
    (counts.LOCAL_FAILED || 0)
    + (counts.MIMO_REJECTED || 0)
    + (counts.DEGRADED_PASS || 0)
    + (counts.BLOCKED || 0);
  const priority = ["IN_PROGRESS", "REVIEW_PENDING", "MIMO_REJECTED", "LOCAL_FAILED", "BLOCKED", "DEGRADED_PASS", "PENDING"];
  const currentTask = priority
    .map((status) => tasks.find((task) => task.status === status))
    .find(Boolean) || null;
  const progressPercent = tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0;
  const messages = (runtimeMockStatus.dedupedAgentMessages || []).filter(
    (message) => !targetRunId || !message.runId || message.runId === targetRunId,
  );
  const events = (runtimeMockStatus.dedupedEvents || []).filter(
    (event) => !targetRunId || !event.runId || event.runId === targetRunId,
  );
  const reviews = (runtimeMockStatus.reviews || []).filter((review) =>
    !review.taskId || tasks.some((task) => task.id === review.taskId),
  );
  return {
    ...runtimeMockStatus,
    currentRunId: targetRunId,
    projectGoal: tasks.length ? runtimeMockStatus.projectGoal : "",
    counts,
    progressPercent,
    currentTask,
    tasks,
    dedupedAgentMessages: messages,
    agentMessages: [],
    dedupedEvents: events,
    events: [],
    rawEvents: [],
    reviews,
    workflowMetrics: {
      totalTasks: tasks.length,
      completedTasks,
      exceptionTasks,
      progressPercent,
      deliveryProgress: completedTasks,
      currentGoal: currentTask?.goal || currentTask?.title || (tasks.length ? runtimeMockStatus.projectGoal : ""),
      currentTaskId: currentTask?.id || "",
      currentTaskTitle: currentTask?.title || "",
    },
    dashboardPipeline: {
      pending: tasks,
      developing: tasks.filter((task) => ["IN_PROGRESS", "LOCAL_FAILED", "MIMO_REJECTED", "BLOCKED"].includes(task.status)),
      review: tasks.filter((task) => ["REVIEW_PENDING", "COMPLETED", "DEGRADED_PASS", "CANCELLED"].includes(task.status)),
    },
    claudeTimelineSource: messages.filter((message) => message.agent === "claude"),
  };
}

function mockSetCodexModelProvider(providerId) {
  const providers = runtimeMockStatus.codexModelSelection?.providers || mockStatus.codexModelSelection?.providers || [];
  const normalized = providerId === "mimo" ? "mimo-v2.5-pro" : (providerId || "codex-gpt-5.5");
  const activeProvider = providers.find((provider) => provider.id === normalized) || providers[0];
  const selection = {
    activeProviderId: activeProvider?.id || "codex-gpt-5.5",
    activeProvider,
    providers,
  };
  runtimeMockStatus = {
    ...runtimeMockStatus,
    codexModelSelection: selection,
  };
  return selection;
}

export async function callTeamflow(command, payload = {}) {
  if (!isTauri) return mockCall(command, payload);
  return invoke(command, payload);
}

export async function subscribeTeamflow(event, handler) {
  if (!isTauri) {
    if (event === "teamflow_realtime") {
      let disposed = false;
      mockRealtimeListeners.add(handler);
      const timer = window.setInterval(() => {
        if (disposed) return;
        const runId = runtimeMockStatus.currentRunId;
        const rows = (runtimeMockStatus.dedupedAgentMessages || [])
          .filter((row) => !runId || !row.runId || row.runId === runId)
          .slice(-2);
        for (const row of rows) {
          mockRealtimeSeq += 1;
          pushMockRealtime({
            seq: mockRealtimeSeq,
            emittedAt: row.lastSeenAt || row.createdAt || new Date().toISOString(),
            runId: row.runId || runId,
            sessionId: row.sessionId || "",
            agent: row.agent || "",
            topic: "agent_message",
            eventType: row.kind || "status",
            sourceItemId: row.sourceItemId || "",
            payload: row,
          });
        }
      }, 1200);
      return () => {
        disposed = true;
        window.clearInterval(timer);
        mockRealtimeListeners.delete(handler);
      };
    }
    return () => {};
  }
  return listen(event, ({ payload: eventPayload }) => handler(eventPayload));
}

async function mockCall(command, payload) {
  if (command === "get_realtime_config") {
    return {
      eventName: "teamflow_realtime",
      wsUrl: "ws://127.0.0.1:48765/teamflow/realtime",
      initialSeq: mockRealtimeSeq,
      mode: "ipc+ws",
    };
  }

  if (command === "get_realtime_events") {
    const runId = payload?.runId || payload?.run_id || runtimeMockStatus.currentRunId;
    const fromSeq = Number(payload?.fromSeq ?? payload?.from_seq ?? 0);
    const events = runtimeMockRealtimeBacklog.filter((event) => {
      const seq = Number(event?.seq || 0);
      if (seq <= fromSeq) return false;
      if (!runId) return true;
      if (!event?.runId) return true;
      return String(event.runId) === String(runId);
    });
    return { events, latestSeq: mockRealtimeSeq };
  }

  if (command === "run_realtime_benchmark") {
    const sampleCountRaw = Number(payload?.sampleCount ?? payload?.sample_count ?? 1000);
    const sampleCount = Number.isFinite(sampleCountRaw)
      ? Math.max(1, Math.min(5000, Math.floor(sampleCountRaw)))
      : 1000;
    const runId = payload?.runId || payload?.run_id || runtimeMockStatus.currentRunId;
    const startedAtMs = Date.now();
    let firstSeq = 0;
    let lastSeq = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      mockRealtimeSeq += 1;
      const seq = mockRealtimeSeq;
      if (!firstSeq) firstSeq = seq;
      lastSeq = seq;
      pushMockRealtime({
        seq,
        emittedAt: new Date().toISOString(),
        runId,
        sessionId: "",
        agent: "system",
        topic: "benchmark",
        eventType: "latency_probe",
        sourceItemId: `bench-${startedAtMs}-${index + 1}`,
        payload: {
          sentAtMs: Date.now(),
          index: index + 1,
          total: sampleCount,
        },
      });
    }
    return {
      sampleCount,
      firstSeq,
      lastSeq,
      startedAtMs,
      endedAtMs: Date.now(),
      runId,
    };
  }

  if (command === "get_status") {
    return deriveMockStatusForRun(payload?.runId || payload?.run_id || runtimeMockStatus.currentRunId);
  }

  if (command === "list_runs_grouped") return runtimeMockRunGroups;
  if (command === "list_runs") return flattenRuns(runtimeMockRunGroups);

  if (command === "get_run_status") {
    const runId = payload?.runId || runtimeMockStatus.currentRunId;
    return deriveMockStatusForRun(runId);
  }

  if (command === "get_run_overview") {
    const runId = payload?.runId;
    return findRun(runId) ?? runtimeMockRunGroups[0]?.runs?.[0] ?? null;
  }

  if (command === "switch_run") {
    if (payload?.runId && findRun(payload.runId)) {
      runtimeMockStatus = { ...runtimeMockStatus, currentRunId: payload.runId };
    }
    return { currentRunId: payload.runId, switchedAt: new Date().toISOString() };
  }

  if (command === "create_run") {
    const runId = `run-preview-${Date.now()}`;
    runtimeMockStatus = { ...runtimeMockStatus, currentRunId: runId };
    return { currentRunId: runId, createdAt: new Date().toISOString() };
  }

  if (command === "delete_run") {
    const runId = payload?.runId || "run-preview-new";
    runtimeMockRunGroups = runtimeMockRunGroups
      .map((group) => ({ ...group, runs: (group.runs ?? []).filter((run) => run.runId !== runId) }))
      .filter((group) => group.runs.length > 0);
    if (runtimeMockStatus.currentRunId === runId) {
      const nextRun = flattenRuns(runtimeMockRunGroups)[0];
      runtimeMockStatus = {
        ...runtimeMockStatus,
        currentRunId: nextRun?.runId || "run-preview-new",
      };
    }
    return { ...runtimeMockDeleteResult, runId };
  }

  if (command === "set_codex_model_provider") {
    return mockSetCodexModelProvider(payload?.providerId || payload?.provider_id);
  }

  if (command === "send_codex_message") {
    const runId = payload?.runId || runtimeMockStatus.currentRunId;
    const run = findRun(runId);
    const sessionId = `codex-preview-session-${runId}`;
    const startedAt = new Date().toISOString();
    if (run && !String(run.title || "").trim()) {
      run.title = String(payload?.text || "新会话").trim();
      if (!run.updatedAt) run.updatedAt = startedAt;
      if (!run.lastActivityAt) run.lastActivityAt = run.updatedAt;
    }
    updateMockCodexBridge({
      sessionId,
      state: "running",
      sleeping: false,
      workerRunning: true,
      queueLength: 0,
      lastUserInputAt: startedAt,
      lastBackendActivityAt: startedAt,
      currentPid: 43210,
      codexState: "RUNNING",
      roundState: {
        runId,
        sessionId,
        state: "running",
        active: true,
        source: "mock",
        prompt: String(payload?.text || "").trim(),
        startedAt,
        endedAt: null,
        pid: 43210,
        exitCode: null,
        interruptRequested: false,
      },
    });
    runtimeMockStatus = {
      ...runtimeMockStatus,
      currentRunId: runId,
      activeCodexSessionId: sessionId,
      codexState: "RUNNING",
    };
    return sessionId;
  }

  if (command === "interrupt_codex_session") {
    const sessionId = payload?.sessionId ?? runtimeMockStatus.activeCodexSessionId ?? mockStatus.activeCodexSessionId;
    const interruptedAt = new Date().toISOString();
    updateMockCodexBridge({
      sessionId,
      state: "interrupted",
      sleeping: false,
      workerRunning: false,
      queueLength: 0,
      currentPid: null,
      codexState: "INTERRUPTED",
      roundState: {
        runId: runtimeMockStatus.currentRunId,
        sessionId,
        state: "interrupted",
        active: false,
        source: "mock",
        endedAt: interruptedAt,
        pid: null,
        exitCode: null,
        interruptRequested: true,
      },
    });
    runtimeMockStatus = {
      ...runtimeMockStatus,
      activeCodexSessionId: sessionId,
      codexState: "INTERRUPTED",
    };
    return { sessionId, interrupted: true };
  }

  if (command === "pause_worker") return { paused: true };
  if (command === "resume_worker") return { paused: false };
  if (command === "start_claude_worker") return "claude-preview-session";

  if (command === "cancel_task") {
    const taskId = payload?.taskId || payload?.task_id || "task-preview";
    updateMockTask(taskId, payload?.runId, { status: "CANCELLED", updatedAt: new Date().toISOString() });
    return { id: taskId, status: "CANCELLED" };
  }

  if (command === "continue_task") {
    const taskId = payload?.taskId || payload?.task_id || "task-preview";
    updateMockTask(taskId, payload?.runId, { status: "PENDING", updatedAt: new Date().toISOString() });
    return { id: taskId, status: "PENDING" };
  }

  if (command === "retry_task_with_instruction") {
    const taskId = payload?.taskId || payload?.task_id || "task-preview";
    updateMockTask(taskId, payload?.runId, {
      status: "PENDING",
      instruction: payload?.instruction || "",
      updatedAt: new Date().toISOString(),
    });
    return { id: taskId, status: "PENDING", instruction: payload?.instruction || "" };
  }

  if (command === "mark_task_completed") {
    const taskId = payload?.taskId || payload?.task_id || "task-preview";
    updateMockTask(taskId, payload?.runId, { status: "COMPLETED", updatedAt: new Date().toISOString() });
    return { id: taskId, status: "COMPLETED" };
  }

  if (command === "terminate_task_and_codex") {
    const taskId = payload?.taskId || payload?.task_id || "task-preview";
    updateMockTask(taskId, payload?.runId, { status: "CANCELLED", updatedAt: new Date().toISOString() });
    return {
      id: taskId,
      status: "CANCELLED",
      sessionId: payload?.sessionId || payload?.session_id || "",
      interrupted: true,
    };
  }

  if (command === "export_tasks_json") return mockStatus;
  if (command === "open_diagnostics") {
    return { ...mockDiagnostics, sessionId: payload?.sessionId || "codex-preview-session" };
  }

  return null;
}
