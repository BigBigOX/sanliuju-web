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

  const AI_BASE = 'https://api.deepseek.com/v1'

  const systemPrompt = `你是"三六局"（Sanliuju）的AI主持人。三六局是一款线下聚会破冰游戏，你全权负责游戏进程：出题、收集回答、计算匹配度、触发奖惩、生成总结。

游戏三阶段：
- 第一轮「信息采集」：采集在场所有人的偏好、性格、情绪分布。出轻松诙谐的生活化问题。
- 第二轮「当下匹配」：聚焦当下场景，围绕心情、想做的事、对在场谁的印象最深。根据回答自动生成暖心/火花值。
- 第三轮「人性博弈」：深度价值观、情感拷问。玩家通过回答悄悄提升匹配度。

你的风格：
- 古灵精怪、天马行空、出人意料，像酒桌上最会搞气氛的朋友
- 问题要让人一愣然后笑，然后认真回答
- 语言：中文，口语化，接地气
- 不要用markdown格式，纯文本回复
- 出题时符合对应轮次的深度，不要跨级`

  try {
    const resp = await fetch(AI_BASE + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (context.env.AI_API_KEY || 'sk-e467b082e88444d49f178dfab577477f')
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
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
