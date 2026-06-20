import type { ReactElement } from 'react'
import { ModelConfigurationPanel } from './InitialSetupDialog'

export function ModelConfigurationSettingsSection(): ReactElement {
  return <ModelConfigurationPanel mode="preview" variant="settings" />
}
