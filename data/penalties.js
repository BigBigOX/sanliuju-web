/**
 * 三六局 V2 — 奖惩词库
 * pool_rise: 匹配上升 → 亲密惩罚
 * pool_fall: 匹配下降 → 公开惩罚
 * 支持模板持久化 (localStorage)
 */
(function() {
const DEFAULT_RISE = {
  toast:    { label: '交杯酒', icon: '🍻', items: ['手臂交叉喝一杯（没酒用水）'] },
  fingers:  { label: '十指相扣', icon: '🤝', items: ['十指相扣保持到下一轮结束'] },
  gaze:     { label: '深情对视', icon: '👀', items: ['对视 15 秒，不许笑'] },
  carry:    { label: '公主抱', icon: '💪', items: ['公主抱对方 10 秒（或尽力而为）'] },
  feed:     { label: '互相喂食', icon: '🍪', items: ['轮流喂对方吃一口食物'] },
  whisper:  { label: '耳边说悄悄话', icon: '👂', items: ['在对方耳边说一句夸奖的话'] },
  selfie:   { label: '亲密自拍', icon: '🤳', items: ['脸贴脸自拍一张，发到群里'] },
  link:     { label: '手挽手', icon: '🔗', items: ['手挽手保持到本轮结束'] }
}

const DEFAULT_FALL = {
  truth:    { label: '真心话', icon: '💬', items: [
    '最近一次对谁撒了谎？说了什么？',
    '手机里最不想让人看到的 App 是什么？',
    '在场你最不想得罪的人是谁？为什么？',
    '说一个你从未告诉过任何人的秘密',
    '你最近一次心动是什么时候？对谁？',
    '你做过最尴尬的一件事是什么？',
    '如果必须在场选一个人借钱，你会选谁？',
    '上一次生气是因为什么？现在还气吗？'
  ]},
  dare:     { label: '大冒险', icon: '⚡', items: [
    '做 10 个俯卧撑（或 15 个深蹲）',
    '闭眼原地转 8 圈，然后走直线',
    '单脚站立 30 秒，失败重来',
    '不弯膝盖弯腰摸脚尖，保持 10 秒',
    '一口气念完"四是四十是十"三遍',
    '头顶一本书绕房间走一圈',
    '用反手写下自己名字，大家评分'
  ]},
  perform:  { label: '表演', icon: '🎭', items: [
    '用三种声调唱《小星星》',
    '模仿在场任意一个人，让大家猜是谁',
    '对着窗外大喊"今天太开心了"',
    '用最浮夸的方式自我介绍 30 秒',
    '跟着音乐即兴跳 20 秒'
  ]},
  social:   { label: '社交任务', icon: '🎯', items: [
    '给不在场的任意朋友发消息"我想你了"',
    '选在场一个人，说出 TA 三个优点',
    '发一条朋友圈"刚玩了三六局"不删',
    '和离你最远的人碰杯',
    '给群聊发一个 5 元红包'
  ]}
}

const STORAGE_KEY = 'penalty_templates_v2'
const LAST_USED_KEY = 'penalty_last_used_v2'

function getActivePool() {
  const template = getActiveTemplate()
  if (template && template.categories) {
    const mergedRise = { ...DEFAULT_RISE }
    const mergedFall = { ...DEFAULT_FALL }
    if (template.rise) {
      for (const [key, cat] of Object.entries(template.rise)) {
        if (cat.items && cat.items.length > 0) mergedRise[key] = cat
      }
    }
    if (template.fall) {
      for (const [key, cat] of Object.entries(template.fall)) {
        if (cat.items && cat.items.length > 0) mergedFall[key] = cat
      }
    }
    return { rise: mergedRise, fall: mergedFall }
  }
  return { rise: DEFAULT_RISE, fall: DEFAULT_FALL }
}

function loadTemplates() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [] } catch (_) { return [] }
}

function saveTemplates(templates) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(templates)) } catch (_) {}
}

function saveTemplate(template) {
  const templates = loadTemplates()
  const idx = templates.findIndex(t => t.id === template.id)
  if (idx >= 0) {
    templates[idx] = { ...template, updatedAt: Date.now() }
  } else {
    template.id = 'tpl_' + Date.now()
    template.createdAt = Date.now()
    template.updatedAt = Date.now()
    templates.push(template)
  }
  saveTemplates(templates)
  return template
}

function deleteTemplate(id) {
  const templates = loadTemplates().filter(t => t.id !== id)
  saveTemplates(templates)
  if (getLastUsedId() === id) {
    try { localStorage.setItem(LAST_USED_KEY, '') } catch (_) {}
  }
}

function getActiveTemplate() {
  const templates = loadTemplates()
  const lastId = getLastUsedId()
  if (lastId) return templates.find(t => t.id === lastId) || null
  return null
}

function setActiveTemplate(id) {
  try { localStorage.setItem(LAST_USED_KEY, id || '') } catch (_) {}
}

function getLastUsedId() {
  try { return localStorage.getItem(LAST_USED_KEY) || '' } catch (_) { return '' }
}

function drawPenalty(type) {
  const pool = getActivePool()
  const catPool = type === 'rise' ? pool.rise : pool.fall
  const keys = Object.keys(catPool)
  if (keys.length === 0) return null
  const key = keys[Math.floor(Math.random() * keys.length)]
  const cat = catPool[key]
  const item = cat.items[Math.floor(Math.random() * cat.items.length)]
  return { type, key, label: cat.label, icon: cat.icon, text: item }
}

function drawCandidates(type, count = 5) {
  const pool = getActivePool()
  const catPool = type === 'rise' ? pool.rise : pool.fall
  const keys = Object.keys(catPool)
  count = Math.min(count, keys.length)
  const shuffled = [...keys].sort(() => Math.random() - 0.5).slice(0, count)
  return shuffled.map(key => {
    const cat = catPool[key]
    const item = cat.items[Math.floor(Math.random() * cat.items.length)]
    return { type, key, label: cat.label, icon: cat.icon, text: item, votes: 0 }
  })
}

function createDefaultTemplate(name) {
  return {
    id: '',
    name: name || '我的惩罚库',
    rise: JSON.parse(JSON.stringify(DEFAULT_RISE)),
    fall: JSON.parse(JSON.stringify(DEFAULT_FALL)),
    createdAt: 0,
    updatedAt: 0
  }
}

window.PENALTIES_ENGINE = {
  DEFAULT_RISE, DEFAULT_FALL,
  getActivePool, getActiveTemplate, setActiveTemplate,
  loadTemplates, saveTemplate, deleteTemplate, createDefaultTemplate,
  drawPenalty, drawCandidates
}
})()
