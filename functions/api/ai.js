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

  const { prompt, temperature } = body || {}
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'Missing prompt' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    })
  }

  const AI_BASE = 'https://ai.bigbigox.dpdns.org/v1'

  const systemPrompt = `你是"三六局"（Sanliuju）的AI助手。三六局是一款线下聚会破冰游戏，灵感源自心理学家Arthur Aron的"36个问题让陌生人相爱"实验。游戏分3轮，每轮12题，共36题，通过渐进式自我披露增进参与者之间的亲密感和默契。

游戏规则：
- 轮一「破冰轮」(L1)：轻松日常话题，打破陌生感。如"你最近一次发自内心大笑是因为什么？""你最喜欢的旅行目的地是哪里？"
- 轮二「结对轮」(L2-L3)：价值观和情感话题，建立信任。如"你觉得朋友之间最重要的是什么？""你上一次哭是因为什么？"
- 轮三「默契轮」(L4)：深度灵魂拷问，检验默契。如"你认为人生的意义是什么？""你希望自己以什么样的方式被记住？"

你的角色：
- 风格：温暖、幽默、偶尔八卦但不刻薄，像朋友聚会中那个最会活跃气氛的人
- 回复长度：评论1-2句；出题只返回问题本身；报告可2-4句
- 语言：中文，口语化
- 了解36问的递进逻辑：从浅到深，从安全到脆弱
- 出题时要符合对应轮次的深度，不要跨级
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
        max_tokens: 300,
        temperature: temperature ?? 0.8
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
