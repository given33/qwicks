param(
  [switch]$Restart,
  [switch]$SyncOnly,
  [switch]$NoLaunch,
  [switch]$Warp
)

$ErrorActionPreference = 'Stop'

$teamflowRoot = 'D:\MCP\teamflow'
$launchName = 'Teamflow V2 MCP'
$teamflowEnvScript = Join-Path $teamflowRoot 'scripts\teamflow-env.ps1'

function Use-TeamflowEnv {
  if (Test-Path $teamflowEnvScript) {
    . $teamflowEnvScript
    return
  }

  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8

  $env:TEAMFLOW_ROOT = $teamflowRoot
  $env:TEAMFLOW_WORKDIR = Join-Path $teamflowRoot 'workspace'
  $env:USER_ROOT = 'C:\Users\28219'
  $env:PYTHONPATH = Join-Path $teamflowRoot 'src'

  New-Item -ItemType Directory -Force -Path $teamflowRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $env:TEAMFLOW_WORKDIR | Out-Null
}

Use-TeamflowEnv

python -m teamflow_v2.launch --root $teamflowRoot --sync
Write-Host 'Synced Teamflow V2 Warp workflow, launch config, pane scripts, and desktop launcher'

Use-TeamflowEnv

if (-not $SyncOnly) {
  $currentRunId = New-TeamflowRun
  Write-Host "Created Teamflow run: $currentRunId"
}

$mcpServer = Join-Path $env:TEAMFLOW_ROOT 'mimo_mcp_server.py'
codex mcp remove teamflow-v2 2>$null | Out-Null
codex mcp add teamflow-v2 --env TEAMFLOW_ROOT=$env:TEAMFLOW_ROOT --env TEAMFLOW_RUN_ID=$env:TEAMFLOW_RUN_ID --env PYTHONPATH="$env:PYTHONPATH" --env MIMO_BASE_URL=$env:MIMO_BASE_URL --env MIMO_MODEL=$env:MIMO_MODEL -- python $mcpServer | Out-Null
Write-Host 'Configured Codex MCP server: teamflow-v2'

if (-not $env:MIMO_API_KEY -and -not $env:ANTHROPIC_AUTH_TOKEN) {
  Write-Host 'MiMo key was not found in standard environment variable names. Startup will continue; review calls need MIMO_API_KEY, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY, XIAOMI_MIMO_API_KEY, or MIMO_KEY.'
}

if ($SyncOnly) {
  Write-Host 'SyncOnly set, skipping restart and launch'
  return
}

if ($Restart) {
  $all = @(Get-CimInstance Win32_Process)
  $roots = @(
    $all | Where-Object { $_.CommandLine -match 'D:\\MCP\\teamflow' -or $_.CommandLine -match 'teamflow-v2' }
  )
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  $queue = [System.Collections.Generic.Queue[int]]::new()

  foreach ($root in $roots) {
    if ($ids.Add([int]$root.ProcessId)) {
      $queue.Enqueue([int]$root.ProcessId)
    }
  }

  while ($queue.Count -gt 0) {
    $parentId = $queue.Dequeue()
    foreach ($child in $all | Where-Object { $_.ParentProcessId -eq $parentId }) {
      if ($ids.Add([int]$child.ProcessId)) {
        $queue.Enqueue([int]$child.ProcessId)
      }
    }
  }

  foreach ($id in @($ids)) {
    if ($id -ne $PID) {
      Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
  }
}

if (-not $NoLaunch) {
  Start-Process ("warp://launch/" + [uri]::EscapeDataString($launchName))
  Write-Host "Started $launchName"
} else {
  Write-Host 'NoLaunch set, skipping Warp launch'
}
