-- 三六局 V3 — Supabase 初始化
-- 在 Supabase Dashboard → SQL Editor 中运行

-- 1. 语音答案存储 bucket（ASR 用）
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('voice-answers', 'voice-answers', true, 1048576, ARRAY['audio/webm', 'audio/wav', 'audio/mp3', 'audio/ogg'])
ON CONFLICT (id) DO NOTHING;

-- 2. 允许公开上传（限时临时文件）
CREATE POLICY "允许上传语音答案" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'voice-answers');

CREATE POLICY "允许读取语音答案" ON storage.objects
  FOR SELECT USING (bucket_id = 'voice-answers');

-- 3. 游戏快照表（远端状态存储）
CREATE TABLE IF NOT EXISTS game_snapshots (
  game_id TEXT PRIMARY KEY,
  snapshot JSONB NOT NULL,
  round INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 内容审核日志表（小程序合规用）
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  game_id TEXT,
  player_id TEXT,
  content_type TEXT,
  content TEXT,
  check_result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_game ON audit_logs(game_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

-- 5. 自动清理 7 天前的语音文件
SELECT cron.schedule(
  'clean-voice-answers',
  '0 3 * * *',
  $$DELETE FROM storage.objects WHERE bucket_id = 'voice-answers' AND created_at < NOW() - INTERVAL '7 days'$$
);
