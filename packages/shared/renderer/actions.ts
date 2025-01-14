import { action } from 'typesafe-actions'

import type { UnityGame } from '@dcl/unity-renderer/src/index'

import { RENDERER_INITIALIZED_CORRECTLY, PARCEL_LOADING_STARTED, RENDERER_INITIALIZE } from './types'
import { RpcClientPort, Transport } from '@dcl/rpc'

export const initializeRenderer = (
  delegate: (container: HTMLElement) => Promise<{ renderer: UnityGame; transport: Transport }>,
  container: HTMLElement
) => action(RENDERER_INITIALIZE, { delegate, container })
export type InitializeRenderer = ReturnType<typeof initializeRenderer>

export const REGISTER_RPC_PORT = 'REGISTER_RPC_PORT'
export const registerRendererPort = (clientPort: RpcClientPort) => action(REGISTER_RPC_PORT, { clientPort })
export type RegisterRendererPort = ReturnType<typeof registerRendererPort>

export const signalRendererInitializedCorrectly = () => action(RENDERER_INITIALIZED_CORRECTLY)
export type SignalRendererInitialized = ReturnType<typeof signalRendererInitializedCorrectly>

export const signalParcelLoadingStarted = () => action(PARCEL_LOADING_STARTED)
export type SignalParcelLoadingStarted = ReturnType<typeof signalParcelLoadingStarted>
