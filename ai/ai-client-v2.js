/**
 * 三六局 V2 — AI 通信客户端
 * 封装 fetch → DeepSeek API，JSON 校验 + fallback
 * 平台差异：Web 用 fetch()，小程序用 wx.request()
 */
(function() {
const C = window.CONSTANTS
const T = window.PromptTemplates

const AI_CONFIG = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-e467b082e88444d49f178dfab577477f',
  model: 'deepseek-chat',
  defaultTimeout: 25000,
  maxTokens: 300
}

/**
 * 校验 AI 返回的 JSON 是否符合规范
 */
function validateJSON(json) {
  if (!json || !json.func) return false
  if (!C.AI_FUNCS.includes(json.func)) return false
  const schema = C.FUNC_SCHEMA[json.func]
  if (!schema) return false
  return schema.required.every(f => json[f] !== undefined)
}

/**
 * 尝试从文本中提取 JSON
 */
function extractJSON(text) {
  if (!text) return null
  try { return JSON.parse(text) } catch (_) {}
  const m = text.match(/\{[\s\S]*\}/)
  if (m) {
    try { return JSON.parse(m[0]) } catch (_) {}
  }
  return null
}

/**
 * 核心 AI 调用
 */
async function callAI(prompt, options = {}) {
  const {
    temperature = 0.8,
    timeoutMs = AI_CONFIG.defaultTimeout,
    systemPrompt = T.SYSTEM_PROMPT,
    responseFormat = 'json'
  } = options

  try {
    const resp = await fetch(AI_CONFIG.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + AI_CONFIG.apiKey
      },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        max_tokens: options.maxTokens || AI_CONFIG.maxTokens,
        temperature,
        ...(responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {})
      }),
      signal: AbortSignal.timeout(timeoutMs)
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      console.warn('[AI] HTTP', resp.status, errText.slice(0, 100))
      return null
    }

    const data = await resp.json()
    const text = data.choices?.[0]?.message?.content?.trim()
    if (!text) return null

    const json = extractJSON(text)
    if (json && responseFormat === 'json') {
      if (validateJSON(json)) {
        return json
      }
      console.warn('[AI] JSON validation failed, using raw text')
    }

    return { func: 'announcement', text: text, level: 'info', _raw: true }
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      console.warn('[AI] Timeout after', timeoutMs, 'ms')
    } else {
      console.warn('[AI] Error:', err.message)
    }
    return null
  }
}

/**
 * AI 出题（带超时 fallback）
 */
async function generateQuestion(round, players, options = {}) {
  const roundName = C.ROUND_NAMES[round]
  const prompt = T.buildQuestionPrompt(round, roundName, players, options.previousDirections)

  const result = await callAI(prompt, {
    temperature: 0.9,
    timeoutMs: options.timeoutMs || 10000,
    maxTokens: 500,
    responseFormat: 'json'
  })

  if (result && result.func === 'new_question' && result.question) {
    return result
  }
  if (result && result._raw) {
    return {
      func: 'new_question',
      round,
      question: result.text,
      question_id: 'q_' + Date.now(),
      timer: C.TIMER_SECONDS
    }
  }
  return null
}

/**
 * AI 匹配分析（带重试 + 兜底）
 */
async function analyzeMatches(round, players, answers) {
  const prompt = T.buildMatchAnalysisPrompt(round, players, answers)

  // First attempt with JSON mode
  let result = await callAI(prompt, { temperature: 0.5, timeoutMs: 30000, maxTokens: 800 })

  // If JSON validation failed, retry once without JSON mode
  if (!result || !result.pairs) {
    console.warn('[AI] Match analysis retry without JSON mode')
    result = await callAI(prompt, { temperature: 0.6, timeoutMs: 25000, maxTokens: 600, responseFormat: 'text' })
    // Extract analysis text from raw response
    if (result && result._raw && result.text) {
      return { func: 'match_result', pairs: [], analysis: result.text.slice(0, 300) }
    }
  }

  return result
}

/**
 * AI 生成轮次结算
 */
async function generateRoundSummary(round, players, heatData, questionCount, answerCount) {
  const roundName = C.ROUND_NAMES[round]
  const names = players.filter(p => !p.isHost).map(p => p.nickname || ('玩家' + p.id)).join('、')
  const prompt = T.buildRoundSummaryPrompt(round, roundName, questionCount, heatData, answerCount, names)
  return callAI(prompt, { temperature: 0.6, timeoutMs: 15000, maxTokens: 800 })
}

async function generateGameReport(players, heat, stats) {
  const prompt = T.buildGameSummaryPrompt(players, heat, stats)
  return callAI(prompt, { temperature: 0.7, timeoutMs: 20000, maxTokens: 1500 })
}

/**
 * AI 即兴评论（toast/旁白）
 */
async function generateHostLine(context) {
  const prompt = T.buildHostLinePrompt(context)
  const result = await callAI(prompt, { temperature: 0.9, timeoutMs: 8000, maxTokens: 100, responseFormat: 'text' })
  return result ? (result.text || null) : null
}

async function generateCommentary(event, context) {
  const ctx = typeof context === 'string' ? context : JSON.stringify(context || {})
  const prompt = '三六局游戏。事件：' + event + '。上下文：' + ctx +
    '。请用一句话评论，幽默口语化，不超过30字。只返回评论。'
  const result = await callAI(prompt, { temperature: 0.9, timeoutMs: 8000, maxTokens: 100, responseFormat: 'text' })
  return result ? (result.text || null) : null
}

// ===== Export =====
const aiClient = {
  AI_CONFIG,
  callAI, validateJSON, extractJSON,
  generateQuestion, analyzeMatches,
  generateRoundSummary, generateGameReport,
  generateCommentary, generateHostLine
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = aiClient
} else {
  window.AIClient = aiClient
}
})()
