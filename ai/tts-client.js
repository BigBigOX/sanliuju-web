/**
 * 三六局 V2 — TTS 播报器
 * CF Function 代理 DashScope CosyVoice，返回音频 URL 直接播放
 */
(function() {

let audioEl = null
let generation = 0
let callTimestamps = []
const MAX_CALLS_PER_MINUTE = 10

function getAudio() {
  if (!audioEl) { audioEl = new Audio(); audioEl.volume = 1.0 }
  audioEl.pause(); audioEl.currentTime = 0
  return audioEl
}

function isRateLimited() {
  const now = Date.now()
  callTimestamps = callTimestamps.filter(t => t > now - 60000)
  return callTimestamps.length >= MAX_CALLS_PER_MINUTE
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function stop() {
  generation++
  try { if (audioEl) audioEl.pause() } catch (_) {}
}

function unlock() {
  try {
    // Create + play a real Audio to unlock browser autoplay
    const el = new Audio()
    el.volume = 0.001
    // Minimal valid WAV (silence, 16kHz, mono, 16-bit)
    el.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='
    el.play().then(() => { el.pause(); el.src = '' }).catch(() => {})
  } catch (_) {}
}

async function speak(text, options = {}) {
  if (!text) return
  const t = text.slice(0, 60)

  stop()
  const myGen = generation

  try {
    if (options.pauseBefore) {
      await sleep(options.pauseBefore)
      if (generation !== myGen) return
    }

    if (isRateLimited()) {
      console.warn('[TTS] Rate limited, skipping:', t.slice(0, 20))
      return
    }

    callTimestamps.push(Date.now())

    const resp = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: t })
    })

    if (generation !== myGen) return

    if (!resp.ok) {
      await sleep(t.length * 60)
      return
    }

    const data = await resp.json()
    if (generation !== myGen) return

    // Prefer base64 (avoids mixed-content), fallback to audio_url
    let src = null
    if (data.audio) { src = 'data:audio/wav;base64,' + data.audio }
    else if (data.audio_url) { src = data.audio_url }
    if (!src) { await sleep(t.length * 60); return }

    const el = getAudio()
    el.src = src
    el.play().catch(e => console.warn('[TTS] Play failed:', e.message))

    await new Promise((resolve) => {
      el.onended = () => resolve()
      el.onerror = () => resolve()
    })

    if (generation !== myGen) return
    if (options.pauseAfter) await sleep(options.pauseAfter)
    options.onComplete?.()
  } catch (e) {
    if (generation !== myGen) return
    console.warn('[TTS]', e.message)
    options.onError?.(e)
  }
}

window.TTS = { unlock, speak, stop }
})()
