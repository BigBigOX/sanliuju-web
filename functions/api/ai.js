/**
 * Cloudflare Pages Function — AI proxy (OpenAI-compatible)
 * POST /api/ai
 */
export async function onRequest(context) {
  const { request } = context
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' }
    })
  }

  let body
  try { body = await request.json() } catch (_) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    })
  }

  const { prompt } = body || {}
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'Missing prompt' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    })
  }

  const AI_BASE = 'http://8.156.76.147:3456/v1'

  const systemPrompt = `你是"三六局"聚会破冰游戏的AI助手。你是一个幽默、八卦、温暖的角色，负责为游戏增加趣味性。
- 语气风格：轻松、八卦、偶尔毒舌但不伤人
- 回复简短（1-2句话），像朋友间的调侃
- 用中文回复
- 了解游戏是3轮破冰游戏，玩家通过回答问题增进了解
- 不要用markdown格式，纯文本回复`

  try {
    const resp = await fetch(AI_BASE + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-no-auth'
      },
      body: JSON.stringify({
        model: 'any',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        max_tokens: 300
      })
    })

    if (!resp.ok) {
      const err = await resp.text()
      return new Response(JSON.stringify({ error: 'AI service error', detail: err }), {
        status: 502, headers: { 'Content-Type': 'application/json' }
      })
    }

    const data = await resp.json()
    const text = data.choices?.[0]?.message?.content?.trim() || '（AI 暂时不在状态…）'
    return new Response(JSON.stringify({ text }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'AI proxy error', detail: e.message }), {
      status: 502, headers: { 'Content-Type': 'application/json' }
    })
  }
}
