/**
 * 三六局 V2 — ASR 语音输入客户端
 * 录音 → 上传 Supabase Storage → DashScope Fun-ASR → 返回文字
 */
(function() {

let mediaRecorder = null
let audioChunks = []

/** 开始录音，返回 Promise<Blob> */
async function startRecording() {
  audioChunks = []

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate: 16000, channelCount: 1 }
  })

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus' : 'audio/webm'

  mediaRecorder = new MediaRecorder(stream, { mimeType })
  audioChunks = []

  mediaRecorder.addEventListener('dataavailable', e => {
    if (e.data.size > 0) audioChunks.push(e.data)
  })

  return new Promise((resolve) => {
    mediaRecorder.addEventListener('start', () => resolve())
    mediaRecorder.start()
  })
}

/** 停止录音，返回 WAV Blob（16kHz mono，Fun-ASR 兼容） */
function stopRecording() {
  return new Promise((resolve) => {
    if (!mediaRecorder) { resolve(null); return }
    mediaRecorder.addEventListener('stop', async () => {
      const rawBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType })
      mediaRecorder.stream.getTracks().forEach(t => t.stop())
      mediaRecorder = null
      // Convert webm to 16kHz WAV
      try {
        const wav = await convertToWav(rawBlob)
        resolve(wav)
      } catch(e) {
        console.warn('[ASR] WAV conversion failed, using raw:', e.message)
        resolve(rawBlob)
      }
    })
    mediaRecorder.stop()
  })
}

/** 上传到 Supabase Storage 并获取公开 URL */
async function uploadToStorage(blob, roomId, playerId) {
  const sb = window.Channel?.getSB?.()
  if (!sb) { console.warn('[ASR] Supabase not available'); return null }

  const fileName = 'answers/' + roomId + '/' + playerId + '_' + Date.now() + '.wav'
  const { data, error } = await sb.storage.from('voice-answers').upload(fileName, blob, {
    contentType: 'audio/wav',
    upsert: false
  })

  if (error) { console.warn('[ASR] Upload failed:', error.message); return null }

  const { data: urlData } = sb.storage.from('voice-answers').getPublicUrl(fileName)
  return urlData?.publicUrl || null
}

/** 语音转文字 */
async function recognize(blob, roomId, playerId) {
  try {
    const fileUrl = await uploadToStorage(blob, roomId, playerId)
    if (!fileUrl) return null

    const resp = await fetch('/api/asr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_url: fileUrl })
    })

    if (!resp.ok) { console.warn('[ASR] API error', resp.status); return null }

    const data = await resp.json()
    return data.text || null
  } catch (e) {
    console.warn('[ASR] Error:', e.message)
    return null
  }
}

/** 完整录音流程：开始录音 → 按钮变红 → 点停止 → 识别 */
async function recordAndRecognize(roomId, playerId) {
  await startRecording()
  return { stopAndRecognize: async () => {
    const blob = await stopRecording()
    if (!blob) return null
    return recognize(blob, roomId, playerId)
  }}
}

async function convertToWav(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  const arrayBuf = await blob.arrayBuffer()
  const audioBuf = await ctx.decodeAudioData(arrayBuf)
  ctx.close()

  let pcmData = audioBuf.getChannelData(0)
  const srcRate = audioBuf.sampleRate
  const targetRate = 16000

  if (srcRate !== targetRate) {
    const ratio = srcRate / targetRate
    const newLen = Math.floor(pcmData.length / ratio)
    const downsampled = new Float32Array(newLen)
    for (let i = 0; i < newLen; i++) downsampled[i] = pcmData[Math.floor(i * ratio)]
    pcmData = downsampled
  }

  const byteRate = targetRate * 2
  const dataSize = pcmData.length * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  function ws(o,s){for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i))}
  ws(0,'RIFF');view.setUint32(4,36+dataSize,true);ws(8,'WAVE')
  ws(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true)
  view.setUint16(22,1,true);view.setUint32(24,targetRate,true)
  view.setUint32(28,byteRate,true);view.setUint16(32,2,true);view.setUint16(34,16,true)
  ws(36,'data');view.setUint32(40,dataSize,true)
  let off=44
  for(let i=0;i<pcmData.length;i++){const s=Math.max(-1,Math.min(1,pcmData[i]));view.setInt16(off,s<0?s*0x8000:s*0x7FFF,true);off+=2}
  return new Blob([buffer],{type:'audio/wav'})
}

window.ASR = { startRecording, stopRecording, recognize, recordAndRecognize }
})()
