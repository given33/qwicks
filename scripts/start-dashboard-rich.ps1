. "$PSScriptRoot\teamflow-env.ps1"
Set-Location $env:TEAMFLOW_WORKDIR
& python (Join-Path $env:TEAMFLOW_ROOT 'dashboard.py')
