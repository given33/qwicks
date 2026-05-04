$ErrorActionPreference = 'Stop'

$teamflowRoot = 'D:\MCP\teamflow'
$env:TEAMFLOW_ROOT = $teamflowRoot
$env:TEAMFLOW_WORKDIR = Join-Path $teamflowRoot 'workspace'
$env:USER_ROOT = 'C:\Users\28219'
$cargoBin = 'C:\Users\28219\.cargo\bin'

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

if ((Test-Path $cargoBin) -and (($env:PATH -split ';') -notcontains $cargoBin)) {
  $env:PATH = "$cargoBin;$env:PATH"
}

New-Item -ItemType Directory -Force -Path $env:TEAMFLOW_ROOT | Out-Null
New-Item -ItemType Directory -Force -Path $env:TEAMFLOW_WORKDIR | Out-Null

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  Write-Host 'Teamflow Desktop 启动失败：未找到 Rust/Cargo。'
  Write-Host '请先安装 Rust，或确认 C:\Users\28219\.cargo\bin 已加入 PATH。'
  exit 2
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host 'Teamflow Desktop 启动失败：未找到 Node.js/npm。'
  exit 2
}

Set-Location $teamflowRoot
if (-not (Test-Path (Join-Path $teamflowRoot 'node_modules'))) {
  npm install
}

if (-not (Test-Path (Join-Path $teamflowRoot 'web\node_modules'))) {
  npm run web:install
}

npm run dev
