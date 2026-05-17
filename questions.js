/**
 * 三六局 V2 — 题库（已废弃固定题库，题由 AI 全量生成）
 * 仅保留工具函数和词库供 fallback 使用。
 */
window.QUESTIONS_DATA = (function() {
  // 本地兜底问题（当 AI 超时/失败时使用）
  const FALLBACK_QS = {
    1: [ // 信息采集
      '如果你可以瞬间去任何地方，你会去哪里？',
      '你最近做过最让自己开心的事是什么？',
      '用三个词形容你现在的心情',
      '如果能和任何一个名人共进晚餐，你会选谁？',
      '你手机里最近一张照片拍的是什么？',
      '你最喜欢什么季节？为什么？',
      '你今天过得怎么样？用一个词描述',
    ],
    2: [ // 当下匹配
      '你觉得在场谁的穿搭最好看？',
      '你此刻最想做什么？',
      '对在场谁的印象最深？为什么？',
      '你觉得朋友之间最重要的是什么？',
      '你现在最想感谢的人是谁？',
    ],
    3: [ // 人性博弈
      '你觉得自己人生中最需要修复的一段关系是什么？',
      '你内心深处最想要的是什么？',
      '你觉得什么是真正的自由？',
      '十年后的你回头看今天，你最希望自己明白了什么？',
      '你什么时候觉得自己真正长大了？',
    ]
  }

  const WORD_CATEGORIES = ['夏天', '幸福', '旅行', '冒险', '家', '朋友', '爱情', '未来', '勇气', '梦想']

  function shuffle(arr) {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  function drawFallback(round) {
    const pool = FALLBACK_QS[round] || FALLBACK_QS[1]
    return shuffle(pool)[0]
  }

  return { FALLBACK_QS, WORD_CATEGORIES, shuffle, drawFallback }
})()
