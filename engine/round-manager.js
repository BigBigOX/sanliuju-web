/**
 * 三六局 V2 — 轮次管理器
 * 控制三轮流程：信息采集 → 当下匹配 → 人性博弈
 * 纯逻辑，无平台依赖。
 */
(function() {
const C = window.CONSTANTS

function createRoundManager(stateManager) {
  const S = stateManager.state

  function startRound(round) {
    S.room.round = round
    S.room.status = 'playing'
    S.game.question = null
    S.game.questionId = null
    S.game.questionLevel = null
    S.game.timerEnd = null
    S.game.timerRunning = false
    S.game.questionCount = 0
    S.game.roundPhase = 'question'
    S.game.settlementData = null
    S.game._matchAnalysis = ''
    S.penalty = null
    S.vote = null
    S.game._lastDirections = null

    if (round === 3) {
      stateManager.clearLogs('第三轮前上下文清理，保证中立匹配')
    }

    stateManager.appendLog({ type: 'round_start', round })
    stateManager.saveSession()

    return {
      round,
      roundName: C.ROUND_NAMES[round],
      timerDuration: C.TIMER_SECONDS,
      contextCleared: round === 3
    }
  }

  function getQuestionsForRound(round) {
    if (round === 1) {
      const playerCount = S.players.filter(p => p.joined && !p.isHost).length
      return (playerCount * 2) || 4
    }
    return C.QUESTIONS_PER_ROUND[round] || 3
  }

  function isRoundComplete() {
    const limit = getQuestionsForRound(S.room.round)
    return (S.game.questionCount || 0) >= limit
  }

  function endRound(roundSummary) {
    S.game.roundPhase = 'settlement'
    S.game.settlementData = roundSummary || null
    // Jealousy calc at end of round 1
    if (S.room.round === 1) {
      const engine = window.MatchCalc
      if (engine) {
        S.jealousy = engine.calcJealousy(S.heat, S.crush, S.players)
        stateManager.appendLog({ type: 'jealousy_calculated', values: { ...S.jealousy } })
      }
    }
    stateManager.saveSession()
    return {
      round: S.room.round,
      questionsInRound: S.game.questionCount || 0,
      nextRound: S.room.round + 1,
      isLastRound: S.room.round >= 3,
      showJealousy: S.room.round === 1 && Object.values(S.jealousy || {}).some(v => v > 0)
    }
  }

  function nextRound() {
    const currentRound = S.room.round
    if (currentRound >= 3) return endGame()
    return startRound(currentRound + 1)
  }

  function endGame() {
    S.room.status = 'ended'
    S.game.timerRunning = false
    S.game.roundPhase = 'ended'
    stateManager.appendLog({ type: 'game_ended' })
    stateManager.saveSession()

    const topPairs = Object.entries(S.heat)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)

    return {
      ended: true,
      finalPairs: topPairs,
      heat: { ...S.heat },
      players: S.players.filter(p => p.joined)
    }
  }

  function getCurrentRoundConfig() {
    const r = S.room.round
    return {
      round: r,
      name: C.ROUND_NAMES[r],
      questionCount: getQuestionsForRound(r),
      timerDuration: C.TIMER_SECONDS,
      allowSteal: r === 3,
      allowDeepQuestions: r === 3,
      showMatchResults: true
    }
  }

  return { startRound, nextRound, endGame,
    getQuestionsForRound, isRoundComplete, endRound }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createRoundManager }
} else {
  window.RoundManager = { createRoundManager }
}
})()
