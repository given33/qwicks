import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

type ReleaseChangeResult = {
  releaseKind: 'code' | 'installer' | 'none'
  hotUpdateSafe: boolean
  codeUpdateNeeded: boolean
  fullInstallerNeeded: boolean
  changedFiles: string[]
  codeFiles: string[]
  installerFiles: string[]
  ignoredFiles: string[]
}

type ReleaseChangeModule = {
  classifyChangedFiles(input: { files: string[] }): ReleaseChangeResult
}

type UpdateVersionResult = {
  version: string
  source: 'manual' | 'commit_count'
}

type UpdateVersionModule = {
  computeUpdateVersion(input: {
    manualVersion?: string
    commitCount?: number | string
    major?: number
    minor?: number
  }): UpdateVersionResult
}

const releaseChange = require('../../scripts/classify-release-change.cjs') as ReleaseChangeModule
const updateVersion = require('../../scripts/compute-update-version.cjs') as UpdateVersionModule

describe('release change classification', () => {
  it('routes renderer and qwicks source changes to code update only', () => {
    expect(
      releaseChange.classifyChangedFiles({
        files: ['src/renderer/src/App.tsx', 'qwicks/src/services/trace-recorder.ts']
      })
    ).toMatchObject({
      releaseKind: 'code',
      hotUpdateSafe: true,
      codeUpdateNeeded: true,
      fullInstallerNeeded: false,
      codeFiles: ['src/renderer/src/App.tsx', 'qwicks/src/services/trace-recorder.ts'],
      installerFiles: []
    })
  })

  it('routes main process changes to a full installer because code.zip cannot update them', () => {
    expect(
      releaseChange.classifyChangedFiles({
        files: ['src/main/gui-updater.ts']
      })
    ).toMatchObject({
      releaseKind: 'installer',
      hotUpdateSafe: false,
      codeUpdateNeeded: false,
      fullInstallerNeeded: true,
      installerFiles: ['src/main/gui-updater.ts']
    })
  })

  it('routes shared shell contracts to a full installer because main imports them too', () => {
    expect(
      releaseChange.classifyChangedFiles({
        files: ['src/shared/gui-update.ts']
      })
    ).toMatchObject({
      releaseKind: 'installer',
      hotUpdateSafe: false,
      codeUpdateNeeded: false,
      fullInstallerNeeded: true,
      installerFiles: ['src/shared/gui-update.ts']
    })
  })

  it('does not publish app updates for docs or workflow-only changes', () => {
    expect(
      releaseChange.classifyChangedFiles({
        files: ['docs/release.md', '.github/workflows/release-windows.yml']
      })
    ).toMatchObject({
      releaseKind: 'none',
      hotUpdateSafe: false,
      codeUpdateNeeded: false,
      fullInstallerNeeded: false,
      ignoredFiles: ['docs/release.md', '.github/workflows/release-windows.yml']
    })
  })

  it('lets installer-required files win over hot-code files on mixed pushes', () => {
    expect(
      releaseChange.classifyChangedFiles({
        files: ['src/renderer/src/App.tsx', 'package-lock.json']
      })
    ).toMatchObject({
      releaseKind: 'installer',
      hotUpdateSafe: false,
      codeUpdateNeeded: false,
      fullInstallerNeeded: true,
      codeFiles: ['src/renderer/src/App.tsx'],
      installerFiles: ['package-lock.json']
    })
  })
})

describe('update version computation', () => {
  it('uses the shared 0.2.N commit-count version by default', () => {
    expect(updateVersion.computeUpdateVersion({ commitCount: 319 })).toEqual({
      version: '0.2.319',
      source: 'commit_count'
    })
  })

  it('accepts an explicit semver override for manual releases', () => {
    expect(updateVersion.computeUpdateVersion({ manualVersion: '1.4.7', commitCount: 319 })).toEqual({
      version: '1.4.7',
      source: 'manual'
    })
  })

  it('rejects four-part versions because electron-updater requires semver', () => {
    expect(() => updateVersion.computeUpdateVersion({ manualVersion: '0.2.319.1', commitCount: 319 })).toThrow(
      /x\.y\.z/
    )
  })
})
