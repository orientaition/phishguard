// content.js — Gmail SPA 감지 + 패널 주입

(function () {
  'use strict';

  let lastAnalyzedId = '';
  let isAnalyzing = false;

  const observer = new MutationObserver(debounce(onDomChange, 800));
  observer.observe(document.body, { childList: true, subtree: true });

  function onDomChange() {
    const body = extractBody();
    const metadata = extractMetadata();
    if (!body) return;
    const emailId = (metadata.senderEmail + '::' + metadata.subject).trim();
    if (!emailId || emailId === '::' || emailId === lastAnalyzedId || isAnalyzing) return;
    lastAnalyzedId = emailId;
    startAnalysis(body, metadata);
  }

  function extractBody() {
    const selectors = ['div.a3s.aiL', 'div[data-message-id] .a3s', '.ii.gt .a3s.aiL', 'div.gs .a3s'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 30) return el.innerText.trim();
    }
    return null;
  }

  function extractMetadata() {
    const meta = { subject: '', sender: '', senderEmail: '', date: '' };
    try {
      const subjectEl = document.querySelector('h2.hP');
      if (subjectEl) meta.subject = subjectEl.innerText.trim();
      const senderEl = document.querySelector('span.gD');
      if (senderEl) {
        meta.sender = senderEl.getAttribute('name') || '';
        meta.senderEmail = senderEl.getAttribute('email') || '';
      }
      const dateEl = document.querySelector('span.g3');
      if (dateEl) meta.date = dateEl.innerText.trim();
    } catch (e) { }
    return meta;
  }

  function startAnalysis(body, metadata) {
    isAnalyzing = true;
    showPanel('loading', null, metadata);
    chrome.runtime.sendMessage(
      { type: 'ANALYZE_EMAIL', payload: { body, metadata } },
      (response) => {
        isAnalyzing = false;
        if (chrome.runtime.lastError) { showPanel('error', chrome.runtime.lastError.message, metadata); return; }
        if (!response || !response.ok) { showPanel('error', response?.error || '알 수 없는 오류', metadata); return; }
        chrome.runtime.sendMessage({ type: 'UPDATE_STATS', level: response.result.riskLevel });
        showPanel('result', response.result, metadata);
      }
    );
  }

  // ── HIGH 위험도 전체화면 오버레이 ─────────────────────────────────────
  function showOverlay(metadata) {
    const existing = document.getElementById('phishguard-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'phishguard-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483646',
      background: 'rgba(140, 0, 0, 0.22)',
      backdropFilter: 'blur(3px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '"JetBrains Mono", monospace',
      animation: 'pgFadeIn 0.25s ease forwards',
    });

    overlay.innerHTML = `
      <style>
        @keyframes pgFadeIn  { from{opacity:0} to{opacity:1} }
        @keyframes pgFadeOut { from{opacity:1} to{opacity:0} }
        @keyframes pgShake   { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)} 40%{transform:translateX(8px)} 60%{transform:translateX(-5px)} 80%{transform:translateX(5px)} }
      </style>
      <div style="
        background:#160808;
        border:1.5px solid rgba(255,60,60,0.45);
        border-radius:10px;
        padding:30px 28px 24px;
        max-width:400px;width:90%;
        text-align:center;
        box-shadow:0 0 80px rgba(255,0,0,0.2),0 24px 60px rgba(0,0,0,0.8);
        animation:pgShake 0.45s ease 0.15s;
      ">
        <div style="width:56px;height:56px;border-radius:50%;background:rgba(255,60,60,0.1);border:2px solid rgba(255,60,60,0.35);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 20h20L12 2z" stroke="#ff4444" stroke-width="1.8" fill="rgba(255,60,60,0.1)"/>
            <path d="M12 9v5M12 16.5v.5" stroke="#ff4444" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>

        <div style="font-size:13px;font-weight:700;letter-spacing:0.15em;color:#ff5555;text-transform:uppercase;margin-bottom:10px;">
          ⚠ 스피어피싱 위험 감지
        </div>

        <div style="font-size:11px;color:#666;margin-bottom:5px;font-family:'Noto Sans KR',sans-serif;">발신자</div>
        <div style="font-size:12px;color:#ffaaaa;background:rgba(255,60,60,0.07);border:1px solid rgba(255,60,60,0.18);border-radius:4px;padding:7px 12px;margin-bottom:16px;word-break:break-all;">
          ${esc(metadata?.senderEmail || '(알 수 없음)')}
        </div>

        <div style="font-size:12px;color:#cc8888;line-height:1.8;font-family:'Noto Sans KR',sans-serif;margin-bottom:22px;">
          이 이메일은 <strong style="color:#ff6666;">높은 위험도</strong>로 분류되었습니다.<br>
          링크 클릭 및 첨부파일 열람을 자제해주세요.
        </div>

        <div style="display:flex;gap:8px;">
          <button id="pg-ov-confirm" style="flex:1;padding:10px;background:rgba(255,60,60,0.1);border:1px solid rgba(255,60,60,0.35);border-radius:5px;color:#ff6666;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;font-family:'JetBrains Mono',monospace;"
            onmouseover="this.style.background='rgba(255,60,60,0.2)'" onmouseout="this.style.background='rgba(255,60,60,0.1)'">
            내용 확인
          </button>
          <button id="pg-ov-back" style="flex:1;padding:10px;background:#1e1e1e;border:1px solid #333;border-radius:5px;color:#999;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;font-family:'JetBrains Mono',monospace;"
            onmouseover="this.style.background='#2a2a2a'" onmouseout="this.style.background='#1e1e1e'">
            뒤로 가기
          </button>
        </div>

        <div style="margin-top:12px;font-size:9px;color:#333;letter-spacing:0.06em;">ESC 키로 닫기</div>
      </div>
    `;

    document.body.appendChild(overlay);

    // 내용 확인 버튼 — 오버레이 닫고 분석 패널 유지
    overlay.querySelector('#pg-ov-confirm').addEventListener('click', () => {
      overlay.style.animation = 'pgFadeOut 0.2s ease forwards';
      setTimeout(() => overlay.remove(), 200);
    });

    // 뒤로 가기
    overlay.querySelector('#pg-ov-back').addEventListener('click', () => {
      overlay.remove();
      history.back();
    });

    // ESC 닫기
    const onEsc = (e) => {
      if (e.key === 'Escape') {
        overlay.style.animation = 'pgFadeOut 0.2s ease forwards';
        setTimeout(() => overlay.remove(), 200);
        document.removeEventListener('keydown', onEsc);
      }
    };
    document.addEventListener('keydown', onEsc);
  }

  // ── 패널 표시 ─────────────────────────────────────────────────────────
  function showPanel(status, data, metadata) {
    const existing = document.getElementById('phishguard-root');
    if (existing) existing.remove();

    // HIGH 위험도면 오버레이 먼저
    if (status === 'result' && data?.riskLevel === 'HIGH') {
      showOverlay(metadata);
    }

    if (!document.getElementById('phishguard-font')) {
      const link = document.createElement('link');
      link.id = 'phishguard-font';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Noto+Sans+KR:wght@400;500&display=swap';
      document.head.appendChild(link);
    }

    const panel = document.createElement('div');
    panel.id = 'phishguard-root';
    Object.assign(panel.style, {
      position: 'fixed',
      top: '64px',
      right: '12px',
      width: '330px',
      maxHeight: 'calc(100vh - 80px)',
      overflowY: 'auto',
      zIndex: '2147483647',
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: '12px',
      lineHeight: '1.5',
    });

    panel.innerHTML = buildHTML(status, data, metadata);
    document.body.appendChild(panel);

    makeDraggable(panel, panel.querySelector('#pg-header'));

    panel.querySelector('#pg-close')?.addEventListener('click', () => {
      panel.remove();
      lastAnalyzedId = '';
    });

    panel.querySelectorAll('.pg-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const itemWrap = cb.closest('.pg-checklist-item') || cb.closest('label');
        if (itemWrap) itemWrap.style.opacity = cb.checked ? '0.4' : '1';
      });
    });

    panel.querySelectorAll('.pg-expand-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetId = btn.getAttribute('data-target');
        const content = panel.querySelector('#' + targetId);
        if (content) {
          if (content.style.display === 'none') {
            content.style.display = 'block';
            btn.textContent = '▲';
          } else {
            content.style.display = 'none';
            btn.textContent = '▼';
          }
        }
      });
    });
  }

  // ── HTML 생성 ─────────────────────────────────────────────────────────
  function buildHTML(status, data, metadata) {
    const wrap = (content) => `
      <div style="background:#141414;border:1px solid #2a2a2a;border-radius:8px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.6),0 0 0 1px rgba(255,255,255,0.04);">
        <div id="pg-header" style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #222;background:#1a1a1a;cursor:move;user-select:none;">
          <div style="display:flex;align-items:center;gap:8px;pointer-events:none;">
            <div style="width:22px;height:22px;background:rgba(255,60,60,0.12);border:1px solid rgba(255,60,60,0.3);border-radius:4px;display:flex;align-items:center;justify-content:center;">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M8 1L1.5 4.5V8c0 3.866 2.91 7 6.5 7s6.5-3.134 6.5-7V4.5L8 1z" stroke="#ff3c3c" stroke-width="1.4" fill="rgba(255,60,60,0.1)"/>
                <path d="M8 5.5V9.5M8 11v.5" stroke="#ff3c3c" stroke-width="1.6" stroke-linecap="round"/>
              </svg>
            </div>
            <span style="font-size:10px;font-weight:600;letter-spacing:0.15em;color:#ccc;text-transform:uppercase;">PhishGuard AI</span>
          </div>
          <button id="pg-close" style="background:none;border:none;cursor:pointer;color:#666;font-size:20px;line-height:1;padding:2px 6px;" onmouseover="this.style.color='#eee'" onmouseout="this.style.color='#666'">×</button>
        </div>
        ${content}
      </div>`;

    if (status === 'loading') {
      return wrap(`
        <div style="padding:28px 16px;text-align:center;background:#141414;">
          <div style="display:flex;justify-content:center;gap:5px;margin-bottom:14px;">
            ${[0, 1, 2].map(i => `<div style="width:7px;height:7px;border-radius:50%;background:#ff3c3c;animation:pgPulse 1.2s ${i * 0.18}s ease-in-out infinite;"></div>`).join('')}
          </div>
          <div style="font-size:11px;letter-spacing:0.1em;color:#888;text-transform:uppercase;">AI 분석 중</div>
          <div style="font-size:10px;color:#555;margin-top:5px;font-family:'Noto Sans KR',sans-serif;">${esc(metadata?.senderEmail || '')}</div>
        </div>
        <style>@keyframes pgPulse{0%,100%{opacity:0.15;transform:scale(0.7)}50%{opacity:1;transform:scale(1.3)}}</style>
      `);
    }

    if (status === 'error') {
      return wrap(`
        <div style="padding:16px;background:#141414;">
          <div style="font-size:11px;color:#ff5555;font-family:'Noto Sans KR',sans-serif;line-height:1.6;">⚠ ${esc(data || '오류가 발생했습니다')}</div>
          <div style="margin-top:8px;font-size:10px;color:#666;font-family:'Noto Sans KR',sans-serif;">팝업 → 설정 탭에서 API 키를 확인해주세요</div>
        </div>
      `);
    }

    const r = data;
    const color = r.riskLevel === 'HIGH' ? '#ff5555' : r.riskLevel === 'MEDIUM' ? '#ffc233' : '#2ee87a';
    const bg = r.riskLevel === 'HIGH' ? 'rgba(255,60,60,0.08)' : r.riskLevel === 'MEDIUM' ? 'rgba(255,184,0,0.08)' : 'rgba(0,212,106,0.08)';
    const border = r.riskLevel === 'HIGH' ? 'rgba(255,60,60,0.2)' : r.riskLevel === 'MEDIUM' ? 'rgba(255,184,0,0.2)' : 'rgba(0,212,106,0.2)';
    const labelKo = r.riskLevel === 'HIGH' ? '위험' : r.riskLevel === 'MEDIUM' ? '주의' : '안전';
    const icon = r.riskLevel === 'HIGH' ? '🔴' : r.riskLevel === 'MEDIUM' ? '🟡' : '🟢';

    const checklist = (r.checklist || []).map((item, i) => {
      const reasonHtml = item.flagged && item.reason ? `
        <div class="pg-reason" id="pg-reason-${i}" style="display:none;margin-top:6px;padding:8px 10px;background:rgba(255,60,60,0.05);border-left:2px solid rgba(255,60,60,0.4);font-size:11px;color:#ffaaaa;font-family:'Noto Sans KR',sans-serif;line-height:1.5;border-radius:2px;">
          ${esc(item.reason)}
        </div>
      ` : '';

      const expandBtnHtml = item.flagged && item.reason ? `
        <button type="button" class="pg-expand-btn" data-target="pg-reason-${i}" style="background:none;border:none;color:#888;cursor:pointer;margin-left:auto;padding:0 5px;font-size:10px;" title="이유 보기">▼</button>
      ` : '';

      return `
      <div style="padding:9px 0;border-bottom:1px solid #1e1e1e;transition:opacity 0.2s;" class="pg-checklist-item">
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;flex:1;">
            <input type="checkbox" class="pg-check" style="margin-top:2px;flex-shrink:0;accent-color:#ff3c3c;width:13px;height:13px;cursor:pointer;">
            <span style="font-size:12px;line-height:1.6;color:${item.flagged ? '#ff6666' : '#bbb'};font-family:'Noto Sans KR',sans-serif;">
              ${item.flagged ? '<span style="color:#ff5555;margin-right:3px;font-size:11px;">⚑</span>' : ''}${esc(item.text)}
            </span>
          </label>
          ${expandBtnHtml}
        </div>
        ${reasonHtml}
      </div>`;
    }).join('');

    const indicators = (r.indicators || []).length > 0 ? `
      <div style="padding:10px 14px 12px;">
        <div style="font-size:9px;letter-spacing:0.12em;color:#666;text-transform:uppercase;margin-bottom:7px;">탐지된 위협 지표</div>
        ${r.indicators.map(ind => `
          <div style="font-size:11px;color:#ff6666;padding:6px 10px;background:rgba(255,60,60,0.07);border-left:2px solid rgba(255,60,60,0.5);margin-bottom:4px;font-family:'Noto Sans KR',sans-serif;line-height:1.5;">${esc(ind)}</div>
        `).join('')}
      </div>` : '';

    return wrap(`
      <div style="background:#141414;">
        <div style="margin:12px 12px 0;padding:12px 14px;background:${bg};border:1px solid ${border};border-radius:6px;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:9px;color:#888;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">위험도</div>
            <div style="font-size:22px;font-weight:700;color:${color};">${icon} ${labelKo}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:9px;color:#888;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">신뢰도</div>
            <div style="font-size:22px;font-weight:700;color:${color};">${r.confidence}%</div>
          </div>
        </div>
        <div style="padding:12px 14px 10px;font-size:12px;color:#aaa;line-height:1.7;font-family:'Noto Sans KR',sans-serif;border-bottom:1px solid #1e1e1e;">${esc(r.summary || '')}</div>
        <div style="padding:9px 14px;border-bottom:1px solid #1e1e1e;">
          <div style="font-size:9px;letter-spacing:0.1em;color:#555;text-transform:uppercase;margin-bottom:3px;">발신자</div>
          <div style="font-size:11px;color:#ccc;">${esc(metadata?.senderEmail || '(알 수 없음)')}</div>
        </div>
        <div style="padding:10px 14px 2px;">
          <div style="font-size:9px;letter-spacing:0.1em;color:#666;text-transform:uppercase;margin-bottom:6px;">판단 체크리스트</div>
          ${checklist}
        </div>
        ${indicators}
        <div style="padding:9px 14px;border-top:1px solid #1e1e1e;font-size:9px;color:#444;text-align:center;letter-spacing:0.06em;">최종 판단은 사용자에게 있습니다 · PhishGuard AI</div>
      </div>
    `);
  }

  function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function debounce(fn, delay) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
  }

  function makeDraggable(el, handle) {
    if (!handle) return;
    let isDragging = false;
    let startX, startY, initialX, initialY;

    const onMouseDown = (e) => {
      if (e.target.id === 'pg-close') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;

      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.margin = '0';
      el.style.left = initialX + 'px';
      el.style.top = initialY + 'px';

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.left = (initialX + dx) + 'px';
      el.style.top = (initialY + dy) + 'px';
    };

    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    handle.addEventListener('mousedown', onMouseDown);
  }

})();