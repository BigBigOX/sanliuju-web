/**
 * 三六局 V2 — 游戏日志系统
 * 持久化日志到 localStorage，最多保存 500 条，可导出
 */
(function() {
const STORAGE_KEY = 'slj_game_logs'
const MAX_LOGS = 500

let logs = []
try { logs = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [] } catch(_) {}

function log(type, detail) {
  const entry = { ts: Date.now(), type, detail }
  logs.push(entry)
  if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS)
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(logs)) } catch(_) {}
  // Also echo to console
  const time = new Date(entry.ts).toLocaleTimeString()
  const icon = { error:'❌', warn:'⚠️', info:'📌', tts:'🔊', asr:'🎤', sync:'🔄', answer:'✏️', penalty:'🎲', match:'📊', question:'🎯', round:'⏭️', game:'🎮' }[type] || '📝'
  console.debug(icon, time, type, detail)
}

function getLogs(filter) {
  if (!filter) return [...logs]
  return logs.filter(l => l.type === filter)
}

function getRecent(n) { return logs.slice(-(n||20)) }

function clearLogs() {
  logs = []
  try { localStorage.removeItem(STORAGE_KEY) } catch(_) {}
}

function exportLogs() {
  return JSON.stringify(logs, null, 2)
}

// Expose globally
window.GameLog = { log, getLogs, getRecent, clearLogs, exportLogs, STORAGE_KEY }

// Hook into game state if available
if (window.stateManager) {
  const origAppend = window.stateManager.appendLog
  if (origAppend) {
    window.stateManager.appendLog = function(entry) {
      origAppend.call(this, entry)
      log('game', entry)
    }
  }
}
})()
