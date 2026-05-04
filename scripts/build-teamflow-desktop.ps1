$ErrorActionPreference = 'Stop'

$teamflowRoot = 'D:\MCP\teamflow'
$env:TEAMFLOW_ROOT = $teamflowRoot
$env:TEAMFLOW_WORKDIR = Join-Path $teamflowRoot 'workspace'
$env:USER_ROOT = 'C:\Users\28219'
$cargoBin = 'C:\Users\28219\.cargo\bin'
$prepareSidecarScript = Join-Path $teamflowRoot 'scripts\prepare-tauri-sidecar.ps1'
$bundledSidecarPath = Join-Path $teamflowRoot 'src-tauri\teamflow-mcp-x86_64-pc-windows-msvc.exe'
# sidecar compile contract: cargo build --manifest-path D:\MCP\teamflow\src-tauri\teamflow-mcp\Cargo.toml --bin teamflow-mcp --release

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

if ((Test-Path $cargoBin) -and (($env:PATH -split ';') -notcontains $cargoBin)) {
  $env:PATH = "$cargoBin;$env:PATH"
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  Write-Host '无法构建 Teamflow Desktop 安装包：未找到 Rust/Cargo。'
  Write-Host '请先安装 Rust，或确认 C:\Users\28219\.cargo\bin 已加入 PATH。'
  exit 2
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host '无法构建 Teamflow Desktop 安装包：未找到 Node.js/npm。'
  exit 2
}

Set-Location $teamflowRoot
if (-not (Test-Path (Join-Path $teamflowRoot 'node_modules'))) {
  npm install
}

if (-not (Test-Path (Join-Path $teamflowRoot 'web\node_modules'))) {
  npm run web:install
}

& $prepareSidecarScript
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

if (-not (Test-Path $bundledSidecarPath)) {
  Write-Host "sidecar 预构建未生成预期文件：$bundledSidecarPath"
  exit 2
}

npm run build
