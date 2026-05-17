/**
 * 三六局 V2 — Supabase Realtime 消息通道
 * 参考 GaryAustin1/Realtime2：removeChannel + 指数退避重连
 * 平台适配：Web 用 supabase-js (CDN)，小程序用小程序版 SDK
 */
(function() {
const SUPABASE_URL = 'https://qrqhooyjbynicwycttfi.supabase.co'
const SUPABASE_KEY = 'sb_publishable_LhnO7BuftYRFwignp2fGtA_m_c0Gkxl'

let sb = null
let channel = null
let messageHandler = null
let isReconnecting = false
let reconnectAttempts = 0
const MAX_RETRIES = 8

function getSB() {
  if (!sb) {
    if (typeof supabase !== 'undefined') {
      sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    } else {
      console.error('[Channel] Supabase SDK not loaded')
      return null
    }
  }
  return sb
}

function genRoomId() {
  let s = ''
  for (let i = 0; i < 6; i++) s += Math.floor(Math.random() * 10)
  return s
}

function reconnectWithBackoff(roomId, onMessage) {
  if (reconnectAttempts >= MAX_RETRIES) {
    console.error('[Channel] Max retries reached, giving up')
    return
  }
  const delay = Math.min(3000 * Math.pow(2, reconnectAttempts), 60000)
  console.log('[Channel] Reconnecting in', delay/1000, 's (attempt', reconnectAttempts+1, '/', MAX_RETRIES, ')')
  setTimeout(() => {
    reconnectAttempts++
    joinRoom(roomId, onMessage)
  }, delay)
}

function joinRoom(roomId, onMessage) {
  const client = getSB()
  if (!client) return false

  // Remove old channel first to prevent reconnection loops
  if (channel) {
    try { client.removeChannel(channel) } catch(_) {}
    channel = null
  }

  messageHandler = onMessage
  const chanName = 'room:' + roomId

  channel = client.channel(chanName)
  channel.on('broadcast', { event: 'msg' }, (payload) => {
    if (messageHandler) {
      reconnectAttempts = 0  // Reset on successful message
      messageHandler(payload.payload)
    }
  })

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log('[Channel] Connected to', chanName)
      reconnectAttempts = 0
      isReconnecting = false
    }
    if (status === 'CHANNEL_ERROR') {
      console.error('[Channel] Error on', chanName)
    }
    if (status === 'CLOSED') {
      console.log('[Channel] Closed', chanName)
      if (!isReconnecting) {
        isReconnecting = true
        reconnectWithBackoff(roomId, onMessage)
      }
    }
  })

  return true
}

function leaveRoom() {
  isReconnecting = false
  reconnectAttempts = 0
  if (channel) {
    const client = getSB()
    if (client) {
      try { client.removeChannel(channel) } catch(_) {}
    }
    channel = null
  }
  messageHandler = null
}

function broadcast(msg) {
  if (!channel) {
    console.warn('[Channel] Not connected, cannot broadcast')
    return false
  }
  channel.send({
    type: 'broadcast',
    event: 'msg',
    payload: msg
  })
  return true
}

function requestState() {
  broadcast({ type: 'ROOM_STATE_REQUEST', from: 'player' })
}

function requestFullState(playerId) {
  broadcast({ type: 'REQUEST_FULL_STATE', from: 'player', data: { playerId, ts: Date.now() } })
}

function isConnected() {
  return channel && channel.state === 'joined'
}

// ===== Export =====
const Channel = {
  getSB, genRoomId,
  joinRoom, leaveRoom,
  broadcast, requestState, requestFullState,
  isConnected,
  SUPABASE_URL, SUPABASE_KEY
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Channel
} else {
  window.Channel = Channel
}
})()
