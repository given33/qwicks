$ErrorActionPreference = 'Stop'

$teamflowRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tauriConfigPath = Join-Path $teamflowRoot 'src-tauri\tauri.conf.json'
$bundleRoot = Join-Path $teamflowRoot 'src-tauri\target\release\bundle'

if (-not (Test-Path -LiteralPath $tauriConfigPath)) {
  throw "Missing Tauri config: $tauriConfigPath"
}

$config = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json
$version = $config.version
if (-not $version) {
  throw 'Tauri config does not define a version.'
}

$stageDir = Join-Path $teamflowRoot "release-staging\$version"
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

$patterns = @(
  'msi\*.msi',
  'msi\*.msi.sig',
  'nsis\*.exe',
  'nsis\*.exe.sig',
  'latest.json'
)

$copied = @()
foreach ($pattern in $patterns) {
  Get-ChildItem -LiteralPath $bundleRoot -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like (Join-Path $bundleRoot $pattern) } |
    ForEach-Object {
      $destination = Join-Path $stageDir $_.Name
      Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
      $copied += [pscustomobject]@{
        Name = $_.Name
        Source = $_.FullName
        Destination = $destination
        Bytes = $_.Length
      }
    }
}

if ($copied.Count -eq 0) {
  throw "No release assets found under $bundleRoot. Run scripts\build-teamflow-desktop.ps1 first."
}

$manifestPath = Join-Path $stageDir 'release-assets.json'
$copied | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host "Staged Teamflow release assets for version ${version}:"
$copied | Format-Table -AutoSize
Write-Host "Manifest: $manifestPath"
