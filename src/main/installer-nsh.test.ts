import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// build/installer.nsh is a NSIS include script — it has no JS to execute, so we
// guard its structure instead. The fix for the full-package-update zombie
// process hinges on process cleanup living inside customInit (which NSIS runs
// in EVERY install mode, including the silent /S mode used by electron-updater's
// quitAndInstall(isSilent=true)). customCheckAppRunning is invoked by the NSIS
// template only from the "app is running" PAGE, which /S skips entirely — so any
// cleanup left there alone is dead code on the auto-update path.
describe('build/installer.nsh structure (problem 2 regression guard)', () => {
  const nshPath = resolve(process.cwd(), 'build/installer.nsh')
  const content = readFileSync(nshPath, 'utf8')

  it('declares both customInit and customCheckAppRunning macros', () => {
    expect(content).toMatch(/!macro\s+customInit\b/)
    expect(content).toMatch(/!macro\s+customCheckAppRunning\b/)
  })

  it('does the taskkill + tasklist poll loop inside customInit (runs under /S)', () => {
    const customInitMatch = content.match(/!macro\s+customInit([\s\S]*?)!macroend/i)
    expect(customInitMatch, 'customInit macro not found').not.toBeNull()
    const customInitBody = customInitMatch![1]
    // Kill + verify-until-gone: both taskkill and the tasklist liveness check
    // must be inside customInit so silent installs clean up processes.
    expect(customInitBody).toMatch(/taskkill\s+\/F\s+\/IM\s+QWicks\.exe/)
    expect(customInitBody).toMatch(/tasklist/)
    expect(customInitBody).toMatch(/INFO/) // the "No tasks running" sentinel
  })

  it('does NOT rely on customCheckAppRunning as the only cleanup (it is skipped under /S)', () => {
    const checkMatch = content.match(/!macro\s+customCheckAppRunning([\s\S]*?)!macroend/i)
    expect(checkMatch, 'customCheckAppRunning macro not found').not.toBeNull()
    const checkBody = checkMatch![1]
    // The body must NOT contain the kill loop — that belongs in customInit now.
    expect(checkBody).not.toMatch(/taskkill\s+\/F\s+\/IM\s+QWicks\.exe/)
  })
})
