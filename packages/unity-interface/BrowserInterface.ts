import { Quaternion, EcsMathReadOnlyQuaternion, EcsMathReadOnlyVector3, Vector3 } from '@dcl/ecs-math'

// import { uuid } from 'atomicHelpers/math'
import { sendPublicChatMessage } from 'shared/comms'
import { findProfileByName } from 'shared/profiles/selectors'
import { TeleportController } from 'shared/world/TeleportController'
import { reportScenesAroundParcel, setHomeScene } from 'shared/atlas/actions'
import { getCurrentIdentity, getCurrentUserId, getIsGuestLogin } from 'shared/session/selectors'
import { DEBUG, ethereumConfigurations, parcelLimits, playerConfigurations, WORLD_EXPLORER } from 'config'
import { trackEvent } from 'shared/analytics'
import {
  BringDownClientAndShowError,
  ErrorContext,
  ReportFatalErrorWithUnityPayload
} from 'shared/loading/ReportFatalError'
import { defaultLogger } from 'shared/logger'
import { profileRequest, saveProfileDelta } from 'shared/profiles/actions'
import { ProfileType } from 'shared/profiles/types'
import {
  ChatMessage,
  FriendshipUpdateStatusMessage,
  FriendshipAction,
  WorldPosition,
  AvatarRendererMessage,
  GetFriendsPayload,
  GetFriendRequestsPayload,
  GetFriendsWithDirectMessagesPayload,
  MarkMessagesAsSeenPayload,
  GetPrivateMessagesPayload,
  MarkChannelMessagesAsSeenPayload,
  CreateChannelPayload,
  GetChannelsPayload,
  GetChannelMessagesPayload,
  GetJoinedChannelsPayload,
  LeaveChannelPayload,
  MuteChannelPayload,
  GetChannelInfoPayload
} from 'shared/types'
import {
  getSceneWorkerBySceneID,
  allScenesEvent,
  AllScenesEvents,
  renderDistanceObservable
} from 'shared/world/parcelSceneManager'
import { getPerformanceInfo } from 'shared/session/getPerformanceInfo'
import { positionObservable } from 'shared/world/positionThings'
import { sendMessage } from 'shared/chat/actions'
import { leaveChannel, updateFriendship, updateUserData } from 'shared/friends/actions'
import { changeRealm } from 'shared/dao'
import { notifyStatusThroughChat } from 'shared/chat'
import { fetchENSOwner } from 'shared/web3'
import { updateStatusMessage } from 'shared/loading/actions'
import { blockPlayers, mutePlayers, unblockPlayers, unmutePlayers } from 'shared/social/actions'
import { setAudioStream } from './audioStream'
import { logout, redirectToSignUp, signUp, signUpCancel } from 'shared/session/actions'
import { getIdentity, hasWallet } from 'shared/session'
import { getUnityInstance } from './IUnityInterface'
import { setDelightedSurveyEnabled } from './delightedSurvey'
import { IFuture } from 'fp-future'
import { reportHotScenes } from 'shared/social/hotScenes'
import { GIFProcessor } from 'gif-processor/processor'
import {
  joinVoiceChat,
  leaveVoiceChat,
  requestVoiceChatRecording,
  setVoiceChatPolicy,
  setVoiceChatVolume,
  requestToggleVoiceChatRecording
} from 'shared/voiceChat/actions'
import { getERC20Balance } from 'shared/ethereum/EthereumService'
import { ensureFriendProfile } from 'shared/friends/ensureFriendProfile'
import { emotesRequest, wearablesRequest } from 'shared/catalogs/actions'
import { EmotesRequestFilters, WearablesRequestFilters } from 'shared/catalogs/types'
import { fetchENSOwnerProfile } from './fetchENSOwnerProfile'
import { AVATAR_LOADING_ERROR, renderingActivated, renderingDectivated } from 'shared/loading/types'
import { getFetchContentUrlPrefix, getSelectedNetwork } from 'shared/dao/selectors'
import { globalObservable } from 'shared/observables'
import { renderStateObservable } from 'shared/world/worldState'
import { store } from 'shared/store/isolatedStore'
import { signalRendererInitializedCorrectly } from 'shared/renderer/actions'
import { setRendererAvatarState } from 'shared/social/avatarTracker'
import { isAddress } from 'eth-connect'
import { getAuthHeaders } from 'atomicHelpers/signedFetch'
import { Authenticator } from '@dcl/crypto'
import { denyPortableExperiences, removeScenePortableExperience } from 'shared/portableExperiences/actions'
import { setDecentralandTime } from 'shared/apis/host/EnvironmentAPI'
import { Avatar, generateLazyValidator, JSONSchema } from '@dcl/schemas'
import { sceneLifeCycleObservable } from 'shared/world/SceneWorker'
import { transformSerializeOpt } from 'unity-interface/transformSerializationOpt'
import {
  getFriendRequests,
  getFriends,
  getFriendsWithDirectMessages,
  getUnseenMessagesByUser,
  getPrivateMessages,
  markAsSeenPrivateChatMessages,
  createChannel,
  getChannelMessages,
  getJoinedChannels,
  getUnseenMessagesByChannel,
  markAsSeenChannelMessages,
  muteChannel,
  getChannelInfo,
  searchChannels
} from 'shared/friends/sagas'
import { areChannelsEnabled, getMatrixIdFromUser } from 'shared/friends/utils'

import * as IPSME_MsgEnv from '@ipsme/msgenv-broadcastchannel'
// import { TwoPhW, JSON_MsgWarp, JSON_MsgEngage, JSON_MsgAckWarp, JSON_MsgAckEngage, l as l_2PhW } from '@rootintf/protocol-2phw';
import { TwoPhW, JSON_MsgEngage, JSON_MsgAckWarp, JSON_MsgAckEngage } from '@rootintf/protocol-2phw';
import { v4 as uuid4 } from 'uuid';

import * as sharedworker_reflector from '@ipsme/reflector-webbr-ws';

//-------------------------------------------------------------------------------------------------

sharedworker_reflector.load(window, "./reflector/reflector-bc-ws-client.js", function () {

  let str_URN= window.location.href;
  if (str_URN.endsWith('/'))
    str_URN= str_URN.substring(0, str_URN.length-1);

  const json_Announcement= twoPhW.create_Announcement_out(str_URN);

	console.log('reflector_INITd: publish: Announcement: ', JSON.stringify(json_Announcement) );
	IPSME_MsgEnv.publish( JSON.stringify(json_Announcement) );	
});

//-------------------------------------------------------------------------------------------------

const regex_URN_ = /^[^:]*:\/\/(?:www\.|(?!www))(.*)$/;

function extract_URN_(str_URL) {
    let m= str_URL.match(regex_URN_);
    if (m === null)
        return m;

	return m[1];
}

//-------------------------------------------------------------------------------------------------
const NodeRSA = require('node-rsa');
//import './node-rsa-browserify.js';
//const key = new NodeRSA({});

/*
-----BEGIN RSA PUBLIC KEY-----
MIIBCgKCAQEAnCFH2r66kIEVGouXx5y5q3asiZ5w/qhNPc4artNSi4+3Ud4Dm/kw
PgkdOEYr5Jm7gSrOXVtD2rAzjKjJXvkbI/H+zR8XAfVqDFN9vUzmIrr9Fx2KYd0/
ZNwNTeoV+q9AoQxjvSVhNrKLiYoGScS2PHqMVEXu+FrcnI6aG8dvM2kpzYXKSolY
kgH85tqibmSs6izSDtBpVN4mxJyXpBHLZTUdtNgaGsB4u5ctbgrVFza1r4kylACp
z+FKhVLgkLCURvZZ96+6Lm97V11Aeur8ySJmi7cShkVIIcM2QCWc11yMV7l82VbF
4OuJqsoVa0rz9bNBWP5Iq5vE4NVvdtXNjQIDAQAB
-----END RSA PUBLIC KEY-----
-----BEGIN RSA PRIVATE KEY-----
MIIEpQIBAAKCAQEAnCFH2r66kIEVGouXx5y5q3asiZ5w/qhNPc4artNSi4+3Ud4D
m/kwPgkdOEYr5Jm7gSrOXVtD2rAzjKjJXvkbI/H+zR8XAfVqDFN9vUzmIrr9Fx2K
Yd0/ZNwNTeoV+q9AoQxjvSVhNrKLiYoGScS2PHqMVEXu+FrcnI6aG8dvM2kpzYXK
SolYkgH85tqibmSs6izSDtBpVN4mxJyXpBHLZTUdtNgaGsB4u5ctbgrVFza1r4ky
lACpz+FKhVLgkLCURvZZ96+6Lm97V11Aeur8ySJmi7cShkVIIcM2QCWc11yMV7l8
2VbF4OuJqsoVa0rz9bNBWP5Iq5vE4NVvdtXNjQIDAQABAoIBACIE/msjc/NYrQiD
sibEd5Bs41t5MpXKhkoZRqchVLMkNYWZIqAxw9lAkyVX5OiCtuCGO0EMSdS04Aae
IIKZNNi4OhTn2VOL7feRmaxNvTeEFvGadjSsyMtpR1zazL86wJJW6MSmCHCqpszp
TkV0n2C+MyWJt3BWHAvg5qN26TwCLtQLmWxZ3TVbnt+HM11JDqjJGw+hQsW81114
7Wr7YV0/lrKS1u3A6b+YsHiOe4JhcnezFLsq1zs3KXQ4zRz0qphN5aYvj/o2I6Vo
kEJwz1XP8Ks1xWGZrm+aC5kLYJznKHy6MPy47nXU/4TUYhEzs+3MsDe1VZV0VaNJ
ebuv2uECgYEA1SF4+7+MUwZ7QbreZEQ0YWjCN0fvtilifkl0vV6WHhSRCWNqyjqY
k79h/c3+NcxoVVg8QO0/4HJAPTaZq+gm/jj5YF5qJHCBQItBKsPwS/3RgbQkcPhS
f/mnO7UhKRr3FX8DI6KSPayQKPYHXOik5Qszx5zclnL2ekFQ2v7p22sCgYEAu4i5
0EPLXw0pJayqTLaD1ig3DH5f3jaIeWYRbX2wO7eY9ypj0c0Vi8U8Nlft26fLkII5
7vU1xav2u1sEVRxjA9K/fFJ5P4QqyktjjGkVnwj/mn7TTTyBDR4PuxjgI0YUxF2c
t77WHYYvrtX2qFj0Raysi0vhNPfJYJKgUBv2cOcCgYEAlreR/61IRVo7BZNpO0yE
IjJbzY4AdTg034uAk330+Jagrhvw48umJC1d1Ya7cz32tgusqFleJ5GD3gXjjA6i
rHqL11tNAjHRJVyUm/Jt1r9KTcefUYg5hyh725xOM+xOuJPWG3gWpKiIVX8OW+Rk
31gZqNpDn9zycigITqWfqLsCgYEAqmqmCGcDEZ5hDPZqT4nwJhWnaLgSoFlIDaG+
JpR4KNw/qiQgT5Ahi0Ex5WRkJx7FMs3UnZzBP590eG9OcZV5OQkzr2M3AYw2Yly9
2uPHnRzNQfUMSXy4/VWbD/eb/xH5XzR+bM+DvZKqFCQloHgtin9O0MqkncCqhBLa
kdHHUnMCgYEA1OjBlHqZ0jZt22jtqlVYJQN5RiGzi9w3LmIXJI5CacbCOu94rCZT
G+C7ahNyaIJn/T12XO2waVdiOvdzZEEJrFgyGphgG0bEmAtDpxa/iDrrmEDhsLxf
YTiYqRQ8FLUT1zRPZUG4gJtXt2JqQhPAMoLhOSwpsvw99qvWL+S4Qb8=
-----END RSA PRIVATE KEY-----
*/

const key = new NodeRSA( String.raw`-----BEGIN RSA PUBLIC KEY-----
MIIBCgKCAQEAnCFH2r66kIEVGouXx5y5q3asiZ5w/qhNPc4artNSi4+3Ud4Dm/kw
PgkdOEYr5Jm7gSrOXVtD2rAzjKjJXvkbI/H+zR8XAfVqDFN9vUzmIrr9Fx2KYd0/
ZNwNTeoV+q9AoQxjvSVhNrKLiYoGScS2PHqMVEXu+FrcnI6aG8dvM2kpzYXKSolY
kgH85tqibmSs6izSDtBpVN4mxJyXpBHLZTUdtNgaGsB4u5ctbgrVFza1r4kylACp
z+FKhVLgkLCURvZZ96+6Lm97V11Aeur8ySJmi7cShkVIIcM2QCWc11yMV7l82VbF
4OuJqsoVa0rz9bNBWP5Iq5vE4NVvdtXNjQIDAQAB
-----END RSA PUBLIC KEY-----` );

console.log( key.exportKey('pkcs1-public-pem') );
// console.log( key.exportKey('pkcs1-private-pem') );

//-------------------------------------------------------------------------------------------------

function onClick_Warp_(x: number, y : number)
{
  console.log('onClick_Warp_(): ', x, y);

  const json_User= { id: "joeSpace", auth:"https://hubs.local:8080/hub.html?hub_id=7EpqHEW" };
  let json_msgWarp= undefined;

  // -----

  if (x == -20 && y == -2) {
    const json_Hyperport= { 
      destination: {
        browser : "_default", target : "_blank", URL : "https://root-interface.se/js-orange/orange.html"
      },
      portal : "E3608BEC-E471-4F86-8214-D928165A306C"
    };

    const uuid_id= uuid4();
    const warp= twoPhW.create_MsgWarp_out(uuid_id, json_User, json_Hyperport);
		warp.referer= karr_referer_;
    json_msgWarp= warp;
  }

  // else if (x == -20 && y == -8) {
  //   const json_Hyperport= { 
  //     destination: {
  //       browser : "_default", target : "_blank", URL : "https://hubs.local:8080/hub.html?hub_id=4vwPQT9"
  //     },
  //     portal: ""
  //   };

  //   const uuid_id= uuid4();
  //   const rsa_enc= key.encrypt(uuid_id, 'base64');
  
  //   const warp= twoPhW.create_MsgWarp_out(uuid_id, json_User, json_Hyperport);
  //   warp.warp.lock= rsa_enc;
  //   json_msgWarp= warp;
  // }

  else if (x == -20 && y == -11) {
    // const json_Hyperport= 'dhewm3://si_map:game/mp/d3dm4';
    const json_Hyperport= 'secondlife://Ahern/128/128';

    const uuid_id= uuid4();
    const warp= twoPhW.create_MsgWarp_out(uuid_id, json_User, json_Hyperport);
		warp.referer= karr_referer_;
    json_msgWarp= warp;
  }

  else return false;

  // setStatus('WARP');
  
  console.log('onClick_Warp: publish Warp ['+ JSON.stringify(json_msgWarp) +']'); 
  IPSME_MsgEnv.publish( JSON.stringify(json_msgWarp) );
  return true;
}

//-------------------------------------------------------------------------------------------------

function callback_msgOptions_(msg, json_msgOptions) 
{
	console.log('callback_msgOptions_: ', json_msgOptions);



}

//-------------------------------------------------------------------------------------------------
// Sender

function callback_msgAckWarp_(msg, json_msgAckWarp) 
{
	// console.log('callback_msgAckWarp_: Ack: ', json_msgAckWarp);

	const json_msgWarp= json_msgAckWarp._msg;

	const json_msgEngage= JSON_MsgEngage.create_with_MsgWarp(json_msgWarp)
	json_msgEngage.referer= karr_referer_;

	console.log('callback_Ack_Warp: publish: Engage: ', json_msgEngage);
	IPSME_MsgEnv.publish( JSON.stringify(json_msgEngage) );

	// setStatus('ENGAGE'); // ENGAGE/ABORT
  return true;
}

function callback_msgAckEngage_(msg, json_msgAckEngage)
{
	console.log('callback_msgAckEngage_: Ack Engage: ', json_msgAckEngage);

	// setUser({ id : "", authentication : "" }, "");
  return true;
}

//-------------------------------------------------------------------------------------------------
// Receiver

//const regex_DCL_ = /^[^:]*:\/\/play.decentraland.org\/\?position=(-?\d+),(-?\d+)$/;
const regex_DCL_ = /^[^:]*:\/\/localhost:8080\/\?position=(-?\d+),(-?\d+)$/; // should handle URL encoding 87%2C33
// const regex_DCL_ = /^[^:]*:\/\/35.187.58.240:8080\/\?position=(-?\d+),(-?\d+)$/; // should handle URL encoding 87%2C33

function callback_msgWarp_(msg, json_msgWarp) {
  // console.log('callback_Warp: Warp: ', json_msgWarp);

  // const json_User = json_Warp.warp.user;
  const json_Hyperport = json_msgWarp.warp.hyperport;
  const str_URL= json_Hyperport.destination.URL;

  if (typeof str_URL !== "string")
    return false;

  let m = str_URL.match(regex_DCL_);
  if (m === null)
    return false;

  // const x = Number(m[1]);
  // const y = Number(m[2]);

  // console.log(`callback_Warp_: x=${x}, y=${y}`);

  // GoTo()
  // notifyStatusThroughChat(`Jumped to ${x},${y}!`)
  // TeleportController.goTo(x, y);

	const json_msgAckWarp= JSON_MsgAckWarp.create_with_msgOk(json_msgWarp, true);
	json_msgAckWarp.referer= karr_referer_;

  console.log('callback_msgWarp_: publish Ack: ', json_msgAckWarp);
  IPSME_MsgEnv.publish(JSON.stringify(json_msgAckWarp));

  // setUser(json_User, 'PREPARE'); // PREPARE/ABORT
  return true;
}

function callback_msgEngage_(msg, json_msgEngage)
{
	// console.log('callback_Engage: Engage: ', json_msgEngage);

	const json_msgAckEngage= JSON_MsgAckEngage.create_with_msgOk(json_msgEngage, true);
	json_msgAckEngage.referer= karr_referer_;

	console.log('callback_msgEngage_: publish: Ack: ', json_msgAckEngage);
	IPSME_MsgEnv.publish( JSON.stringify(json_msgAckEngage) );

	// setStatus('IN WORLD'); // ACKNOWLEDGE/ABORT
  return true;
}

//-------------------------------------------------------------------------------------------------

const logr_= {
  CXNS : 1,
  REFL : 1,
  // MsgEnv : 1
}

const karr_referer_= [ extract_URN_(window.location.href), uuid4()];
console.log(`karr_referer_= ${karr_referer_}`);

var twoPhW= new TwoPhW();

twoPhW.config.receiver( callback_msgWarp_, callback_msgEngage_ );
twoPhW.config.sender( callback_msgAckWarp_, callback_msgAckEngage_ );
twoPhW.config.callback_msgOptions= callback_msgOptions_;
twoPhW.config.logr= logr_;

//-----------------------------------------------------------------------------------------------------------------------
// IPSME base handlers

function ipsme_handler_object_(msg, obj_msg)
{
  // console.log('ipsme_handler_object_: obj_msg: ', obj_msg); 

  return false;
}

function ipsme_handler_string_(msg, str_msg)
{
  let json_msg;
  try {
    json_msg= JSON.parse(str_msg);
  }
  catch (err) {
    return false;
  }

  // console.log('ipsme_handler_string_: JSON ['+ str_msg +']'); 

  if (twoPhW.handler_msg_json(msg, json_msg))
    return true;

  if (typeof(json_msg) === 'object' && ipsme_handler_object_(msg, json_msg))
    return true;

  return false;
}

function ipsme_handler_(msg : any) 
{
  // console.log('ipsme_handler_: msg: ', msg); 

  try {
    if (typeof (msg) === 'string' && ipsme_handler_string_(msg, msg))
      return true;

    if (typeof (msg) === 'object' && ipsme_handler_object_(msg, msg))
      return true;

  }
  catch (e) {
    console.log(e)
  }

  console.log("ipsme_handler_: DROP! ", msg);
}

IPSME_MsgEnv.config.options= {
  logr: logr_
}

IPSME_MsgEnv.subscribe(ipsme_handler_);

//-------------------------------------------------------------------------------------------------

declare const globalThis: { gifProcessor?: GIFProcessor }
export const futures: Record<string, IFuture<any>> = {}

const positionEvent = {
  position: Vector3.Zero(),
  quaternion: Quaternion.Identity,
  rotation: Vector3.Zero(),
  playerHeight: playerConfigurations.height,
  mousePosition: Vector3.Zero(),
  immediate: false, // By default the renderer lerps avatars position
  cameraQuaternion: Quaternion.Identity,
  cameraEuler: Vector3.Zero()
}

type UnityEvent = any

type SystemInfoPayload = {
  graphicsDeviceName: string
  graphicsDeviceVersion: string
  graphicsMemorySize: number
  processorType: string
  processorCount: number
  systemMemorySize: number
}

/** Message from renderer sent to save the profile in the catalyst */
export type RendererSaveProfile = {
  avatar: {
    name: string
    bodyShape: string
    skinColor: {
      r: number
      g: number
      b: number
      a: number
    }
    hairColor: {
      r: number
      g: number
      b: number
      a: number
    }
    eyeColor: {
      r: number
      g: number
      b: number
      a: number
    }
    wearables: string[]
    emotes: {
      slot: number
      urn: string
    }[]
  }
  face256: string
  body: string
  isSignUpFlow?: boolean
}

const color3Schema: JSONSchema<{ r: number; g: number; b: number; a: number }> = {
  type: 'object',
  required: ['r', 'g', 'b', 'a'],
  properties: {
    r: { type: 'number', nullable: false },
    g: { type: 'number', nullable: false },
    b: { type: 'number', nullable: false },
    a: { type: 'number', nullable: false }
  }
} as any

const emoteSchema: JSONSchema<{ slot: number; urn: string }> = {
  type: 'object',
  required: ['slot', 'urn'],
  properties: {
    slot: { type: 'number', nullable: false },
    urn: { type: 'string', nullable: false }
  }
}

export const rendererSaveProfileSchemaV0: JSONSchema<RendererSaveProfile> = {
  type: 'object',
  required: ['avatar', 'body', 'face256'],
  properties: {
    face256: { type: 'string' },
    body: { type: 'string' },
    isSignUpFlow: { type: 'boolean', nullable: true },
    avatar: {
      type: 'object',
      required: ['bodyShape', 'eyeColor', 'hairColor', 'name', 'skinColor', 'wearables'],
      properties: {
        bodyShape: { type: 'string' },
        name: { type: 'string' },
        eyeColor: color3Schema,
        hairColor: color3Schema,
        skinColor: color3Schema,
        wearables: { type: 'array', items: { type: 'string' } },
        emotes: { type: 'array', items: emoteSchema }
      }
    }
  }
} as any

export const rendererSaveProfileSchemaV1: JSONSchema<RendererSaveProfile> = {
  type: 'object',
  required: ['avatar', 'body', 'face256'],
  properties: {
    face256: { type: 'string' },
    body: { type: 'string' },
    isSignUpFlow: { type: 'boolean', nullable: true },
    avatar: {
      type: 'object',
      required: ['bodyShape', 'eyeColor', 'hairColor', 'name', 'skinColor', 'wearables'],
      properties: {
        bodyShape: { type: 'string' },
        name: { type: 'string' },
        eyeColor: color3Schema,
        hairColor: color3Schema,
        skinColor: color3Schema,
        wearables: { type: 'array', items: { type: 'string' } },
        emotes: { type: 'array', items: emoteSchema }
      }
    }
  }
} as any

// This old schema should keep working until ADR74 is merged and renderer is released
const validateRendererSaveProfileV0 = generateLazyValidator<RendererSaveProfile>(rendererSaveProfileSchemaV0)

// This is the new one
const validateRendererSaveProfileV1 = generateLazyValidator<RendererSaveProfile>(rendererSaveProfileSchemaV1)

// the BrowserInterface is a visitor for messages received from Unity
export class BrowserInterface {
  private lastBalanceOfMana: number = -1

  /**
   * This is the only method that should be called publically in this class.
   * It dispatches "renderer messages" to the correct handlers.
   *
   * It has a fallback that doesn't fail to support future versions of renderers
   * and independant workflows for both teams.
   */
  public handleUnityMessage(type: string, message: any) {
    if (type in this) {
      ;(this as any)[type](message)
    } else {
      if (DEBUG) {
        defaultLogger.info(`Unknown message (did you forget to add ${type} to unity-interface/dcl.ts?)`, message)
      }
    }
  }

  public StartIsolatedMode() {
    defaultLogger.warn('StartIsolatedMode')
  }

  public StopIsolatedMode() {
    defaultLogger.warn('StopIsolatedMode')
  }

  public AllScenesEvent<T extends IEventNames>(data: AllScenesEvents<T>) {
    allScenesEvent(data)
  }

  /** Triggered when the camera moves */
  public ReportPosition(data: {
    position: EcsMathReadOnlyVector3
    rotation: EcsMathReadOnlyQuaternion
    playerHeight?: number
    immediate?: boolean
    cameraRotation?: EcsMathReadOnlyQuaternion
  }) {
    positionEvent.position.set(data.position.x, data.position.y, data.position.z)
    positionEvent.quaternion.set(data.rotation.x, data.rotation.y, data.rotation.z, data.rotation.w)
    positionEvent.rotation.copyFrom(positionEvent.quaternion.eulerAngles)
    positionEvent.playerHeight = data.playerHeight || playerConfigurations.height

    const cameraQuaternion = data.cameraRotation ?? data.rotation
    positionEvent.cameraQuaternion.set(cameraQuaternion.x, cameraQuaternion.y, cameraQuaternion.z, cameraQuaternion.w)
    positionEvent.cameraEuler.copyFrom(positionEvent.cameraQuaternion.eulerAngles)

    // By default the renderer lerps avatars position
    positionEvent.immediate = false

    if (data.immediate !== undefined) {
      positionEvent.immediate = data.immediate
    }

    positionObservable.notifyObservers(positionEvent)
  }

  public ReportMousePosition(data: { id: string; mousePosition: EcsMathReadOnlyVector3 }) {
    positionEvent.mousePosition.set(data.mousePosition.x, data.mousePosition.y, data.mousePosition.z)
    positionObservable.notifyObservers(positionEvent)
    futures[data.id].resolve(data.mousePosition)
  }

  public SceneEvent(data: { sceneId: string; eventType: string; payload: any }) {
    const scene = getSceneWorkerBySceneID(data.sceneId)
    if (scene) {
      scene.rpcContext.sendSceneEvent(data.eventType as IEventNames, data.payload)

      // Keep backward compatibility with old scenes using deprecated `pointerEvent`
      if (data.eventType === 'actionButtonEvent') {
        const { payload } = data.payload
        // CLICK, PRIMARY or SECONDARY
        if (payload.buttonId >= 0 && payload.buttonId <= 2) {
          scene.rpcContext.sendSceneEvent('pointerEvent', data.payload)
        }
      }
    } else {
      if (data.eventType !== 'metricsUpdate') {
        defaultLogger.error(`SceneEvent: Scene ${data.sceneId} not found`, data)
      }
    }
  }

  public OpenWebURL(data: { url: string }) {
    globalObservable.emit('openUrl', data)
  }

  public PerformanceReport(data: Record<string, unknown>) {
    let estimatedAllocatedMemory = 0
    let estimatedTotalMemory = 0
    if (getUnityInstance()?.Module?.asmLibraryArg?._GetDynamicMemorySize) {
      estimatedAllocatedMemory = getUnityInstance().Module.asmLibraryArg._GetDynamicMemorySize()
      estimatedTotalMemory = getUnityInstance().Module.asmLibraryArg._GetTotalMemorySize()
    }
    const perfReport = getPerformanceInfo({ ...(data as any), estimatedAllocatedMemory, estimatedTotalMemory })
    trackEvent('performance report', perfReport)
  }

  // TODO: remove useBinaryTransform after ECS7 is fully in prod
  public SystemInfoReport(data: SystemInfoPayload & { useBinaryTransform?: boolean }) {
    trackEvent('system info report', data)

    transformSerializeOpt.useBinaryTransform = !!data.useBinaryTransform

    queueMicrotask(() => {
      // send an "engineStarted" notification, use a queueMicrotask
      // to escape the current stack leveraging the JS event loop
      store.dispatch(signalRendererInitializedCorrectly())
    })
  }

  public CrashPayloadResponse(data: { payload: any }) {
    getUnityInstance().crashPayloadResponseObservable.notifyObservers(JSON.stringify(data))
  }

  public PreloadFinished(_data: { sceneId: string }) {
    // stub. there is no code about this in unity side yet
  }

  public Track(data: { name: string; properties: { key: string; value: string }[] | null }) {
    const properties: Record<string, string> = {}
    if (data.properties) {
      for (const property of data.properties) {
        properties[property.key] = property.value
      }
    }

    trackEvent(data.name as UnityEvent, { context: properties.context || 'unity-event', ...properties })
  }

  public TriggerExpression(data: { id: string; timestamp: number }) {
    allScenesEvent({
      eventType: 'playerExpression',
      payload: {
        expressionId: data.id
      }
    })

    const messageId = uuid4()
    const body = `␐${data.id} ${data.timestamp}`

    sendPublicChatMessage(messageId, body)
  }

  public TermsOfServiceResponse(data: { sceneId: string; accepted: boolean; dontShowAgain: boolean }) {
    trackEvent('TermsOfServiceResponse', data)
  }

  public MotdConfirmClicked() {
    if (!hasWallet()) {
      globalObservable.emit('openUrl', { url: 'https://docs.decentraland.org/get-a-wallet/' })
    }
  }

  public GoTo(data: { x: number; y: number }) {
    notifyStatusThroughChat(`Jumped to ${data.x},${data.y}!`)
    // TeleportController.goTo(data.x, data.y)
    onClick_Warp_(data.x, data.y);
  }

  public GoToMagic() {
    TeleportController.goToCrowd().catch((e) => defaultLogger.error('error goToCrowd', e))
  }

  public GoToCrowd() {
    TeleportController.goToCrowd().catch((e) => defaultLogger.error('error goToCrowd', e))
  }

  public LogOut() {
    store.dispatch(logout())
  }

  public RedirectToSignUp() {
    store.dispatch(redirectToSignUp())
  }

  public SaveUserInterests(interests: string[]) {
    if (!interests) {
      return
    }
    const unique = new Set<string>(interests)

    store.dispatch(saveProfileDelta({ interests: Array.from(unique) }))
  }

  public SaveUserAvatar(changes: RendererSaveProfile) {
    if (validateRendererSaveProfileV1(changes as RendererSaveProfile)) {
      const update: Partial<Avatar> = {
        avatar: {
          bodyShape: changes.avatar.bodyShape,
          eyes: { color: changes.avatar.eyeColor },
          hair: { color: changes.avatar.hairColor },
          skin: { color: changes.avatar.skinColor },
          wearables: changes.avatar.wearables,
          snapshots: {
            body: changes.body,
            face256: changes.face256
          },
          emotes: changes.avatar.emotes
        }
      }
      store.dispatch(saveProfileDelta(update))
    } else if (validateRendererSaveProfileV0(changes as RendererSaveProfile)) {
      const update: Partial<Avatar> = {
        avatar: {
          bodyShape: changes.avatar.bodyShape,
          eyes: { color: changes.avatar.eyeColor },
          hair: { color: changes.avatar.hairColor },
          skin: { color: changes.avatar.skinColor },
          wearables: changes.avatar.wearables,
          emotes: (changes.avatar.emotes ?? []).map((value, index) => ({ slot: index, urn: value as any as string })),
          snapshots: {
            body: changes.body,
            face256: changes.face256
          }
        }
      }
      store.dispatch(saveProfileDelta(update))
    } else {
      const errors = validateRendererSaveProfileV1.errors ?? validateRendererSaveProfileV0.errors
      defaultLogger.error('error validating schema', errors)
      trackEvent('invalid_schema', {
        schema: 'SaveUserAvatar',
        payload: changes,
        errors: (errors ?? []).map(($) => $.message).join(',')
      })
      defaultLogger.error('Unity sent invalid profile' + JSON.stringify(changes) + ' Errors: ' + JSON.stringify(errors))
    }
  }

  public SendPassport(passport: { name: string; email: string }) {
    store.dispatch(signUp(passport.email, passport.name))
  }

  public RequestOwnProfileUpdate() {
    const userId = getCurrentUserId(store.getState())
    const isGuest = getIsGuestLogin(store.getState())
    if (!isGuest && userId) {
      store.dispatch(profileRequest(userId))
    }
  }

  public SaveUserUnverifiedName(changes: { newUnverifiedName: string }) {
    store.dispatch(saveProfileDelta({ name: changes.newUnverifiedName, hasClaimedName: false }))
  }

  public SaveUserDescription(changes: { description: string }) {
    store.dispatch(saveProfileDelta({ description: changes.description }))
  }

  public GetFriends(getFriendsRequest: GetFriendsPayload) {
    getFriends(getFriendsRequest)
  }

  public GetFriendRequests(getFriendRequestsPayload: GetFriendRequestsPayload) {
    getFriendRequests(getFriendRequestsPayload)
  }

  public async MarkMessagesAsSeen(userId: MarkMessagesAsSeenPayload) {
    if (userId.userId === 'nearby') return
    markAsSeenPrivateChatMessages(userId).catch((err) => {
      defaultLogger.error('error markAsSeenPrivateChatMessages', err),
        trackEvent('error', {
          message: `error marking private messages as seen ${userId.userId} ` + err.message,
          context: 'kernel#friendsSaga',
          stack: 'markAsSeenPrivateChatMessages'
        })
    })
  }

  public async GetPrivateMessages(getPrivateMessagesPayload: GetPrivateMessagesPayload) {
    getPrivateMessages(getPrivateMessagesPayload).catch((err) => {
      defaultLogger.error('error getPrivateMessages', err),
        trackEvent('error', {
          message: `error getting private messages ${getPrivateMessagesPayload.userId} ` + err.message,
          context: 'kernel#friendsSaga',
          stack: 'getPrivateMessages'
        })
    })
  }

  public CloseUserAvatar(isSignUpFlow = false) {
    if (isSignUpFlow) {
      getUnityInstance().DeactivateRendering()
      store.dispatch(signUpCancel())
    }
  }

  public SaveUserTutorialStep(data: { tutorialStep: number }) {
    store.dispatch(saveProfileDelta({ tutorialStep: data.tutorialStep }))
  }

  public ControlEvent({ eventType, payload }: { eventType: string; payload: any }) {
    switch (eventType) {
      case 'SceneReady': {
        const { sceneId } = payload
        sceneLifeCycleObservable.notifyObservers({ sceneId, status: 'ready' })
        break
      }
      case 'DeactivateRenderingACK': {
        /**
         * This event is called everytime the renderer deactivates its camera
         */
        store.dispatch(renderingDectivated())
        renderStateObservable.notifyObservers()
        break
      }
      case 'ActivateRenderingACK': {
        /**
         * This event is called everytime the renderer activates the main camera
         */
        store.dispatch(renderingActivated())
        renderStateObservable.notifyObservers()
        break
      }
      default: {
        defaultLogger.warn(`Unknown event type ${eventType}, ignoring`)
        break
      }
    }
  }

  public SendScreenshot(data: { id: string; encodedTexture: string }) {
    futures[data.id].resolve(data.encodedTexture)
  }

  public ReportBuilderCameraTarget(data: { id: string; cameraTarget: EcsMathReadOnlyVector3 }) {
    futures[data.id].resolve(data.cameraTarget)
  }

  public UserAcceptedCollectibles(_data: { id: string }) {
    // Here, we should have "airdropObservable.notifyObservers(data.id)".
    // It's disabled because of security reasons.
  }

  public SetDelightedSurveyEnabled(data: { enabled: boolean }) {
    setDelightedSurveyEnabled(data.enabled)
  }

  public SetScenesLoadRadius(data: { newRadius: number }) {
    parcelLimits.visibleRadius = Math.round(data.newRadius)

    renderDistanceObservable.notifyObservers({
      distanceInParcels: parcelLimits.visibleRadius
    })
  }

  public GetUnseenMessagesByUser() {
    getUnseenMessagesByUser()
  }

  public SetHomeScene(data: { sceneId: string }) {
    store.dispatch(setHomeScene(data.sceneId))
  }

  public GetFriendsWithDirectMessages(getFriendsWithDirectMessagesPayload: GetFriendsWithDirectMessagesPayload) {
    getFriendsWithDirectMessages(getFriendsWithDirectMessagesPayload)
  }

  public ReportScene(data: { sceneId: string }) {
    this.OpenWebURL({
      url: `https://dcl.gg/report-user-or-scene?scene_or_name=${data.sceneId}`
    })
  }

  public ReportPlayer(data: { userId: string }) {
    this.OpenWebURL({
      url: `https://dcl.gg/report-user-or-scene?scene_or_name=${data.userId}`
    })
  }

  public BlockPlayer(data: { userId: string }) {
    store.dispatch(blockPlayers([data.userId]))
  }

  public UnblockPlayer(data: { userId: string }) {
    store.dispatch(unblockPlayers([data.userId]))
  }

  public RequestScenesInfoInArea(data: { parcel: { x: number; y: number }; scenesAround: number }) {
    store.dispatch(reportScenesAroundParcel(data.parcel, data.scenesAround))
  }

  public SetAudioStream(data: { url: string; play: boolean; volume: number }) {
    setAudioStream(data.url, data.play, data.volume).catch((err) => defaultLogger.log(err))
  }

  public SendChatMessage(data: { message: ChatMessage }) {
    store.dispatch(sendMessage(data.message))
  }

  public SetVoiceChatRecording(recordingMessage: { recording: boolean }) {
    store.dispatch(requestVoiceChatRecording(recordingMessage.recording))
  }

  public JoinVoiceChat() {
    store.dispatch(joinVoiceChat())
  }

  public LeaveVoiceChat() {
    store.dispatch(leaveVoiceChat())
  }

  public ToggleVoiceChatRecording() {
    store.dispatch(requestToggleVoiceChatRecording())
  }

  public ApplySettings(settingsMessage: { voiceChatVolume: number; voiceChatAllowCategory: number }) {
    store.dispatch(setVoiceChatVolume(settingsMessage.voiceChatVolume))
    store.dispatch(setVoiceChatPolicy(settingsMessage.voiceChatAllowCategory))
  }

  public async UpdateFriendshipStatus(message: FriendshipUpdateStatusMessage) {
    try {
      let { userId } = message
      let found = false
      const state = store.getState()

      // TODO - fix this hack: search should come from another message and method should only exec correct updates (userId, action) - moliva - 01/05/2020
      if (message.action === FriendshipAction.REQUESTED_TO) {
        const avatar = await ensureFriendProfile(userId)

        if (isAddress(userId)) {
          found = avatar.hasConnectedWeb3 || false
        } else {
          const profileByName = findProfileByName(state, userId)
          if (profileByName) {
            userId = profileByName.userId
            found = true
          }
        }
      }

      if (!found) {
        // if user profile was not found on server -> no connected web3, check if it's a claimed name
        const net = getSelectedNetwork(state)
        const address = await fetchENSOwner(ethereumConfigurations[net].names, userId)
        if (address) {
          // if an address was found for the name -> set as user id & add that instead
          userId = address
          found = true
        }
      }

      if (message.action === FriendshipAction.REQUESTED_TO && !found) {
        // if we still haven't the user by now (meaning the user has never logged and doesn't have a profile in the dao, or the user id is for a non wallet user or name is not correct) -> fail
        getUnityInstance().FriendNotFound(userId)
        return
      }

      store.dispatch(updateUserData(userId.toLowerCase(), getMatrixIdFromUser(userId)))
      store.dispatch(updateFriendship(message.action, userId.toLowerCase(), false))
    } catch (error) {
      const message = 'Failed while processing updating friendship status'
      defaultLogger.error(message, error)

      trackEvent('error', {
        context: 'kernel#saga',
        message: message,
        stack: '' + error
      })
    }
  }

  public CreateChannel(createChannelPayload: CreateChannelPayload) {
    if (!areChannelsEnabled()) return
    createChannel(createChannelPayload).catch((err) => {
      defaultLogger.error('error createChannel', err),
        trackEvent('error', {
          message: `error creating channel ${createChannelPayload.channelId} ` + err.message,
          context: 'kernel#friendsSaga',
          stack: 'createChannel'
        })
    })
  }

  public MarkChannelMessagesAsSeen(markChannelMessagesAsSeenPayload: MarkChannelMessagesAsSeenPayload) {
    if (!areChannelsEnabled()) return
    if (markChannelMessagesAsSeenPayload.channelId === 'nearby') return
    markAsSeenChannelMessages(markChannelMessagesAsSeenPayload).catch((err) => {
      defaultLogger.error('error markAsSeenChannelMessages', err),
        trackEvent('error', {
          message:
            `error marking channel messages as seen ${markChannelMessagesAsSeenPayload.channelId} ` + err.message,
          context: 'kernel#friendsSaga',
          stack: 'markAsSeenChannelMessages'
        })
    })
  }

  public GetChannelMessages(getChannelMessagesPayload: GetChannelMessagesPayload) {
    if (!areChannelsEnabled()) return
    getChannelMessages(getChannelMessagesPayload).catch((err) => {
      defaultLogger.error('error getChannelMessages', err),
        trackEvent('error', {
          message: `error getting channel messages ${getChannelMessagesPayload.channelId} ` + err.message,
          context: 'kernel#friendsSaga',
          stack: 'getChannelMessages'
        })
    })
  }

  public GetChannels(getChannelsPayload: GetChannelsPayload) {
    if (!areChannelsEnabled()) return
    searchChannels(getChannelsPayload).catch((err) => {
      defaultLogger.error('error searchChannels', err),
        trackEvent('error', {
          message: `error searching channels ` + err.message,
          context: 'kernel#friendsSaga',
          stack: 'searchChannels'
        })
    })
  }

  public GetUnseenMessagesByChannel() {
    if (!areChannelsEnabled()) return
    getUnseenMessagesByChannel()
  }

  public GetJoinedChannels(getJoinedChannelsPayload: GetJoinedChannelsPayload) {
    if (!areChannelsEnabled()) return
    getJoinedChannels(getJoinedChannelsPayload)
  }

  public LeaveChannel(leaveChannelPayload: LeaveChannelPayload) {
    if (!areChannelsEnabled()) return
    leaveChannel(leaveChannelPayload.channelId)
  }

  public MuteChannel(muteChannelPayload: MuteChannelPayload) {
    if (!areChannelsEnabled()) return
    muteChannel(muteChannelPayload)
  }

  public GetChannelInfo(getChannelInfoPayload: GetChannelInfoPayload) {
    if (!areChannelsEnabled()) return
    getChannelInfo(getChannelInfoPayload)
  }

  public SearchENSOwner(data: { name: string; maxResults?: number }) {
    const profilesPromise = fetchENSOwnerProfile(data.name, data.maxResults)

    const baseUrl = getFetchContentUrlPrefix(store.getState())

    profilesPromise
      .then((profiles) => {
        getUnityInstance().SetENSOwnerQueryResult(data.name, profiles, baseUrl)
      })
      .catch((error) => {
        getUnityInstance().SetENSOwnerQueryResult(data.name, undefined, baseUrl)
        defaultLogger.error(error)
      })
  }

  public async JumpIn(data: WorldPosition) {
    const {
      gridPosition: { x, y },
      realm: { serverName }
    } = data

    notifyStatusThroughChat(`Jumping to ${serverName} at ${x},${y}...`)

    changeRealm(serverName).then(
      () => {
        const successMessage = `Jumped to ${x},${y} in realm ${serverName}!`
        notifyStatusThroughChat(successMessage)
        getUnityInstance().ConnectionToRealmSuccess(data)
        TeleportController.goTo(x, y, successMessage)
      },
      (e) => {
        const cause = e === 'realm-full' ? ' The requested realm is full.' : ''
        notifyStatusThroughChat('changerealm: Could not join realm.' + cause)
        getUnityInstance().ConnectionToRealmFailed(data)
        defaultLogger.error(e)
      }
    )
  }

  public ScenesLoadingFeedback(data: { message: string; loadPercentage: number }) {
    const { message, loadPercentage } = data
    store.dispatch(updateStatusMessage(message, loadPercentage))
  }

  public FetchHotScenes() {
    if (WORLD_EXPLORER) {
      reportHotScenes().catch((e: any) => {
        return defaultLogger.error('FetchHotScenes error', e)
      })
    }
  }

  public SetBaseResolution(data: { baseResolution: number }) {
    getUnityInstance().SetTargetHeight(data.baseResolution)
  }

  async RequestGIFProcessor(data: { imageSource: string; id: string; isWebGL1: boolean }) {
    if (!globalThis.gifProcessor) {
      globalThis.gifProcessor = new GIFProcessor(getUnityInstance().gameInstance, getUnityInstance(), data.isWebGL1)
    }

    globalThis.gifProcessor.ProcessGIF(data)
  }

  public DeleteGIF(data: { value: string }) {
    if (globalThis.gifProcessor) {
      globalThis.gifProcessor.DeleteGIF(data.value)
    }
  }

  public Web3UseResponse(data: { id: string; result: boolean }) {
    if (data.result) {
      futures[data.id].resolve(true)
    } else {
      futures[data.id].reject(new Error('Web3 operation rejected'))
    }
  }

  public FetchBalanceOfMANA() {
    const fn = async () => {
      const identity = getIdentity()

      if (!identity?.hasConnectedWeb3) {
        return
      }
      const net = getSelectedNetwork(store.getState())
      const balance = (await getERC20Balance(identity.address, ethereumConfigurations[net].MANAToken)).toNumber()
      if (this.lastBalanceOfMana !== balance) {
        this.lastBalanceOfMana = balance
        getUnityInstance().UpdateBalanceOfMANA(`${balance}`)
      }
    }

    fn().catch((err) => defaultLogger.error(err))
  }

  public SetMuteUsers(data: { usersId: string[]; mute: boolean }) {
    if (data.mute) {
      store.dispatch(mutePlayers(data.usersId))
    } else {
      store.dispatch(unmutePlayers(data.usersId))
    }
  }

  public async KillPortableExperience(data: { portableExperienceId: string }): Promise<void> {
    store.dispatch(removeScenePortableExperience(data.portableExperienceId))
  }

  public async SetDisabledPortableExperiences(data: { idsToDisable: string[] }): Promise<void> {
    store.dispatch(denyPortableExperiences(data.idsToDisable))
  }

  public RequestBIWCatalogHeader() {
    defaultLogger.warn('RequestBIWCatalogHeader')
  }

  public RequestHeaderForUrl(_data: { method: string; url: string }) {
    defaultLogger.warn('RequestHeaderForUrl')
  }

  public RequestSignedHeaderForBuilder(_data: { method: string; url: string }) {
    defaultLogger.warn('RequestSignedHeaderForBuilder')
  }

  // Note: This message is deprecated and should be deleted in the future.
  //       It is here until the Builder API is stabilized and uses the same signedFetch method as the rest of the platform
  public RequestSignedHeader(data: { method: string; url: string; metadata: Record<string, any> }) {
    const identity = getCurrentIdentity(store.getState())

    const headers: Record<string, string> = identity
      ? getAuthHeaders(data.method, data.url, data.metadata, (_payload) =>
          Authenticator.signPayload(identity, data.url)
        )
      : {}

    getUnityInstance().SendHeaders(data.url, headers)
  }

  public async PublishSceneState(data) {
    defaultLogger.warn('PublishSceneState', data)
  }

  public RequestWearables(data: {
    filters: {
      ownedByUser: string | null
      wearableIds?: string[] | null
      collectionIds?: string[] | null
      thirdPartyId?: string | null
    }
    context?: string
  }) {
    const { filters, context } = data
    const newFilters: WearablesRequestFilters = {
      ownedByUser: filters.ownedByUser ?? undefined,
      thirdPartyId: filters.thirdPartyId ?? undefined,
      wearableIds: arrayCleanup(filters.wearableIds),
      collectionIds: arrayCleanup(filters.collectionIds)
    }
    store.dispatch(wearablesRequest(newFilters, context))
  }

  public RequestEmotes(data: {
    filters: {
      ownedByUser: string | null
      emoteIds?: string[] | null
      collectionIds?: string[] | null
      thirdPartyId?: string | null
    }
    context?: string
  }) {
    const { filters, context } = data
    const newFilters: EmotesRequestFilters = {
      ownedByUser: filters.ownedByUser ?? undefined,
      thirdPartyId: filters.thirdPartyId ?? undefined,
      emoteIds: arrayCleanup(filters.emoteIds),
      collectionIds: arrayCleanup(filters.collectionIds)
    }
    store.dispatch(emotesRequest(newFilters, context))
  }

  public RequestUserProfile(userIdPayload: { value: string }) {
    store.dispatch(profileRequest(userIdPayload.value, ProfileType.DEPLOYED))
  }

  public ReportAvatarFatalError() {
    // TODO(Brian): Add more parameters?
    ReportFatalErrorWithUnityPayload(new Error(AVATAR_LOADING_ERROR), ErrorContext.RENDERER_AVATARS)
    BringDownClientAndShowError(AVATAR_LOADING_ERROR)
  }

  public UnpublishScene(data: any) {
    defaultLogger.warn('UnpublishScene', data)
  }

  public async NotifyStatusThroughChat(data: { value: string }) {
    notifyStatusThroughChat(data.value)
  }

  public VideoProgressEvent(videoEvent: {
    componentId: string
    sceneId: string
    videoTextureId: string
    status: number
    currentOffset: number
    videoLength: number
  }) {
    const scene = getSceneWorkerBySceneID(videoEvent.sceneId)
    if (scene) {
      scene.rpcContext.sendSceneEvent('videoEvent' as IEventNames, {
        componentId: videoEvent.componentId,
        videoClipId: videoEvent.videoTextureId,
        videoStatus: videoEvent.status,
        currentOffset: videoEvent.currentOffset,
        totalVideoLength: videoEvent.videoLength
      })
    } else {
      defaultLogger.error(`SceneEvent: Scene ${videoEvent.sceneId} not found`, videoEvent)
    }
  }

  public ReportAvatarState(data: AvatarRendererMessage) {
    setRendererAvatarState(data)
  }

  public ReportDecentralandTime(data: any) {
    setDecentralandTime(data)
  }

  public ReportLog(data: { type: string; message: string }) {
    const logger = getUnityInstance().logger
    switch (data.type) {
      case 'trace':
        logger.trace(data.message)
        break
      case 'info':
        logger.info(data.message)
        break
      case 'warn':
        logger.warn(data.message)
        break
      case 'error':
        logger.error(data.message)
        break
      default:
        logger.log(data.message)
        break
    }
  }
}

function arrayCleanup<T>(array: T[] | null | undefined): T[] | undefined {
  return !array || array.length === 0 ? undefined : array
}

export const browserInterface: BrowserInterface = new BrowserInterface()
