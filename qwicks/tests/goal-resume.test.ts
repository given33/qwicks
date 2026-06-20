import { describe, expect, it } from 'vitest'
import { LocalToolHost, buildDefaultLocalTools } from '../src/adapters/tool/local-tool-host.js'
import { GET_GOAL_TOOL_NAME, UPDATE_GOAL_TOOL_NAME } from '../src/adapters/tool/goal-tools.js'
import type { ModelStreamChunk } from '../src/ports/model-client.js'
import { bootstrapThread, makeHarness, type Harness } from './loop-test-harness.js'

type CapturedTimer = { fn: () => void; cancelled: boolean }

function makeCapturingTimer() {
  const timers: CapturedTimer[] = []
  const setTimer = (fn: () => void) => {
    const entry: CapturedTimer = { fn, cancelled: false }
    timers.push(entry)
    return {
      cancel: () => {
        entry.cancelled = true
      }
    }
  }
  const pending = () => timers.filter((t) => !t.cancelled)
  const fireLatest = () => {
    const entry = [...timers].reverse().find((t) => !t.cancelled)
    if (!entry) throw new Error('no pending goal-resume timer to fire')
    entry.cancelled = true
    entry.fn()
  }
  return { setTimer, pending, fireLatest }
}

function makeGoalTools(getHarness: () => Harness) {
  return [
    LocalToolHost.defineTool({
      name: GET_GOAL_TOOL_NAME,
      description: 'Get goal',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      policy: 'auto',
      execute: async (_args, context) => ({ output: { goal: await getHarness().threads.getGoal(context.threadId) } })
    }),
    LocalToolHost.defineTool({
      name: UPDATE_GOAL_TOOL_NAME,
      description: 'Update goal',
      inputSchema: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['complete', 'blocked'] } },
        required: ['status'],
        additionalProperties: false
      },
      policy: 'auto',
      execute: async (args, context) => {
        const status = args.status
        if (status !== 'complete' && status !== 'blocked') {
          return { output: { error: 'invalid status' }, isError: true }
        }
        const goal = await getHarness().threads.setGoal(context.threadId, { status })
        return { output: { goal } }
      }
    })
  ]
}

async function waitFor(predicate: () => Promise<boolean> | boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for: ${label}`)
}

describe('goal auto-resume (issue #370)', () => {
  it('auto-resumes a failed goal turn and drives it to completion', async () => {
    const timer = makeCapturingTimer()
    let h: Harness
    let calls = 0
    h = makeHarness(
      {
        provider: 'goal-resume',
        model: 'goal-resume',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls === 1) {
            // Initial goal turn dies mid-run (e.g. transient model error).
            yield { kind: 'error', message: 'model request failed with status 500', code: 'http_500' }
            return
          }
          if (calls === 2) {
            // Resumed turn picks the work back up and finishes the goal.
            yield {
              kind: 'tool_call_complete',
              callId: 'call_complete',
              toolName: UPDATE_GOAL_TOOL_NAME,
              arguments: { status: 'complete' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'assistant_text_delta', text: 'Done.' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [...buildDefaultLocalTools(), ...makeGoalTools(() => h)], goalResume: { setTimer: timer.setTimer } }
    )
    await bootstrapThread(h, { request: { prompt: 'fix all the bugs' } })
    await h.threads.setGoal(h.threadId, { objective: 'fix all the bugs', status: 'active' })

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    expect(status).toBe('failed')
    // Goal is still active and a resume is scheduled rather than left dead.
    expect((await h.threads.getGoal(h.threadId))?.status).toBe('active')
    expect(timer.pending()).toHaveLength(1)

    timer.fireLatest()
    await waitFor(async () => (await h.threads.getGoal(h.threadId))?.status === 'complete', 'goal complete')

    const thread = await h.threadStore.get(h.threadId)
    expect(thread?.turns.length).toBe(2) // original + auto-resume turn
    const resumeEvents = (await h.sessionStore.loadEventsSince(h.threadId, 0)).filter(
      (event) => event.kind === 'error' && event.code === 'goal_auto_resume'
    )
    expect(resumeEvents).toHaveLength(1)
  })

  it('blocks the goal once consecutive no-progress resumes are exhausted', async () => {
    const timer = makeCapturingTimer()
    let h: Harness
    h = makeHarness(
      {
        provider: 'goal-stuck',
        model: 'goal-stuck',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          // Every attempt dies immediately without making progress.
          yield { kind: 'error', message: 'still broken', code: 'http_500' }
        }
      },
      {
        tools: [...buildDefaultLocalTools(), ...makeGoalTools(() => h)],
        goalResume: { setTimer: timer.setTimer, maxNoProgressAttempts: 1 }
      }
    )
    await bootstrapThread(h, { request: { prompt: 'fix all the bugs' } })
    await h.threads.setGoal(h.threadId, { objective: 'fix all the bugs', status: 'active' })

    await h.loop.runTurn(h.threadId, h.turnId)
    expect(timer.pending()).toHaveLength(1) // one resume allowed

    timer.fireLatest() // the resume also fails -> budget exhausted
    await waitFor(async () => (await h.threads.getGoal(h.threadId))?.status === 'blocked', 'goal blocked')

    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(events.some((e) => e.kind === 'error' && e.code === 'goal_auto_resume_exhausted')).toBe(true)
    expect(events.some((e) => e.kind === 'goal_updated' && e.goal?.status === 'blocked')).toBe(true)
  })

  it('does not auto-resume a failed turn when there is no active goal', async () => {
    const timer = makeCapturingTimer()
    const h = makeHarness(
      {
        provider: 'no-goal',
        model: 'no-goal',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          yield { kind: 'error', message: 'boom', code: 'http_500' }
        }
      },
      { goalResume: { setTimer: timer.setTimer } }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    expect(status).toBe('failed')
    expect(timer.pending()).toHaveLength(0)
  })

  it('does not auto-resume when the goal turn completes normally', async () => {
    const timer = makeCapturingTimer()
    let h: Harness
    h = makeHarness(
      {
        provider: 'goal-done',
        model: 'goal-done',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_done',
            toolName: UPDATE_GOAL_TOOL_NAME,
            arguments: { status: 'complete' }
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
        }
      },
      { tools: [...buildDefaultLocalTools(), ...makeGoalTools(() => h)], goalResume: { setTimer: timer.setTimer } }
    )
    await bootstrapThread(h, { request: { prompt: 'fix all the bugs' } })
    await h.threads.setGoal(h.threadId, { objective: 'fix all the bugs', status: 'active' })

    await h.loop.runTurn(h.threadId, h.turnId)
    expect((await h.threads.getGoal(h.threadId))?.status).toBe('complete')
    expect(timer.pending()).toHaveLength(0)
  })
})
