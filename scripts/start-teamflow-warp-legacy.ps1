$ErrorActionPreference = 'Stop'
$teamflowRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
& (Join-Path $teamflowRoot 'start-teamflow-v2.ps1') -Restart -Warp
