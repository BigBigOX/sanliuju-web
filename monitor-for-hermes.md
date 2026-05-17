```javascript
/**
 * 三六局 — 后台监控 & 数据采集
 * 用法: node monitor.js <roomId> [--quiet] [--report]
 *   --quiet   只输出告警，不输出普通日志
 *   --report  游戏结束后生成完整 JSON 报告
 */
const { createClient } = require('@supabase/supabase-js')
const sb = createClient('https://qrqhooyjbynicwycttfi.supabase.co', 'sb_publishable_LhnO7BuftYRFwignp2fGtA_m_c0Gkxl')
const roomId = process.argv[2] || process.env.ROOM || '255811'
const quiet = process.argv.includes('--quiet')
const genReport = process.argv.includes('--report')
const jsonl = process.argv.includes('--jsonl')
const fs = require('fs')

const AI_KEY = 'sk-e467b082e88444d49f178dfab577477f'
const AI_BASE = 'https://api.deepseek.com/v1'
const ROUND_NAMES = {1:'破冰轮',2:'结对轮',3:'默契轮'}

// ---- Data Collection ----
const log = []
const alerts = []
const state = { room: null, players: [], game: null, heat: {}, jealousy: {} }
const stats = {
  startedAt: null, endedAt: null,
  questions: [],       // { round, level, text, timestamp }
  hearts: [],          // { from, to, nickname, timestamp }
  sparks: [],          // { from, to, nickname, timestamp }
  steals: [],          // { playerId, timestamp }
  votes: [],           // { type, winner, tally, timestamp }
  penalties: [],       // { icon, label, text, timestamp }
  aiComments: [],      // { text, timestamp }
  heatSnapshots: [],   // periodic heat state
  playerJoins: [],     // { playerId, nickname, avatar, timestamp }
  roundTransitions: [],// { from, to, timestamp }
  errors: []           // detected anomalies
}

// ---- Helpers ----
function ts() { return new Date().toLocaleTimeString() }
function now() { return Date.now() }
function emit(type, data) {
  if (jsonl) console.log(JSON.stringify({ time: ts(), type, ...data }))
}
function log_(icon, msg) { if (!quiet && !jsonl) console.log(`[${ts()}] ${icon} ${msg}`) }
function warn(code, msg) {
  alerts.push({ time: ts(), code, msg })
  stats.errors.push({ time: ts(), code, msg })
  emit('ALERT', { code, message: msg })
  if (!jsonl) console.log(`[${ts()}] 🚨 ${code}: ${msg}`)
}
function record(event) { log.push({ ...event, ts: now() }) }

// ---- AI Analysis ----
async function askAI(prompt) {
  try {
    const resp = await fetch(AI_BASE + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AI_KEY },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是三六局聚会游戏的后台裁判。分析游戏数据，发现规则漏洞、平衡问题、异常行为。简洁专业，每条建议一句话。' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 200, temperature: 0.3
      }),
      signal: AbortSignal.timeout(15000)
    })
    if (!resp.ok) return null
    const data = await resp.json()
    return data.choices?.[0]?.message?.content?.trim() || null
  } catch (_) { return null }
}

function aiAudit(label, context) {
  const pNames = {}
  state.players?.filter(p => p.joined).forEach(p => { pNames[p.id] = p.nickname || ('玩家'+p.id) })
  const prompt = `[${label}] 玩家:${JSON.stringify(pNames)} 轮次:${state.room?.round||0} 热度:${JSON.stringify(state.heat||{})} 嫉妒:${JSON.stringify(state.jealousy||{})} 题目数:${stats.questions.length} ${context||''}。分析游戏状态，指出不合理之处。`
  askAI(prompt).then(result => {
    if (result) {
      const lines = result.split('\n').filter(l => l.trim())
      lines.forEach(l => {
        const text = l.trim()
        if (!jsonl) console.log(`[${ts()}] ⚖️ 裁判: ${text}`)
        emit('AI_AUDIT', { label, text })
      })
      record({ type: 'AI_AUDIT', label, result })
    }
  })
}

// ---- Keyword-based Question Level Detection ----
const L1_KW = ['旅行','音乐','电影','宠物','美食','兴趣','季节','动画','歌曲','天气','运动','下厨','照片','手机','购物','超能力','技能','周末','假期','童年','礼物','emoji','颜色']
const L2_KW = ['朋友','信任','梦想','感动','骄傲','欣赏','家人','建议','关系','陪伴','改观','角色','习惯','感谢','主动','团队','安慰','暖心','改观','记忆']
const L3_KW = ['孤独','哭','秘密','害怕','误解','遗憾','焦虑','愧疚','伤害','放弃','自卑','示弱','脆弱','生气','爱','心痛','后悔','原谅','伤害']
const L4_KW = ['生命','意义','自由','命运','灵魂','死亡','价值观','改变','成长','内心','传承','幸福','选择','本质','人生','墓志铭','信仰','轮回','宇宙','时间']

function guessLevel(q) {
  let s = {L1:0,L2:0,L3:0,L4:0}
  L1_KW.forEach(w => { if (q.includes(w)) s.L1++ })
  L2_KW.forEach(w => { if (q.includes(w)) s.L2++ })
  L3_KW.forEach(w => { if (q.includes(w)) s.L3++ })
  L4_KW.forEach(w => { if (q.includes(w)) s.L4++ })
  const best = Object.entries(s).sort((a,b) => b[1]-a[1])[0]
  return best[1] > 0 ? best[0] : null
}

// ---- Message Handler ----
function handle(msg) {
  const { type, from, data } = msg
  if (from && from.startsWith('debug')) return

  record({ type, from, data: JSON.parse(JSON.stringify(data)) })

  switch (type) {

    case 'ROOM_STATE':
      state.room = data.room
      state.players = data.players || []
      state.game = data.game
      state.heat = data.heat || {}
      const joined = (data.players || []).filter(p => p.joined)
      log_('📡', `ROOM_STATE: ${data.room.status} 轮${data.room.round} 玩家${joined.length}/${data.room.maxPlayers}`)
      joined.forEach(p => log_('  👤', `${p.avatar||'?'} ${p.nickname||p.id} ${p.isHost?'👑':''} 🪙${p.coins||0}`))
      const pairs = Object.entries(data.heat || {}).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1]).slice(0, 5)
      if (pairs.length) pairs.forEach(([k, v]) => {
        const [a, b] = k.split('-')
        const pa = joined.find(x => x.id == a), pb = joined.find(x => x.id == b)
        log_('  🌡️', `${pa?.nickname||a} ↔ ${pb?.nickname||b}: ${v}`)
      })
      break

    case 'PLAYER_JOINED':
      stats.playerJoins.push({ playerId: data.playerId, nickname: data.nickname, avatar: data.avatar, timestamp: now() })
      emit('PLAYER_JOINED', { playerId: data.playerId, nickname: data.nickname, avatar: data.avatar })
      log_('🚪', `加入: ${data.avatar||''} ${data.nickname||data.playerId} (#${data.playerId})`)
      break

    case 'GAME_STARTED':
      stats.startedAt = now()
      emit('GAME_STARTED', { round: data.round, roundName: ROUND_NAMES[data.round] })
      log_('▶️', `游戏开始! 第${data.round}轮 «${ROUND_NAMES[data.round]}»`)
      if ((state.players||[]).filter(p => p.joined).length < 3) warn('FEW_PLAYERS', '开局时不足3人')
      break

    case 'QUESTION':
      stats.questions.push({ round: state.room?.round || 0, level: data.level, text: data.question || '', timestamp: now() })
      emit('QUESTION', { round: state.room?.round, level: data.level, question: data.question, ai: data.level === 'AI' })
      log_('🎲', `出题 [L${data.level}]: ${data.question}`)
      // Depth check
      const guessed = guessLevel(data.question || '')
      const round = state.room?.round || 0
      if (round === 1 && guessed && !['L1'].includes(guessed))
        warn('DEPTH_MISMATCH', `轮${round}题疑似${guessed}级: "${(data.question||'').slice(0, 30)}"`)
      if (round === 3 && guessed && guessed === 'L1')
        warn('DEPTH_TOO_SHALLOW', `轮3题疑似L1级: "${(data.question||'').slice(0, 30)}"`)
      if ((data.question || '').length < 8)
        warn('QUESTION_TOO_SHORT', `题目过短(${data.question.length}字): ${data.question}`)
      if ((data.question || '').length > 60)
        log_('  ⚠️', `偏长(${data.question.length}字)`)
      break

    case 'HEART':
      stats.hearts.push({ from: data.playerId, to: data.targetId, nickname: data.nickname, timestamp: now() })
      emit('HEART', { from: data.playerId, to: data.targetId, nickname: data.nickname })
      log_('❤️', `${data.nickname||data.playerId} → 玩家${data.targetId}`)
      break

    case 'SPARK':
      stats.sparks.push({ from: data.playerId, to: data.targetId, nickname: data.nickname, timestamp: now() })
      emit('SPARK', { from: data.playerId, to: data.targetId, nickname: data.nickname })
      log_('🔥', `${data.nickname||data.playerId} → 玩家${data.targetId}`)
      break

    case 'HEAT_UPDATED':
      stats.heatSnapshots.push({ heat: { ...data.heat }, timestamp: now() })
      const vals = Object.values(data.heat || {})
      if (vals.some(v => v > 100)) warn('HEAT_OVERFLOW', '热度值超限 >100')
      if (vals.some(v => v < 0)) warn('HEAT_NEGATIVE', '热度值为负')
      break

    case 'CHOICE_PICK':
      log_('🔄', `玩家${data.playerId} 选${data.choice}`)
      if (state.room?.round !== 2) warn('WRONG_ROUND', '二选一在非结对轮触发')
      break

    case 'STEAL_ATTEMPT':
      stats.steals.push({ playerId: data.playerId, timestamp: now() })
      emit('STEAL', { playerId: data.playerId })
      log_('🗡️', `玩家${data.playerId} 挖墙脚`)
      if (state.room?.round !== 2) warn('WRONG_ROUND', '挖墙脚在非结对轮')
      break

    case 'JEALOUSY_UPDATED':
      state.jealousy = data.jealousy || {}
      log_('😈', `嫉妒值: ${JSON.stringify(data.jealousy)}`)
      break

    case 'VOTE_START':
      log_('📊', `投票: ${data.vtype} ${data.candidates?.length||0}候选`)
      break

    case 'VOTE_CAST':
      log_('✏️', `玩家${data.playerId} 投票`)
      break

    case 'VOTE_RESULT':
      stats.votes.push({ type: state.vote?.type, winner: data.winner, tally: data.winner?.tally, timestamp: now() })
      emit('VOTE_RESULT', { type: state.vote?.type, winner: data.winner?.candidate?.label, tally: data.winner?.tally })
      log_('🏆', `投票结果: ${data.winner?.candidate?.icon} ${data.winner?.candidate?.label}`)
      // Check if penalty target is always the same person
      if (stats.votes.length >= 3) {
        const last3 = stats.votes.slice(-3)
        const labels = last3.map(v => v.winner?.candidate?.label).filter(Boolean)
        if (new Set(labels).size === 1) warn('PENALTY_BULLY', `连续${last3.length}次惩罚同一目标: ${labels[0]}`)
      }
      break

    case 'PENALTY_SELECTED':
      stats.penalties.push({ icon: data.penalty?.icon, label: data.penalty?.label, text: data.penalty?.text, timestamp: now() })
      break

    case 'ROUND_CHANGED':
      stats.roundTransitions.push({ from: state.room?.round, to: data.round, timestamp: now() })
      emit('ROUND_CHANGED', { from: state.room?.round, to: data.round, roundName: ROUND_NAMES[data.round] })
      log_('⏭️', `→ 第${data.round}轮 «${ROUND_NAMES[data.round]}»`)
      if (data.round < 1 || data.round > 3) warn('ROUND_OUT_OF_RANGE', `轮次异常: ${data.round}`)
      // AI audit on round transition
      setTimeout(() => aiAudit(`进入第${data.round}轮`, `本轮已出题${stats.questions.filter(q=>q.round===data.round).length}道`), 2000)
      break

    case 'GAME_ENDED':
      stats.endedAt = now()
      emit('GAME_ENDED', { heat: data.heat, questions: stats.questions.length, alerts: alerts.length })
      log_('🏁', '游戏结束!')
      const top3 = Object.entries(data.heat || {}).sort((a, b) => b[1] - a[1]).slice(0, 3)
      log_('  💕', `TOP3: ${top3.map(([k, v]) => k + ':' + v).join(' | ')}`)

      // Summary stats
      const duration = stats.endedAt - stats.startedAt
      log_('  📊', `共${stats.questions.length}题 ${stats.hearts.length}暖心 ${stats.sparks.length}火花 ${stats.steals.length}挖墙脚 ${alerts.length}告警 耗时${Math.round(duration/1000)}s`)

      if (alerts.length) {
        console.log(`\n=== 🚨 告警汇总 (${alerts.length}条) ===`)
        alerts.forEach(a => console.log(`  [${a.time}] ${a.code}: ${a.msg}`))
      }

      // AI final audit
      const summary = `游戏结束。${stats.questions.length}题，${stats.hearts.length}心，${stats.sparks.length}火，${stats.steals.length}挖墙脚，${alerts.length}告警。各轮题目：${JSON.stringify(stats.questions.map(q=>`轮${q.round}[${q.level}]${q.text.slice(0,20)}`))}。热度前三：${top3.map(([k,v])=>k+':'+v).join(',')}。`
      askAI(`[游戏结束总结] ${summary} 请从规则设计角度分析：1)是否有不平衡 2)是否有漏洞 3)建议如何改进。每条一句话。`).then(result => {
        if (result) {
          emit('AI_FINAL_AUDIT', { result })
          if (!jsonl) {
            console.log(`\n=== ⚖️ AI 裁判终审 ===`)
            console.log(result)
          }
          record({ type: 'AI_FINAL_AUDIT', result })
        }
        // Save report
        if (genReport) saveReport(summary)
      })
      break

    case 'AI_SAY':
      stats.aiComments.push({ text: data.text || '', timestamp: now() })
      log_('🤖', `AI: ${(data.text || '').slice(0, 80)}`)
      break

    case 'AI_THINKING':
      if (data.thinking) log_('🤖', 'AI 出题中…')
      break

    case 'PLAYER_ANSWERED':
      log_('✅', `玩家${data.playerId} 已回答`)
      break

    case 'TIMER_TICK':
      if ((data.timerRemaining || 0) <= 0) log_('⏰', '计时结束')
      break

    case 'PENALTY_CANDIDATES':
      log_('🎲', `惩罚候选: ${data.candidates?.length||0}个`)
      break

    case 'COINS_UPDATED':
      log_('🪙', '暖心值更新')
      break

    case 'ROOM_STATE_REQUEST':
      log_('📡', `状态请求 from ${from}`)
      break
  }
}

function saveReport(summary) {
  const filename = `game-report-${roomId}.json`
  const report = {
    roomId,
    monitoredAt: new Date().toISOString(),
    duration: stats.endedAt ? Math.round((stats.endedAt - stats.startedAt) / 1000) + 's' : 'unknown',
    state: {
      players: state.players?.filter(p => p.joined).map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar })),
      finalHeat: state.heat,
      jealousy: state.jealousy
    },
    stats: {
      questions: stats.questions.length,
      hearts: stats.hearts.length,
      sparks: stats.sparks.length,
      steals: stats.steals.length,
      votes: stats.votes.length,
      penalties: stats.penalties.length,
      alerts: alerts.length
    },
    questions: stats.questions,
    hearts: stats.hearts,
    sparks: stats.sparks,
    steals: stats.steals,
    votes: stats.votes,
    penalties: stats.penalties,
    aiComments: stats.aiComments,
    roundTransitions: stats.roundTransitions,
    alerts: alerts,
    summary
  }
  fs.writeFileSync(filename, JSON.stringify(report, null, 2), 'utf-8')
  emit('REPORT_READY', { path: filename, summary })
  if (!jsonl) console.log(`\n📁 报告已保存: ${filename}`)
}

// ---- Connect ----
const ch = sb.channel('room:' + roomId)
ch.on('broadcast', { event: 'msg' }, (payload) => handle(payload.payload))
ch.subscribe((status) => {
  if (status === 'SUBSCRIBED') {
    emit('CONNECTED', { roomId })
    if (!jsonl) {
      console.log(`[${ts()}] 🔌 监控房间 ${roomId} | ${quiet?'静默模式':'标准模式'} | 报告:${genReport?'开':'关'}`)
      console.log(`   等待游戏事件…`)
    }
  }
  if (status === 'CHANNEL_ERROR') console.log(`[${ts()}] ❌ 频道错误`)
  if (status === 'CLOSED') console.log(`[${ts()}] 🔌 连接关闭`)
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n[${ts()}] 🛑 监控结束 | 事件:${log.length} 告警:${alerts.length}`)
  if (genReport && stats.questions.length > 0) {
    saveReport(`手动终止。${stats.questions.length}题${alerts.length}告警`)
  }
  process.exit(0)
})
```
