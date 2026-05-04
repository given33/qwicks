$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$teamflowRoot = 'D:\MCP\teamflow'
$cargoBin = 'C:\Users\28219\.cargo\bin'

if ((Test-Path $cargoBin) -and (($env:PATH -split ';') -notcontains $cargoBin)) {
  $env:PATH = "$cargoBin;$env:PATH"
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  Write-Host 'Failed to prepare Teamflow Desktop sidecar: Rust/Cargo was not found.'
  Write-Host 'Please install Rust, or confirm C:\Users\28219\.cargo\bin is available in PATH.'
  exit 2
}

$manifestPath = Join-Path $teamflowRoot 'src-tauri\teamflow-mcp\Cargo.toml'
$mainReleaseDir = Join-Path $teamflowRoot 'src-tauri\target\release'
$sidecarReleaseDir = Join-Path $teamflowRoot 'src-tauri\teamflow-mcp\target\release'
$hostLine = (& rustc -vV | Select-String '^host:').ToString()
if (-not $hostLine) {
  throw 'Failed to resolve Rust target triple.'
}

$colonIndex = $hostLine.IndexOf(':')
if ($colonIndex -lt 0) {
  throw "Unexpected rustc host line: $hostLine"
}
$targetTriple = $hostLine.Substring($colonIndex + 1).Trim()

Push-Location $teamflowRoot
try {
  foreach ($staleSidecar in @(
    (Join-Path $mainReleaseDir 'teamflow-mcp.pdb'),
    (Join-Path $mainReleaseDir 'teamflow-mcp.d'),
    (Join-Path $mainReleaseDir 'teamflow_mcp.pdb'),
    (Join-Path $teamflowRoot "src-tauri\\bin\\teamflow-mcp-$targetTriple.exe")
  )) {
    if (Test-Path $staleSidecar) {
      Remove-Item -LiteralPath $staleSidecar -Force
    }
  }

  $env:TEAMFLOW_SKIP_TAURI_BUILD = '1'
  cargo build --manifest-path $manifestPath --bin teamflow-mcp --release
  if ($LASTEXITCODE -ne 0) {
    throw 'teamflow-mcp sidecar build failed.'
  }

  $builtSidecar = Join-Path $sidecarReleaseDir 'teamflow-mcp.exe'
  if (-not (Test-Path $builtSidecar)) {
    throw "Compiled sidecar was not found: $builtSidecar"
  }

  $stagedSidecar = Join-Path $mainReleaseDir 'teamflow-mcp.exe'
  Copy-Item -Force $builtSidecar $stagedSidecar

  $sidecarDir = Join-Path $teamflowRoot 'src-tauri'
  $bundledSidecar = Join-Path $sidecarDir "teamflow-mcp-$targetTriple.exe"
  Copy-Item -Force $builtSidecar $bundledSidecar
  Write-Host "Prepared Teamflow Desktop sidecar: $bundledSidecar"
}
finally {
  Remove-Item Env:TEAMFLOW_SKIP_TAURI_BUILD -ErrorAction SilentlyContinue
  Pop-Location
}
