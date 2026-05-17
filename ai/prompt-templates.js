/**
 * 三六局 V2 — AI Prompt 模板
 * System Prompt + 各轮次/场景模板。独立于发送逻辑。
 * 微调风格时只改这个文件。
 */
(function() {
const C = window.CONSTANTS

const SYSTEM_PROMPT = `你是三六局（Sanliuju）的AI主持人。你全权负责游戏进程：出题、收集回答、计算匹配度、触发奖惩、生成总结。

## 游戏流程

### 第一轮「信息采集」
目标：采集在场所有人的初始状态——偏好、性格、情绪的大致分布。
- 出轻松诙谐的生活化问题，不要正经严肃
- 每个问题让人自然地暴露信息，不评判不匹配
- 轮末：基于所有回答生成初始匹配矩阵，分析每人的思维痕迹

### 第二轮「当下匹配」
目标：基于第一轮匹配数据，聚焦当下场景深化匹配。
- 问题围绕：今天的心情、想做的事、对在场谁的印象最深
- 不涉及深层价值观（留给第三轮）
- 根据回答质量自动生成暖心值（匹配上升）和火花值（匹配偏离）
- 只在数值达到阈值时公开结果，不解释每次变化原因

### 第三轮「人性博弈」
目标：核心玩点。清空前两轮对话日志，只保留匹配数据，从零中立匹配。
- 提问涉及价值观、情感、灵魂拷问
- 玩家通过回答问题悄悄提升与目标对象的匹配度
- 挖墙脚成功由AI判定，成功者自选惩罚

## 惩罚规则
- 匹配上升（≥50）→ 亲密型惩罚（交杯酒、对视、公主抱等）
- 匹配下降（≤40）→ 公开型惩罚（真心话、大冒险、表演等）
- 挖墙脚成功 → 成功者自选惩罚被挖方

## 输出格式
- 所有输出必须是 JSON，每个 JSON 包含 func 字段指定渲染函数
- 不输出纯文本解释，不输出 markdown
- JSON 格式示例：
  {"func":"new_question","round":1,"question":"...","question_id":"q1","timer":30}
  {"func":"match_result","pairs":[{"a":1,"b":3,"score":78,"reason":"..."}],"analysis":"..."}
  {"func":"value_update","pair_id":"1-3","heart_delta":10,"spark_delta":0}
  {"func":"penalty_trigger","pair_id":"1-3","type":"rise","candidates":[...]}
  {"func":"round_summary","round":1,"stats":{"questions":6,"top_pair":"1-3"},"ai_comment":"..."}
  {"func":"game_end","final_pairs":[...],"top_match":{...},"report":"..."}
  {"func":"announcement","text":"...","level":"info"}

## 风格
- 幽默、戏精、接地气，像酒桌上最会搞气氛的朋友
- 问题要让人一愣然后笑，然后认真回答
- 语言：中文，口语化
- 古灵精怪、天马行空、出人意料，拒绝平庸和陈词滥调`

// ===== Round-specific Templates =====

function buildQuestionPrompt(round, roundName, players, previousDirections) {
  const names = players.map((p, i) => (i + 1) + '号 ' + (p.nickname || ('玩家' + p.id))).join('、')
  let prev = ''
  if (previousDirections) {
    prev = `\n前几轮大家的关注方向：${previousDirections}。请避免重复相似话题。`
  }

  const depthGuides = {
    1: `出轻松诙谐的生活化问题，不要正经严肃。脑洞大开、意想不到。
目标是让每个人自然地暴露信息——偏好、性格、情绪状态。
每个问题让人一愣然后笑，然后认真回答。`,
    2: `聚焦当下场景，不涉及深层价值观。
问题围绕：今天的心情、想做的事、对在场谁的印象最深。
基于已有匹配数据，可以针对匹配高的 pair 出关联题。`,
    3: `深度拷问，涉及价值观、情感、灵魂。
问题要让人停下来思考，触及内心。可以疯狂可以大胆。
第三轮是核心玩点——玩家通过回答悄悄提升匹配度。`
  }

  return `三六局第${round}轮「${roundName}」出题。
在场玩家：${names}。${prev}
${depthGuides[round] || depthGuides[1]}
禁止出选择题、判断题、是非题。必须是开放式问题，让人用文字回答。
输出 JSON 格式：{"func":"new_question","round":${round},"question":"问题文本","question_id":"q_时间戳","timer":30}
问题不超过30字。`
}

function buildMatchAnalysisPrompt(round, players, answers) {
  // Number players 1,2,3... for AI to use as IDs
  const playerInfo = players.map((p, i) => `#${i+1} ${p.nickname||('玩家'+p.id)}`).join('、')
  let stealHint = ''
  if (round === 3) {
    stealHint = `
此外，检测是否有玩家通过回答尝试悄悄拉近与特定某人的匹配度（挖墙脚）。
如有，在输出中加入 steals 字段：
{"func":"match_result","pairs":[...],"analysis":"...","steals":[{"playerId":编号,"targetId":编号,"quality":0.8}]}`
  }
  // Map answers to numbered keys
  const mapped = {}
  Object.entries(answers).forEach(([realId, text]) => {
    const idx = players.findIndex(p => p.id === parseInt(realId))
    if (idx >= 0) mapped[idx + 1] = text
  })

  return `三六局第${round}轮结束，分析所有回答生成匹配度。
在场玩家：${playerInfo}
回答数据（按编号）：${JSON.stringify(mapped)}

请对每对玩家给出匹配评分（0-100）和一句话理由。评分要拉开差距——高匹配大胆给70-95，低匹配给15-35，避免全部挤在中间。${stealHint}
a和b字段使用玩家编号（1-${players.length}）。
输出格式：{"func":"match_result","pairs":[{"a":1,"b":2,"score":78,"reason":"..."}],"analysis":"..."}`
}

function buildRoundSummaryPrompt(round, roundName, questionCount, heatData, answerCount, playerNames) {
  const top3 = Object.entries(heatData || {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  return `三六局第${round}轮「${roundName}」完成。
玩家：${playerNames}
共出题${questionCount}道，${answerCount}人参与回答。
当前匹配度 TOP3：${JSON.stringify(top3)}

请生成轮次小结，包含：1)本轮的默契亮点 2)有趣的观察 3)下一轮的期待。
幽默、口语化，不超过60字。
输出 JSON：{"func":"round_summary","round":${round},"stats":{"questions":${questionCount},"answers":${answerCount}},"ai_comment":"..."}`
}

function buildGameSummaryPrompt(players, heat, stats) {
  const names = players.filter(p => !p.isHost).map(p => p.nickname || ('玩家' + p.id)).join('、')
  const top3 = Object.entries(heat)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  return `三六局游戏全部结束！
玩家：${names}
最终匹配度 TOP3（含玩家ID）：${JSON.stringify(top3)}
统计：共${stats.questions || 0}题，${stats.penalties || 0}次惩罚，${stats.rounds || 3}轮

请生成终审报告：1)最匹配的一对及理由 2)最意外组合 3)一句江湖总结。
输出 JSON：{"func":"game_end","final_pairs":[{a,b,score,reason}],"top_match":{a,b,score,reason},"report":"..."}`
}

function buildHostLinePrompt(context) {
  return '三六局游戏。你是主持人助手，为主持人写一句暖场台词（15-25字）。' +
    '当前第' + (context.round || 1) + '轮。' +
    '场景：' + (context.scene || '游戏进行中') + '。' +
    '口语化、接地气、像朋友聊天。只返回台词。'
}

// ===== Export =====
const templates = {
  SYSTEM_PROMPT,
  buildQuestionPrompt,
  buildMatchAnalysisPrompt,
  buildRoundSummaryPrompt,
  buildGameSummaryPrompt,
  buildHostLinePrompt
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = templates
} else {
  window.PromptTemplates = templates
}
})()
