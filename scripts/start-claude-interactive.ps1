. "$PSScriptRoot\teamflow-env.ps1"
Set-Location $env:TEAMFLOW_WORKDIR
$mcpConfig = Join-Path $env:TEAMFLOW_ROOT 'runtime\claude-mcp.json'
& claude --add-dir 'C:\Users\28219' --permission-mode bypassPermissions --mcp-config $mcpConfig --strict-mcp-config -n 'Claude Teamflow V2 Interactive'
