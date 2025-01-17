import { AnyAction } from 'redux'
import { RegisterRendererPort, REGISTER_RPC_PORT } from './actions'
import { PARCEL_LOADING_STARTED, RendererState, RENDERER_INITIALIZED_CORRECTLY } from './types'

const INITIAL_STATE: RendererState = {
  initialized: false,
  parcelLoadingStarted: false,
  clientPort: undefined
}

export function rendererReducer(state?: RendererState, action?: AnyAction): RendererState {
  if (!state) {
    return INITIAL_STATE
  }
  if (!action) {
    return state
  }
  switch (action.type) {
    case RENDERER_INITIALIZED_CORRECTLY:
      return {
        ...state,
        initialized: true
      }
    case REGISTER_RPC_PORT:
      return {
        ...state,
        clientPort: (action as RegisterRendererPort).payload.clientPort
      }
    case PARCEL_LOADING_STARTED:
      return {
        ...state,
        parcelLoadingStarted: true
      }
    default:
      return state
  }
}
