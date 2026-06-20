/// <reference types="vite/client" />

import type { DetailedHTMLProps, HTMLAttributes } from 'react'
import type { KunGuiApi } from '@shared/kun-gui-api'

declare global {
  interface Window {
    kunGui: KunGuiApi
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        allowpopups?: string
        partition?: string
        src?: string
        webpreferences?: string
      }
    }
  }
}
