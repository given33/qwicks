. "$PSScriptRoot\teamflow-env.ps1"
Set-Location $env:TEAMFLOW_WORKDIR
& codex -C $env:TEAMFLOW_WORKDIR --add-dir 'C:\Users\28219' --dangerously-bypass-approvals-and-sandbox
