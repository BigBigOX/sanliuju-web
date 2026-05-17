/**
 * 三六局 V2 — 常量定义
 * 纯数据，无平台依赖，可移植到微信小程序
 */
const CONSTANTS = {
  // 轮次名称 (V2)
  ROUND_NAMES: { 1: '信息采集', 2: '当下匹配', 3: '人性博弈' },

  // 游戏配置
  MAX_PLAYERS: 6,
  ANSWER_CHAR_LIMIT: 50,
  TIMER_SECONDS: 45,
  SESSION_MAX_AGE_MS: 30 * 60 * 1000, // 30分钟，超过则会话失效
  REJOIN_TIMEOUT_MS: 10000, // 重连后等待 state 响应的超时
  SETTLEMENT_DISPLAY_MS: 4000, // 结算前匹配结果展示时间

  // 每轮题目数 (null=动态: 玩家数×2)
  QUESTIONS_PER_ROUND: { 1: null, 2: 5, 3: 3 },

  // V2.1 状态机 — 单一枚举，替代散落的 roundPhase+question+_draftQuestion
  PHASES: {
    IDLE: 'idle',           // 等待主持人操作
    DRAFTING: 'drafting',   // AI 生成题目中
    PREVIEW: 'preview',     // 主持人预览草稿，可发布或跳过
    ANSWERING: 'answering', // 玩家答题中（计时器运行）
    ANALYZING: 'analyzing', // AI 分析匹配中
    RESULTS: 'results',     // 展示匹配结果
    VOTING: 'voting',       // 惩罚投票中
    SETTLEMENT: 'settlement', // 轮次结算
    ENDED: 'ended'          // 游戏结束
  },

  // 游戏阶段（V2 兼容，逐步废弃）
  GAME_PHASES: {
    QUESTION: 'question',
    ANALYSIS: 'analysis',
    RESULTS: 'results',
    SETTLEMENT: 'settlement',
    PENALTY: 'penalty',
    ENDED: 'ended'
  },

  // 惩罚阈值说明 (展示给玩家)
  PENALTY_INFO: {
    rise: '默契度 ≥ 50 → 亲密惩罚',
    fall: '默契度 ≤ 40 → 公开惩罚'
  },

  // 匹配阈值 (engine/match-calc.js 使用)
  HEAT_MIN: 0,
  HEAT_MAX: 100,
  RISE_THRESHOLD: 50,   // 匹配度 >= 50 触发亲密惩罚
  FALL_THRESHOLD: 40,   // 匹配度 <= 40 触发公开惩罚
  STEAL_MATCH_DELTA: 15, // 新匹配 > 原匹配 + 15 触发重组

  // AI 输出 func 列表 (下行)
  AI_FUNCS: [
    'new_question',    // 出题
    'match_result',    // 匹配结果
    'value_update',    // 暖心/火花变化
    'penalty_trigger', // 惩罚触发
    'penalty_result',  // 惩罚结果
    'steal_success',   // 挖墙脚成功
    'round_summary',   // 轮次总结
    'game_end',        // 游戏结束
    'announcement',    // 全局通知
    'tts_queue'        // 语音播报
  ],

  // 玩家上行 func 列表
  PLAYER_FUNCS: [
    'submit_answer',   // 提交回答
    'cast_vote',       // 投票
    'steal_punish',    // 挖墙脚自选惩罚
    'admin_override'   // 超管干预
  ],

  // JSON 校验 schema (必填字段)
  FUNC_SCHEMA: {
    new_question:      { required: ['round', 'question', 'question_id', 'timer'] },
    match_result:      { required: ['pairs', 'analysis'] },
    value_update:      { required: ['pair_id'] },
    penalty_trigger:   { required: ['pair_id', 'type', 'candidates'] },
    penalty_result:    { required: ['pair_id', 'penalty_text'] },
    steal_success:     { required: ['winner_id', 'loser_id', 'target_id', 'new_match'] },
    round_summary:     { required: ['round', 'stats'] },
    game_end:          { required: ['final_pairs', 'report'] },
    announcement:      { required: ['text', 'level'] },
    tts_queue:         { required: ['text'] }
  },

  // 头像列表
  AVATARS: [
    '🐱','🐶','🐰','🐻','🐼','🐨','🐯','🦁','🐮','🐷',
    '🐸','🐵','🐔','🐧','🐦','🐤','🦊','🐴','🦄','🐌',
    '🐝','🐞','🦋','🐙','🦑','🦀','🐳','🐬','🐟','🐠',
    '🦜','🦩','🦚','🐿️','🦔','🦦','🦥','🐾','🐉','🦕',
    '👽','🤖','👻','🎃','🎄','🌈','⭐','🌙','☀️','🔥',
    '💎','🎯'
  ],

  // 背景漂浮动画随机参数
  generateDrift() {
    return {
      x: (Math.random() * 30 - 15).toFixed(1),
      y: (Math.random() * 20 - 10).toFixed(1),
      dur: (6 + Math.random() * 4).toFixed(1),
      delay: (Math.random() * 5).toFixed(1)
    }
  },

  // 主持人暖场台词池（倒计时期间轮换）
  WARMUP_LINES: [
    '慢慢想，真诚最重要~',
    '写出第一反应就好，不用想太多',
    '答案只有自己知道，放心写',
    '大家随意，这不是考试',
    '越真实越有趣，别端着',
    '写完的可以看看周围人的表情',
    '每一题都在悄悄拉近距离'
  ],

  // 热度 key 算法
  heatKey(a, b) {
    return a < b ? `${a}-${b}` : `${b}-${a}`
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONSTANTS
} else {
  window.CONSTANTS = CONSTANTS
}
