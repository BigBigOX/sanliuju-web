/**
 * CF Pages Function — DashScope CosyVoice TTS proxy
 * POST /api/tts  { text, voice?, instruction? }
 * Returns { audio: "base64..." } or { error }
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

  const text = (body.text || '').trim()
  if (!text || text.length > 200) {
    return new Response(JSON.stringify({ error: 'Text required, max 200 chars' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    })
  }

  const DASHSCOPE_KEY = context.env.DASHSCOPE_API_KEY || 'sk-7cab2d990ac84d3fa9b5279ad3b4a3a6'
  const voice = body.voice || 'longfei_v3'
  const instruction = body.instruction || null

  try {
    // Step 1: Call DashScope CosyVoice
    const reqBody = {
      model: 'cosyvoice-v3-flash',
      input: { text: text, voice: voice }
    }
    // Only add instruction if provided (avoid extra fields causing InvalidParameter)
    if (instruction) reqBody.input.instruction = instruction

    const ttsResp = await fetch(
      'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + DASHSCOPE_KEY,
          'Content-Type': 'application/json',
          'X-DashScope-Source-Config': '{"channel":"cf-function","tags":{"t1":"public","t2":""}}'
        },
        body: JSON.stringify(reqBody)
      }
    )

    if (!ttsResp.ok) {
      const errText = await ttsResp.text().catch(() => '')
      console.warn('[TTS] DashScope HTTP', ttsResp.status, errText.slice(0, 300))
      return new Response(JSON.stringify({ error: 'TTS service error: ' + errText.slice(0, 200) }), {
        status: 502, headers: { 'Content-Type': 'application/json' }
      })
    }

    const ttsData = await ttsResp.json()
    const audioUrl = ttsData.output?.audio?.url

    if (!audioUrl) {
      console.warn('[TTS] No audio URL, response:', JSON.stringify(ttsData.output).slice(0, 300))
      return new Response(JSON.stringify({ error: 'No audio generated' }), {
        status: 502, headers: { 'Content-Type': 'application/json' }
      })
    }

    // Return HTTPS URL (rewrite HTTP→HTTPS for mixed-content compatibility)
    const secureUrl = audioUrl.replace(/^http:\/\//, 'https://')
    return new Response(JSON.stringify({ audio_url: secureUrl }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })
  } catch (e) {
    console.warn('[TTS] Error:', e.message)
    return new Response(JSON.stringify({ error: 'TTS proxy error', detail: e.message }), {
      status: 502, headers: { 'Content-Type': 'application/json' }
    })
  }
}
