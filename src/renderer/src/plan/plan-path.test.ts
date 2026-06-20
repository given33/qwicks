import { describe, expect, it } from 'vitest'
import {
  buildPlanRelativePath,
  isGuiPlanRelativePath,
  nextAvailablePlanRelativePath,
  planFeatureNameFromRequest
} from './plan-path'

describe('plan-path', () => {
  it('keeps readable Chinese feature names', () => {
    expect(planFeatureNameFromRequest('做一个登录页')).toBe('做一个登录页')
    expect(buildPlanRelativePath('做一个登录页')).toBe('.qwickssdd/plan/做一个登录页.md')
  })

  it('normalizes English spacing and illegal filename characters', () => {
    expect(planFeatureNameFromRequest('Build Login: OAuth / SSO?')).toBe('build-login-oauth-sso')
  })

  it('falls back for empty or unsafe names', () => {
    expect(planFeatureNameFromRequest('../')).toBe('plan')
    expect(buildPlanRelativePath('../')).toBe('.qwickssdd/plan/plan.md')
  })

  it('selects the next available duplicate path', () => {
    expect(
      nextAvailablePlanRelativePath('login', [
        '.qwickssdd/plan/login.md',
        '.qwickssdd/plan/login-2.md'
      ])
    ).toBe('.qwickssdd/plan/login-3.md')
  })

  it('accepts only direct markdown files inside the GUI plan directory', () => {
    expect(isGuiPlanRelativePath('.qwickssdd/plan/login.md')).toBe(true)
    expect(isGuiPlanRelativePath('.deepseekgui/plan/login.md')).toBe(true)
    expect(isGuiPlanRelativePath('.qwickssdd/plan/nested/login.md')).toBe(false)
    expect(isGuiPlanRelativePath('../.qwickssdd/plan/login.md')).toBe(false)
    expect(isGuiPlanRelativePath('.qwickssdd/plan/login.txt')).toBe(false)
  })
})
