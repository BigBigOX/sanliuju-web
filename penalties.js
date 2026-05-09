/**
 * 趣味奖惩词库
 * 支持默认词库 + 自定义模板持久化
 */
const DEFAULT = {
  perform: {
    label: '表演', icon: '🎭', desc: '来段才艺，让大家开心一下',
    items: [
      '用三种不同的声调唱《小星星》',
      '模仿在场任意一个人，让大家猜是谁',
      '用 rap 节奏念出你的手机号后四位',
      '对着窗户大喊三声「今天太开心了」',
      '用慢动作表演「被蜜蜂追着跑」',
      '单手倒立… 呃做不到就倒立喝水吧',
      '用最浮夸的方式自我介绍 30 秒',
      '表演一个广告，推销现场的任意一件物品',
      '用方言朗诵一段天气预报',
      '跟着音乐即兴跳 20 秒舞蹈（不许停）'
    ]
  },
  truth: {
    label: '真心话', icon: '💬', desc: '诚实回答，不许撒谎',
    items: [
      '最近一次对谁撒了谎？说了什么？',
      '手机里最不想让人看到的 App 是什么？',
      '上一次哭是因为什么？',
      '你在场最不想得罪的人是谁？为什么？',
      '说一个你从来没有告诉过任何人的秘密',
      '你最近一次心动是什么时候？对谁？',
      '你做过最尴尬的一件事是什么？',
      '如果必须在场选一个人借钱，你会选谁？',
      '你觉得自己最虚伪的地方是什么？',
      '上一次生气是因为什么？现在还气吗？'
    ]
  },
  dare: {
    label: '大冒险', icon: '⚡', desc: '完成挑战，不许耍赖',
    items: [
      '做 10 个俯卧撑（或 15 个深蹲）',
      '闭眼原地转 8 圈，然后走直线',
      '用嘴叼着杯子喝一口水，不许用手',
      '单脚站立 30 秒，失败重来',
      '和左手边的玩家对视 15 秒，不许笑',
      '不弯膝盖弯腰摸脚尖，保持 10 秒',
      '一口气念完「四是四十是十十四是十四」三遍',
      '在 30 秒内让至少两个人笑出声',
      '头顶一本书绕房间走一圈，掉了重来',
      '用反手写下自己的名字，大家评分'
    ]
  },
  social: {
    label: '社交', icon: '🎯', desc: '和在场的人互动',
    items: [
      '给在场每个人一句真诚的夸奖',
      '和右手边的人交换手机看相册第一张照片',
      '给不在场的任意一个朋友发消息「我想你了」',
      '选出在场「最想和他一起旅行」的人并说明原因',
      '和最不熟的人握手 10 秒并说「认识你真好」',
      '发一条朋友圈：「刚刚在玩三六局，太刺激了」不删',
      '选一个人，用 30 秒说出 TA 的三个优点',
      '和离你最远的人碰杯（没杯子就用手指）',
      '给群聊发一个 5 元红包（认真的）',
      '对在场最年长/资历最深的人鞠一躬'
    ]
  }
}

const STORAGE_KEY = 'penalty_templates'
const LAST_USED_KEY = 'penalty_last_used'

/** 获取当前生效的词库（自定义覆盖默认） */
function getActivePool() {
  const template = getActiveTemplate()
  if (template && template.categories) {
    // 合并：自定义覆盖同 key 的默认类别
    const merged = { ...DEFAULT }
    for (const [key, cat] of Object.entries(template.categories)) {
      if (cat.items && cat.items.length > 0) {
        merged[key] = { label: cat.label, icon: cat.icon, desc: cat.desc, items: cat.items }
      }
    }
    return merged
  }
  return DEFAULT
}

/** 保存模板列表 */
function saveTemplates(templates) {
  wx.setStorageSync(STORAGE_KEY, templates)
  syncToCloud(templates)
}

/** 加载模板列表 */
function loadTemplates() {
  return wx.getStorageSync(STORAGE_KEY) || []
}

/** 保存单个模板 */
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

/** 删除模板 */
function deleteTemplate(id) {
  const templates = loadTemplates().filter(t => t.id !== id)
  saveTemplates(templates)
  // 如果删除的是当前激活的，清除激活
  if (getLastUsedId() === id) {
    wx.setStorageSync(LAST_USED_KEY, '')
  }
}

/** 获取当前激活的模板 */
function getActiveTemplate() {
  const templates = loadTemplates()
  const lastId = getLastUsedId()
  if (lastId) {
    const tpl = templates.find(t => t.id === lastId)
    if (tpl) return tpl
  }
  return null // null = 使用默认词库
}

/** 设置当前激活的模板 */
function setActiveTemplate(id) {
  wx.setStorageSync(LAST_USED_KEY, id || '')
}

function getLastUsedId() {
  return wx.getStorageSync(LAST_USED_KEY) || ''
}

/** 从模板中随机抽一个惩罚 */
function drawPenalty(category, templateId) {
  const pool = getActivePool()
  const cat = pool[category]
  if (!cat) return null
  const item = cat.items[Math.floor(Math.random() * cat.items.length)]
  return { category, label: cat.label, icon: cat.icon, text: item }
}

/** 从每个类别各抽一题，返回 4 个候选（用于投票） */
function drawCandidates() {
  const pool = getActivePool()
  return Object.entries(pool).map(([key, val]) => {
    const item = val.items[Math.floor(Math.random() * val.items.length)]
    return { key, label: val.label, icon: val.icon, text: item, votes: 0 }
  })
}

/** 获取所有类别 */
function getCategories() {
  const pool = getActivePool()
  return Object.entries(pool).map(([key, val]) => ({
    key, label: val.label, icon: val.icon, desc: val.desc, count: val.items.length
  }))
}

/** 创建默认模板副本（基于内置词库） */
function createDefaultTemplate(name) {
  return {
    id: '',
    name: name || '我的惩罚库',
    categories: JSON.parse(JSON.stringify(DEFAULT)),
    createdAt: 0,
    updatedAt: 0
  }
}

/** 云同步 */
async function syncToCloud(templates) {
  try {
    const app = getApp()
    if (!app) return
    await wx.cloud.callFunction({
      name: 'room',
      data: { action: 'saveTemplates', templates }
    })
  } catch (e) { /* 静默失败，本地始终有效 */ }
}

async function loadFromCloud() {
  try {
    const res = await wx.cloud.callFunction({
      name: 'room',
      data: { action: 'loadTemplates' }
    })
    if (res.result && res.result.code === 0 && res.result.data) {
      const cloudData = res.result.data
      // 合并：云端的覆盖本地的（如果云端更新）
      const local = loadTemplates()
      const merged = mergeTemplates(local, cloudData)
      wx.setStorageSync(STORAGE_KEY, merged)
      return merged
    }
  } catch (e) { /* offline */ }
  return loadTemplates()
}

function mergeTemplates(local, cloud) {
  const map = new Map()
  for (const t of local) map.set(t.id, t)
  for (const t of cloud) {
    const existing = map.get(t.id)
    if (!existing || (t.updatedAt > existing.updatedAt)) {
      map.set(t.id, t)
    }
  }
  return [...map.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

module.exports = {
  DEFAULT, getActivePool, getActiveTemplate, setActiveTemplate,
  loadTemplates, saveTemplate, deleteTemplate, createDefaultTemplate,
  drawPenalty, drawCandidates, getCategories, loadFromCloud
}
