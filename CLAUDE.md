# 三六局 (Sanliuju) V2

AI 主持人驱动的线下聚会破冰游戏。3 轮渐进式匹配：信息采集 → 当下匹配 → 人性博弈。

**部署**：Cloudflare Pages 静态站点 + Functions 代理 AI 调用。实时通信走 Supabase Realtime Broadcast。目标平台：Web 模拟器 → 微信小程序 → APP。

## 常用命令

```bash
# 语法检查（所有模块独立于浏览器运行，用 node --check）
node --check data/constants.js state/game-state.js engine/*.js ai/*.js channel/*.js ui/renderer.js app/actions.js

# 启动游戏监控（Node.js CLI，订阅 Supabase 房间事件）
node monitor.js <房间号>              # 标准模式
node monitor.js <房间号> --quiet      # 只输出告警
node monitor.js <房间号> --report     # 游戏结束生成 JSON 报告

# 部署（CF Pages，wrangler 已配置）
npx wrangler pages deploy .
```

## 架构层次

```
index.html (入口 + CSS + 引导脚本)
    ↓ 加载顺序决定依赖方向
data/         纯数据，无依赖。常量、惩罚词库
state/        状态管理。依赖 data/
engine/       游戏逻辑。依赖 state/ + data/
ai/           AI 通信。依赖 data/（prompt 模板 + 客户端）
channel/      消息总线。独立模块，Supabase Realtime 封装
ui/           渲染层。依赖 data/ + state/
app/          编排层。依赖所有上层模块
```

**核心原则**：数据流单向向下。`index.html` 引导脚本在底部初始化所有模块并注入依赖。

## 模块接口（window.* 全局命名空间）

| 模块 | 全局名 | 工厂函数 | 返回的关键方法 |
|------|--------|---------|---------------|
| `data/constants.js` | `CONSTANTS` | 无（直接导出对象） | 常量访问 |
| `data/penalties.js` | `PENALTIES_ENGINE` | 无（IIFE） | `getActivePool`, `drawPenalty`, `drawCandidates` |
| `state/game-state.js` | `GameState` | `createState()` | `reset`, `getSnapshot`, `restoreSnapshot`, `saveSession`, `loadSession`, `saveHostBackup`, `loadHostBackup` |
| `engine/round-manager.js` | `RoundManager` | `createRoundManager(sm)` | `startRound`, `nextRound`, `endGame`, `getQuestionsForRound`, `isRoundComplete`, `endRound` |
| `engine/match-calc.js` | `MatchCalc` | `createMatchCalc(sm)` | `updateHeat`, `applyAIScores`, `calcJealousy`, `stealthBoost`, `getTopPairs` |
| `engine/penalty-engine.js` | `PenaltyEngine` | `createPenaltyEngine(sm)` | `checkThresholds`, `generateCandidates`, `resolveVote`, `executePenalty` |
| `ai/prompt-templates.js` | `PromptTemplates` | 无（直接导出对象） | `buildQuestionPrompt`, `buildMatchAnalysisPrompt`, `buildRoundSummaryPrompt`, `buildGameSummaryPrompt` |
| `ai/ai-client.js` | `AIClient` | 无（直接导出对象） | `callAI`, `generateQuestion`, `analyzeMatches`, `generateRoundSummary`, `generateGameReport`, `generateCommentary` |
| `channel/supabase-channel.js` | `Channel` | 无（直接导出对象） | `genRoomId`, `joinRoom`, `leaveRoom`, `broadcast`, `requestState`, `isConnected` |
| `ui/renderer.js` | `Renderer` | `createRenderer(sm)` | `render`, `renderHostConsole`, `renderPlayerBoard`, `renderSettlement`, `renderGameEnd`, `renderFloatRoom`, `convergePlayers`, `toast` |
| `app/actions.js` | `AppActions` | `createActions(sm)` | `goHost`, `hostStartGame`, `hostGenerateQuestion`, `hostSettleRound`, `hostNextRound`, `hostEndGame`, `goPlayer`, `submitAnswer`, `castVote`, `rejoin` |

## 消息协议

所有消息通过 Supabase Realtime Broadcast 发送，格式 `{ type, from, data }`。

**Host → All**：`ROOM_STATE`, `GAME_STARTED`, `QUESTION`, `TIMER_TICK`, `TIMER_END`, `MATCH_RESULT`, `VOTE_START`, `VOTE_RESULT`, `ROUND_SETTLEMENT`, `ROUND_CHANGED`, `JEALOUSY_UPDATED`, `GAME_ENDED`, `AI_THINKING`

**Player → Host**：`PLAYER_JOINED`, `PLAYER_ANSWER`, `PLAYER_REJOINED`, `VOTE_CAST`, `ROOM_STATE_REQUEST`

**Host 是权威状态源**。所有游戏逻辑在 host 浏览器运行。Player 是瘦客户端——只接收广播、提交回答/投票。

## 游戏状态树 (`S` object)

```
S.role             'host' | 'player'
S.room             { id, status, round, maxPlayers }
S.players          [{ id, nickname, avatar, joined, isHost, coins }]
S.heat             { '1-3': 65 }  热力值，key 算法: heatKey(a,b) = min-max
S.jealousy         { playerId: value }
S.vote             { type, pairKey, candidates, tally, winner }
S.penalty          { selected, pair, type, executedAt }
S.roundAnswers     { round: { answers: { playerId: text } } }
S.game.question   当前题目
S.game.questionCount  本轮已出题数
S.game.roundPhase   'question'|'analysis'|'results'|'penalty'|'settlement'|'ended'
S.game.timerEnd    Date.now() + seconds*1000
S.logs             游戏事件日志
```

**关键不变量**：host 的 `playerId` 始终为 `0`，`isHost: true`。heat 键中绝不应出现 host（actions.js 在匹配分析时过滤）。

## 游戏循环

```
hostGenerateQuestion() → AI出题 → 30s倒计时 → 玩家提交文字回答
    ↓
stopTimer() → 800ms延迟 → hostAnalyzeMatches() 自动触发
    ↓
AI分析 → 更新S.heat → 广播MATCH_RESULT → 检查惩罚阈值
    ↓ (如果 questionCount >= 当轮上限)
SETTLEMENT_DISPLAY_MS 后 → hostSettleRound() 自动触发
    ↓
AI生成结算 → 广播ROUND_SETTLEMENT → 显示嫉妒值(轮1)
    ↓
hostNextRound() → 1.5s后自动出第一题 → 循环
    ↓ (三轮后)
hostEndGame() → AI终审报告 → 广播GAME_ENDED
```

## 回合配置

| 轮 | 名称 | 题目数 | 特殊规则 |
|----|------|--------|---------|
| 1 | 信息采集 | 玩家数×2 | 轻松生活化，轮末结算嫉妒值 |
| 2 | 当下匹配 | 5 | 当下场景题，匹配结果展示 |
| 3 | 人性博弈 | 3 | 清空上下文，深度价值观题，隐蔽挖墙脚 |

## 文件关系与注意事项

- **`questions.js`（根目录）** 是 AI 超时时的兜底题库，`window.QUESTIONS_DATA.drawFallback(round)`
- **`penalties.js`（根目录）** 是 V1 遗留惩罚引擎，仅供 `penalties.html` 管理页使用。游戏运行时用 `data/penalties.js` 的 V2 版本
- **`functions/api/ai.js`** 是 CF Pages Function AI 代理。前端 `ai/ai-client.js` 直接调 DeepSeek（API key 在前端暴露，仅开发阶段）。生产环境应走 CF Function 代理
- **`monitor.js`** 是独立 Node.js 进程，通过 Supabase Realtime 订阅房间事件，不嵌入主应用
- **State 序列化**：`usedQuestions` 是 `Set`，在 `getSnapshot()`/`saveHostBackup()` 中转为数组，在 `restoreSnapshot()` 中转回 Set。新增字段时需同步更新这三个函数
- **Index.html 加载顺序**：data → state → engine → ai → channel → ui → app，依赖方向决定顺序
- **所有 engine/state 模块** 通过 `stateManager.state` 闭包引用同一个 `S` 对象。模块间通过 `window.*` 工厂函数创建，在 `index.html` 引导脚本中注入依赖
- **TTS 接入**：百度短文本在线合成 API（AppID: 7751562），精品音库 5 万次配额 3 QPS，需通过 CF Function 代理调用避免 API key 泄露。详见 `语音合成文档.txt`
