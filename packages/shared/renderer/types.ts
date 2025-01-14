import { RpcClientPort } from '@dcl/rpc'

export const RENDERER_INITIALIZED_CORRECTLY = '[RENDERER] Renderer initialized correctly'
export const PARCEL_LOADING_STARTED = '[RENDERER] Parcel loading started'
export const RENDERER_INITIALIZE = '[RENDERER] Initializing'

export type RendererState = {
  initialized: boolean
  parcelLoadingStarted: boolean
  clientPort: RpcClientPort | undefined
}

export type RootRendererState = {
  renderer: RendererState
}
