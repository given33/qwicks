. "$PSScriptRoot\teamflow-env.ps1"
Set-Location $env:TEAMFLOW_WORKDIR
& python -m teamflow_v2.claude_worker
