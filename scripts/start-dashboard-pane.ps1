. "$PSScriptRoot\teamflow-env.ps1"
Set-Location $env:TEAMFLOW_ROOT

$apiCommand = ". `"$PSScriptRoot\teamflow-env.ps1`"; python (Join-Path `$env:TEAMFLOW_ROOT 'dashboard.py') --api-only"
Start-Process powershell -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $apiCommand) | Out-Null

$webRoot = Join-Path $env:TEAMFLOW_ROOT 'web'
Set-Location $webRoot
if (-not (Test-Path (Join-Path $webRoot 'node_modules'))) {
  npm install
}
Start-Process 'http://127.0.0.1:5173'
npm run dev
