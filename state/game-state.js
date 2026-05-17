/**
 * 三六局 V2 — 全局状态管理
 * 纯逻辑，无 DOM/平台依赖。移植小程序时只需替换 storage 适配器。
 */
(function() {
const C = window.CONSTANTS

// ===== Storage Adapter =====
const storage = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)) } catch (_) { return null }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)) } catch (_) {}
  },
  remove(key) {
    try { localStorage.removeItem(key) } catch (_) {}
  }
}

// ===== Session Keys =====
const SESSION_KEY = 'slj_v2_session'
const HOST_BACKUP_KEY = 'slj_v2_host_backup'

// ===== Initial State =====
function createInitialState() {
  return {
    role: null,        // 'host' | 'player'
    playerId: null,
    profile: null,     // { id, name, avatar }
    room: null,        // { id, status: 'waiting'|'playing', round, maxPlayers }
    players: [],       // [{ id, nickname, avatar, joined, isHost, coins }]
    heat: {},          // { '1-3': 65 }
    crush: {},         // { playerId: [targetIds] } — who each player is interested in
    jealousy: {},      // { playerId: value }
    penalty: null,     // { selected: {...}, target: playerId }
    vote: null,        // { type: 'penalty', candidates: [], winner: null }
    roundAnswers: {},  // { round: { question, answers: { playerId: text } } }
    game: {            // 当前回合状态
      phase: 'idle',          // V2.1 显式状态机
      question: null,
      questionId: null,
      questionLevel: null,
      timerEnd: null,
      timerRunning: false,
      pairs: null,
      sparks: {},
      usedQuestions: new Set(),
      questionCount: 0,
      roundPhase: 'question',  // V2 兼容字段
      settlementData: null,
      _matchAnalysis: '',
      _gameReport: null,
      _aiThinking: false,
      _draftQuestion: null,
      _draftQuestionId: null
    },
    logs: []
  }
}

// ===== State Factory =====
function createState() {
  const S = createInitialState()

  return {
    state: S,

    reset() {
      Object.assign(this.state, createInitialState())
      storage.remove(SESSION_KEY)
      storage.remove(HOST_BACKUP_KEY)
    },

    // ---- Snapshots ----
    getSnapshot() {
      return {
        room: S.room,
        players: S.players,
        heat: { ...S.heat },
      crush: { ...S.crush },
      jealousy: { ...S.jealousy },
        game: {
          phase: S.game.phase || 'idle',
          question: S.game.question,
          questionId: S.game.questionId,
          questionLevel: S.game.questionLevel,
          timerEnd: S.game.timerEnd,
          timerRunning: S.game.timerRunning,
          usedQuestions: [...(S.game.usedQuestions || [])],
          questionCount: S.game.questionCount || 0,
          roundPhase: S.game.roundPhase || 'question',
          settlementData: S.game.settlementData,
          _matchAnalysis: S.game._matchAnalysis || '',
          _gameReport: S.game._gameReport,
          roundAnswers: JSON.parse(JSON.stringify(S.roundAnswers || {}))
        },
        roundAnswers: JSON.parse(JSON.stringify(S.roundAnswers || {})),
        round: S.room?.round || 0
      }
    },

    restoreSnapshot(snap) {
      if (!snap) return false
      S.room = snap.room
      S.players = snap.players || []
      S.heat = snap.heat || {}
      S.crush = snap.crush || {}
      S.game = {
        ...S.game, ...snap.game,
        phase: snap.game?.phase || 'idle',
        usedQuestions: new Set(snap.game?.usedQuestions || []),
        questionCount: snap.game?.questionCount || 0,
        roundPhase: snap.game?.roundPhase || 'question',
        settlementData: snap.game?.settlementData || null,
        _matchAnalysis: snap.game?._matchAnalysis || '',
        _gameReport: snap.game?._gameReport || null
      }
      S.roundAnswers = snap.roundAnswers || {}
      S.jealousy = snap.jealousy || {}
      return true
    },

    // ---- Local Persistence ----
    saveSession() {
      if (!S.role || !S.room?.id) return
      storage.set(SESSION_KEY, {
        role: S.role, roomId: S.room.id, playerId: S.playerId,
        profileId: S.profile?.id, status: S.room.status,
        round: S.room.round, savedAt: Date.now()
      })
      if (S.role === 'host') this.saveHostBackup()
    },

    loadSession() {
      const s = storage.get(SESSION_KEY)
      if (!s) return null
      // Expire sessions older than SESSION_MAX_AGE_MS
      if (s.savedAt && Date.now() - s.savedAt > (window.CONSTANTS || C).SESSION_MAX_AGE_MS) {
        this.clearSession()
        return null
      }
      return s
    },

    clearSession() {
      storage.remove(SESSION_KEY)
      storage.remove(HOST_BACKUP_KEY)
    },

    saveHostBackup() {
      if (S.role !== 'host' || !S.room) return
      storage.set(HOST_BACKUP_KEY, {
        room: S.room, players: S.players, heat: S.heat,
        crush: S.crush, jealousy: S.jealousy,
        game: { ...S.game, usedQuestions: [...(S.game.usedQuestions || [])] },
        roundAnswers: S.roundAnswers, vote: S.vote,
        penalty: S.penalty, savedAt: Date.now()
      })
    },

    loadHostBackup() {
      return storage.get(HOST_BACKUP_KEY)
    },

    // ---- Remote Persistence (Supabase) ----
    async saveRemote(sb, gameId) {
      if (!sb || !gameId) return
      try {
        const { error } = await sb
          .from('game_snapshots')
          .upsert({
            game_id: String(gameId),
            snapshot: this.getSnapshot(),
            updated_at: new Date().toISOString()
          }, { onConflict: 'game_id' })
        if (error) console.warn('[State] Remote save failed:', error.message)
      } catch (e) { console.warn('[State] Remote save error:', e.message) }
    },

    async loadRemote(sb, gameId) {
      if (!sb || !gameId) return null
      try {
        const { data, error } = await sb
          .from('game_snapshots')
          .select('snapshot')
          .eq('game_id', String(gameId))
          .maybeSingle()
        if (error || !data) return null
        return data.snapshot
      } catch (e) { console.warn('[State] Remote load error:', e.message); return null }
    },

    // ---- Log Management ----
    appendLog(entry) {
      S.logs.push({ ...entry, ts: Date.now() })
    },

    clearLogs(reason) {
      S.logs = [{ type: 'context_clear', reason, ts: Date.now() }]
    },

  }
}

// ===== Export =====
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createState, createInitialState }
} else {
  window.GameState = { createState, createInitialState }
}
})()
