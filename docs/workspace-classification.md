# Teamflow Workspace Classification

## Source Worktrees

- `D:\MCP\teamflow-release-main`: clean GitHub `main` release worktree.
- `D:\MCP\teamflow`: active migration and integration worktree.
- `D:\MCP\teamflow-kernel-convergence`: historical kernel convergence worktree.
- `D:\MCP\teamflow-task2-runtime-boundaries`: clean task boundary worktree.

## Local Backup

- `D:\git-backups\teamflow-desktop-full.git`: bare backup repository.
- `refs/snapshots/full-working-tree-20260604-233430`: dirty `D:\MCP\teamflow` snapshot before cleanup.
- `refs/snapshots/teamflow-kernel-convergence-working-tree-20260604-234720`: dirty kernel convergence snapshot before cleanup.

## Workspace Archive

- `D:\MCP\_teamflow-workspace-archive\root-loose-files\reports`: loose Markdown/status reports from `D:\MCP`.
- `D:\MCP\_teamflow-workspace-archive\root-loose-files\images`: UI preview screenshots.
- `D:\MCP\_teamflow-workspace-archive\root-loose-files\scripts-and-configs`: loose scripts and config templates.
- `D:\MCP\_teamflow-workspace-archive\backups`: large local backup directories.
- `D:\MCP\_teamflow-workspace-archive\historical-workspaces`: non-Git historical workspaces.
- `D:\MCP\_teamflow-workspace-archive\root-stray-directories`: stray root directories that are not active Git worktrees.

## Reference Repositories

Reference repositories remain in `D:\MCP` because Teamflow architecture work depends on their stable paths:

- `D:\MCP\agent-reference-repos*`
- `D:\MCP\agent-hub`
- `D:\MCP\learn-claude-code-review`

They are not part of the Teamflow GitHub `main` source tree.
