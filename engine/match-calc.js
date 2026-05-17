/**
 * 三六局 V2 — 匹配度计算引擎
 * 纯算法，无平台依赖。
 * 输入：玩家列表、回答数据、AI 评分
 * 输出：heat, crush, jealousy 等匹配指标
 */
(function() {
const C = window.CONSTANTS

function createMatchCalc(stateManager) {
  const S = stateManager.state

  /**
   * 计算 or 更新匹配度 (heat)
   * @param {string} pairKey - 'a-b' 格式
   * @param {number} delta - 变化量
   */
  function updateHeat(pairKey, delta) {
    S.heat[pairKey] = Math.max(C.HEAT_MIN, Math.min(C.HEAT_MAX, (S.heat[pairKey] || 0) + delta))
    return S.heat[pairKey]
  }

  /**
   * 计算嫉妒值
   * 规则：如果 A 心仪 B，但 B 与 C 的匹配度很高，A 产生嫉妒
   */
  function calcJealousy(heat, crush, players) {
    const result = {}
    const topPairs = Object.entries(heat)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)

    players.filter(p => p.joined && !p.isHost).forEach(p => {
      const crushes = crush[p.id] || []
      let jValue = 0

      topPairs.forEach(([key, val]) => {
        const [a, b] = key.split('-').map(Number)
        if (crushes.includes(a) && b !== p.id && val > 30) jValue += 1
        if (crushes.includes(b) && a !== p.id && val > 30) jValue += 1
      })

      if (jValue > 0) result[p.id] = jValue
    })

    return result
  }

  /**
   * 隐蔽挖墙脚：通过回答悄悄提升与目标匹配度
   */
  function stealthBoost(playerId, targetId, answerQuality) {
    const key = C.heatKey(playerId, targetId)
    const boost = Math.round(answerQuality * 15) // 0-15 boost
    const oldVal = S.heat[key] || 0
    const newVal = updateHeat(key, boost)

    S.game.sparks[`${playerId}-${targetId}`] = {
      from: playerId, to: targetId,
      boost, oldVal: oldVal, newVal: newVal,
      stealth: true
    }

    return { success: boost > 8, boost, newVal }
  }

  /**
   * 获取 top N 匹配对
   */
  function getTopPairs(n = 3) {
    return Object.entries(S.heat)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([key, val]) => {
        const [a, b] = key.split('-').map(Number)
        return { a, b, key, score: val }
      })
  }

  return {
    updateHeat, calcJealousy, stealthBoost, getTopPairs
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createMatchCalc }
} else {
  window.MatchCalc = { createMatchCalc }
}
})()
