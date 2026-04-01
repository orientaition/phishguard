// content.js — Gmail SPA 감지 + 분석 패널 주입
// MutationObserver로 이메일 열람을 감지하고, AI 분석 결과를 패널로 표시

(function () {
  'use strict';

  // ── 상태 변수 ──────────────────────────────────────────────────────
  let lastAnalyzedId = '';       // 마지막 분석한 이메일 ID
  let isAnalyzing = false;       // 분석 진행 중 여부
  let panelDismissed = false;    // X로 닫은 상태 (같은 이메일에서 재표시 방지)
  let savedPosition = null;      // 드래그 후 패널 위치 기억 { top, left }
  let currentTheme = 'light';    // 현재 테마 (light / dark)
  const resultCache = {};        // 분석 결과 캐시 { emailId → { result, metadata } }

  // ── 저장된 테마 로드 ──────────────────────────────────────────────
  chrome.storage.local.get(['theme'], (data) => {
    currentTheme = data.theme || 'light';
  });

  // ── DOM 변경 감시 시작 ─────────────────────────────────────────────
  const observer = new MutationObserver(debounce(onDomChange, 800));
  observer.observe(document.body, { childList: true, subtree: true });

  // ── 팝업에서 메시지 수신 ──────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    // 테마 변경
    if (msg.type === 'SET_THEME') {
      currentTheme = msg.theme;
      // 현재 열린 패널이 있으면 테마 적용해서 다시 그리기
      if (lastAnalyzedId && resultCache[lastAnalyzedId] && document.getElementById('phishguard-root')) {
        const cached = resultCache[lastAnalyzedId];
        showPanel('result', cached.result, cached.metadata);
      }
      return;
    }

    // 패널 토글
    if (msg.type === 'TOGGLE_PANEL') {
      const existing = document.getElementById('phishguard-root');
      if (existing) {
        panelDismissed = true;
        existing.remove();
        return;
      }
      if (lastAnalyzedId && resultCache[lastAnalyzedId]) {
        panelDismissed = false;
        const cached = resultCache[lastAnalyzedId];
        showPanel('result', cached.result, cached.metadata);
      }
    }
  });

  // ── DOM 변경 콜백 (이메일 열람 감지) ───────────────────────────────
  function onDomChange() {
    // 확장 프로그램 컨텍스트 무효화 시 옵저버 정지
    if (!chrome.runtime?.id) {
      observer.disconnect();
      return;
    }

    const body = extractBody();
    const metadata = extractMetadata();
    if (!body) return;

    const emailId = (metadata.senderEmail + '::' + metadata.subject).trim();
    if (!emailId || emailId === '::' || isAnalyzing) return;

    // ── 같은 이메일에 머무는 경우 ──
    if (emailId === lastAnalyzedId) {
      // 패널이 열려있으면 그대로 유지
      if (document.getElementById('phishguard-root')) return;
      // X로 닫은 상태면 재표시 안 함
      if (panelDismissed) return;
      // 캐시가 있는데 패널이 없으면 (페이지 변동으로 사라진 경우) 복원
      if (resultCache[emailId]) {
        showPanel('result', resultCache[emailId].result, resultCache[emailId].metadata);
      }
      return;
    }

    // ── 다른 이메일로 이동한 경우 ──
    panelDismissed = false;
    lastAnalyzedId = emailId;

    // 이전 패널 제거
    const oldPanel = document.getElementById('phishguard-root');
    if (oldPanel) oldPanel.remove();

    // 캐시 히트 → 저장된 결과 바로 표시
    if (resultCache[emailId]) {
      showPanel('result', resultCache[emailId].result, resultCache[emailId].metadata);
      return;
    }

    // 미분석 이메일 → 자동 분석 시작
    startAnalysis(body, metadata);
  }

  // ── 이메일 본문 추출 ──────────────────────────────────────────────
  function extractBody() {
    const selectors = [
      'div.a3s.aiL',
      'div[data-message-id] .a3s',
      '.ii.gt .a3s.aiL',
      'div.gs .a3s'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 30) return el.innerText.trim();
    }
    return null;
  }

  // ── 이메일 메타데이터 추출 (발신자, 제목, 날짜) ────────────────────
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
    } catch (_) {}
    return meta;
  }

  // ── AI 분석 요청 ──────────────────────────────────────────────────
  function startAnalysis(body, metadata) {
    isAnalyzing = true;
    showPanel('loading', null, metadata);

    if (!chrome.runtime?.id) {
      isAnalyzing = false;
      showPanel('error', '페이지를 새로고침해주세요.', metadata);
      return;
    }

    try {
      chrome.runtime.sendMessage(
        { type: 'ANALYZE_EMAIL', payload: { body, metadata } },
        (response) => {
          isAnalyzing = false;
          if (chrome.runtime.lastError) {
            showPanel('error', chrome.runtime.lastError.message, metadata);
            return;
          }
          if (!response?.ok) {
            showPanel('error', response?.error || '알 수 없는 오류', metadata);
            return;
          }

          // 통계 업데이트 (실패해도 무시)
          try { chrome.runtime.sendMessage({ type: 'UPDATE_STATS', level: response.result.riskLevel }); } catch (_) {}

          // 결과 캐시 저장 후 패널 표시
          resultCache[lastAnalyzedId] = { result: response.result, metadata };
          showPanel('result', response.result, metadata);
        }
      );
    } catch (_) {
      isAnalyzing = false;
      showPanel('error', '페이지를 새로고침해주세요.', metadata);
    }
  }

  // ── HIGH 위험도 전체화면 오버레이 ─────────────────────────────────
  function showOverlay(metadata) {
    const old = document.getElementById('phishguard-overlay');
    if (old) old.remove();

    const ov = document.createElement('div');
    ov.id = 'phishguard-overlay';
    Object.assign(ov.style, {
      position: 'fixed', inset: '0', zIndex: '2147483646',
      background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '"Google Sans",Roboto,sans-serif',
      animation: 'pgFadeIn .2s ease'
    });

    ov.innerHTML = `
      <style>
        @keyframes pgFadeIn{from{opacity:0}to{opacity:1}}
        @keyframes pgFadeOut{from{opacity:1}to{opacity:0}}
        @keyframes pgSlideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
      </style>
      <div style="background:#fff;border-radius:16px;padding:32px 28px 24px;max-width:400px;width:90%;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,.25);animation:pgSlideUp .3s ease .05s both">
        <div style="width:56px;height:56px;border-radius:50%;background:#fce8e6;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 20h20L12 2z" stroke="#d93025" stroke-width="1.8" fill="#fce8e6"/><path d="M12 9v5M12 16.5v.5" stroke="#d93025" stroke-width="2" stroke-linecap="round"/></svg>
        </div>
        <div style="font-size:18px;font-weight:600;color:#d93025;margin-bottom:8px">스피어피싱 위험 감지</div>
        <div style="font-size:13px;color:#5f6368;margin-bottom:6px">발신자</div>
        <div style="font-size:13px;color:#d93025;background:#fce8e6;border-radius:8px;padding:8px 14px;margin-bottom:16px;word-break:break-all;font-weight:500">${esc(metadata?.senderEmail || '(알 수 없음)')}</div>
        <div style="font-size:14px;color:#3c4043;line-height:1.7;margin-bottom:24px">
          이 이메일은 <strong style="color:#d93025">높은 위험도</strong>로 분류되었습니다.<br>링크 클릭 및 첨부파일 열람을 자제해주세요.
        </div>
        <div style="display:flex;gap:10px">
          <button id="pg-ov-confirm" style="flex:1;padding:10px 16px;background:#d93025;border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:500;cursor:pointer" onmouseover="this.style.background='#c5221f'" onmouseout="this.style.background='#d93025'">내용 확인</button>
          <button id="pg-ov-back" style="flex:1;padding:10px 16px;background:#f1f3f4;border:none;border-radius:8px;color:#3c4043;font-size:13px;font-weight:500;cursor:pointer" onmouseover="this.style.background='#e8eaed'" onmouseout="this.style.background='#f1f3f4'">뒤로 가기</button>
        </div>
        <div style="margin-top:14px;font-size:11px;color:#9aa0a6">ESC 키로 닫기</div>
      </div>`;

    document.body.appendChild(ov);

    // 오버레이 닫기 공통 함수
    const closeOv = () => { ov.style.animation = 'pgFadeOut .2s ease forwards'; setTimeout(() => ov.remove(), 200); };
    ov.querySelector('#pg-ov-confirm').addEventListener('click', closeOv);
    ov.querySelector('#pg-ov-back').addEventListener('click', () => { ov.remove(); history.back(); });

    // ESC 키로 닫기
    const onEsc = (e) => { if (e.key === 'Escape') { closeOv(); document.removeEventListener('keydown', onEsc); } };
    document.addEventListener('keydown', onEsc);
  }

  // ── 분석 패널 표시 ────────────────────────────────────────────────
  function showPanel(status, data, metadata) {
    const old = document.getElementById('phishguard-root');
    if (old) old.remove();

    // HIGH 위험도 → 오버레이 표시 (최초 1회만)
    if (status === 'result' && data?.riskLevel === 'HIGH' && !resultCache[lastAnalyzedId]?._overlayShown) {
      showOverlay(metadata);
      if (resultCache[lastAnalyzedId]) resultCache[lastAnalyzedId]._overlayShown = true;
    }

    // Google Sans 폰트 로드
    if (!document.getElementById('phishguard-font')) {
      const link = document.createElement('link');
      link.id = 'phishguard-font';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600&family=Noto+Sans+KR:wght@400;500&display=swap';
      document.head.appendChild(link);
    }

    // 패널 생성 및 위치 설정
    const panel = document.createElement('div');
    panel.id = 'phishguard-root';
    Object.assign(panel.style, {
      position: 'fixed', width: '340px', maxHeight: 'calc(100vh - 88px)',
      overflowY: 'auto', zIndex: '2147483647',
      fontFamily: '"Google Sans",Roboto,"Noto Sans KR",sans-serif',
      fontSize: '13px', lineHeight: '1.5'
    });

    // 마지막 드래그 위치 복원 또는 기본 위치
    if (savedPosition) {
      panel.style.top = savedPosition.top;
      panel.style.left = savedPosition.left;
      panel.style.right = 'auto';
    } else {
      panel.style.top = '72px';
      panel.style.right = '16px';
    }

    panel.innerHTML = buildHTML(status, data, metadata);
    document.body.appendChild(panel);
    makeDraggable(panel, panel.querySelector('#pg-header'));

    // X 닫기 → dismiss 상태 (팝업 "분석 결과 보기"로만 재표시)
    panel.querySelector('#pg-close')?.addEventListener('click', () => {
      panelDismissed = true;
      panel.style.animation = 'pgPanelOut .15s ease forwards';
      setTimeout(() => panel.remove(), 150);
    });

    // 체크리스트 체크 시 흐리게
    panel.querySelectorAll('.pg-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const wrap = cb.closest('.pg-checklist-item');
        if (wrap) wrap.style.opacity = cb.checked ? '0.45' : '1';
      });
    });

    // 체크리스트 이유 펼치기/접기
    panel.querySelectorAll('.pg-expand-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const content = panel.querySelector('#' + btn.getAttribute('data-target'));
        if (!content) return;
        const hidden = content.style.display === 'none';
        content.style.display = hidden ? 'block' : 'none';
        btn.textContent = hidden ? '▲' : '▼';
      });
    });
  }

  // ── 패널 HTML 생성 (테마 지원) ───────────────────────────────────
  function buildHTML(status, data, metadata) {
    const dk = currentTheme === 'dark';

    // 테마 색상 팔레트
    const T = dk ? {
      bg: '#1f1f1f', bg2: '#2d2d2d', hover: '#3c3c3c',
      text: '#e8eaed', text2: '#9aa0a6', muted: '#5f6368',
      border: '#3c3c3c', borderLight: '#333',
      accent: '#8ab4f8', accentBg: 'rgba(138,180,248,0.12)',
      red: '#f28b82', redBg: 'rgba(242,139,130,0.12)', redBorder: 'rgba(242,139,130,0.25)',
      yellow: '#fdd663', yellowBg: 'rgba(253,214,99,0.12)',
      green: '#81c995', greenBg: 'rgba(129,201,149,0.12)',
      scrollThumb: '#555'
    } : {
      bg: '#fff', bg2: '#f8f9fa', hover: '#f1f3f4',
      text: '#202124', text2: '#5f6368', muted: '#9aa0a6',
      border: '#e8eaed', borderLight: '#f1f3f4',
      accent: '#1a73e8', accentBg: '#e8f0fe',
      red: '#d93025', redBg: '#fce8e6', redBorder: '#f5c6c2',
      yellow: '#e37400', yellowBg: '#fef7e0',
      green: '#188038', greenBg: '#e6f4ea',
      scrollThumb: '#dadce0'
    };

    // 공통 스타일
    const styles = `<style>
      @keyframes pgPanelIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
      @keyframes pgPanelOut{from{opacity:1}to{opacity:0;transform:translateY(-8px)}}
      @keyframes pgPulse{0%,100%{opacity:.2;transform:scale(.8)}50%{opacity:1;transform:scale(1.2)}}
      #phishguard-root::-webkit-scrollbar{width:4px}
      #phishguard-root::-webkit-scrollbar-thumb{background:${T.scrollThumb};border-radius:4px}
    </style>`;

    const header = `
      <div id="pg-header" style="padding:12px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid ${T.border};background:${T.bg};cursor:move;user-select:none">
        <div style="display:flex;align-items:center;gap:10px;pointer-events:none">
          <div style="width:28px;height:28px;background:${T.accentBg};border-radius:50%;display:flex;align-items:center;justify-content:center">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1L1.5 4.5V8c0 3.866 2.91 7 6.5 7s6.5-3.134 6.5-7V4.5L8 1z" stroke="${T.accent}" stroke-width="1.3" fill="${T.accentBg}"/><path d="M6 8l1.5 1.5L10 6" stroke="${T.accent}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <span style="font-size:14px;font-weight:500;color:${T.text}">PhishGuard AI</span>
        </div>
        <button id="pg-close" style="background:none;border:none;cursor:pointer;color:${T.text2};width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center" onmouseover="this.style.background='${T.hover}'" onmouseout="this.style.background='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>`;

    const wrap = (content) => `${styles}<div style="background:${T.bg};border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,${dk?'.4':'.15'});animation:pgPanelIn .2s ease">${header}${content}</div>`;

    // 로딩 상태
    if (status === 'loading') {
      const dots = [0, 1, 2].map(i => `<div style="width:8px;height:8px;border-radius:50%;background:${T.accent};animation:pgPulse 1.2s ${i * 0.2}s ease-in-out infinite"></div>`).join('');
      return wrap(`
        <div style="padding:32px 16px;text-align:center">
          <div style="display:flex;justify-content:center;gap:6px;margin-bottom:16px">${dots}</div>
          <div style="font-size:13px;font-weight:500;color:${T.text}">AI 분석 중...</div>
          <div style="font-size:12px;color:${T.text2};margin-top:6px">${esc(metadata?.senderEmail || '')}</div>
        </div>`);
    }

    // 에러 상태
    if (status === 'error') {
      return wrap(`
        <div style="padding:20px 16px">
          <div style="display:flex;gap:10px;padding:12px;background:${T.redBg};border-radius:8px">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;margin-top:1px"><circle cx="12" cy="12" r="10" stroke="${T.red}" stroke-width="1.5"/><path d="M12 8v5M12 15.5v.5" stroke="${T.red}" stroke-width="2" stroke-linecap="round"/></svg>
            <div>
              <div style="font-size:13px;color:${T.red};font-weight:500;margin-bottom:4px">${esc(data || '오류가 발생했습니다')}</div>
              <div style="font-size:12px;color:${T.text2}">팝업 → 설정에서 API 키를 확인해주세요</div>
            </div>
          </div>
        </div>`);
    }

    // ── 분석 결과 ──
    const r = data;
    const isHigh = r.riskLevel === 'HIGH';
    const isMed = r.riskLevel === 'MEDIUM';
    const color = isHigh ? T.red : isMed ? T.yellow : T.green;
    const bg = isHigh ? T.redBg : isMed ? T.yellowBg : T.greenBg;
    const label = isHigh ? '높음' : isMed ? '보통' : '낮음';

    // 위험도 아이콘
    const icon = isHigh
      ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 20h20L12 2z" stroke="${color}" stroke-width="1.5" fill="${bg}"/><path d="M12 9v5M12 16.5v.5" stroke="${color}" stroke-width="2" stroke-linecap="round"/></svg>`
      : isMed
        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="${color}" stroke-width="1.5" fill="${bg}"/><path d="M12 8v5M12 15.5v.5" stroke="${color}" stroke-width="2" stroke-linecap="round"/></svg>`
        : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="${color}" stroke-width="1.5" fill="${bg}"/><path d="M8 12l2.5 2.5L16 9" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    // 체크리스트 항목 생성
    const checklist = (r.checklist || []).map((item, i) => {
      const flagged = item.flagged;
      const textColor = flagged ? T.red : T.text;
      const checkColor = flagged ? T.red : T.accent;
      const itemBg = flagged ? `background:${T.redBg};border-radius:8px;padding:10px 12px;margin:4px 0` : 'padding:10px 0';
      const reason = flagged && item.reason
        ? `<div class="pg-reason" id="pg-reason-${i}" style="display:none;margin-top:8px;padding:8px 12px;background:${T.bg2};border:1px solid ${T.redBorder};border-radius:6px;font-size:12px;color:${T.text2};line-height:1.6">${esc(item.reason)}</div>` : '';
      const expandBtn = flagged && item.reason
        ? `<button type="button" class="pg-expand-btn" data-target="pg-reason-${i}" style="background:none;border:none;color:${T.muted};cursor:pointer;margin-left:auto;padding:2px 6px;font-size:10px;border-radius:4px" onmouseover="this.style.background='${T.hover}'" onmouseout="this.style.background='none'">▼</button>` : '';
      return `
        <div style="${itemBg};border-bottom:1px solid ${T.borderLight}" class="pg-checklist-item">
          <div style="display:flex;align-items:flex-start;gap:8px">
            <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;flex:1">
              <input type="checkbox" class="pg-check" style="margin-top:3px;flex-shrink:0;accent-color:${checkColor};width:14px;height:14px;cursor:pointer">
              <span style="font-size:13px;line-height:1.6;color:${textColor};${flagged ? 'font-weight:500' : ''}">${flagged ? '⚠ ' : ''}${esc(item.text)}</span>
            </label>
            ${expandBtn}
          </div>
          ${reason}
        </div>`;
    }).join('');

    // 위협 지표
    const indicators = (r.indicators || []).length
      ? `<div style="padding:12px 16px">
          <div style="font-size:11px;font-weight:500;color:${T.text2};text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">탐지된 위협 지표</div>
          ${r.indicators.map(x => `<div style="font-size:12px;color:${T.red};padding:8px 12px;background:${T.redBg};border-radius:6px;margin-bottom:4px">${esc(x)}</div>`).join('')}
        </div>` : '';

    return wrap(`
      <div>
        <div style="margin:14px 14px 0;padding:14px 16px;background:${bg};border-radius:10px;display:flex;justify-content:space-between;align-items:center">
          <div style="display:flex;align-items:center;gap:10px">
            ${icon}
            <div>
              <div style="font-size:11px;color:${T.text2}">위험도</div>
              <div style="font-size:20px;font-weight:600;color:${color}">${label}</div>
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;color:${T.text2}">신뢰도</div>
            <div style="font-size:20px;font-weight:600;color:${color}">${r.confidence}%</div>
          </div>
        </div>
        <div style="padding:14px 16px;font-size:13px;color:${T.text};line-height:1.7;border-bottom:1px solid ${T.borderLight}">${esc(r.summary || '')}</div>
        <div style="padding:10px 16px;border-bottom:1px solid ${T.borderLight};display:flex;align-items:center;gap:8px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="16" rx="2" stroke="${T.text2}" stroke-width="1.5"/><path d="M2 7l10 6 10-6" stroke="${T.text2}" stroke-width="1.5"/></svg>
          <div>
            <div style="font-size:11px;color:${T.text2}">발신자</div>
            <div style="font-size:12px;color:${T.text};font-weight:500">${esc(metadata?.senderEmail || '(알 수 없음)')}</div>
          </div>
        </div>
        <div style="padding:12px 16px 4px">
          <div style="font-size:11px;font-weight:500;color:${T.text2};text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">판단 체크리스트</div>
          ${checklist}
        </div>
        ${indicators}
        <div style="padding:10px 16px;border-top:1px solid ${T.borderLight};font-size:11px;color:${T.muted};text-align:center">최종 판단은 사용자에게 있습니다 · PhishGuard AI</div>
      </div>`);
  }

  // ── 유틸리티 ──────────────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function debounce(fn, delay) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
  }

  // ── 패널 드래그 이동 ──────────────────────────────────────────────
  function makeDraggable(el, handle) {
    if (!handle) return;
    let dragging = false, startX, startY, initX, initY;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('#pg-close')) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      initX = rect.left;
      initY = rect.top;

      el.style.right = 'auto';
      el.style.left = initX + 'px';
      el.style.top = initY + 'px';

      const onMove = (e) => {
        if (!dragging) return;
        el.style.left = (initX + e.clientX - startX) + 'px';
        el.style.top = (initY + e.clientY - startY) + 'px';
      };
      const onUp = () => {
        dragging = false;
        savedPosition = { top: el.style.top, left: el.style.left };
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  }

})();