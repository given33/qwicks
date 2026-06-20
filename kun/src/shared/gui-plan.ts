/**
 * Simple stub for GUI plan path validation.
 * TODO: Migrate full implementation from shared/gui-plan.ts
 */
export function isGuiPlanRelativePath(path: string): boolean {
  // Check if path matches .teamflow-sdd/plan/*.md pattern
  return /^\.teamflow-sdd\/plan\/[^/]+\.md$/.test(path) ||
         /^\.kunsdd\/plan\/[^/]+\.md$/.test(path)
}