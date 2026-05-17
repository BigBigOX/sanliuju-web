/**
 * CF Pages Function — DashScope Fun-ASR proxy
 * POST /api/asr  { file_url }
 * Returns { text: "..." } or { error }
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

  const fileUrl = (body.file_url || '').trim()
  const language = body.language || 'zh'
  if (!fileUrl) {
    return new Response(JSON.stringify({ error: 'file_url required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    })
  }

  const DASHSCOPE_KEY = context.env.DASHSCOPE_API_KEY || 'sk-7cab2d990ac84d3fa9b5279ad3b4a3a6'

  try {
    // Step 1: Submit ASR task
    const submitResp = await fetch(
      'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + DASHSCOPE_KEY,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable'
        },
        body: JSON.stringify({
          model: 'fun-asr',
          input: { file_urls: [fileUrl] },
          parameters: { channel_id: [0], language_hints: [language] }
        })
      }
    )

    if (!submitResp.ok) {
      const errText = await submitResp.text().catch(() => '')
      console.warn('[ASR] Submit failed', submitResp.status, errText.slice(0, 200))
      return new Response(JSON.stringify({ error: 'ASR submit failed' }), {
        status: 502, headers: { 'Content-Type': 'application/json' }
      })
    }

    const submitData = await submitResp.json()
    const taskId = submitData.output?.task_id
    if (!taskId) {
      return new Response(JSON.stringify({ error: 'No task ID' }), {
        status: 502, headers: { 'Content-Type': 'application/json' }
      })
    }

    // Step 2: Poll for result (max 15s)
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 1500))

      const pollResp = await fetch(
        'https://dashscope.aliyuncs.com/api/v1/tasks/' + taskId,
        { headers: { 'Authorization': 'Bearer ' + DASHSCOPE_KEY } }
      )

      if (!pollResp.ok) continue

      const pollData = await pollResp.json()
      const status = pollData.output?.task_status

      if (status === 'SUCCEEDED') {
        const results = pollData.output?.results || []
        // Fetch transcription from each result's transcription_url
        const texts = []
        for (const r of results) {
          const tUrl = r.transcription_url
          if (!tUrl) continue
          try {
            const tResp = await fetch(tUrl)
            if (tResp.ok) {
              const tData = await tResp.json()
              const tText = tData.transcripts?.map(t => t.text).join(' ') || ''
              if (tText) texts.push(tText)
            }
          } catch (_) {}
        }
        const text = texts.join(' ').trim()
        return new Response(JSON.stringify({ text: text || '(未识别到语音)' }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        })
      }

      if (status === 'FAILED') {
        return new Response(JSON.stringify({ error: 'ASR task failed', detail: pollData.output?.message || JSON.stringify(pollData.output).slice(0, 200) }), {
          status: 502, headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    return new Response(JSON.stringify({ error: 'ASR timeout' }), {
      status: 504, headers: { 'Content-Type': 'application/json' }
    })
  } catch (e) {
    console.warn('[ASR] Error:', e.message)
    return new Response(JSON.stringify({ error: 'ASR proxy error', detail: e.message }), {
      status: 502, headers: { 'Content-Type': 'application/json' }
    })
  }
}
