$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$buildScript = Get-Content -LiteralPath (Join-Path $root 'scripts\build-teamflow-desktop.ps1') -Raw
$prepareScript = Get-Content -LiteralPath (Join-Path $root 'scripts\prepare-tauri-sidecar.ps1') -Raw
$stageScript = Get-Content -LiteralPath (Join-Path $root 'scripts\stage-release-assets.ps1') -Raw
$operationalScripts = @(
  'scripts\build-teamflow-desktop.ps1',
  'scripts\start-teamflow-desktop.ps1',
  'scripts\start-teamflow-warp-legacy.ps1',
  'scripts\teamflow-env.ps1',
  'start-teamflow-v2.ps1'
)

function Assert-Contains {
  param(
    [string] $Text,
    [string] $Pattern,
    [string] $Message
  )

  if ($Text -notmatch $Pattern) {
    throw $Message
  }
}

function Assert-NotContains {
  param(
    [string] $Text,
    [string] $Pattern,
    [string] $Message
  )

  if ($Text -match $Pattern) {
    throw $Message
  }
}

Assert-Contains `
  -Text $prepareScript `
  -Pattern 'New-Item\s+-ItemType\s+Directory\s+-Force\s+-Path\s+\$mainReleaseDir' `
  -Message 'prepare-tauri-sidecar.ps1 must create src-tauri\target\release before staging the sidecar.'

Assert-Contains `
  -Text $buildScript `
  -Pattern 'Invoke-CheckedCommand' `
  -Message 'build-teamflow-desktop.ps1 must check external command exit codes instead of continuing after npm/cargo failures.'

Assert-Contains `
  -Text $buildScript `
  -Pattern 'npm run web:install' `
  -Message 'build-teamflow-desktop.ps1 must keep the web dependency install step.'

Assert-Contains `
  -Text $buildScript `
  -Pattern 'web\\node_modules\\\.bin\\vite\.cmd' `
  -Message 'build-teamflow-desktop.ps1 must verify the Vite command, not just the web node_modules directory.'

Assert-Contains `
  -Text $stageScript `
  -Pattern '\$\{version\}:' `
  -Message 'stage-release-assets.ps1 must delimit $version before a colon in strings.'

Assert-Contains `
  -Text $stageScript `
  -Pattern 'Get-FileHash[^\r\n]+-Algorithm\s+SHA256' `
  -Message 'stage-release-assets.ps1 must include SHA256 checksums in release-assets.json.'

foreach ($relativePath in $operationalScripts) {
  $scriptText = Get-Content -LiteralPath (Join-Path $root $relativePath) -Raw
  Assert-NotContains `
    -Text $scriptText `
    -Pattern 'D:[\\/]MCP[\\/]teamflow' `
    -Message "$relativePath must not hardcode the old D:\MCP\teamflow worktree."
}

Write-Host 'release script checks passed'
