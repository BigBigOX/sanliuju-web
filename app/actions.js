// MARKER_V21_1779075326
/**
 * 三六局 V2 — 用户交互动作
 * AI 驱动游戏循环：出题→计时→自动分析→结果→结算→下一轮
 * 超管仅控制节奏（点出题）+ 越权干预
 */
(function() {
const C = window.CONSTANTS
const Channel = window.Channel
const AIClient = window.AIClient

function createActions(stateManager) {
  const S = stateManager.state
  let roundManager = null
  let matchCalc = null
  let penaltyEngine = null
  let renderFn = null

  function init(rm, mc, pe, rf) {
    roundManager = rm; matchCalc = mc; penaltyEngine = pe; renderFn = rf
  }

  // V2.1 状态机辅助
  function setPhase(phase) {
    S.game.phase = phase
    S.game.roundPhase = phase // 兼容旧字段
  }

  // Replace #1, #2, #3 with player nicknames in AI analysis text
  function resolveNames(text, players) {
    if (!text) return ''
    let out = text
    players.forEach((p, i) => {
      const name = p.nickname || ('玩家' + p.id)
      out = out.replace(new RegExp('#' + (i + 1), 'g'), name)
      out = out.replace(new RegExp('玩家' + (i + 1), 'g'), name)
    })
    return out
  }

  // ===== Page =====
  function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
    const page = document.getElementById(pageId)
    if (page) page.classList.add('active')
  }

  // ===== Profile =====
  function loadProfiles() { try { return JSON.parse(localStorage.getItem('slj_profiles')) || [] } catch (_) { return [] } }
  function saveProfiles(l) { try { localStorage.setItem('slj_profiles', JSON.stringify(l)) } catch (_) {} }
  function createProfile(name, avatar) { return { id: 'p_' + Date.now(), name, avatar, createdAt: Date.now(), lastUsed: Date.now() } }
  function touchProfile(id) { const l = loadProfiles(); const p = l.find(x => x.id === id); if (p) { p.lastUsed = Date.now(); saveProfiles(l) } }

  // ================================================================
  //  HOST — Game Loop (AI-driven)
  // ================================================================

  function goHost(profile, roomId) {
    if (!roomId) roomId = Channel.genRoomId()
    S.role = 'host'; S.profile = profile; S.playerId = 0
    S.room = { id: roomId, status: 'waiting', round: 1, maxPlayers: C.MAX_PLAYERS }
    S.players = [{ id: 0, nickname: profile?.name || '主持人', avatar: profile?.avatar || '👑', joined: true, isHost: true }]
    S.game.usedQuestions = new Set()
    Channel.joinRoom(roomId, handleHostMessage)
    stateManager.saveSession()
    showPage('page-host-wait')
    renderFn()
  }

  function hostStartGame() {
    roundManager.startRound(1)
    stateManager.saveSession()
    stateManager.saveRemote(Channel.getSB(), S.room.id)
    showPage('page-host-console')
    renderFn()
    Channel.broadcast({ type: 'GAME_STARTED', from: 'host_0', data: { roomId: S.room.id, round: 1, roundName: C.ROUND_NAMES[1] } })
    hostGenerateQuestion()
  }

  async function hostGenerateQuestion() {
    if (window.GameLog) window.GameLog.log('tts', 'unlock')
    if (window.TTS) window.TTS.unlock()
    if (roundManager.isRoundComplete()) { await hostSettleRound(); return }
    if (S.game.phase === C.PHASES.PREVIEW) { hostPublishQuestion(); return }

    const players = S.players.filter(p => p.joined)
    const round = S.room.round

    S.game._draftQuestion = null; S.game._draftQuestionId = null
    setPhase(C.PHASES.DRAFTING)
    renderFn()

    const prevDirections = round === 3 ? null : S.game._lastDirections
    const result = await AIClient.generateQuestion(round, players, { previousDirections: prevDirections, timeoutMs: 10000 })

    if (result && result.question) {
      S.game._draftQuestion = result.question
      S.game._draftQuestionId = result.question_id || ('q_draft_' + Date.now())
      S.game._aiThinking = false
      setPhase(C.PHASES.PREVIEW)
      renderFn(); stateManager.saveSession()
    } else {
      hostFallbackQuestion()
    }
  }

  function hostPublishQuestion() {
    const P = C.PHASES
    const round = S.room.round
    const q = S.game._draftQuestion
    if (!q) return
    setPhase(P.ANSWERING)
    S.game.questionCount = (S.game.questionCount || 0) + 1
    S.game.question = q
    S.game.questionId = S.game._draftQuestionId || ('q_' + Date.now())
    S.game.questionLevel = 'AI'
    S.game._draftQuestion = null; S.game._draftQuestionId = null
    // Clear previous question's answers for this round
    if (S.roundAnswers?.[round]) S.roundAnswers[round].answers = {}
    if (S.roundAnswers?.[round]) S.roundAnswers[round].questionId = S.game.questionId
    S.game.usedQuestions.add(q)
    S.game.timerEnd = Date.now() + C.TIMER_SECONDS * 1000
    S.game.timerRunning = true; S.game._lastDirections = null
    Channel.broadcast({ type: 'QUESTION', from: 'host_0', data: { question: q, questionId: S.game.questionId, level: 'AI', round, timer: C.TIMER_SECONDS } })
    Channel.broadcast({ type: 'ROOM_STATE', from: 'host_0', data: { room: S.room, players: S.players, game: stateManager.getSnapshot().game, heat: S.heat } })
    if (window.TTS) window.TTS.speak(q)
    S.game._hostLine = C.WARMUP_LINES[0]
    AIClient.generateHostLine({ round, scene: 'new_question' }).then(line => {
      if (line) { S.game._hostLine = line; renderFn() }
    })
    startTimer(); stateManager.saveSession()
    renderFn()
  }

  function hostFallbackQuestion() {
    const round = S.room.round
    const q = (window.QUESTIONS_DATA && window.QUESTIONS_DATA.drawFallback) ? window.QUESTIONS_DATA.drawFallback(round) : '如果可以去任何地方，你想去哪里？'
    S.game._draftQuestion = q; S.game._draftQuestionId = 'q_fallback_' + Date.now()
    S.game._aiThinking = false
    renderFn()
  }

  // ---- Timer ----
  let timerInterval = null
  let tickCount = 0

  function startTimer() {
    clearInterval(timerInterval); tickCount = 0
    timerInterval = setInterval(() => {
      if (!S.game.timerRunning) return
      tickCount++
      const remaining = Math.max(0, Math.round((S.game.timerEnd - Date.now()) / 1000))
      // All answered → stop immediately
      const totalPlayers = S.players.filter(p => p.joined && !p.isHost).length
      const answeredCount = Object.keys(S.roundAnswers?.[S.room.round]?.answers || {}).length
      if (totalPlayers > 0 && answeredCount >= totalPlayers) {
        stopTimer(); return
      }
      // Rotate warm-up line every 20 seconds
      if (tickCount % 20 === 0 && tickCount > 0) {
        const lines = C.WARMUP_LINES
        const curIdx = lines.indexOf(S.game._hostLine)
        S.game._hostLine = lines[(curIdx + 1) % lines.length]
      }
      renderFn()
      Channel.broadcast({ type: 'TIMER_TICK', from: 'host_0', data: { timerRemaining: remaining } })
      if (tickCount % 3 === 0) Channel.broadcast({ type: 'ROOM_STATE', from: 'host_0', data: { room: S.room, players: S.players, game: stateManager.getSnapshot().game, heat: S.heat } })
      if (remaining <= 0) stopTimer()
    }, 1000)
  }

  function stopTimer() {
    S.game.timerRunning = false; clearInterval(timerInterval)
    setPhase(C.PHASES.ANALYZING)
    renderFn()
    Channel.broadcast({ type: 'TIMER_END', from: 'host_0', data: { answers: S.roundAnswers[S.room.round]?.answers || {} } })
    Channel.broadcast({ type: 'ROOM_STATE', from: 'host_0', data: { room: S.room, players: S.players, game: stateManager.getSnapshot().game, heat: S.heat } })
    setTimeout(() => hostAnalyzeMatches(), 1500)
  }

  // ---- Per-player answer direction analysis ----
  async function analyzeAnswerDirection(playerId, answer) {
    const round = S.room.round
    const player = S.players.find(p => p.id === playerId)
    const name = player?.nickname || ('玩家' + playerId)

    const prompt = `三六局第${round}轮。题目："${S.game.question || ''}"。玩家${name}的回答："${answer}"。
请用1个词（2-6字）概括这个回答的方向/态度/情绪倾向。只返回这个词。`
    try {
      const result = await AIClient.callAI(prompt, { temperature: 0.3, timeoutMs: 5000, maxTokens: 50, responseFormat: 'text' })
      if (result && result.text) {
        if (!S.roundAnswers[round].directions) S.roundAnswers[round].directions = {}
        S.roundAnswers[round].directions[playerId] = result.text.trim()
        // Accumulate into _lastDirections for next question context
        const allDirs = Object.entries(S.roundAnswers[round].directions).map(([pid, dir]) => {
          const p = S.players.find(x => x.id === parseInt(pid))
          return (p?.nickname || ('玩家' + pid)) + ':' + dir
        }).join('; ')
        S.game._lastDirections = allDirs || null
        renderFn()
      }
    } catch (_) { /* fire-and-forget */ }
  }

  // ---- Analysis (auto after timer) ----
  async function hostAnalyzeMatches() {
    const round = S.room.round
    const answers = S.roundAnswers[round]?.answers || {}
    const players = S.players.filter(p => p.joined && !p.isHost)
    if (Object.keys(answers).length === 0) {
      S.game._matchAnalysis = '本轮无人作答，可继续下一题'
      setPhase(C.PHASES.RESULTS); renderFn()
      // Auto-settle if round complete
      if (roundManager.isRoundComplete()) {
        setTimeout(() => hostSettleRound(), C.SETTLEMENT_DISPLAY_MS)
      }
      return
    }

    S.game._aiThinking = true; renderFn()
    const result = await AIClient.analyzeMatches(round, players, answers)
    S.game._aiThinking = false

    if (result && result.pairs) {
      // Map AI's 1-based indices → actual player IDs
      const idxToId = {}
      players.forEach((p, i) => { idxToId[i + 1] = p.id })

      const resolvedPairs = result.pairs.map(pair => {
        const realA = idxToId[pair.a]
        const realB = idxToId[pair.b]
        if (!realA || !realB || realA === 0 || realB === 0) return null
        const key = C.heatKey(realA, realB)
        S.heat[key] = Math.max(0, Math.min(100, pair.score || 50))
        return { a: realA, b: realB, score: pair.score, reason: pair.reason }
      }).filter(Boolean)

      stateManager.appendLog({ type: 'match_analysis', round, pairs: resolvedPairs })
      S.game._matchAnalysis = resolveNames(result.analysis || '', players)
      setPhase(C.PHASES.RESULTS)

      Channel.broadcast({ type: 'MATCH_RESULT', from: 'host_0', data: { pairs: resolvedPairs, analysis: result.analysis || '', round } })
      // Host line for results
      AIClient.generateHostLine({ round, scene: 'match_result' }).then(line => {
        if (line) { S.game._hostLine = line; renderFn() }
      })

      // Steal detection (round 3 only)
      if (round === 3 && result.steals && Array.isArray(result.steals)) {
        result.steals.forEach(s => {
          const realPid = idxToId[s.playerId]
          const realTid = idxToId[s.targetId]
          if (!realPid || !realTid || realPid === 0 || realTid === 0) return
          const outcome = matchCalc.stealthBoost(realPid, realTid, s.quality || 0.5)
          if (outcome.success) {
            stateManager.appendLog({ type: 'steal_success', playerId: realPid, targetId: realTid, boost: outcome.boost, newVal: outcome.newVal })
            Channel.broadcast({ type: 'STEAL_SUCCESS', from: 'host_0', data: { winner_id: realPid, loser_id: null, target_id: realTid, new_match: outcome.newVal } })
          }
        })
      }

      // Penalty check (skip round 1 — info gathering only)
      const triggers = round === 1 ? [] : penaltyEngine.checkThresholds()
      if (triggers.length > 0) {
        setPhase(C.PHASES.VOTING)
        triggers.forEach(t => {
          const pc = S.players.filter(p => p.joined && !p.isHost).length
          const maxCandidates = Math.max(2, Math.min(5, pc - 1))
          const candidates = penaltyEngine.generateCandidates(t.type, maxCandidates)
          S.vote = { type: t.type, pairKey: t.pairKey, candidates, tally: {} }
          Channel.broadcast({ type: 'VOTE_START', from: 'host_0', data: { vtype: t.type, pairKey: t.pairKey, candidates, thresholdInfo: C.PENALTY_INFO[t.type] } })
        })
      }
    } else {
      // Fallback: generate simulated scores so game continues
      const players = S.players.filter(p => p.joined && !p.isHost)
      const fbPairs = []
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          const score = 20 + Math.floor(Math.random() * 65) // 20-85 range
          fbPairs.push({ a: players[i].id, b: players[j].id, score, reason: '自动生成匹配度' })
          const key = C.heatKey(players[i].id, players[j].id)
          S.heat[key] = Math.max(0, Math.min(100, score))
        }
      }
      S.game._matchAnalysis = '匹配度已更新，来看看谁最默契吧~'
      setPhase(C.PHASES.RESULTS)
      Channel.broadcast({ type: 'MATCH_RESULT', from: 'host_0', data: { pairs: fbPairs, analysis: S.game._matchAnalysis, round } })
    }

    // Auto-settle if round complete
    if (roundManager.isRoundComplete()) {
      setTimeout(() => hostSettleRound(), C.SETTLEMENT_DISPLAY_MS)
    }

    stateManager.saveSession(); renderFn()
  }

  // ---- Settlement (round end) ----
  async function hostSettleRound() {
    const round = S.room.round
    const answerCount = Object.keys(S.roundAnswers[round]?.answers || {}).length
    const settlement = roundManager.endRound()

    S.game._aiThinking = true; setPhase(C.PHASES.SETTLEMENT); renderFn()
    Channel.broadcast({ type: 'AI_THINKING', from: 'host_0', data: { thinking: true } })

    const summary = await AIClient.generateRoundSummary(round, S.players, S.heat, S.game.questionCount || 0, answerCount)
    S.game._aiThinking = false
    S.game.settlementData = summary || { ai_comment: `${C.ROUND_NAMES[round]} 完成！` }

    Channel.broadcast({
      type: 'ROUND_SETTLEMENT',
      from: 'host_0',
      data: {
        round, roundName: C.ROUND_NAMES[round],
        questionsCount: S.game.questionCount, answerCount,
        topPairs: matchCalc.getTopPairs(3),
        summary: S.game.settlementData,
        isLastRound: settlement.isLastRound,
        jealousy: settlement.showJealousy ? { ...S.jealousy } : null
      }
    })

    if (settlement.showJealousy) {
      Channel.broadcast({ type: 'JEALOUSY_UPDATED', from: 'host_0', data: { jealousy: S.jealousy } })
    }

    stateManager.saveSession()
    stateManager.saveRemote(Channel.getSB(), S.room.id)
    renderFn()

    // Auto-advance to next round after settlement display
    if (!settlement.isLastRound) {
      setTimeout(() => {
        if (S.game.phase === C.PHASES.SETTLEMENT) hostNextRound()
      }, 6000)
    }
  }

  function hostNextRound() {
    if (S.room.round >= 3) { hostEndGame(); return }

    roundManager.nextRound()
    S.game.question = null; S.game._draftQuestion = null; S.game.timerEnd = null; S.game.timerRunning = false
    S.game.questionCount = 0; setPhase(C.PHASES.IDLE)
    S.game.settlementData = null; S.game._matchAnalysis = ''
    clearInterval(timerInterval)
    stateManager.saveSession()

    Channel.broadcast({ type: 'ROUND_CHANGED', from: 'host_0', data: { round: S.room.round } })
    renderFn()
    setTimeout(() => hostGenerateQuestion(), 1500)
  }

  async function hostEndGame() {
    S.game._aiThinking = true; setPhase(C.PHASES.ENDED); renderFn()

    const stats = { questions: S.game.questionCount || 0, penalties: (S.logs || []).filter(l => l.type === 'penalty_executed').length, rounds: 3 }
    const report = await AIClient.generateGameReport(S.players, S.heat, stats)
    S.game._aiThinking = false; S.game._gameReport = report
    S.room.status = 'ended'

    Channel.broadcast({
      type: 'GAME_ENDED',
      from: 'host_0',
      data: { heat: S.heat, finalPairs: matchCalc.getTopPairs(5), report: report?.report || '', topMatch: report?.top_match || null, stats }
    })

    stateManager.saveSession()
    stateManager.saveRemote(Channel.getSB(), S.room.id)
    renderFn()
  }

  // ================================================================
  //  PLAYER
  // ================================================================

  function goPlayer(profile, roomId) {
    S.role = 'player'; S.profile = profile; S.playerId = Date.now()
    S.room = { id: roomId, status: 'waiting', round: 1 }
    S.game = { ...S.game, usedQuestions: new Set() }
    Channel.joinRoom(roomId, handlePlayerMessage)
    stateManager.saveSession()
    Channel.broadcast({ type: 'PLAYER_JOINED', from: 'player_' + S.playerId, data: { playerId: S.playerId, nickname: profile?.name, avatar: profile?.avatar } })
    setTimeout(() => Channel.requestState(), 500)
    showPage('page-player-board'); renderFn()
  }

  function submitAnswer(text) {
    if (!text || !text.trim()) return
    const answer = text.trim().slice(0, C.ANSWER_CHAR_LIMIT)
    Channel.broadcast({ type: 'PLAYER_ANSWER', from: 'player_' + S.playerId, data: { playerId: S.playerId, questionId: S.game.questionId, answer } })
    S._answeredThisRound = true; renderFn()
  }

  function castVote(candidateIndex) {
    Channel.broadcast({ type: 'VOTE_CAST', from: 'player_' + S.playerId, data: { playerId: S.playerId, candidateIndex } })
  }

  // ================================================================
  //  REJOIN
  // ================================================================

  async function rejoin() {
    const session = stateManager.loadSession()
    if (!session || !session.roomId) { renderFn(); return false }

    if (session.role === 'host') {
      let backup = stateManager.loadHostBackup()
      if (!backup) {
        try { backup = await stateManager.loadRemote(Channel.getSB(), session.roomId) } catch (_) {}
      }
      if (!backup) { stateManager.clearSession(); renderFn(); return false }
      stateManager.restoreSnapshot(backup)
      S.role = 'host'; S.playerId = 0
      Channel.joinRoom(session.roomId, handleHostMessage)
      stateManager.saveSession()
      showPage(S.room.status === 'playing' ? 'page-host-console' : 'page-host-wait'); renderFn()
      setTimeout(() => Channel.broadcast({ type: 'ROOM_STATE', from: 'host_0', data: { room: S.room, players: S.players, game: stateManager.getSnapshot().game, heat: S.heat } }), 500)
      return true
    }

    // Player rejoin
    S.role = 'player'
    if (!session.playerId) session.playerId = Date.now()
    S.playerId = session.playerId
    S.profile = loadProfiles().find(p => p.id === session.profileId) || { id: session.profileId, name: '玩家' + S.playerId, avatar: '🎭' }
    S.room = { id: session.roomId, status: session.status || 'waiting', round: session.round || 1 }

    let resolved = false
    const timeoutId = setTimeout(() => {
      if (resolved) return; resolved = true
      stateManager.clearSession(); Channel.leaveRoom()
      S.role = null; S.room = null
      showPage('page-entry'); renderFn()
    }, C.REJOIN_TIMEOUT_MS)

    const originalHandler = handlePlayerMessage
    Channel.joinRoom(session.roomId, function(msg) {
      if (msg.type === 'ROOM_STATE' && !resolved) { resolved = true; clearTimeout(timeoutId); stateManager.saveSession() }
      originalHandler(msg)
    })

    setTimeout(() => {
      if (resolved) return
      Channel.broadcast({ type: 'PLAYER_REJOINED', from: 'player_' + S.playerId, data: { playerId: S.playerId, nickname: S.profile?.name || ('玩家' + S.playerId), avatar: S.profile?.avatar || '🎭' } })
      Channel.requestFullState(S.playerId)
    }, 500)

    showPage('page-player-board'); renderFn()
    return true
  }

  // ================================================================
  //  MESSAGE HANDLERS
  // ================================================================

  function handleHostMessage(msg) {
    const { type, data } = msg
    if (msg.from && msg.from.startsWith('debug')) return
    stateManager.appendLog({ type, data })

    switch (type) {
      case 'PLAYER_JOINED':
        if (S.players.length >= S.room.maxPlayers + 1) break
        if (S.players.some(p => p.id === data.playerId)) break
        S.players.push({ id: data.playerId || Date.now(), nickname: data.nickname || '匿名', avatar: data.avatar || '🎭', joined: true, isHost: false })
        stateManager.saveHostBackup()
        Channel.broadcast({ type: 'ROOM_STATE', from: 'host_0', data: { room: S.room, players: S.players, game: stateManager.getSnapshot().game, heat: S.heat } })
        renderFn(); break

      case 'PLAYER_ANSWER':
        if (!S.roundAnswers) S.roundAnswers = {}
        if (!S.roundAnswers[S.room.round]) S.roundAnswers[S.room.round] = { question: S.game.question, questionId: S.game.questionId, answers: {}, directions: {} }
        if (!S.roundAnswers[S.room.round].questionId) S.roundAnswers[S.room.round].questionId = S.game.questionId
        S.roundAnswers[S.room.round].answers[data.playerId] = data.answer
        renderFn()
        // Per-player AI direction analysis (fire-and-forget)
        analyzeAnswerDirection(data.playerId, data.answer)
        break

      case 'PLAYER_REJOINED': {
        const pid = data.playerId || Date.now()
        const existing = S.players.find(p => p.id === pid)
        if (!existing) { S.players.push({ id: pid, nickname: data.nickname || ('玩家' + pid), avatar: data.avatar || '🎭', joined: true, isHost: false }); stateManager.saveHostBackup() }
        else { existing.joined = true }
        Channel.broadcast({ type: 'ROOM_STATE', from: 'host_0', data: { room: S.room, players: S.players, game: stateManager.getSnapshot().game, heat: S.heat } })
        renderFn(); break
      }

      case 'VOTE_CAST':
        if (!S.vote) S.vote = { type: 'penalty', candidates: [], tally: {} }
        S.vote.tally[data.playerId] = data.candidateIndex
        // Track host vote for UI highlight
        if (data.playerId === 0) S.vote._hostVote = data.candidateIndex
        // Update live per-candidate vote counts for host display
        if (S.vote.candidates) {
          S.vote.candidates.forEach(c => { c.votes = 0 })
          Object.values(S.vote.tally).forEach(idx => {
            if (S.vote.candidates[idx]) S.vote.candidates[idx].votes++
          })
        }
        const pc = S.players.filter(p => p.joined && !p.isHost).length
        if (Object.keys(S.vote.tally).length >= pc) {
          const w = penaltyEngine.resolveVote(S.vote.candidates, S.vote.tally)
          if (w) { S.vote.winner = w.winner; penaltyEngine.executePenalty({ pairKey: S.vote.pairKey, type: S.vote.type }, w.winner); Channel.broadcast({ type: 'VOTE_RESULT', from: 'host_0', data: { winner: w.winner, penalty: S.penalty } }) }
        }
        renderFn(); break

      case 'ROOM_STATE_REQUEST':
      case 'REQUEST_FULL_STATE':
        // Send full snapshot for reconnection
        Channel.broadcast({
          type: 'ROOM_STATE', from: 'host_0',
          data: {
            room: S.room, players: S.players, heat: S.heat,
            game: stateManager.getSnapshot().game,
            vote: S.vote, penalty: S.penalty,
            roundAnswers: JSON.parse(JSON.stringify(S.roundAnswers || {}))
          }
        }); break
    }
  }

  function handlePlayerMessage(msg) {
    const { type, data } = msg
    if (msg.from && msg.from.startsWith('debug')) return

    switch (type) {
      case 'ROOM_STATE':
        S.room = data.room; S.players = data.players || []
        S.heat = { ...S.heat, ...(data.heat || {}) }
        if (data.game) S.game = { ...S.game, ...data.game, usedQuestions: new Set(data.game?.usedQuestions || []), questionCount: data.game?.questionCount || S.game.questionCount || 0, roundPhase: data.game?.roundPhase || S.game.roundPhase || 'question' }
        // Restore answered state — only if questionId matches current question
        S.roundAnswers = data.roundAnswers || (data.game && data.game.roundAnswers) || {}
        if (S.room?.round && S.playerId && S.game.questionId) {
          const ra = S.roundAnswers[S.room.round]
          if (ra && ra.questionId === S.game.questionId) {
            S._answeredThisRound = !!(ra.answers?.[S.playerId])
          }
        }
        // Restore vote + penalty from full state (for rejoin)
        if (data.vote) S.vote = data.vote
        if (data.penalty) S.penalty = data.penalty
        renderFn(); break

      case 'GAME_STARTED': S.room.status = 'playing'; S.room.round = data.round || 1; renderFn(); break
      case 'QUESTION': S.game.question = data.question; S.game.questionId = data.questionId; S.game.questionLevel = data.level; S.game.timerEnd = Date.now() + (data.timer || C.TIMER_SECONDS) * 1000; S.game.timerRunning = true; if (!data.reopen) S._answeredThisRound = false; renderFn(); break
      case 'TIMER_TICK': S.game.timerRemaining = data.timerRemaining; renderFn(); break
      case 'TIMER_END': S.game.timerRunning = false; renderFn(); break

      case 'MATCH_RESULT':
        if (data.pairs) data.pairs.forEach(p => { const k = C.heatKey(p.a, p.b); S.heat[k] = Math.max(0, Math.min(100, p.score || 50)) })
        S.game._matchAnalysis = data.analysis || ''; setPhase(C.PHASES.RESULTS); renderFn(); break

      case 'VOTE_START': S.vote = { type: data.vtype, pairKey: data.pairKey, candidates: data.candidates, tally: {}, thresholdInfo: data.thresholdInfo }; setPhase(C.PHASES.VOTING); renderFn(); break
      case 'VOTE_RESULT': if (S.vote) S.vote.winner = data.winner; if (data.penalty) S.penalty = data.penalty; renderFn(); break

      case 'ROUND_SETTLEMENT':
        S.game.settlementData = data.summary; setPhase(C.PHASES.SETTLEMENT)
        if (data.jealousy) S.jealousy = data.jealousy
        renderFn(); break

      case 'ROUND_CHANGED': S.room.round = data.round; S.game.question = null; S.game.timerRunning = false; S._answeredThisRound = false; stateManager.saveSession(); renderFn(); break
      case 'JEALOUSY_UPDATED': S.jealousy = data.jealousy || {}; renderFn(); break
      case 'STEAL_SUCCESS': S._lastSteal = data; renderFn(); break
      case 'AI_THINKING': S.game._aiThinking = data.thinking; renderFn(); break
      case 'GAME_ENDED': S.room.status = 'ended'; S.heat = { ...S.heat, ...(data.heat || {}) }; S.game._gameReport = data.report || null; setPhase(C.PHASES.ENDED); renderFn(); break
    }
  }

  // ================================================================
  //  ADMIN OVERRIDE
  // ================================================================

  function adminSkipQuestion() {
    if (S.role !== 'host') return
    S.game._draftQuestion = null; S.game._draftQuestionId = null
    S.game.question = null; S.game.questionId = null
    S.game.timerRunning = false; clearInterval(timerInterval)
    Channel.broadcast({ type: 'ADMIN_OVERRIDE', from: 'host_0', data: { action: 'skip_question' } }); renderFn()
  }

  function adminReopenQuestion() {
    if (S.role !== 'host' || !S.game.question) return
    S.game.timerEnd = Date.now() + C.TIMER_SECONDS * 1000
    S.game.timerRunning = true; S.game.roundPhase = 'question'
    Channel.broadcast({ type: 'QUESTION', from: 'host_0', data: { question: S.game.question, questionId: S.game.questionId, level: S.game.questionLevel || 'AI', round: S.room.round, timer: C.TIMER_SECONDS, reopen: true } })
    Channel.broadcast({ type: 'ROOM_STATE', from: 'host_0', data: { room: S.room, players: S.players, game: stateManager.getSnapshot().game, heat: S.heat } })
    startTimer(); renderFn()
  }

  function adminSkipPenalty() {
    if (S.role !== 'host') return
    S.penalty = null; S.vote = null
    Channel.broadcast({ type: 'ADMIN_OVERRIDE', from: 'host_0', data: { action: 'skip_penalty' } }); renderFn()
  }

  // ================================================================
  return {
    init, loadProfiles, saveProfiles, createProfile, touchProfile,
    goHost, hostStartGame, hostGenerateQuestion, hostFallbackQuestion, hostAnalyzeMatches,
    hostSettleRound, hostNextRound, hostEndGame, startTimer, stopTimer,
    goPlayer, submitAnswer, castVote, rejoin,
    adminSkipPenalty, adminSkipQuestion, adminReopenQuestion
  }
}

if (typeof module !== 'undefined' && module.exports) { module.exports = { createActions } }
else { window.AppActions = { createActions } }
})()
