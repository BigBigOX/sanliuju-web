const { createClient } = require('@supabase/supabase-js')
const sb = createClient('https://qrqhooyjbynicwycttfi.supabase.co', 'sb_publishable_LhnO7BuftYRFwignp2fGtA_m_c0Gkxl')
const roomId = process.argv[2] || '466927'
const ROUND_NAMES = {1:'破冰轮',2:'结对轮',3:'默契轮'}

let msgs = 0, questions = [], alerts = [], state = {}

function ts() { return new Date().toLocaleTimeString() }
function log(icon, msg) { console.log(`[${ts()}] ${icon} ${msg}`) }
function warn(msg) { alerts.push({time: ts(), msg}); console.log(`[${ts()}] 🚨 ${msg}`) }

const L1_KW=['旅行','音乐','电影','宠物','美食','兴趣','季节','动画','歌曲','天气','运动','下厨','照片','手机','购物']
const L2_KW=['朋友','信任','梦想','感动','骄傲','欣赏','家人','建议','关系','陪伴','改观','角色','习惯','感谢','主动']
const L3_KW=['孤独','哭','秘密','害怕','误解','遗憾','焦虑','愧疚','伤害','放弃','自卑','示弱','脆弱','生气']
const L4_KW=['生命','意义','自由','命运','灵魂','死亡','价值观','改变','成长','内心','传承','幸福','选择','本质']
function guessLevel(q) {
  let s = {L1:0,L2:0,L3:0,L4:0}
  L1_KW.forEach(w=>{if(q.includes(w))s.L1++})
  L2_KW.forEach(w=>{if(q.includes(w))s.L2++})
  L3_KW.forEach(w=>{if(q.includes(w))s.L3++})
  L4_KW.forEach(w=>{if(q.includes(w))s.L4++})
  const best = Object.entries(s).sort((a,b)=>b[1]-a[1])[0]
  return best[1]>0 ? best[0] : null
}

function handle(msg) {
  msgs++
  const {type, from, data} = msg
  if (from && from.startsWith('debug')) return

  if (type === 'ROOM_STATE' && data) {
    state = { room: data.room, players: data.players, game: data.game, heat: data.heat||{}, crush: data.crush||{}, jealousy: data.jealousy||{}, vote: data.vote || null }
    const joined = (data.players||[]).filter(p=>p.joined)
    log('📡', `ROOM_STATE: ${data.room.status} 轮${data.room.round} 玩家${joined.length}/${data.room.maxPlayers}`)
    joined.forEach(p => log('  👤', `${p.avatar||'?'} ${p.nickname||p.id} ${p.isHost?'👑':''} 🪙${p.coins||0}`))
    const h = data.heat||{}
    const pairs = Object.entries(h).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,5)
    if (pairs.length) pairs.forEach(([k,v])=>{
      const [a,b]=k.split('-'); const pa = joined.find(x=>x.id==a), pb = joined.find(x=>x.id==b)
      log('  🌡️', `${pa?.nickname||a} ↔ ${pb?.nickname||b}: ${v}`)
    })
  }

  if (type === 'PLAYER_JOINED') {
    const nm = data.nickname || data.playerId
    log('🚪', `玩家加入: ${data.avatar||''} ${nm} (#${data.playerId})`)
    const all = (state.players||[]).filter(p=>p.joined)
    if (all.length >= 3) log('  ✅', `已够${all.length}人，可以开局`)
  }

  if (type === 'GAME_STARTED') {
    log('▶️', `游戏开始! 第${data.round}轮 «${ROUND_NAMES[data.round]}»`)
    const joined = (state.players||[]).filter(p=>p.joined).length
    if (joined < 3) warn(`开局时仅${joined}人!`)
  }

  if (type === 'QUESTION') {
    const q = data.question||'', lvl = data.level||'?', round = state.room?.round||0
    questions.push({ round, level: lvl, text: q })
    log('🎲', `出题 [L${lvl}]: ${q}`)
    const guessed = guessLevel(q)
    let ok = true
    if (round===1 && guessed && !['L1'].includes(guessed)) ok=false
    if (round===3 && guessed && !['L3','L4'].includes(guessed)) ok=false
    if (!ok) warn(`题目深度不匹配: 轮${round} 预期${round===1?'L1':'L3/L4'} 检测${guessed} — "${q.slice(0,30)}"`)
    if (q.length < 8) warn(`题目过短(${q.length}字): ${q}`)
    if (q.length > 60) log('  ⚠️', `题目偏长(${q.length}字)`)
    if (lvl === 'AI') log('  🤖', 'AI生成')
  }

  if (type === 'HEART' || type === 'SPARK') {
    const nm = data.nickname || data.playerId, gain = type==='HEART'?10:20
    log(type==='HEART'?'❤️':'🔥', `${nm} 送出 +${gain}热度`)
  }

  if (type === 'HEAT_UPDATED') {
    const vals = Object.values(data.heat||{})
    if (vals.some(v=>v>100)) warn('热度值超限 >100!')
    if (vals.some(v=>v<0)) warn('热度值为负!')
  }

  if (type === 'CHOICE_PICK') {
    log('🔄', `玩家${data.playerId} 选${data.choice}`)
    if (state.room?.round!==2) warn('二选一在非配对轮触发!')
  }

  if (type === 'STEAL_ATTEMPT') {
    log('🗡️', `玩家${data.playerId} 挖墙脚!`)
    if (state.room?.round!==2) warn('挖墙脚在非配对轮!')
  }

  if (type === 'JEALOUSY_UPDATED') {
    log('😈', `嫉妒值: ${JSON.stringify(data.jealousy)}`)
  }

  if (type === 'VOTE_START') {
    log('📊', `投票: ${data.vtype} ${data.candidates?.length||0}候选`)
  }

  if (type === 'VOTE_CAST') {
    log('✏️', `玩家${data.playerId} 投票`)
  }

  if (type === 'VOTE_RESULT') {
    const w = data.winner
    log('🏆', `投票结果: ${w?.candidate?.icon} ${w?.candidate?.label}`)
    if (w?.tally) log('  📊', JSON.stringify(w.tally))
  }

  if (type === 'ROUND_CHANGED') {
    log('⏭️', `→ 第${data.round}轮 «${ROUND_NAMES[data.round]}»`)
    if (data.round<1||data.round>3) warn(`轮次异常: ${data.round}`)
  }

  if (type === 'GAME_ENDED') {
    log('🏁', '游戏结束!')
    const top3 = Object.entries(data.heat||{}).sort((a,b)=>b[1]-a[1]).slice(0,3)
    log('  💕', `TOP3: ${top3.map(([k,v])=>k+':'+v).join(' | ')}`)
    if (alerts.length) {
      log('  📋', `共${alerts.length}条告警:`)
      alerts.forEach(a => log('    ', a.msg))
    }
  }

  if (type === 'AI_SAY') {
    log('🤖', `AI: ${(data.text||'').slice(0,80)}`)
  }

  if (type === 'TIMER_TICK' && (data.timerRemaining||0) <= 0) {
    log('⏰', '计时结束')
  }

  if (type === 'COINS_UPDATED') log('🪙', '暖心值更新')
}

const ch = sb.channel('room:' + roomId)
ch.on('broadcast', { event: 'msg' }, (payload) => handle(payload.payload))
ch.subscribe((status) => {
  if (status === 'SUBSCRIBED') log('🔌', `已连接房间 ${roomId}`)
  if (status === 'CHANNEL_ERROR') log('❌', `频道错误: ${status}`)
  if (status === 'CLOSED') log('🔌', '连接关闭')
})
