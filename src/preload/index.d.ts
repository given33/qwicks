import type { QWicksGuiApi } from '../shared/qwicks-gui-api'

export type * from '../shared/qwicks-gui-api'

declare global {
  interface Window {
    qwicksGui: QWicksGuiApi
  }
}
