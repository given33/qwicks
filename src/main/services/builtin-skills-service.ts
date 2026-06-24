import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Built-in media skills ship as static skill.json + SKILL.md packages. On app
 * start they are materialized (idempotently, version-gated) into the user data
 * dir so the existing filesystem-based skill discovery pipeline picks them up —
 * no in-memory registration mechanism is needed.
 *
 * The four packages point the model at the already-existing generative tools
 * (generate_image / generate_speech / generate_music / generate_video). They
 * carry no logic of their own.
 */

const BUILTIN_SKILLS_DIR_NAME = 'builtin-skills'

/** Directory inside userData where materialized built-in skill packages live. */
export function builtinSkillsTargetDir(userDataDir: string = app.getPath('userData')): string {
  return join(userDataDir, BUILTIN_SKILLS_DIR_NAME)
}

/**
 * Absolute path to the shipped (read-only) source skill packages. In production
 * the extraResources rule copies resources/builtin-skills into
 * <resourcesPath>/builtin-skills; in development it resolves relative to the
 * project root.
 */
export function builtinSkillsSourceDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, BUILTIN_SKILLS_DIR_NAME)
  }
  // Development: <repo>/resources/builtin-skills. app.getAppPath() points at the
  // out/ dir in dev, so walk up to the project root.
  return join(app.getAppPath(), '..', 'resources', BUILTIN_SKILLS_DIR_NAME)
}

type SkillManifestLite = { version?: string }

async function readSkillVersion(skillDir: string): Promise<string | null> {
  try {
    const raw = await readFile(join(skillDir, 'skill.json'), 'utf8')
    const parsed = JSON.parse(raw) as SkillManifestLite
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

/**
 * Materialize the built-in skill packages into userData/builtin-skills. Skips a
 * package when the on-disk copy already matches the shipped version. Overwrites
 * (rm + cp) when the version changed or the target is missing. Failures are
 * logged but never throw — a missing built-in skill is non-fatal (the generative
 * tools still work independently; the skill only surfaces them to the model).
 */
export async function ensureBuiltinMediaSkills(
  userDataDir: string = app.getPath('userData')
): Promise<void> {
  const source = builtinSkillsSourceDir()
  if (!existsSync(source)) {
    // Source missing (e.g. dev checkout without the resources dir). Nothing to do.
    return
  }
  const target = builtinSkillsTargetDir(userDataDir)
  let sourceSkills: string[]
  try {
    sourceSkills = (await readdir(source, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return
  }
  await mkdir(target, { recursive: true })

  for (const skillId of sourceSkills) {
    const sourceSkillDir = join(source, skillId)
    const targetSkillDir = join(target, skillId)
    try {
      const sourceVersion = await readSkillVersion(sourceSkillDir)
      const targetVersion = await readSkillVersion(targetSkillDir)
      if (sourceVersion && targetVersion === sourceVersion) {
        // Already up to date.
        continue
      }
      // Version changed, target missing, or unparseable: replace wholesale.
      if (existsSync(targetSkillDir)) {
        await rm(targetSkillDir, { recursive: true, force: true })
      }
      await mkdir(targetSkillDir, { recursive: true })
      await cp(sourceSkillDir, targetSkillDir, { recursive: true })
    } catch {
      // Best-effort; a failed skill should not block startup or other skills.
    }
  }
}

/**
 * Whether a given skill root path is the built-in skills directory. Used by the
 * settings UI to tag built-in skills and hide their disable toggle. The root is
 * always a single directory (the materialized builtin-skills folder), so a path
 * comparison is sufficient.
 */
export function isBuiltinSkillsRoot(
  rootPath: string,
  userDataDir: string = app.getPath('userData')
): boolean {
  return rootPath === builtinSkillsTargetDir(userDataDir)
}
