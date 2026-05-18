/**
 * 三六局 V2 — UI 渲染器
 * DOM 操作层。平台移植时整个替换（DOM → WXML）。
 */
(function() {
const C = window.CONSTANTS

function createRenderer(stateManager) {
  const S = stateManager.state
  function $(id) { return document.getElementById(id) }

  function render() {
    if (!S.role) { renderEntry(); return }
    if (S.role === 'host') {
      if (S.room.status === 'waiting') renderHostWait()
      else if (S.room.status === 'ended') renderGameEnd()
      else if (S.game.phase === 'settlement') renderSettlement()
      else renderHostConsole()
    }
    if (S.role === 'player') {
      if (S.room.status === 'ended') renderGameEnd()
      else if (S.game.phase === 'settlement') renderPlayerSettlement()
      else renderPlayerBoard()
    }
  }

  // ===== Entry =====
  function renderEntry() {
    const profiles = JSON.parse(localStorage.getItem('slj_profiles') || '[]')
    const listEl = $('profile-list')
    if (listEl && profiles.length > 0) {
      listEl.innerHTML = profiles.map(p => `<div style="text-align:center;cursor:pointer" onclick="App.useProfile('${p.id}')"><div style="font-size:32px">${p.avatar||'🎭'}</div><div style="font-size:12px;color:var(--text2)">${p.name}</div></div>`).join('')
      listEl.style.display = ''
    } else if (listEl) { listEl.style.display = 'none' }
  }

  // ===== Host Wait =====
  function renderHostWait() {
    const el = $('host-room-id'); if (el) el.textContent = S.room?.id || '------'
    renderFloatRoom('host-player-room', S.players, S.room.maxPlayers, true)
    const hint = $('host-wait-hint')
    if (hint) {
      const count = S.players.filter(p => p.joined && !p.isHost).length
      hint.textContent = count > 0 ? `${count}/${S.room.maxPlayers} 人已加入` : '等待玩家加入… 告知房间号'
    }
    const startBtn = $('host-start-btn')
    if (startBtn) startBtn.disabled = S.players.filter(p => p.joined && !p.isHost).length < 2
  }

  // ===== Host Console =====
  function renderHostConsole() {
    const rid = $('host-room-id'); if (rid) rid.textContent = S.room?.id || '------'
    const config = roundManagerConfig()
    const rb = $('console-round-badge'); if (rb) rb.textContent = `第${S.room.round}轮 · ${C.ROUND_NAMES[S.room.round]||''}`
    const qInfo = $('question-info'); if (qInfo) qInfo.textContent = `第 ${S.game.questionCount||0} / ${config?.questionCount||'?'} 题`

    // Host script card — strip raw JSON, add guide prefix
    const scriptCard = $('host-script-card'), scriptText = $('host-script-text')
    if (scriptCard && scriptText && S.game._hostLine) {
      let line = S.game._hostLine
      // Strip ANY raw JSON — extract the meaningful text field
      if (line.startsWith('{') && line.includes('"func"')) {
        const j = extractTextFromJSON(line)
        if (j) line = j
      }
      scriptCard.style.display = ''
      scriptText.textContent = '你可以跟大家说："' + line + '"'
    } else if (scriptCard) { scriptCard.style.display = 'none' }

    // Question card — driven by phase
    const qEl = $('console-question')
    const hasDraft = !!S.game._draftQuestion
    if (qEl) {
      const p = S.game.phase
      if (p === 'preview' && hasDraft) { qEl.textContent = '📝 ' + S.game._draftQuestion; qEl.classList.remove('empty'); qEl.classList.add('ai-loading') }
      else if (p === 'answering' && S.game.question) { qEl.textContent = S.game.question; qEl.classList.remove('empty','ai-loading') }
      else if (p === 'drafting') { qEl.textContent = '🤖 正在出题…'; qEl.classList.add('ai-loading'); qEl.classList.remove('empty') }
      else if (p === 'analyzing') { qEl.textContent = '⏳ 分析中…'; qEl.classList.add('ai-loading'); qEl.classList.remove('empty') }
      else if (p === 'results') { qEl.textContent = '✅ 匹配结果已生成'; qEl.classList.remove('empty','ai-loading') }
      else { qEl.textContent = '点「来一题」开始'; qEl.classList.add('empty'); qEl.classList.remove('ai-loading') }
    }

    // Timer
    const timerEl = $('console-timer')
    if (timerEl) {
      if (S.game.timerRunning) { const r = Math.max(0, Math.round((S.game.timerEnd - Date.now())/1000)); timerEl.textContent = r; if (r <= 5) timerEl.classList.add('warn'); else timerEl.classList.remove('warn') }
      else { timerEl.textContent = '--'; timerEl.classList.remove('warn') }
    }

    // Buttons
    const qBtn = $('console-question-btn')
    if (qBtn) {
      const p = S.game.phase
      if (p === 'answering' || p === 'analyzing' || p === 'voting') { qBtn.style.display = 'none' }
      else if (p === 'preview') { qBtn.style.display = ''; qBtn.textContent = '📤 发布题目' }
      else if (p === 'results') { qBtn.style.display = ''; qBtn.textContent = '🎲 下一题' }
      else { qBtn.style.display = ''; qBtn.textContent = '🎲 来一题' }
    }
    const nextRoundBtn = $('console-nextround-btn'); if (nextRoundBtn) nextRoundBtn.style.display = (S.game.phase === 'results' && (S.game.questionCount||0) >= (roundManagerConfig()?.questionCount||0)) ? '' : 'none'
    const adminBtns = $('admin-btns'); if (adminBtns) adminBtns.style.display = (hasDraft || S.game.question || S.penalty) ? '' : 'none'
    const reopenBtn = $('btn-reopen'); if (reopenBtn) reopenBtn.style.display = S.game.question ? '' : 'none'
    const skipQBtn = $('btn-skip-q'); if (skipQBtn) skipQBtn.style.display = (hasDraft || S.game.question) ? '' : 'none'
    const skipPBtn = $('btn-skip-p'); if (skipPBtn) skipPBtn.style.display = S.penalty ? '' : 'none'

    // Answer count
    const countEl = $('answered-count')
    if (countEl && S.game.question) {
      const answers = S.roundAnswers?.[S.room.round]?.answers || {}
      const total = S.players.filter(p => p.joined && !p.isHost).length
      countEl.textContent = `已回答 ${Object.keys(answers).length}/${total}`
    } else if (countEl) { countEl.textContent = '' }

    // Answers list
    const ansEl = $('host-answers')
    if (ansEl && S.game.question) {
      const answers = S.roundAnswers?.[S.room.round]?.answers || {}
      ansEl.innerHTML = S.players.filter(p => p.joined && !p.isHost).map(p => { const a = answers[p.id]; return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;"><span>${p.avatar||'🎭'}</span><span style="font-weight:600">${p.nickname||('玩家'+p.id)}</span><span style="color:${a?'var(--success)':'var(--text2)'};flex:1">${a||'⏳'}</span></div>` }).join('')
    } else if (ansEl) { ansEl.innerHTML = '' }

    // Match results
    const matchPanel = $('match-result')
    if (matchPanel && S.game._matchAnalysis && S.game.phase === 'results') {
      matchPanel.style.display = ''
      const pairsEl = $('match-pairs')
      if (pairsEl) {
        const topPairs = Object.entries(S.heat).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,5)
        pairsEl.innerHTML = topPairs.map(([key,val])=>{const[a,b]=key.split('-').map(Number);const pa=S.players.find(x=>x.id===a);const pb=S.players.find(x=>x.id===b);return `<div style="display:flex;align-items:center;gap:8px;font-size:13px;"><span>${pa?.avatar||'?'} ${pa?.nickname||a}</span><span style="color:var(--text2)">↔</span><span>${pb?.avatar||'?'} ${pb?.nickname||b}</span><span style="margin-left:auto;font-weight:700;color:var(--warm)">${val}</span></div>`}).join('')||'<div style="font-size:12px;color:var(--text2)">暂无匹配数据</div>'
      }
      const analysisEl = $('match-analysis'); if (analysisEl) analysisEl.textContent = S.game._matchAnalysis
    } else if (matchPanel) { matchPanel.style.display = 'none' }

    // Vote status panel
    const votePanel = $('host-vote-status')
    // Penalty reveal overlay (when result just came in)
    renderPenaltyReveal()

    if (votePanel && S.game.phase === 'penalty' && S.vote && S.vote.candidates) {
      votePanel.style.display = ''
      const pn = pairNames(S.vote.pairKey)
      $('host-vote-title').textContent = (S.vote.type === 'rise' ? '🔺 亲密惩罚' : '🔻 公开惩罚') + ' · ' + pn + ' · 等待投票'
      $('host-vote-candidates').innerHTML = S.vote.candidates.map((c, i) =>
        `<div onclick="App.castVote(${i})" style="padding:10px 12px;background:${S.vote._hostVote===i?'rgba(249,115,22,0.12)':'var(--card)'};border:1px solid ${S.vote._hostVote===i?'var(--warm)':'var(--border)'};border-radius:10px;font-size:13px;display:flex;justify-content:space-between;cursor:pointer;transition:all .15s;">
          <span>${c.icon} ${c.label}: ${c.text}</span><span style="color:var(--warm);font-weight:600;">${c.votes || 0} 票</span></div>`).join('')
      const total = S.players.filter(p => p.joined && !p.isHost).length
      const voted = Object.keys(S.vote.tally || {}).length
      $('host-vote-progress').textContent = `投票进度 ${voted}/${total}`
    } else if (votePanel) { votePanel.style.display = 'none' }

    // Phase badge
    const phaseEl = $('phase-badge')
    if (phaseEl) {
      const labels = { drafting:'🤖 生成题目中', preview:'👀 预览题目', answering:'🧠 答题中', analyzing:'🔍 分析中', results:'📊 查看结果', voting:'🎲 惩罚投票中', settlement:'📋 结算中', ended:'🏁 游戏结束' }
      phaseEl.textContent = labels[S.game.phase] || ''
      phaseEl.style.display = S.game.phase && S.game.phase !== 'question' ? '' : 'none'
    }

    renderFloatRoom('host-player-room', S.players, S.room.maxPlayers, true)
  }

  function roundManagerConfig() {
    return { questionCount: C.QUESTIONS_PER_ROUND[S.room.round] || (S.players.filter(p=>p.joined&&!p.isHost).length*2)||4 }
  }

  // ===== Settlement (Host) =====
  function renderSettlement() {
    const page = $('settlement-section'); if (!page) return
    $(S.room.status==='playing'?'page-host-console':'page-player-board')?.classList.remove('active')
    page.style.display = ''; page.classList.add('active')

    const sd = S.game.settlementData || {}
    $('settlement-title').textContent = `第${S.room.round}轮 · ${C.ROUND_NAMES[S.room.round]||''} 结算`
    $('settlement-sub').textContent = sd.ai_comment || '本轮完成！'
    $('settlement-icon').textContent = S.room.round >= 3 ? '🎉' : '📊'

    const pairsEl = $('settlement-pairs')
    if (pairsEl) {
      const topPairs = Object.entries(S.heat).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,3)
      pairsEl.innerHTML = topPairs.map(([key,val])=>{const[a,b]=key.split('-').map(Number);const pa=S.players.find(x=>x.id===a);const pb=S.players.find(x=>x.id===b);return `<div style="padding:8px 14px;background:var(--card);border-radius:12px;text-align:center;margin:4px 0;font-size:14px;">${pa?.avatar||'?'} ${pa?.nickname||a} ↔ ${pb?.avatar||'?'} ${pb?.nickname||a} <span style="font-weight:700;color:var(--warm)">${val}</span></div>`}).join('')
    }

    const jPanel = $('settlement-jealousy')
    if (jPanel) {
      const jealous = S.players.filter(p=>p.joined&&!p.isHost&&(S.jealousy[p.id]||0)>0)
      jPanel.style.display = jealous.length > 0 ? '' : 'none'
      if (jealous.length > 0) {
        $('jealousy-list').innerHTML = jealous.map(p=>`<div style="padding:6px 12px;background:var(--card);border-radius:10px;font-size:12px;">${p.avatar} ${p.nickname||('玩家'+p.id)} 💔${S.jealousy[p.id]}</div>`).join('')
      }
    }

    const btn = $('settlement-next-btn')
    if (btn) { btn.textContent = S.room.round >= 3 ? '🎉 查看最终结果' : '→ 进入下一轮'; btn.style.display = '' }
  }

  // ===== Settlement (Player) =====
  function renderPlayerSettlement() {
    $('page-player-board')?.classList.remove('active')
    const page = $('settlement-section')
    if (page) { page.style.display = ''; page.classList.add('active') }

    const sd = S.game.settlementData || {}
    $('settlement-title').textContent = `第${S.room.round}轮 · ${C.ROUND_NAMES[S.room.round]||''} 结算`
    $('settlement-sub').textContent = sd.ai_comment || '本轮完成！'
    $('settlement-icon').textContent = S.room.round >= 3 ? '🎉' : '📊'

    const pairsEl = $('settlement-pairs')
    if (pairsEl) {
      const topPairs = Object.entries(S.heat).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,3)
      pairsEl.innerHTML = topPairs.map(([key,val])=>{const[a,b]=key.split('-').map(Number);const pa=S.players.find(x=>x.id===a);const pb=S.players.find(x=>x.id===b);return `<div style="padding:8px 14px;background:var(--card);border-radius:12px;text-align:center;margin:4px 0;font-size:14px;">${pa?.avatar||'?'} ${pa?.nickname||a} ↔ ${pb?.avatar||'?'} ${pb?.nickname||b} <span style="font-weight:700;color:var(--warm)">${val}</span></div>`}).join('')||'<div style="font-size:13px;color:var(--text2);text-align:center;">等待主持人…</div>'
    }

    const jPanel = $('settlement-jealousy'); if (jPanel) jPanel.style.display = 'none'
    const btn = $('settlement-next-btn'); if (btn) btn.style.display = 'none'
  }

  // ===== Player Board =====
  function renderPlayerBoard() {
    // Top bar
    const rb = $('player-round-badge')
    if (rb) { rb.textContent = S.room.round > 0 ? `第${S.room.round}轮 · ${C.ROUND_NAMES[S.room.round]||''}` : ''; rb.style.display = S.room.round > 0 ? '' : 'none' }
    const rt = $('player-room-tag'); if (rt) rt.textContent = S.room?.id ? '🏠 ' + S.room.id : ''
    const pt = $('player-phase-text')
    if (pt) { const labels = { drafting:'🤖 出题中', preview:'👀 预览中', answering:'🧠 答题中', analyzing:'🔍 分析中', results:'📊 揭晓结果', voting:'🎲 投票中', settlement:'📋 结算中' }; pt.textContent = labels[S.game.phase] || '' }

    // Waiting state
    const waitArea = $('player-waiting-area'), gameArea = $('player-game-area')
    if (S.room.status !== 'playing') {
      if (waitArea) waitArea.style.display = ''
      if (gameArea) gameArea.style.display = 'none'
      const wc = $('player-wait-room-code'); if (wc) wc.textContent = S.room?.id || '------'
      const avatarsEl = $('player-wait-avatars')
      if (avatarsEl) {
        const joined = S.players.filter(p => p.joined)
        avatarsEl.innerHTML = joined.map(p =>
          `<div style="text-align:center;animation:fadeUp .4s ease both;animation-delay:${joined.indexOf(p)*0.05}s">
            <div style="width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;font-size:22px;">${p.avatar||'🎭'}</div>
            <div style="font-size:10px;color:var(--t2);margin-top:4px;max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.nickname||p.id}</div></div>`).join('') || '<span style="color:var(--t3);font-size:13px;">等待玩家加入…</span>'
      }
      return
    }
    if (waitArea) waitArea.style.display = 'none'
    if (gameArea) gameArea.style.display = ''

    // Timer ring
    const timerWrap = $('player-timer-wrap'), timerRing = $('player-timer-ring'), timerText = $('player-timer-text')
    const CIRC = 263.9
    if (timerWrap && timerRing && timerText) {
      if (S.game.timerRunning) {
        timerWrap.style.display = ''
        const remaining = (S.game.timerRemaining != null) ? S.game.timerRemaining : Math.max(0, Math.round((S.game.timerEnd - Date.now()) / 1000))
        const progress = Math.max(0, Math.min(1, remaining / C.TIMER_SECONDS))
        timerRing.style.strokeDashoffset = CIRC * (1 - progress)
        timerText.textContent = remaining
        if (remaining <= 5) { timerRing.style.stroke = 'var(--danger)'; timerText.style.color = 'var(--danger)' }
        else if (remaining <= 15) { timerRing.style.stroke = '#F59E0B'; timerText.style.color = '#F59E0B' }
        else { timerRing.style.stroke = 'var(--warm)'; timerText.style.color = 'var(--text)' }
      } else { timerWrap.style.display = 'none' }
    }

    // Question card — phase-driven
    const qEl = $('player-question')
    if (qEl) {
      const p = S.game.phase
      if (p === 'answering' && S.game.question) { qEl.textContent = S.game.question; qEl.classList.remove('empty','ai-loading') }
      else if (p === 'drafting' || p === 'analyzing') { qEl.textContent = '⏳ 稍等…'; qEl.classList.add('ai-loading'); qEl.classList.remove('empty') }
      else if (S.game.question) { qEl.textContent = S.game.question; qEl.classList.remove('empty','ai-loading') }
      else { qEl.textContent = '等待出题…'; qEl.classList.add('empty'); qEl.classList.remove('ai-loading') }
    }

    // Answer area
    const answerArea = $('player-answer-area'), answerInput = $('player-answer-input'), answerBtn = $('player-answer-btn'), micBtn = $('player-mic-btn')
    if (answerArea) {
      if (S.game.phase === 'answering' || (S.game.question && S.game.timerRunning)) {
        answerArea.style.display = ''
        if (S._answeredThisRound) {
          if (answerInput) answerInput.disabled = true
          if (answerBtn) { answerBtn.textContent = '✅ 已提交'; answerBtn.disabled = true; answerBtn.style.opacity = '0.5' }
          if (micBtn) micBtn.style.display = 'none'
        } else {
          if (answerInput) answerInput.disabled = false
          if (answerBtn) { answerBtn.textContent = '提交回答'; answerBtn.disabled = false; answerBtn.style.opacity = '1' }
          if (micBtn) micBtn.style.display = ''
        }
      } else { answerArea.style.display = 'none' }
    }

    // Match results
    const matchPanel = $('player-match-result')
    if (matchPanel && S.game._matchAnalysis && S.game.phase === 'results') {
      matchPanel.style.display = ''
      // Show top pairs with scores
      const pairsEl = $('player-match-pairs')
      if (pairsEl) {
        const topPairs = Object.entries(S.heat).filter(([,v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3)
        pairsEl.innerHTML = topPairs.map(([key, val], i) => {
          const [a, b] = key.split('-').map(Number)
          const pa = S.players.find(x => x.id === a)
          const pb = S.players.find(x => x.id === b)
          const emoji = val >= 60 ? '🔥' : val >= 40 ? '✨' : '👀'
          const colors = ['var(--warm)', '#F59E0B', 'var(--t2)'][i] || 'var(--t2)'
          return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(255,255,255,0.03);border-radius:14px;border:1px solid rgba(255,255,255,0.06);animation:fadeUp .4s ease both;animation-delay:${i*0.1}s;">
            <span style="font-size:24px;">${pa?.avatar||'?'}</span>
            <span style="font-weight:600;color:var(--text);flex:1;">${pa?.nickname||a} ↔ ${pb?.nickname||b}</span>
            <span style="font-size:20px;font-weight:800;color:${colors};">${val}</span>
            <span style="font-size:16px;">${emoji}</span></div>`
        }).join('') || '<div style="text-align:center;color:var(--t3);font-size:12px;">等待更多数据…</div>'
      }
      $('player-match-text').textContent = S.game._matchAnalysis
    } else if (matchPanel) { matchPanel.style.display = 'none' }

    // Penalty reveal overlay
    renderPenaltyReveal()

    // Vote panel
    const votePanel = $('player-vote-panel')
    if (votePanel && S.vote && S.vote.candidates && S.game.phase === 'penalty') {
      votePanel.style.display = ''
      votePanel.innerHTML =
        `<div style="font-size:14px;font-weight:700;color:var(--warm);margin-bottom:8px;text-align:center;">${S.vote.type==='rise'?'🔺 亲密惩罚':'🔻 公开惩罚'} · ${pairNames(S.vote.pairKey)}</div>` +
        (S.vote.thresholdInfo ? `<div style="font-size:11px;color:var(--t3);text-align:center;margin-bottom:10px;">${S.vote.thresholdInfo}</div>` : '') +
        `<div style="font-size:12px;color:var(--t2);text-align:center;margin-bottom:8px;">请投票选择</div>` +
        S.vote.candidates.map((c,i) => {
          const selected = S._myVote === i
          return `<button onclick="App.castVote(${i})" style="display:block;width:100%;margin:6px 0;padding:14px 16px;text-align:left;
            background:${selected?'rgba(249,115,22,0.12)':'rgba(255,255,255,0.04)'};border:1px solid ${selected?'var(--warm)':'rgba(255,255,255,0.1)'};border-radius:14px;font-size:14px;color:var(--text);cursor:pointer;transition:all .15s;">
            <span style="font-size:18px;">${c.icon}</span> <span style="font-weight:600;">${c.label}</span>
            <span style="color:var(--t2);"> — ${c.text}</span>
            ${selected ? '<span style="float:right;color:var(--warm);">✓ 已投</span>' : (c.votes ? `<span style="float:right;color:var(--warm);font-weight:700;">${c.votes}票</span>` : '')}</button>`
        }).join('')
    } else if (votePanel) { votePanel.style.display = 'none' }

    // Player list at bottom
    const playerList = $('player-board-players')
    if (playerList) {
      const joined = S.players.filter(p => p.joined)
      playerList.innerHTML = joined.map(p =>
        `<div style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(255,255,255,0.03);border-radius:20px;font-size:12px;">
          <span style="font-size:18px;">${p.avatar||'🎭'}</span><span style="color:var(--text);font-weight:500;">${p.nickname||('玩家'+p.id)}</span>
          ${p.isHost ? '<span style="font-size:10px;color:var(--warm);">主持</span>' : ''}</div>`).join('')
    }
  }

  // ===== Game End =====
  function renderGameEnd() {
    const page = $('page-game-end'); if (!page) return
    $(S.role==='host'?'page-host-console':'page-player-board')?.classList.remove('active')
    const ss = $('settlement-section'); if (ss) ss.style.display = 'none'
    page.classList.add('active')

    const report = S.game._gameReport
    $('end-report').textContent = report?.report || '游戏结束！看看谁和谁最默契吧~'
    $('end-icon').textContent = '🎉'

    const resultsEl = $('end-results')
    if (resultsEl) {
      const topPairs = Object.entries(S.heat).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,5)
      resultsEl.innerHTML = topPairs.map(([key,val])=>{const[a,b]=key.split('-').map(Number);const pa=S.players.find(x=>x.id===a);const pb=S.players.find(x=>x.id===b);return `<div style="padding:10px 16px;background:var(--card);border-radius:12px;text-align:center;margin:6px 0;font-size:14px;">${pa?.avatar||'?'} ${pa?.nickname||a} ↔ ${pb?.avatar||'?'} ${pb?.nickname||b} <span style="font-size:20px;font-weight:800;color:var(--warm);margin-left:8px;">${val}</span></div>`}).join('')
    }
  }

  // ===== Shared =====
  function pairNames(pairKey) {
    if (!pairKey) return ''
    const [a, b] = pairKey.split('-').map(Number)
    const pa = S.players.find(x => x.id === a)
    const pb = S.players.find(x => x.id === b)
    return (pa?.nickname || ('玩家' + a)) + ' ↔ ' + (pb?.nickname || ('玩家' + b))
  }

  function renderFloatRoom(roomId, players, maxPlayers, showHeat) {
    const room = $(roomId); if (!room) return
    const joined = players.filter(p => p.joined && !p.isHost)
    room.innerHTML = joined.map((p, i) => {
      const seed = (p.id * 7 + 13) % 100 / 100
      const left = 10 + seed * (room.clientWidth - 100)
      const top = 20 + ((i * 37 + 11) % 60) * (room.clientHeight / 100)
      const drift = C.generateDrift()
      return `<div class="player-float joined" data-pid="${p.id}" style="left:${left}px;top:${top}px;--drift-x:${drift.x}px;--drift-y:${drift.y}px;--drift-dur:${drift.dur}s;--drift-delay:${drift.delay}s"><div class="pf-avatar">${p.avatar||'🎭'}</div><div class="pf-tag">${p.nickname||('玩家'+p.id)}</div>${p.isHost?'<div class="pf-host">👑</div>':''}</div>`
    }).join('') + (joined.length === 0 ? '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--t2);font-size:14px;">等待玩家加入…</div>' : '')
  }

  function extractTextFromJSON(str) {
    try {
      const j = JSON.parse(str)
      return j.text || j.question || j.analysis || j.ai_comment || j.report || ''
    } catch (_) {
      // Try regex extraction
      for (const key of ['text', 'question', 'analysis', 'ai_comment']) {
        const m = str.match(new RegExp('"' + key + '"\\s*:\\s*"([^"]+)"'))
        if (m) return m[1]
      }
      return ''
    }
  }

  function renderPenaltyReveal() {
    if (!S.penalty || S.penalty._shown) return
    S.penalty._shown = true
    const pn = pairNames(S.penalty.pair?.join('-') || '')

    const type = S.penalty.type
    const isRise = type === 'rise'
    const emoji = isRise ? '🔺' : '🔻'
    const title = isRise ? '亲密惩罚' : '公开惩罚'
    const colors = isRise
      ? { bg: 'linear-gradient(135deg,rgba(236,72,153,0.15),rgba(249,115,22,0.1))', border: 'rgba(236,72,153,0.3)', particles: '💕💗✨🌸🎀' }
      : { bg: 'linear-gradient(135deg,rgba(6,182,212,0.15),rgba(250,204,21,0.1))', border: 'rgba(6,182,212,0.3)', particles: '⚡💥🔥🎪📢' }

    const card = document.createElement('div')
    card.style.cssText = `position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);animation:fadeIn .3s ease;`
    card.innerHTML = `
      <div style="position:relative;width:300px;background:${colors.bg};border:2px solid ${colors.border};border-radius:24px;padding:28px 20px;text-align:center;animation:scaleInBounce .5s cubic-bezier(.22,.61,.36,1);">
        <div style="font-size:56px;margin-bottom:8px;animation:pulse .6s ease-in-out 3;">${emoji}</div>
        <div style="font-size:22px;font-weight:800;color:var(--text);margin-bottom:6px;">${title}</div>
        <div style="font-size:14px;color:var(--warm);margin-bottom:16px;">${pn}</div>
        <div style="font-size:36px;margin-bottom:8px;">${S.penalty.selected?.icon || '🎯'}</div>
        <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px;">${S.penalty.selected?.label || ''}</div>
        <div style="font-size:13px;color:var(--text2);">${S.penalty.selected?.text || ''}</div>
        <div style="margin-top:16px;font-size:24px;letter-spacing:4px;animation:particleFloat 1.5s ease-out infinite;">${colors.particles}</div>
      </div>`
    card.addEventListener('click', () => card.remove())
    document.body.appendChild(card)
    setTimeout(() => { if (card.parentNode) card.remove() }, 6000)
  }

  function toast(msg) {
    const el = $('toast'); if (!el) return; el.textContent = msg; el.classList.add('show')
    clearTimeout(toast._timer); toast._timer = setTimeout(() => el.classList.remove('show'), 2500)
  }

  return { render, renderEntry, renderHostWait, renderHostConsole,
    renderSettlement, renderPlayerSettlement, renderPlayerBoard, renderGameEnd,
    renderFloatRoom, convergePlayers: function(roomId, pairs) {
      const room = $(roomId); if (!room) return
      const cw = room.clientWidth; const ch = room.clientHeight || 380
      pairs.forEach((pair, i) => {
        const elA = room.querySelector('[data-pid="' + pair.a + '"]')
        const elB = room.querySelector('[data-pid="' + pair.b + '"]')
        if (!elA || !elB) return
        const cx = cw / 2 + (i - (pairs.length - 1) / 2) * 120
        elA.style.left = (cx - 30) + 'px'; elA.style.top = (ch / 2 - 10) + 'px'
        elB.style.left = (cx + 10) + 'px'; elB.style.top = (ch / 2 + 10) + 'px'
        elA.classList.add('converged'); elB.classList.add('converged')
      })
    }, toast }
}

if (typeof module !== 'undefined' && module.exports) { module.exports = { createRenderer } }
else { window.Renderer = { createRenderer } }
})()
