/**
 * 三六局 V2 — 惩罚引擎
 * 阈值检测 + 候选生成 + 投票决议
 * pool_rise → 亲密惩罚, pool_fall → 公开惩罚
 */
(function() {
const C = window.CONSTANTS

function createPenaltyEngine(stateManager) {
  const S = stateManager.state

  /**
   * 检测是否触发惩罚阈值
   * @returns {Array} 触发的惩罚事件 [{ pairKey, type: 'rise'|'fall', a, b, value }]
   */
  function checkThresholds() {
    const triggers = []
    const entries = Object.entries(S.heat)

    entries.forEach(([key, val]) => {
      if (val >= C.RISE_THRESHOLD) {
        const [a, b] = key.split('-').map(Number)
        triggers.push({ pairKey: key, type: 'rise', a, b, value: val })
      }
      if (val <= C.FALL_THRESHOLD && val > 0) {
        const [a, b] = key.split('-').map(Number)
        triggers.push({ pairKey: key, type: 'fall', a, b, value: val })
      }
    })

    return triggers
  }

  /**
   * 为指定类型生成投票候选列表
   * @param {string} type - 'rise' | 'fall'
   * @param {number} count - 候选数量
   */
  function generateCandidates(type, count = 5) {
    const engine = window.PENALTIES_ENGINE
    if (!engine) return []
    return engine.drawCandidates(type, count)
  }

  /**
   * 解析投票结果
   * @param {Array} candidates - 候选列表
   * @param {Object} votes - { playerId: candidateIndex }
   */
  function resolveVote(candidates, votes) {
    if (!candidates || !votes) return null

    candidates.forEach(c => { c.votes = 0 })
    Object.values(votes).forEach(idx => {
      if (candidates[idx]) candidates[idx].votes++
    })

    const winner = candidates.reduce((a, b) => a.votes >= b.votes ? a : b, candidates[0])
    return { winner, tally: winner.votes, candidates }
  }

  /**
   * 执行惩罚
   * @param {Object} trigger - 惩罚触发事件
   * @param {Object} winner - 投票胜出的惩罚
   */
  function executePenalty(trigger, winner) {
    const [a, b] = trigger.pairKey.split('-').map(Number)
    const penalty = {
      type: trigger.type,
      pair: [a, b],
      selected: {
        label: winner.label,
        icon: winner.icon,
        text: winner.text
      },
      executedAt: Date.now()
    }
    S.penalty = penalty
    stateManager.appendLog({ type: 'penalty_executed', penalty })
    return penalty
  }

  return { checkThresholds, generateCandidates, resolveVote, executePenalty }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createPenaltyEngine }
} else {
  window.PenaltyEngine = { createPenaltyEngine }
}
})()
