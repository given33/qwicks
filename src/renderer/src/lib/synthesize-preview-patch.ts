/**
 * 从 old/new 文本对合成一个简化的 unified-diff 字符串（渲染器端，无依赖）。
 *
 * 用途：PatchItem 流式预览——模型发起编辑时（tool_call_started），前端只有
 * oldText/newText 参数，尚未拿到 runtime 的精确 diff。本函数合成一个临时
 * patch 喂给 DiffView，让用户提前看到"要改什么"；编辑完成（tool_call_finished）
 * 后用 runtime 的精确 diff 替换。
 *
 * 采用 LCS（最长公共子序列）逐行 diff，输出标准 unified diff 格式
 * （@@ -a,b +c,d @@ + +/-/context），DiffView 能直接渲染。
 */

/**
 * 计算两段文本的逐行 unified diff。
 * @param filePath 文件路径（写进 diff header）
 * @param oldText 原文
 * @param newText 新文
 * @returns unified diff 字符串；若无变化返回空串
 */
export function synthesizePreviewPatch(
  filePath: string,
  oldText: string,
  newText: string
): string {
  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)
  const hunks = diffToHunks(oldLines, newLines)
  if (hunks.length === 0) return ''

  const header = `--- a/${filePath}\n+++ b/${filePath}\n`
  return header + hunks.map(hunkToString).join('\n')
}

function splitLines(text: string): string[] {
  // 保留行内容（不含换行符）；末尾空行忽略
  const lines = text.split('\n')
  // 如果文本以换行结尾，split 会产生一个空串尾元素，去掉它
  if (lines.length > 0 && lines[lines.length - 1] === '' && text.endsWith('\n')) {
    lines.pop()
  }
  return lines
}

type DiffOp =
  | { type: 'equal'; oldLine: number; newLine: number; text: string }
  | { type: 'delete'; oldLine: number; text: string }
  | { type: 'insert'; newLine: number; text: string }

/**
 * LCS-based line diff。返回操作序列。
 */
function lcsLineDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length
  const m = b.length
  // dp[i][j] = LCS 长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', oldLine: i + 1, newLine: j + 1, text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'delete', oldLine: i + 1, text: a[i] })
      i++
    } else {
      ops.push({ type: 'insert', newLine: j + 1, text: b[j] })
      j++
    }
  }
  while (i < n) {
    ops.push({ type: 'delete', oldLine: i + 1, text: a[i] })
    i++
  }
  while (j < m) {
    ops.push({ type: 'insert', newLine: j + 1, text: b[j] })
    j++
  }
  return ops
}

type Hunk = {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: string[]
}

const CONTEXT = 3

/**
 * 把操作序列聚合成 unified diff hunks（带 3 行上下文）。
 */
function diffToHunks(a: string[], b: string[]): Hunk[] {
  const ops = lcsLineDiff(a, b)
  // 找出所有非 equal 的操作索引
  const changeIndices: number[] = []
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].type !== 'equal') changeIndices.push(k)
  }
  if (changeIndices.length === 0) return []

  const hunks: Hunk[] = []
  // 把相邻的变更（间隔 <= 2*CONTEXT）合并成同一 hunk
  let groupStart = changeIndices[0]
  let groupEnd = changeIndices[0]
  for (let c = 1; c < changeIndices.length; c++) {
    const idx = changeIndices[c]
    if (idx - groupEnd <= 2 * CONTEXT) {
      groupEnd = idx
    } else {
      hunks.push(buildHunk(ops, groupStart, groupEnd))
      groupStart = idx
      groupEnd = idx
    }
  }
  hunks.push(buildHunk(ops, groupStart, groupEnd))
  return hunks
}

function buildHunk(ops: DiffOp[], changeStart: number, changeEnd: number): Hunk {
  const first = Math.max(0, changeStart - CONTEXT)
  const last = Math.min(ops.length - 1, changeEnd + CONTEXT)
  const lines: string[] = []
  let oldStart = 0
  let newStart = 0
  let oldCount = 0
  let newCount = 0
  let oldStartSet = false
  let newStartSet = false
  for (let k = first; k <= last; k++) {
    const op = ops[k]
    if (op.type === 'equal') {
      if (!oldStartSet) { oldStart = op.oldLine; oldStartSet = true }
      if (!newStartSet) { newStart = op.newLine; newStartSet = true }
      lines.push(' ' + op.text)
      oldCount++
      newCount++
    } else if (op.type === 'delete') {
      if (!oldStartSet) { oldStart = op.oldLine; oldStartSet = true }
      lines.push('-' + op.text)
      oldCount++
    } else {
      if (!newStartSet) { newStart = op.newLine; newStartSet = true }
      lines.push('+' + op.text)
      newCount++
    }
  }
  // unified diff 约定：空 hunk 用 0 起点 + 0 计数；这里至少有变更不会空
  return {
    oldStart: oldStart || 1,
    oldCount,
    newStart: newStart || 1,
    newCount,
    lines
  }
}

function hunkToString(h: Hunk): string {
  const header = `@@ -${formatRange(h.oldStart, h.oldCount)} +${formatRange(h.newStart, h.newCount)} @@`
  return header + '\n' + h.lines.join('\n')
}

function formatRange(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`
}
