$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$teamflowRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$env:TEAMFLOW_ROOT = $teamflowRoot
$env:TEAMFLOW_WORKDIR = Join-Path $teamflowRoot 'workspace'
$env:USER_ROOT = 'C:\Users\28219'
$env:PYTHONPATH = Join-Path $teamflowRoot 'src'
$env:MIMO_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/anthropic'
$env:MIMO_MODEL = 'mimo-v2.5-pro'
$env:ANTHROPIC_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/anthropic'
$env:ANTHROPIC_MODEL = 'mimo-v2.5-pro'

$teamflowNpmBin = 'C:\Users\28219\AppData\Roaming\npm'
if ((Test-Path $teamflowNpmBin) -and (($env:PATH -split ';') -notcontains $teamflowNpmBin)) {
  $env:PATH = "$teamflowNpmBin;$env:PATH"
}

if (-not $env:TEAMFLOW_WORKER_POLL_SECONDS) { $env:TEAMFLOW_WORKER_POLL_SECONDS = '2' }
if (-not $env:TEAMFLOW_WORKER_IDLE_LOG_SECONDS) { $env:TEAMFLOW_WORKER_IDLE_LOG_SECONDS = '60' }
if (-not $env:TEAMFLOW_WORKER_CLAUDE_TIMEOUT_SECONDS) { $env:TEAMFLOW_WORKER_CLAUDE_TIMEOUT_SECONDS = '7200' }

function Get-TeamflowSecret {
  param([string[]]$Names)
  foreach ($name in $Names) {
    $value = [Environment]::GetEnvironmentVariable($name, 'Process')
    if ($value) { return $value }
  }
  foreach ($name in $Names) {
    $value = [Environment]::GetEnvironmentVariable($name, 'User')
    if ($value) { return $value }
  }
  foreach ($name in $Names) {
    $value = [Environment]::GetEnvironmentVariable($name, 'Machine')
    if ($value) { return $value }
  }
  return $null
}

$teamflowKey = Get-TeamflowSecret @('MIMO_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'XIAOMI_MIMO_API_KEY', 'MIMO_KEY')
if ($teamflowKey) {
  $env:MIMO_API_KEY = $teamflowKey
  $env:ANTHROPIC_AUTH_TOKEN = $teamflowKey
}

New-Item -ItemType Directory -Force -Path $env:TEAMFLOW_ROOT | Out-Null
New-Item -ItemType Directory -Force -Path $env:TEAMFLOW_WORKDIR | Out-Null

$activeRunPath = Join-Path $env:TEAMFLOW_ROOT 'runtime\active-run.json'
if (Test-Path $activeRunPath) {
  try {
    $activeRun = Get-Content -Raw $activeRunPath | ConvertFrom-Json
    if ($activeRun.currentRunId) {
      $env:TEAMFLOW_RUN_ID = [string]$activeRun.currentRunId
    }
  } catch {
    $env:TEAMFLOW_RUN_ID = $null
  }
}

function global:New-TeamflowRun {
  $payload = python -c "import json; from teamflow_v2.store import create_active_run; print(json.dumps(create_active_run(r'$env:TEAMFLOW_ROOT'), ensure_ascii=False))"
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to create Teamflow run'
  }
  $createdRun = $payload | ConvertFrom-Json
  $env:TEAMFLOW_RUN_ID = [string]$createdRun.currentRunId
  return $env:TEAMFLOW_RUN_ID
}
