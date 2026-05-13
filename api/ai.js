/**
 * Vercel Serverless Function — AI proxy for Claude API
 * POST /api/ai
 * Body: { prompt, type: 'comment'|'question'|'report', context }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'AI not configured' })
  }

  const { prompt, context } = req.body || {}
  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' })
  }

  const systemPrompt = `你是"三六局"聚会破冰游戏的AI助手。你是一个幽默、八卦、温暖的角色，负责为游戏增加趣味性。
- 语气风格：轻松、八卦、偶尔毒舌但不伤人
- 回复简短（1-2句话），像朋友间的调侃
- 用中文回复
- 了解游戏是3轮破冰游戏，玩家通过回答问题增进了解
- 不要用markdown格式，纯文本回复`

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!resp.ok) {
      const err = await resp.text()
      console.error('Claude API error:', resp.status, err)
      return res.status(502).json({ error: 'AI service error', detail: err })
    }

    const data = await resp.json()
    const text = data.content?.[0]?.text || '（AI 暂时不在状态…）'
    return res.status(200).json({ text })
  } catch (e) {
    console.error('AI proxy error:', e)
    return res.status(502).json({ error: 'AI proxy error', detail: e.message })
  }
}
