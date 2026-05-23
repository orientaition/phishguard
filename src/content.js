// content.js — Gmail SPA 감지 + 분석 패널 주입
// ★ VERSION: 2026-05-13-v5 ★

(function () {
  'use strict';

  // 로드 확인용 — 콘솔에서 [PhishGuard v5] 가 보이면 새 파일이 로드된 것입니다

  // ══════════════════════════════════════════════
  // 유틸리티 (가장 먼저 선언 — 아래에서 참조됨)
  // ══════════════════════════════════════════════

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function debounce(fn, delay) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
  }

  function afterLoadingPaint(callback) {
    const raf = window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
    raf(() => setTimeout(callback, 0));
  }

  // ══════════════════════════════════════════════
  // 확장 컨텍스트 가드
  // ══════════════════════════════════════════════

  function isExtensionValid() {
    try { return !!(chrome?.runtime?.id); } catch (_) { return false; }
  }

  function safeStorageGet(keys, callback) {
    if (!isExtensionValid()) return;
    try {
      chrome.storage.local.get(keys, (data) => {
        if (chrome.runtime.lastError) return;
        callback(data);
      });
    } catch (_) {}
  }

  function safeStorageSet(items, callback) {
    if (!isExtensionValid()) return;
    try {
      chrome.storage.local.set(items, () => {
        if (chrome.runtime.lastError) return;
        if (callback) callback();
      });
    } catch (_) {}
  }

  function normalizeKeyPart(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function getMailRiskDbKey(item) {
    const explicitId = normalizeKeyPart(item?.emailId);
    if (explicitId && explicitId !== 'unknown::(no-subject)') return explicitId;

    const stableId = normalizeKeyPart(item?.stableId);
    if (stableId) return `row::${stableId}`;

    return getMailRiskTextKey(item);
  }

  function getMailRiskTextKey(item) {
    const sender = normalizeKeyPart(item?.senderEmail || item?.sender);
    const subject = normalizeKeyPart(item?.subject);
    return `${sender || 'unknown'}::${subject || '(no-subject)'}`;
  }

  function getMailRiskDbAliases(item) {
    const aliases = new Set();
    const primary = getMailRiskDbKey(item);
    const textKey = getMailRiskTextKey(item);

    if (textKey && textKey !== primary) aliases.add(textKey);
    (item?.aliases || []).forEach(alias => {
      const normalized = normalizeKeyPart(alias);
      if (normalized && normalized !== primary) aliases.add(normalized);
    });

    return Array.from(aliases);
  }

  // ══════════════════════════════════════════════
  // 상태 변수
  // ══════════════════════════════════════════════

  let lastAnalyzedId   = '';
  let isAnalyzing      = false;
  let panelDismissed   = false;
  let savedPosition    = null;
  let currentTheme     = 'light';
  let pendingEmailData = null;
  let isMetadataChecking = false;
  let analysisSeq      = 0;
  let metadataSeq      = 0;
  let lastLocationHref = location.href;
  let toolbarUpdateTimer = null;
  let riskDataCacheReady = false;
  let riskDataCacheLoading = false;
  let pendingRiskDataCallbacks = [];
  let cachedWhitelist = [];
  let cachedBlacklist = [];
  let cachedMailRiskDb = {};

  const resultCache  = {};          // { emailId → { result, metadata, _overlayShown } }
  const rowRiskCache = new Map();   // { emailId → { riskLevel, score, indicators } }
  const MAIL_RISK_DB_KEY = 'mailRiskDb';
  const MAIL_RISK_DB_LIMIT = 500;
  const SELECTED_METADATA_BATCH_SIZE = 10;
  const SELECTED_METADATA_GEMINI_BATCH_SIZE = 80;

  const SUSPICIOUS_KEYWORDS = [
    'urgent', 'verify', 'suspended', 'password', 'login',
    'security alert', 'account locked', 'confirm now',
    'click below', 'limited time', 'payment'
  ];

  // ── 브랜드명 → 공식 도메인 매핑 ──────────────────────────────────
  const BRAND_DOMAINS = {
    'github'    : ['github.com', 'githubapp.com'],
    'google'    : ['google.com', 'accounts.google.com', 'mail.google.com'],
    'youtube'   : ['youtube.com', 'google.com'],
    'microsoft' : ['microsoft.com', 'outlook.com', 'office.com', 'live.com'],
    'apple'     : ['apple.com', 'icloud.com'],
    'amazon'    : ['amazon.com', 'amazon.co.kr', 'amazonaws.com'],
    'kakao'     : ['kakao.com', 'kakaocorp.com'],
    'naver'     : ['naver.com', 'navercorp.com'],
    'paypal'    : ['paypal.com'],
    'netflix'   : ['netflix.com'],
    'facebook'  : ['facebook.com', 'meta.com', 'facebookmail.com'],
    'instagram' : ['instagram.com', 'facebookmail.com'],
    'twitter'   : ['twitter.com', 'x.com'],
    'notion'    : ['notion.so'],
    'slack'     : ['slack.com'],
    'anthropic' : ['anthropic.com'],
    'supabase'  : ['supabase.com', 'supabase.io'],
    'vercel'    : ['vercel.com'],
    'aws'       : ['amazonaws.com', 'amazon.com'],
    'samsung'   : ['samsung.com'],
    'coupang'   : ['coupang.com'],
    'toss'      : ['toss.im', 'viva-republica.com'],
    'cgv'       : ['cgv.co.kr'],
    'lotte'     : ['lotte.com', 'lottecinema.co.kr'],
  };

  // ══════════════════════════════════════════════
  // 초기화
  // ══════════════════════════════════════════════

  safeStorageGet(['theme'], (data) => {
    currentTheme = data.theme || 'light';
  });
  loadRiskDataCache(() => {
    scanInboxRows();
    updateSelectionToolbarButton();
  });

  // 팝업 메시지 수신
  if (isExtensionValid()) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'SET_THEME') {
        currentTheme = msg.theme;
        if (lastAnalyzedId && resultCache[lastAnalyzedId] && document.getElementById('phishguard-root')) {
          const c = resultCache[lastAnalyzedId];
          showPanel('result', c.result, c.metadata);
        }
        return;
      }
      if (msg.type === 'TOGGLE_PANEL') {
        const existing = document.getElementById('phishguard-root');
        if (existing) { panelDismissed = true; existing.remove(); return; }
        if (lastAnalyzedId && resultCache[lastAnalyzedId]) {
          panelDismissed = false;
          const c = resultCache[lastAnalyzedId];
          showPanel('result', c.result, c.metadata);
        }
      }
    });
  }

  // MutationObserver 시작
  const debouncedDomChange = debounce(onDomChange, 800);
  const observer = new MutationObserver(() => {
    scanInboxRows();
    updateSelectionToolbarButton();
    debouncedDomChange();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', clearAnalysisUi);
  window.addEventListener('hashchange', clearAnalysisUi);
  window.addEventListener('focus', refreshInboxBadgesFast);
  window.addEventListener('pageshow', refreshInboxBadgesFast);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshInboxBadgesFast();
  });
  document.addEventListener('click', handleNavigationClick, true);
  document.addEventListener('click', handleSelectionToolbarInteraction, true);
  document.addEventListener('keyup', handleSelectionToolbarInteraction, true);
  setInterval(checkRouteChange, 500);

  // 블랙리스트/화이트리스트 변경 시 inbox row 전체 재스캔
  if (isExtensionValid()) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      updateRiskDataCacheFromChanges(changes);
      if (changes.blacklist || changes.whitelist || changes[MAIL_RISK_DB_KEY]) {
        // 모든 row의 스캔/인터셉트 상태 초기화
        resetInboxScanState();
        // 즉시 재스캔
        refreshInboxBadgesFast();
      }
    });
  }

  // ══════════════════════════════════════════════
  // DOM 변경 콜백
  // ══════════════════════════════════════════════

  function onDomChange() {
    if (!isExtensionValid()) { observer.disconnect(); return; }

    scanInboxRows();
    updateSelectionToolbarButton();

    const body     = extractBody();
    const metadata = extractMetadata();
    if (!body) {
      if (!isGmailMessageRoute()) {
        const selectionPanel = document.querySelector('#phishguard-root[data-pg-context="selection"]');
        if (selectionPanel && getSelectedInboxRows().length > 0) return;
        clearAnalysisUi();
      }
      return;
    }

    const emailId = getEmailId(metadata);
    if (!emailId) return;
    if (isAnalyzing && emailId === lastAnalyzedId) return;

    // 같은 이메일
    if (emailId === lastAnalyzedId) {
      if (document.getElementById('phishguard-root')) return;
      if (panelDismissed) return;
      if (resultCache[emailId]) {
        showPanel('result', resultCache[emailId].result, resultCache[emailId].metadata);
      }
      return;
    }

    // 새 이메일
    isAnalyzing = false;
    isMetadataChecking = false;
    analysisSeq += 1;
    metadataSeq += 1;
    panelDismissed = false;
    lastAnalyzedId = emailId;
    document.getElementById('phishguard-root')?.remove();
    document.getElementById('pg-deep-analysis-btn')?.remove();

    // 1순위: AI 결과 캐시
    if (resultCache[emailId]) {
      showPanel('result', resultCache[emailId].result, resultCache[emailId].metadata);
      return;
    }

    // 2순위: inbox 사전 분석 캐시
    const pre = rowRiskCache.get(emailId);

    if (pre) {
      if (pre.riskLevel === 'HIGH') {
        const quickResult = {
          riskLevel : 'HIGH',
          confidence: 75,
          summary   : '사전 분석(알고리즘) 결과 높은 위험도가 감지되었습니다. "AI 정밀 분석" 버튼으로 상세 분석을 실행할 수 있습니다.',
          checklist : [],
          indicators: pre.indicators || []
        };
        resultCache[emailId] = { result: quickResult, metadata, _overlayShown: false };
        showOverlay(metadata, 'HIGH');
        resultCache[emailId]._overlayShown = true;
        showPanel('result', quickResult, metadata);
        injectDeepAnalysisButton(body, metadata, emailId);
        return;
      }

      if (pre.riskLevel === 'LOW') {
        // LOW → 본문 전송 여부만 사용자에게 확인
        startMetadataAnalysis(body, metadata, pre);
        return;
      }
    }

    // 3순위: MEDIUM 또는 사전 분석 없음
    startMetadataAnalysis(body, metadata, pre);
  }

  function checkRouteChange() {
    if (location.href === lastLocationHref) return;
    lastLocationHref = location.href;
    clearAnalysisUi();
  }

  function handleNavigationClick(e) {
    const nav = e.target?.closest?.('[role="button"], a, button');
    if (!nav) return;

    const label = [
      nav.getAttribute('aria-label'),
      nav.getAttribute('data-tooltip'),
      nav.getAttribute('title'),
      nav.textContent
    ].filter(Boolean).join(' ').trim();

    if (!isGmailBackToListControl(label)) return;
    clearAnalysisUi();
  }

  function isGmailBackToListControl(label) {
    return /^(back|뒤로|이전|목록으로|받은편지함으로|메일 목록으로)/i.test(label) ||
      /(back to inbox|back to|inbox|받은편지함|메일 목록|목록으로 돌아가기|이전 페이지)/i.test(label);
  }

  function isGmailMessageRoute() {
    const hash = decodeURIComponent(location.hash || '').replace(/^#\/?/, '');
    if (!hash) return false;

    const parts = hash.split('/').filter(Boolean);
    if (parts.length < 2) return false;

    const threadId = parts[parts.length - 1];
    return /^(FMfc|Ktbx|[a-f0-9]{12,}|[0-9]+)$/i.test(threadId);
  }

  function clearAnalysisUi() {
    document.getElementById('phishguard-root')?.remove();
    document.getElementById('pg-deep-analysis-btn')?.remove();
    document.getElementById('phishguard-overlay')?.remove();
    document.getElementById('phishguard-consent')?.remove();
    pendingEmailData = null;
    lastAnalyzedId = '';
    panelDismissed = false;
    isAnalyzing = false;
    isMetadataChecking = false;
    analysisSeq += 1;
    metadataSeq += 1;
  }

  function isCurrentEmailView(metadata) {
    const body = extractBody();
    if (!body) return false;
    if (!isGmailMessageRoute() && !hasVisibleMessageShell()) return false;
    return getEmailId(extractMetadata()) === getEmailId(metadata);
  }

  function loadRiskDataCache(callback) {
    if (riskDataCacheReady) {
      if (callback) callback();
      return;
    }

    if (callback) pendingRiskDataCallbacks.push(callback);
    if (riskDataCacheLoading || !isExtensionValid()) return;

    riskDataCacheLoading = true;
    safeStorageGet(['whitelist', 'blacklist', MAIL_RISK_DB_KEY], (data) => {
      cachedWhitelist = normalizeDomainList(data.whitelist);
      cachedBlacklist = normalizeDomainList(data.blacklist);
      cachedMailRiskDb = data[MAIL_RISK_DB_KEY] || {};
      riskDataCacheReady = true;
      riskDataCacheLoading = false;

      const callbacks = pendingRiskDataCallbacks;
      pendingRiskDataCallbacks = [];
      callbacks.forEach(fn => {
        try { fn(); } catch (_) {}
      });
    });
  }

  function normalizeDomainList(list) {
    return (list || []).map(e => e.trim().toLowerCase()).filter(Boolean);
  }

  function updateRiskDataCacheFromChanges(changes) {
    if (changes.whitelist) cachedWhitelist = normalizeDomainList(changes.whitelist.newValue);
    if (changes.blacklist) cachedBlacklist = normalizeDomainList(changes.blacklist.newValue);
    if (changes[MAIL_RISK_DB_KEY]) cachedMailRiskDb = changes[MAIL_RISK_DB_KEY].newValue || {};
    if (changes.whitelist || changes.blacklist || changes[MAIL_RISK_DB_KEY]) {
      riskDataCacheReady = true;
      riskDataCacheLoading = false;
    }
  }

  function refreshInboxBadgesFast() {
    scanInboxRows();
    updateSelectionToolbarButton();
  }

  function resetInboxScanState(rows = document.querySelectorAll('tr.zA')) {
    Array.from(rows).forEach(row => {
      delete row.dataset.pgScanned;
      delete row.dataset.pgIntercepted;
      row.querySelector('.pg-inbox-badge')?.remove();
    });
  }

  // ══════════════════════════════════════════════
  // Gmail 선택 액션바 버튼
  // ══════════════════════════════════════════════

  function handleSelectionToolbarInteraction(e) {
    const keyMayChangeSelection = e.type === 'keyup' &&
      ['x', 'X', ' ', 'Enter', 'ArrowUp', 'ArrowDown'].includes(e.key);
    const clickMayChangeSelection = e.type === 'click' && e.target?.closest?.(
      'tr.zA, [role="checkbox"], .T-Jo, [aria-label*="Select"], [data-tooltip*="Select"], [aria-label*="선택"], [data-tooltip*="선택"]'
    );

    if (!keyMayChangeSelection && !clickMayChangeSelection) return;
    scheduleSelectionToolbarUpdate();
  }

  function scheduleSelectionToolbarUpdate() {
    clearTimeout(toolbarUpdateTimer);
    toolbarUpdateTimer = setTimeout(updateSelectionToolbarButton, 0);
  }

  function updateSelectionToolbarButton() {
    const rows = getSelectedInboxRows();
    const existing = document.getElementById('pg-native-toolbar-btn');

    if (rows.length === 0) {
      existing?.remove();
      return;
    }

    const anchor = findGmailToolbarAnchor();
    if (!anchor?.parentElement) {
      existing?.remove();
      return;
    }

    const label = `PhishGuard 선택 메일 검사 (${rows.length})`;

    if (existing && existing.parentElement === anchor.parentElement) {
      existing.setAttribute('aria-label', label);
      existing.setAttribute('data-tooltip', label);
      existing.title = label;
      syncSelectionToolbarButtonStyle(existing, anchor);
      return;
    }

    existing?.remove();
    anchor.insertAdjacentElement('afterend', createSelectionToolbarButton(rows.length, anchor));
  }

  function createSelectionToolbarButton(count, anchor) {
    const label = `PhishGuard 선택 메일 검사 (${count})`;
    const btn = document.createElement('div');
    btn.id = 'pg-native-toolbar-btn';
    const anchorClass = typeof anchor?.className === 'string' ? anchor.className.trim() : '';
    btn.className = `${anchorClass || 'T-I J-J5-Ji nX T-I-ax7'} pg-native-toolbar-btn`;
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', label);
    btn.setAttribute('data-tooltip', label);
    btn.title = label;

    const iconColor = currentTheme === 'dark' ? '#bdc1c6' : '#5f6368';
    Object.assign(btn.style, {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: iconColor,
      cursor: 'pointer',
      boxSizing: 'border-box',
      position: 'static'
    });
    syncSelectionToolbarButtonStyle(btn, anchor);

    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"
           style="display:block;pointer-events:none">
        <path d="M12 3l7 3v5c0 4.4-2.8 8.4-7 10-4.2-1.6-7-5.6-7-10V6l7-3z"
              stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
        <path d="M8.7 12.1l2.1 2.1 4.6-5"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;

    btn.addEventListener('mouseenter', () => { btn.style.backgroundColor = 'rgba(60,64,67,.08)'; });
    btn.addEventListener('mouseleave', () => { btn.style.backgroundColor = 'transparent'; });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showSelectedMailSecurityPanel();
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      showSelectedMailSecurityPanel();
    });

    return btn;
  }

  function syncSelectionToolbarButtonStyle(btn, anchor) {
    if (!btn || !anchor) return;

    const style = getComputedStyle(anchor);
    const rect = anchor.getBoundingClientRect();
    const width = rect.width > 0 ? `${rect.width}px` : style.width;
    const height = rect.height > 0 ? `${rect.height}px` : style.height;
    const iconColor = currentTheme === 'dark' ? '#bdc1c6' : '#5f6368';

    Object.assign(btn.style, {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width,
      height,
      minWidth: style.minWidth,
      margin: style.margin,
      padding: style.padding,
      border: style.border,
      borderRadius: style.borderRadius,
      verticalAlign: style.verticalAlign,
      lineHeight: style.lineHeight,
      boxSizing: style.boxSizing,
      color: style.color || iconColor,
      position: 'static',
      top: '',
      transform: ''
    });
  }

  function findGmailToolbarAnchor() {
    const buttons = Array.from(document.querySelectorAll('[role="button"], button'))
      .filter(btn => btn.id !== 'pg-native-toolbar-btn' && isVisibleElement(btn));

    const withLabel = buttons.map(btn => ({
      btn,
      label: [
        btn.getAttribute('aria-label'),
        btn.getAttribute('data-tooltip'),
        btn.getAttribute('title')
      ].filter(Boolean).join(' ').trim()
    })).filter(x => x.label);

    const preferred = withLabel.find(x =>
      /(Delete|Move to trash|휴지통|삭제)/i.test(x.label)
    ) || withLabel.find(x =>
      /(Archive|보관|Report spam|스팸)/i.test(x.label)
    );

    return preferred?.btn || null;
  }

  function getSelectedInboxRows() {
    const rows = Array.from(document.querySelectorAll('tr.zA'));
    if (isBulkInboxSelectionActive()) return rows;

    return rows.filter(row => {
      const checkbox = getRowSelectionCheckbox(row);
      return checkbox?.getAttribute('aria-checked') === 'true';
    });
  }

  function isBulkInboxSelectionActive() {
    const toolbarCheckboxes = Array.from(document.querySelectorAll('[role="checkbox"]'))
      .filter(cb => !cb.closest('tr.zA') && isVisibleElement(cb));

    return toolbarCheckboxes.some(cb => {
      const label = [
        cb.getAttribute('aria-label'),
        cb.getAttribute('data-tooltip'),
        cb.getAttribute('title')
      ].filter(Boolean).join(' ');

      const isSelectAllControl = /(Select|선택|모두)/i.test(label) ||
        cb.classList.contains('T-Jo');

      return isSelectAllControl && cb.getAttribute('aria-checked') === 'true';
    });
  }

  function getRowSelectionCheckbox(row) {
    return row.querySelector('.T-Jo[role="checkbox"]') ||
      row.querySelector('[role="checkbox"][aria-label*="Select"]') ||
      row.querySelector('[role="checkbox"][data-tooltip*="Select"]') ||
      row.querySelector('[role="checkbox"][aria-label*="선택"]') ||
      row.querySelector('[role="checkbox"][data-tooltip*="선택"]');
  }

  function getInboxRowInfo(row) {
    const senderEl = row.querySelector('span[email]') ||
      row.querySelector('.yP') ||
      row.querySelector('.zF') ||
      row.querySelector('.yW');
    const subjectEl = row.querySelector('.bog');
    const senderEmail =
      senderEl?.getAttribute?.('email') ||
      row.querySelector('[email]')?.getAttribute('email') ||
      row.getAttribute('email') ||
      '';
    const sender =
      senderEl?.getAttribute?.('name') ||
      cleanGmailListText(senderEl) ||
      cleanGmailListText(row.querySelector('.yX')) ||
      '';
    const subject = cleanGmailListText(subjectEl);
    const stableId = getRowStableId(row);
    const textKey = getMailRiskTextKey({ senderEmail, sender, subject });
    const rowKey = stableId ? `row::${normalizeKeyPart(stableId)}` : '';

    return {
      sender,
      subject,
      senderEmail,
      stableId,
      emailId: rowKey || textKey,
      aliases: rowKey ? [textKey] : [],
      text: `${sender} ${subject}`
    };
  }

  function getRowStableId(row) {
    return row.getAttribute('data-legacy-message-id') ||
      row.getAttribute('data-legacy-thread-id') ||
      row.getAttribute('data-thread-id') ||
      row.getAttribute('data-message-id') ||
      row.getAttribute('id') ||
      '';
  }

  function cleanGmailListText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll?.('.pg-inbox-badge').forEach(node => node.remove());
    return stripPhishGuardBadgeText(clone.textContent || '');
  }

  function stripPhishGuardBadgeText(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/\s*(미검사|낮음|보통|높음|✕\s*차단)\s*$/g, '')
      .trim();
  }

  function getPanelRiskLevel(level) {
    if (level === 'BLACKLIST' || level === 'HIGH') return 'HIGH';
    if (level === 'MEDIUM') return 'MEDIUM';
    return 'LOW';
  }

  function showSelectedMailSecurityPanel() {
    const selected = getSelectedInboxRows().map(row => ({ row, ...getInboxRowInfo(row) }));

    if (selected.length === 0) {
      updateSelectionToolbarButton();
      return;
    }

    panelDismissed = false;
    showPanel('loading', { _selectionPanel: true }, {
      senderEmail: `${selected.length}개 메일 선택됨`,
      _selectionPanel: true
    });

    afterLoadingPaint(() => runSelectedMailMetadataAnalysis(selected));
  }

  async function runSelectedMailMetadataAnalysis(selected) {
    const mailRiskDb = await readMailRiskDb();
    const analyzed = new Array(selected.length);
    const pending = [];

    selected.forEach((info, selectionIndex) => {
      const stored = findStoredRiskRecord(mailRiskDb, info);
      if (stored) {
        const risk = riskFromStoredRecord(stored);
        analyzed[selectionIndex] = {
          ...info,
          risk,
          reason: stored.reason || '저장된 검사 결과를 불러왔습니다.',
          signals: stored.indicators || [],
          failed: false,
          cached: true
        };
        return;
      }

      const localRisk = calculateRiskFromText(info);
      const metadata = {
        subject: info.subject,
        sender: info.sender,
        senderEmail: info.senderEmail,
        date: ''
      };
      pending.push({
        selectionIndex,
        requestIndex: pending.length + 1,
        info,
        metadata,
        localRisk
      });
    });

    if (pending.length > 0) {
      const selectedModel = await readSelectedModel();
      await runSelectedMetadataBatches(analyzed, pending, {
        selectedCount: selected.length,
        cachedCount: selected.length - pending.length,
        selectedModel
      }, getSelectedMetadataBatchSize(selectedModel, pending.length));
    }

    const failedCount = analyzed.filter(item => item.failed).length;
    const cachedCount = analyzed.filter(item => item.cached).length;
    const savedRecords = analyzed
      .filter(item => !item.failed && !item.cached)
      .map(item => toStoredRiskRecord(item, 'metadata'));
    saveMailRiskRecords(savedRecords, () => {
      resetInboxScanState();
      refreshInboxBadgesFast();
    });
    analyzed.forEach(item => {
      if (item.failed || !item.row) return;
      const risk = item.cached ? item.risk : riskFromStoredRecord(toStoredRiskRecord(item, 'metadata'));
      rowRiskCache.set(item.emailId, risk);
      if (item.row.isConnected) {
        injectInboxBadge(item.row, risk.riskLevel, item.senderEmail, item.subject, risk);
      }
    });

    if (failedCount === analyzed.length) {
      showPanel('error', analyzed[0]?.reason || '선택 메일 검사를 완료하지 못했습니다.', {
        senderEmail: `${selected.length}개 메일 선택됨`,
        _selectionPanel: true
      });
      return;
    }

    const counts = analyzed.reduce((acc, item) => {
      const level = getPanelRiskLevel(item.risk?.riskLevel);
      acc[level] = (acc[level] || 0) + 1;
      return acc;
    }, { HIGH: 0, MEDIUM: 0, LOW: 0 });

    const riskLevel = counts.HIGH > 0 ? 'HIGH' : counts.MEDIUM > 0 ? 'MEDIUM' : 'LOW';
    const confidence = Math.round(
      analyzed.reduce((sum, item) => sum + Number(item.risk?.confidence || 70), 0) / analyzed.length
    );
    const suspiciousItems = analyzed
      .filter(item => getPanelRiskLevel(item.risk?.riskLevel) !== 'LOW')
      .slice(0, 8)
      .map(item => {
        const level = getPanelRiskLevel(item.risk?.riskLevel);
        const signals = (item.signals || []).slice(0, 2).join(' / ');
        return {
          level,
          title: `${item.subject || '(제목 없음)'} · ${item.senderEmail || item.sender || '(발신자 없음)'}`,
          detail: item.reason || signals || '제목과 발신자 기준으로 의심 요소가 확인되었습니다.'
        };
      });
    const topIndicators = [...new Set(suspiciousItems.map(item => item.detail))].slice(0, 6);
    const checklist = [];

    const summary =
      `선택한 ${selected.length}개 메일을 본문과 미리보기 없이 제목과 발신자 기준으로 검사했습니다. ` +
      `높음 ${counts.HIGH}개, 보통 ${counts.MEDIUM}개, 낮음 ${counts.LOW}개로 분류되었습니다. ` +
      `${cachedCount ? `이미 검사된 ${cachedCount}개 메일은 저장된 결과를 사용했습니다. ` : ''}` +
      `${failedCount ? `일부 ${failedCount}개 메일은 AI 응답을 받지 못해 로컬 사전검사 결과를 함께 표시했습니다. ` : ''}` +
      `의심 메일은 열어서 개인정보 전송 동의 후 정밀 분석을 진행해 주세요.`;

    showPanel('result', {
      riskLevel,
      confidence,
      summary,
      checklist,
      suspiciousItems,
      indicators: topIndicators,
      _skipOverlay: true,
      _selectionPanel: true
    }, {
      senderEmail: `${selected.length}개 메일 선택됨`,
      _selectionPanel: true
    });
  }

  function requestSelectedMetadataAnalysis(metadata, preRisk) {
    return new Promise(resolve => {
      if (!isExtensionValid()) {
        resolve({ ok: false, error: '확장 프로그램을 새로고침해주세요.' });
        return;
      }

      try {
        chrome.runtime.sendMessage(
          { type: 'ANALYZE_METADATA', payload: { metadata, preRisk } },
          (response) => {
            if (!isExtensionValid() || chrome.runtime.lastError) {
              resolve({
                ok: false,
                error: chrome.runtime.lastError?.message || '확장 프로그램을 새로고침해주세요.'
              });
              return;
            }
            if (!response?.ok) {
              resolve({ ok: false, error: response?.error || '알 수 없는 오류' });
              return;
            }
            resolve({ ok: true, result: response.result });
          }
        );
      } catch (_) {
        resolve({ ok: false, error: '선택 메일 검사를 시작하지 못했습니다.' });
      }
    });
  }

  async function runSelectedMetadataBatches(analyzed, pending, context, batchSize) {
    const chunks = chunkArray(pending, batchSize);

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const baseContext = {
        ...context,
        batchNumber: i + 1,
        batchCount: chunks.length,
        batchSize,
        batchStartIndex: chunk[0]?.requestIndex,
        batchEndIndex: chunk[chunk.length - 1]?.requestIndex
      };

      const response = await requestSelectedMetadataBatchWithRetry(chunk, baseContext);

      if (!response.ok) {
        markSelectedMetadataFailed(analyzed, chunk, response.error || '제목과 발신자 기반 AI 배치 검사를 완료하지 못했습니다.');
      } else {
        const missing = applySelectedMetadataBatchResults(analyzed, chunk, response.results || []);

        if (missing.length > 0) {
          const retryResponse = await requestSelectedMetadataBatchWithRetry(missing, {
            ...baseContext,
            retryMissing: true
          });

          if (retryResponse.ok) {
            const stillMissing = applySelectedMetadataBatchResults(analyzed, missing, retryResponse.results || []);
            markSelectedMetadataFailed(
              analyzed,
              stillMissing,
              'AI 배치 응답에서 이 메일의 결과가 누락되어 로컬 사전검사 결과를 표시했습니다.'
            );
          } else {
            markSelectedMetadataFailed(
              analyzed,
              missing,
              retryResponse.error || 'AI 배치 응답에서 누락된 메일을 재검사하지 못했습니다.'
            );
          }
        }
      }

      if (i < chunks.length - 1) {
        await delay(250);
      }
    }
  }

  async function requestSelectedMetadataBatchWithRetry(chunk, context) {
    const response = await requestSelectedMetadataBatchAnalysis(
      chunk.map(toMetadataBatchPayload),
      context
    );

    if (response.ok || !shouldRetryBatchError(response.error)) return response;

    await delay(1500);
    return requestSelectedMetadataBatchAnalysis(
      chunk.map(toMetadataBatchPayload),
      { ...context, retryAfterError: true }
    );
  }

  function toMetadataBatchPayload(item) {
    return {
      index: item.requestIndex,
      metadata: item.metadata,
      preRisk: item.localRisk
    };
  }

  function applySelectedMetadataBatchResults(analyzed, chunk, results) {
    const resultByIndex = new Map(
      (results || []).map(result => [Number(result.index), result])
    );
    const missing = [];

    chunk.forEach(item => {
      const metaRisk = resultByIndex.get(item.requestIndex);

      if (!metaRisk) {
        missing.push(item);
        return;
      }

      analyzed[item.selectionIndex] = {
        ...item.info,
        risk: {
          riskLevel: metaRisk.riskLevel || item.localRisk.riskLevel,
          confidence: Number(metaRisk.confidence || 70),
          indicators: metaRisk.signals || item.localRisk.indicators || []
        },
        reason: metaRisk.reason || '제목과 발신자 기준으로 뚜렷한 추가 위험 신호는 확인되지 않았습니다.',
        signals: metaRisk.signals || item.localRisk.indicators || [],
        failed: false
      };
    });

    return missing;
  }

  function markSelectedMetadataFailed(analyzed, items, reason) {
    items.forEach(item => {
      analyzed[item.selectionIndex] = {
        ...item.info,
        risk: item.localRisk,
        reason,
        signals: item.localRisk.indicators || [],
        failed: true
      };
    });
  }

  function shouldRetryBatchError(error) {
    return /429|rate|limit|timeout|503|502|500/i.test(String(error || ''));
  }

  function getSelectedMetadataBatchSize(model, pendingCount) {
    if (model === 'gemini') {
      return Math.min(SELECTED_METADATA_GEMINI_BATCH_SIZE, Math.max(1, pendingCount));
    }
    return SELECTED_METADATA_BATCH_SIZE;
  }

  function readSelectedModel() {
    return new Promise(resolve => {
      if (!isExtensionValid()) {
        resolve('groq');
        return;
      }

      try {
        chrome.storage.local.get(['selectedModel'], (data) => {
          if (chrome.runtime.lastError) {
            resolve('groq');
            return;
          }
          resolve(data.selectedModel || 'groq');
        });
      } catch (_) {
        resolve('groq');
      }
    });
  }

  function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function requestSelectedMetadataBatchAnalysis(items, context = {}) {
    return new Promise(resolve => {
      if (!isExtensionValid()) {
        resolve({ ok: false, error: '확장 프로그램을 새로고침해주세요.' });
        return;
      }

      try {
        chrome.runtime.sendMessage(
          { type: 'ANALYZE_METADATA_BATCH', payload: { items, context } },
          (response) => {
            if (!isExtensionValid() || chrome.runtime.lastError) {
              resolve({
                ok: false,
                error: chrome.runtime.lastError?.message || '확장 프로그램을 새로고침해주세요.'
              });
              return;
            }
            if (!response?.ok) {
              resolve({ ok: false, error: response?.error || '알 수 없는 오류' });
              return;
            }
            resolve({
              ok: true,
              results: Array.isArray(response.result?.results) ? response.result.results : []
            });
          }
        );
      } catch (_) {
        resolve({ ok: false, error: '선택 메일 배치 검사를 시작하지 못했습니다.' });
      }
    });
  }

  function findStoredRiskRecord(db, item) {
    const keys = [
      item?.emailId,
      getMailRiskDbKey(item),
      getMailRiskTextKey(item),
      ...(item?.aliases || [])
    ].map(normalizeKeyPart).filter(Boolean);

    for (const key of [...new Set(keys)]) {
      if (db[key]) return db[key];
    }
    return null;
  }

  async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function runNext() {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex++;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    }

    const workers = Array.from(
      { length: Math.min(limit, items.length) },
      runNext
    );
    await Promise.all(workers);
    return results;
  }

  function readMailRiskDb() {
    return new Promise(resolve => {
      if (riskDataCacheReady) {
        resolve(cachedMailRiskDb);
        return;
      }
      if (!isExtensionValid()) {
        resolve({});
        return;
      }
      safeStorageGet([MAIL_RISK_DB_KEY], (data) => {
        resolve(data[MAIL_RISK_DB_KEY] || {});
      });
    });
  }

  function toStoredRiskRecord(item, source) {
    const risk = item?.risk || {};
    const indicators = item?.signals || risk.indicators || item?.indicators || [];
    return {
      key: getMailRiskDbKey(item),
      aliases: getMailRiskDbAliases(item),
      subject: item?.subject || '',
      sender: item?.sender || '',
      senderEmail: item?.senderEmail || '',
      riskLevel: normalizeRiskLevel(risk.riskLevel || item?.riskLevel),
      confidence: Number(risk.confidence ?? item?.confidence ?? risk.score ?? 70),
      reason: item?.reason || item?.summary || '',
      indicators,
      source,
      checkedAt: Date.now()
    };
  }

  function normalizeRiskLevel(level) {
    if (level === 'BLACKLIST' || level === 'HIGH') return 'HIGH';
    if (level === 'MEDIUM') return 'MEDIUM';
    return 'LOW';
  }

  function riskFromStoredRecord(record) {
    return {
      riskLevel: normalizeRiskLevel(record?.riskLevel),
      confidence: Number(record?.confidence || 70),
      score: Number(record?.confidence || 70),
      indicators: record?.indicators || [],
      reason: record?.reason || '',
      checkedAt: record?.checkedAt
    };
  }

  function saveMailRiskRecords(records, callback) {
    const validRecords = records.filter(record => record?.key);
    if (validRecords.length === 0) {
      if (callback) callback();
      return;
    }

    safeStorageGet([MAIL_RISK_DB_KEY], (data) => {
      const db = data[MAIL_RISK_DB_KEY] || {};
      validRecords.forEach(record => {
        db[record.key] = record;
        (record.aliases || []).forEach(alias => {
          db[alias] = record;
        });
      });
      pruneMailRiskDb(db);
      cachedMailRiskDb = db;
      riskDataCacheReady = true;
      safeStorageSet({ [MAIL_RISK_DB_KEY]: db }, callback);
    });
  }

  function pruneMailRiskDb(db) {
    const entries = Object.entries(db);
    if (entries.length <= MAIL_RISK_DB_LIMIT) return;

    entries
      .sort((a, b) => Number(b[1]?.checkedAt || 0) - Number(a[1]?.checkedAt || 0))
      .slice(MAIL_RISK_DB_LIMIT)
      .forEach(([key]) => { delete db[key]; });
  }

  // ══════════════════════════════════════════════
  // Inbox 사전 분석
  // ══════════════════════════════════════════════

  // ── storage를 한 번만 읽고 모든 row를 처리 ──
  function scanInboxRows() {
    if (!riskDataCacheReady) {
      loadRiskDataCache(scanInboxRows);
      return;
    }

    const rows = Array.from(document.querySelectorAll('tr.zA'))
      .filter(row => !row.dataset.pgScanned || !row.querySelector('.pg-inbox-badge'));

    if (rows.length === 0) return;

    rows.forEach(row => {
      row.dataset.pgScanned = '1';

      const info       = getInboxRowInfo(row);
      const emailId    = info.emailId;
      const emailLower = info.senderEmail.toLowerCase();
      const domain     = emailLower.split('@')[1] || '';

      // 화이트/블랙리스트 매칭 — 도메인 또는 전체 이메일 둘 다 허용
      const matchList  = (list) => list.some(entry =>
        entry === emailLower ||
        entry === domain     ||
        domain.endsWith('.' + entry) // 서브도메인도 매칭: mail.anthropic.com → anthropic.com
      );

      const inWhitelist = matchList(cachedWhitelist);
      const inBlacklist = matchList(cachedBlacklist);

      if (inWhitelist) {
        const r = { riskLevel: 'SAFE', score: 0, indicators: [] };
        rowRiskCache.set(emailId, r);
        injectInboxBadge(row, 'SAFE', info.senderEmail, info.subject, r);
        return;
      }

      if (inBlacklist) {
        const r = { riskLevel: 'BLACKLIST', score: 100, indicators: ['블랙리스트 등록 발신자'] };
        rowRiskCache.set(emailId, r);
        injectInboxBadge(row, 'BLACKLIST', info.senderEmail, info.subject, r);
        attachClickInterceptor(row, info.senderEmail, info.subject, r);
        return;
      }

      const stored = findStoredRiskRecord(cachedMailRiskDb, info);
      if (!stored) {
        rowRiskCache.delete(emailId);
        injectInboxBadge(row, 'UNCHECKED', info.senderEmail, info.subject, {
          indicators: ['아직 검사하지 않은 메일입니다. 선택 후 PhishGuard 버튼으로 검사할 수 있습니다.']
        });
        return;
      }

      const risk = riskFromStoredRecord(stored);
      rowRiskCache.set(emailId, risk);
      injectInboxBadge(row, risk.riskLevel, info.senderEmail, info.subject, risk);
      if (risk.riskLevel === 'HIGH') {
        attachClickInterceptor(row, info.senderEmail, info.subject, risk);
      }
    });
  }

  // ── row 클릭 인터셉터 ─────────────────────────────────────────────
  function attachClickInterceptor(row, senderEmail, subject, risk) {
    if (row.dataset.pgIntercepted) return;
    row.dataset.pgIntercepted = '1';

    row.addEventListener('click', (e) => {
      if (row.dataset.pgIntercepted === 'done') return;

      e.preventDefault();
      e.stopImmediatePropagation();

      showClickInterceptOverlay({
        senderEmail,
        subject,
        riskLevel : risk.riskLevel,
        indicators: risk.indicators,
        onConfirm: () => {
          row.dataset.pgIntercepted = 'done';
          row.click();
        }
      });
    }, true);
  }

  // ── 클릭 인터셉트 오버레이 ────────────────────────────────────────
  function showClickInterceptOverlay({ senderEmail, subject, riskLevel, indicators, onConfirm }) {
    document.getElementById('phishguard-intercept')?.remove();
    // storage에서 최신 테마를 직접 읽어 렌더
    safeStorageGet(['theme'], (d) => {
      currentTheme = d.theme || 'light';
      _renderInterceptOverlay({ senderEmail, subject, riskLevel, indicators, onConfirm });
    });
  }
  function _renderInterceptOverlay({ senderEmail, subject, riskLevel, indicators, onConfirm }) {
    document.getElementById('phishguard-intercept')?.remove();

    const dk = currentTheme === 'dark';

    // 위험도별 라이트 기준 색상
    const RISK = {
      LOW      : { accent:'#137333', iconBg:'#e6f4ea', infoBg:'#f0faf3', confirmBg:'#137333', badgeBg:'#e6f4ea', title:'안전한 이메일',        sub:'알고리즘 사전 분석 결과', confirmText:'열기',               desc:'이 이메일은 <b style="color:#137333">낮은 위험도</b>로 분류되었습니다.',
        icon:`<svg width="30" height="30" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#137333" stroke-width="1.8" fill="#e6f4ea"/><path d="M8 12l2.5 2.5L16 9" stroke="#137333" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>` },
      MEDIUM   : { accent:'#e37400', iconBg:'#fef7e0', infoBg:'#fffde7', confirmBg:'#f9ab00', badgeBg:'#fef7e0', title:'주의가 필요한 이메일',  sub:'알고리즘 사전 분석 결과', confirmText:'주의하고 열기',       desc:'이 이메일은 <b style="color:#e37400">보통 위험도</b>로 분류되었습니다.<br>내용을 주의 깊게 확인하세요.',
        icon:`<svg width="30" height="30" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#f9ab00" stroke-width="1.8" fill="#fef7e0"/><path d="M12 8v5M12 15.5v.5" stroke="#f9ab00" stroke-width="2.2" stroke-linecap="round"/></svg>` },
      HIGH     : { accent:'#d93025', iconBg:'#fce8e6', infoBg:'#fff5f5', confirmBg:'#d93025', badgeBg:'#fce8e6', title:'피싱 위험 이메일 감지', sub:'알고리즘 사전 분석 결과', confirmText:'위험 감수하고 열기', desc:'이 이메일은 <b style="color:#d93025">높은 위험도</b>로 분류되었습니다.<br>링크 클릭 및 첨부파일을 주의하세요.',
        icon:`<svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 20h20L12 2z" stroke="#d93025" stroke-width="1.8" fill="#fce8e6"/><path d="M12 9v5M12 16.5v.5" stroke="#d93025" stroke-width="2" stroke-linecap="round"/></svg>` },
      BLACKLIST: { accent:'#ff5252', iconBg:'#2d0000', infoBg:'#1f1f1f', confirmBg:'#c62828', badgeBg:'#2d0000', title:'차단된 발신자',          sub:'블랙리스트 등록 도메인',   confirmText:'차단 무시하고 열기', desc:'이 발신자는 <b style="color:#ff5252">블랙리스트</b>에 등록되어 있습니다.<br>열람을 강력히 권장하지 않습니다.',
        icon:`<svg width="30" height="30" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#ff5252" stroke-width="1.8" fill="#2d0000"/><path d="M6 6l12 12M18 6L6 18" stroke="#ff5252" stroke-width="2.2" stroke-linecap="round"/></svg>` },
    };

    const R = RISK[riskLevel] || RISK.HIGH;
    const isBlacklist = riskLevel === 'BLACKLIST';

    // 다크모드 오버라이드 (BLACKLIST는 항상 어두운 카드 유지)
    const cardBg    = isBlacklist ? '#111111' : dk ? '#1e1e1e' : '#ffffff';
    const textBody  = isBlacklist ? '#f5f5f5' : dk ? '#e8eaed' : '#202124';
    const subText   = isBlacklist ? '#9e9e9e' : dk ? '#9aa0a6' : '#5f6368';
    const infoBg    = isBlacklist ? R.infoBg  : dk ? '#2a2a2a' : R.infoBg;
    const divider   = isBlacklist ? '#333333' : dk ? '#3c3c3c' : '#e8eaed';
    const cancelBg  = isBlacklist ? '#2a2a2a' : dk ? '#2d2d2d' : '#f1f3f4';
    const cancelBdr = isBlacklist ? '1px solid #444' : dk ? '1px solid #3c3c3c' : 'none';
    const cancelTxt = isBlacklist ? '#e0e0e0' : dk ? '#e8eaed' : '#3c4043';
    const shadow    = isBlacklist ? '.8' : dk ? '.6' : '.25';
    const border    = isBlacklist ? '1px solid #ff525430' : dk ? '1px solid #3c3c3c' : 'none';
    const backdrop  = isBlacklist ? 'rgba(0,0,0,0.80)' : dk ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.45)';
    const infoLabel = isBlacklist ? '#9e9e9e' : dk ? '#9aa0a6' : '#5f6368';
    const infoValue = isBlacklist ? '#ffcdd2' : R.accent;
    const badgeBg   = isBlacklist ? R.badgeBg : dk ? '#2a2a2a' : R.badgeBg;

    const indicatorHTML = indicators.slice(0, 5).map(x =>
      `<div style="font-size:12px;color:${R.accent};background:${badgeBg};border-radius:6px;padding:6px 10px;margin-bottom:4px;border:1px solid ${R.accent}40">⚠ ${esc(x)}</div>`
    ).join('');

    const ov = document.createElement('div');
    ov.id = 'phishguard-intercept';
    Object.assign(ov.style, {
      position:'fixed', inset:'0', zIndex:'2147483647',
      background: backdrop, backdropFilter:'blur(6px)',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontFamily:'"Google Sans",Roboto,sans-serif'
    });

    ov.innerHTML = `
      <style>@keyframes pgIcIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}</style>
      <div style="background:${cardBg};border-radius:20px;padding:32px 28px 24px;max-width:420px;width:92%;
                  text-align:center;box-shadow:0 16px 56px rgba(0,0,0,${shadow});
                  animation:pgIcIn .2s ease both;border:${border}">
        <div style="width:64px;height:64px;border-radius:50%;background:${R.iconBg};
                    display:flex;align-items:center;justify-content:center;margin:0 auto 16px;
                    box-shadow:0 0 0 6px ${R.iconBg}50">
          ${R.icon}
        </div>
        <div style="font-size:19px;font-weight:700;color:${R.accent};margin-bottom:4px">${esc(R.title)}</div>
        <div style="font-size:12px;color:${subText};margin-bottom:18px;background:${badgeBg};
                    display:inline-block;padding:2px 10px;border-radius:999px">${esc(R.sub)}</div>
        <div style="background:${infoBg};border-radius:12px;padding:14px 16px;
                    margin-bottom:${indicatorHTML ? '12px' : '18px'};text-align:left">
          <div style="font-size:11px;color:${infoLabel};margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">발신자</div>
          <div style="font-size:13px;color:${infoValue};font-weight:600;word-break:break-all">${esc(senderEmail)}</div>
          ${subject ? `<div style="height:1px;background:${divider};margin:10px 0"></div>
          <div style="font-size:11px;color:${infoLabel};margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">제목</div>
          <div style="font-size:13px;color:${textBody};word-break:break-all">${esc(subject)}</div>` : ''}
        </div>
        ${indicatorHTML ? `<div style="margin-bottom:18px;text-align:left">${indicatorHTML}</div>` : ''}
        <div style="font-size:13px;color:${textBody};line-height:1.8;margin-bottom:24px">${R.desc}</div>
        <div style="display:flex;gap:10px">
          <button id="pg-ic-cancel" style="flex:1;padding:12px 16px;background:${cancelBg};border:${cancelBdr};
                  border-radius:12px;color:${cancelTxt};font-size:13px;font-weight:500;cursor:pointer">← 돌아가기</button>
          <button id="pg-ic-confirm" style="flex:1;padding:12px 16px;background:${R.confirmBg};border:none;
                  border-radius:12px;color:#fff;font-size:13px;font-weight:500;cursor:pointer">${esc(R.confirmText)}</button>
        </div>
        <div style="margin-top:14px;font-size:11px;color:${subText}">ESC 키 또는 바깥 클릭으로 닫기</div>
      </div>`;

    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.querySelector('#pg-ic-cancel').addEventListener('click', close);
    ov.querySelector('#pg-ic-confirm').addEventListener('click', () => { close(); onConfirm(); });
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    const onEsc = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); } };
    document.addEventListener('keydown', onEsc);
  }
  function calculateRiskFromText({ senderEmail, subject, sender, text }) {
    let score = 0;
    const indicators = [];
    const lower = text.toLowerCase();
    const domain = senderEmail.split('@')[1]?.toLowerCase() || '';
    const senderLower = (sender || '').toLowerCase();

    // ── 브랜드 사칭 감지 ──
    for (const [brand, officialDomains] of Object.entries(BRAND_DOMAINS)) {
      if (senderLower.includes(brand)) {
        const isOfficial = officialDomains.some(od =>
          domain === od || domain.endsWith('.' + od)
        );
        if (!isOfficial) {
          score += 50;
          indicators.push(`브랜드 사칭 의심: "${sender}" 표시명이지만 실제 도메인은 ${domain}`);
        }
        break;
      }
    }

    SUSPICIOUS_KEYWORDS.forEach(k => {
      if (lower.includes(k)) {
        score += 10;
        indicators.push(`키워드 감지: "${k}"`);
      }
    });

    if (/bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly/i.test(text)) {
      score += 15; indicators.push('단축 URL 포함');
    }
    if (/https?:\/\/\d+\.\d+\.\d+\.\d+/.test(text)) {
      score += 20; indicators.push('IP 주소 기반 URL 포함');
    }
    if (/\.(zip|mov|xyz|top|gq|tk)(\/|$)/i.test(text)) {
      score += 15; indicators.push('의심스러운 TLD 사용');
    }

    if (/[а-яА-Я\u0370-\u03FF]/.test(domain)) {
      score += 40; indicators.push('유니코드 스푸핑 의심 (동형 문자)');
    }
    if (/[\u200B-\u200D\uFEFF]/.test(senderEmail)) {
      score += 20; indicators.push('숨겨진 Zero-width 문자 포함');
    }
    if (/\d/.test(domain)) {
      score += 10; indicators.push('숫자 포함 도메인');
    }
    if (/paypaI\.com|micr0soft|arnazon/.test(domain)) {
      score += 35; indicators.push('유사 도메인 사용 의심');
    }

    // 브랜드 사칭 감지 시 무조건 HIGH
    const brandSpoofed = indicators.some(i => i.startsWith('브랜드 사칭'));
    const riskLevel = brandSpoofed ? 'HIGH'
                    : score >= 60  ? 'HIGH'
                    : score >= 25  ? 'MEDIUM'
                    : 'LOW';
    return { score, riskLevel, indicators };
  }

  // ══════════════════════════════════════════════
  // 이메일 본문 / 메타데이터 추출
  // ══════════════════════════════════════════════

  function extractBody() {
    for (const sel of ['div.a3s.aiL', 'div[data-message-id] .a3s', '.ii.gt .a3s.aiL', 'div.gs .a3s']) {
      const el = Array.from(document.querySelectorAll(sel)).find(isVisibleElement);
      if (el && el.innerText.trim().length > 30) return el.innerText.trim();
    }
    return null;
  }

  function extractMetadata() {
    const meta = { subject: '', sender: '', senderEmail: '', date: '' };
    try {
      const subjectEl = Array.from(document.querySelectorAll('h2.hP')).find(isVisibleElement);
      const senderEl  = Array.from(document.querySelectorAll('span.gD')).find(isVisibleElement);
      const dateEl    = Array.from(document.querySelectorAll('span.g3')).find(isVisibleElement);

      meta.subject     = subjectEl?.innerText.trim()        || '';
      meta.sender      = senderEl?.getAttribute('name')     || '';
      meta.senderEmail = senderEl?.getAttribute('email')    || '';
      meta.date        = dateEl?.innerText.trim()           || '';
    } catch (_) {}
    return meta;
  }

  function hasVisibleMessageShell() {
    return !!Array.from(document.querySelectorAll('h2.hP, span.gD, div[role="main"] div.a3s')).find(isVisibleElement);
  }

  function isVisibleElement(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0';
  }

  function getEmailId(metadata) {
    return getMailRiskDbKey(metadata);
  }

  // ══════════════════════════════════════════════
  // 메타데이터 기반 사전 분석 (Privacy-First)
  // ══════════════════════════════════════════════

  function startMetadataAnalysis(body, metadata, preRisk) {
    pendingEmailData = { body, metadata };

    if (!isExtensionValid()) return;
    if (isMetadataChecking) return;

    isMetadataChecking = true;
    showPanel('loading', null, metadata);
    const seq = ++metadataSeq;
    const fallbackTimer = setTimeout(() => {
      if (seq === metadataSeq && isMetadataChecking && isCurrentEmailView(metadata)) {
        showContentConsentPanel(metadata, preRisk);
      }
    }, 2500);
    console.debug('[PhishGuard] metadata precheck start', {
      sender: metadata.sender,
      senderEmail: metadata.senderEmail,
      subject: metadata.subject,
      preRisk
    });
    afterLoadingPaint(() => {
      if (seq !== metadataSeq || !isMetadataChecking) return;
      if (!isCurrentEmailView(metadata)) {
        clearTimeout(fallbackTimer);
        isMetadataChecking = false;
        return;
      }

      try {
        chrome.runtime.sendMessage(
          { type: 'ANALYZE_METADATA', payload: { metadata, preRisk } },
          (response) => {
            if (seq !== metadataSeq) return;
            clearTimeout(fallbackTimer);
            isMetadataChecking = false;
            if (!isExtensionValid() || chrome.runtime.lastError) {
              console.debug('[PhishGuard] metadata precheck runtime error', chrome.runtime.lastError?.message);
              if (isCurrentEmailView(metadata)) showContentConsentPanel(metadata, preRisk);
              return;
            }
            if (!response?.ok) {
              console.debug('[PhishGuard] metadata precheck failed', response?.error);
              if (isCurrentEmailView(metadata)) showContentConsentPanel(metadata, preRisk);
              return;
            }

            const metaRisk = response.result;
            console.debug('[PhishGuard] metadata precheck result', metaRisk);
            saveMailRiskRecords([
              toStoredRiskRecord({
                ...metadata,
                risk: {
                  riskLevel: metaRisk?.riskLevel,
                  confidence: metaRisk?.confidence,
                  indicators: metaRisk?.signals || []
                },
                reason: metaRisk?.reason,
                signals: metaRisk?.signals || []
              }, 'metadata')
            ]);
            if (!isCurrentEmailView(metadata)) return;
            showContentConsentPanel(metadata, preRisk, metaRisk);
          }
        );
      } catch (_) {
        if (seq !== metadataSeq) return;
        clearTimeout(fallbackTimer);
        isMetadataChecking = false;
        if (isCurrentEmailView(metadata)) showContentConsentPanel(metadata, preRisk);
      }
    });
  }

  // ══════════════════════════════════════════════
  // AI 분석 요청
  // ══════════════════════════════════════════════

  function startAnalysis(body, metadata) {
    isAnalyzing = true;
    showPanel('loading', null, metadata);
    const analysisEmailId = getEmailId(metadata);
    const seq = ++analysisSeq;

    if (!isExtensionValid()) {
      isAnalyzing = false;
      showPanel('error', '페이지를 새로고침해주세요.', metadata);
      return;
    }

    afterLoadingPaint(() => {
      if (seq !== analysisSeq) return;
      if (!isCurrentEmailView(metadata)) {
        isAnalyzing = false;
        return;
      }

      try {
        chrome.runtime.sendMessage(
          { type: 'ANALYZE_EMAIL', payload: { body, metadata } },
          (response) => {
            if (seq !== analysisSeq) return;
            isAnalyzing = false;
            if (!isExtensionValid() || chrome.runtime.lastError) {
              if (!isCurrentEmailView(metadata)) return;
              showPanel('error',
                chrome.runtime.lastError?.message || '확장 프로그램을 새로고침해주세요.',
                metadata);
              return;
            }
            if (!response?.ok) {
              if (!isCurrentEmailView(metadata)) return;
              showPanel('error', response?.error || '알 수 없는 오류', metadata);
              return;
            }
            try { chrome.runtime.sendMessage({ type: 'UPDATE_STATS', level: response.result.riskLevel }); } catch (_) {}
            resultCache[analysisEmailId] = { result: response.result, metadata };
            saveMailRiskRecords([
              toStoredRiskRecord({
                ...metadata,
                risk: response.result,
                summary: response.result?.summary,
                indicators: response.result?.indicators || []
              }, 'full')
            ]);
            if (!isCurrentEmailView(metadata)) return;
            showPanel('result', response.result, metadata);
          }
        );
      } catch (_) {
        if (seq !== analysisSeq) return;
        isAnalyzing = false;
        showPanel('error', '페이지를 새로고침해주세요.', metadata);
      }
    });
  }

  // ══════════════════════════════════════════════
  // UI: 오버레이 (HIGH 위험)
  // ══════════════════════════════════════════════

  function showOverlay(metadata, riskLevel) {
    document.getElementById('phishguard-overlay')?.remove();
    safeStorageGet(['theme'], (d) => {
      currentTheme = d.theme || 'light';
      _renderOverlay(metadata, riskLevel);
    });
  }
  function _renderOverlay(metadata, riskLevel) {
    document.getElementById('phishguard-overlay')?.remove();

    const dk = currentTheme === 'dark';

    const RISK = {
      LOW      : { accent:'#137333', iconBg:'#e6f4ea', senderBg:'#e6f4ea', confirmBg:'#137333', title:'안전한 이메일',        desc:'이 이메일은 <b style="color:#137333">낮은 위험도</b>로 분류되었습니다.',
        icon:`<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#137333" stroke-width="1.8" fill="#e6f4ea"/><path d="M8 12l2.5 2.5L16 9" stroke="#137333" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>` },
      MEDIUM   : { accent:'#e37400', iconBg:'#fef7e0', senderBg:'#fef7e0', confirmBg:'#f9ab00', title:'주의 필요 이메일',      desc:'이 이메일은 <b style="color:#e37400">보통 위험도</b>로 분류되었습니다.<br>내용을 주의 깊게 확인하세요.',
        icon:`<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#f9ab00" stroke-width="1.8" fill="#fef7e0"/><path d="M12 8v5M12 15.5v.5" stroke="#f9ab00" stroke-width="2.2" stroke-linecap="round"/></svg>` },
      HIGH     : { accent:'#d93025', iconBg:'#fce8e6', senderBg:'#fce8e6', confirmBg:'#d93025', title:'스피어피싱 위험 감지',  desc:'이 이메일은 <b style="color:#d93025">높은 위험도</b>로 분류되었습니다.<br>링크 클릭 및 첨부파일 열람을 자제해주세요.',
        icon:`<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 20h20L12 2z" stroke="#d93025" stroke-width="1.8" fill="#fce8e6"/><path d="M12 9v5M12 16.5v.5" stroke="#d93025" stroke-width="2" stroke-linecap="round"/></svg>` },
      BLACKLIST: { accent:'#ff5252', iconBg:'#2d0000', senderBg:'#1f1f1f', confirmBg:'#c62828', title:'차단된 발신자',          desc:'이 발신자는 <b style="color:#ff5252">블랙리스트</b>에 등록되어 있습니다.<br>열람을 강력히 권장하지 않습니다.',
        icon:`<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#ff5252" stroke-width="1.8" fill="#2d0000"/><path d="M6 6l12 12M18 6L6 18" stroke="#ff5252" stroke-width="2.2" stroke-linecap="round"/></svg>` },
    };

    const R = RISK[riskLevel] || RISK.HIGH;
    const isBlacklist = riskLevel === 'BLACKLIST';

    const cardBg   = isBlacklist ? '#111111' : dk ? '#1e1e1e' : '#ffffff';
    const textBody = isBlacklist ? '#f5f5f5' : dk ? '#e8eaed' : '#3c4043';
    const subText  = isBlacklist ? '#9e9e9e' : dk ? '#9aa0a6' : '#5f6368';
    const senderBg = isBlacklist ? R.senderBg : dk ? '#2a2a2a' : R.senderBg;
    const cancelBg = isBlacklist ? '#2a2a2a' : dk ? '#2d2d2d' : '#f1f3f4';
    const cancelBdr= isBlacklist ? '1px solid #444' : dk ? '1px solid #3c3c3c' : 'none';
    const cancelTxt= isBlacklist ? '#e0e0e0' : dk ? '#e8eaed' : '#3c4043';
    const shadow   = isBlacklist ? '.8' : dk ? '.6' : '.25';
    const border   = isBlacklist ? '1px solid #ff525430' : dk ? '1px solid #3c3c3c' : 'none';
    const backdrop = isBlacklist ? 'rgba(0,0,0,0.80)' : dk ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.45)';

    const ov = document.createElement('div');
    ov.id = 'phishguard-overlay';
    Object.assign(ov.style, {
      position:'fixed', inset:'0', zIndex:'2147483646',
      background: backdrop, backdropFilter:'blur(5px)',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontFamily:'"Google Sans",Roboto,sans-serif'
    });

    ov.innerHTML = `
      <style>
        @keyframes pgFadeOut{from{opacity:1}to{opacity:0}}
        @keyframes pgSlideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
      </style>
      <div style="background:${cardBg};border-radius:20px;padding:32px 28px 24px;max-width:400px;width:90%;
                  text-align:center;box-shadow:0 8px 40px rgba(0,0,0,${shadow});
                  animation:pgSlideUp .3s ease both;border:${border}">
        <div style="width:56px;height:56px;border-radius:50%;background:${R.iconBg};
                    display:flex;align-items:center;justify-content:center;margin:0 auto 16px;
                    box-shadow:0 0 0 5px ${R.iconBg}50">
          ${R.icon}
        </div>
        <div style="font-size:18px;font-weight:700;color:${R.accent};margin-bottom:8px">${esc(R.title)}</div>
        <div style="font-size:12px;color:${subText};margin-bottom:12px">발신자</div>
        <div style="font-size:13px;color:${R.accent};background:${senderBg};border-radius:8px;
                    padding:8px 14px;margin-bottom:16px;word-break:break-all;font-weight:600">
          ${esc(metadata?.senderEmail || '(알 수 없음)')}
        </div>
        <div style="font-size:14px;color:${textBody};line-height:1.8;margin-bottom:24px">${R.desc}</div>
        <div style="display:flex;gap:10px">
          <button id="pg-ov-confirm" style="flex:1;padding:11px 16px;background:${R.confirmBg};border:none;
                  border-radius:12px;color:#fff;font-size:13px;font-weight:500;cursor:pointer">내용 확인</button>
          <button id="pg-ov-back" style="flex:1;padding:11px 16px;background:${cancelBg};border:${cancelBdr};
                  border-radius:12px;color:${cancelTxt};font-size:13px;font-weight:500;cursor:pointer">뒤로 가기</button>
        </div>
        <div style="margin-top:14px;font-size:11px;color:${subText}">ESC 키로 닫기</div>
      </div>`;

    document.body.appendChild(ov);
    const closeOv = () => {
      ov.style.animation = 'pgFadeOut .2s ease forwards';
      setTimeout(() => ov.remove(), 200);
    };
    ov.querySelector('#pg-ov-confirm').addEventListener('click', closeOv);
    ov.querySelector('#pg-ov-back').addEventListener('click', () => { ov.remove(); history.back(); });
    const onEsc = (e) => { if (e.key === 'Escape') { closeOv(); document.removeEventListener('keydown', onEsc); } };
    document.addEventListener('keydown', onEsc);
  }
  function showContentConsentPanel(metadata, preRisk, metaRisk) {
    document.getElementById('phishguard-consent')?.remove();
    document.getElementById('phishguard-root')?.remove();

    const riskLevel = preRisk?.riskLevel || 'UNKNOWN';
    const indicators = preRisk?.indicators || [];
    const aiSignals = metaRisk?.signals || [];
    const reason = metaRisk?.reason || '';
    const needsAdditionalCheck = metaRisk?.needsAdditionalCheck !== false;
    const signalList = aiSignals.length ? aiSignals : indicators;
    const intro = needsAdditionalCheck
      ? '이 이메일에서 일부 의심 요소가 발견되었습니다.'
      : '1차 검사 결과 뚜렷한 피싱 위험 신호는 확인되지 않았습니다.';
    const title = needsAdditionalCheck ? '추가 검사가 필요합니다' : '1차 검사 결과 정상으로 보입니다';
    const detail = [
      intro,
      reason ? `<br><br><strong style="color:#3c4043">판단 근거</strong><br>${esc(reason)}` : '',
      signalList.length ? `<br><br>${signalList.slice(0, 3).map(x => `• ${esc(x)}`).join('<br>')}` : '',
      '<br><br>개인정보보호를 위해 본문은 아직 AI에 전송되지 않았습니다.'
    ].join('');

    const box = document.createElement('div');
    box.id = 'phishguard-consent';
    Object.assign(box.style, {
      position: 'fixed', top: '90px', right: '20px', width: '320px',
      background: '#fff', border: '1px solid #dadce0', borderRadius: '14px',
      boxShadow: '0 4px 20px rgba(0,0,0,.15)', zIndex: '2147483647',
      padding: '18px', fontFamily: '"Google Sans",sans-serif'
    });

    box.innerHTML = `
      <div style="font-size:15px;font-weight:600;margin-bottom:10px">${title}</div>
      <div style="font-size:13px;color:#5f6368;line-height:1.6;margin-bottom:16px">
        ${detail}
      </div>
      <button id="pg-analyze-full"
        style="width:100%;padding:10px;border:none;border-radius:8px;background:#1a73e8;
               color:#fff;cursor:pointer;font-weight:500;font-size:13px;margin-bottom:8px">
        본문 포함 정밀 분석
      </button>
      <button id="pg-cancel-consent"
        style="width:100%;padding:9px;border:1px solid #dadce0;border-radius:8px;
               background:none;color:#5f6368;cursor:pointer;font-size:13px">
        나중에 하기
      </button>`;

    document.body.appendChild(box);

    box.querySelector('#pg-analyze-full').addEventListener('click', () => {
      box.remove();
      if (pendingEmailData) startAnalysis(pendingEmailData.body, pendingEmailData.metadata);
    });
    box.querySelector('#pg-cancel-consent').addEventListener('click', () => box.remove());
  }

  // ══════════════════════════════════════════════
  // UI: AI 정밀 분석 버튼 (HIGH 사전 감지 후)
  // ══════════════════════════════════════════════

  function injectDeepAnalysisButton(body, metadata, emailId) {
    document.getElementById('pg-deep-analysis-btn')?.remove();

    const btn = document.createElement('button');
    btn.id = 'pg-deep-analysis-btn';
    Object.assign(btn.style, {
      position: 'fixed', bottom: '24px', right: '24px', zIndex: '2147483647',
      padding: '10px 20px', background: '#1a73e8', color: '#fff',
      border: 'none', borderRadius: '20px', fontSize: '13px', fontWeight: '500',
      cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,.3)',
      fontFamily: '"Google Sans",sans-serif', transition: 'background .15s'
    });
    btn.textContent = '🔍 AI 정밀 분석';
    btn.onmouseover = () => { btn.style.background = '#1557b0'; };
    btn.onmouseout  = () => { btn.style.background = '#1a73e8'; };
    btn.addEventListener('click', () => {
      btn.remove();
      delete resultCache[emailId];
      startAnalysis(body, metadata);
    });
    document.body.appendChild(btn);

    const btnObs = new MutationObserver(() => {
      if (!document.getElementById('phishguard-root')) { btn.remove(); btnObs.disconnect(); }
    });
    btnObs.observe(document.body, { childList: true, subtree: false });
  }

  // ══════════════════════════════════════════════
  // UI: 분석 패널
  // ══════════════════════════════════════════════

  function showPanel(status, data, metadata) {
    document.getElementById('phishguard-root')?.remove();
    const selectionContext =
      (typeof data === 'object' && !!data?._selectionPanel) ||
      !!metadata?._selectionPanel;

    // HIGH → 오버레이 (최초 1회)
    if (status === 'result' && data?.riskLevel === 'HIGH' && !data?._skipOverlay) {
      if (!resultCache[lastAnalyzedId]) resultCache[lastAnalyzedId] = {};
      if (!resultCache[lastAnalyzedId]._overlayShown) {
        showOverlay(metadata, 'HIGH');
        resultCache[lastAnalyzedId]._overlayShown = true;
      }
    }

    if (!document.getElementById('phishguard-font')) {
      const link = document.createElement('link');
      link.id = 'phishguard-font'; link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600&family=Noto+Sans+KR:wght@400;500&display=swap';
      document.head.appendChild(link);
    }

    const panel = document.createElement('div');
    panel.id = 'phishguard-root';
    if (selectionContext) panel.dataset.pgContext = 'selection';
    Object.assign(panel.style, {
      position: 'fixed', width: '340px', maxHeight: 'calc(100vh - 88px)',
      overflowY: 'auto', zIndex: '2147483647',
      fontFamily: '"Google Sans",Roboto,"Noto Sans KR",sans-serif',
      fontSize: '13px', lineHeight: '1.5'
    });

    if (savedPosition) {
      panel.style.top  = savedPosition.top;
      panel.style.left = savedPosition.left;
      panel.style.right = 'auto';
    } else {
      panel.style.top   = '72px';
      panel.style.right = '16px';
    }

    panel.innerHTML = buildHTML(status, data, metadata);
    document.body.appendChild(panel);
    makeDraggable(panel, panel.querySelector('#pg-header'));

    panel.querySelector('#pg-close')?.addEventListener('click', () => {
      panelDismissed = true;
      panel.style.animation = 'pgPanelOut .15s ease forwards';
      setTimeout(() => panel.remove(), 150);
    });
    panel.querySelectorAll('.pg-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const wrap = cb.closest('.pg-checklist-item');
        if (wrap) wrap.style.opacity = cb.checked ? '0.45' : '1';
      });
    });
    panel.querySelectorAll('.pg-expand-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const el = panel.querySelector('#' + btn.getAttribute('data-target'));
        if (!el) return;
        const hidden = el.style.display === 'none';
        el.style.display = hidden ? 'block' : 'none';
        btn.textContent = hidden ? '▲' : '▼';
      });
    });
  }

  // ══════════════════════════════════════════════
  // UI: 패널 HTML 빌더
  // ══════════════════════════════════════════════

  function buildHTML(status, data, metadata) {
    const dk = currentTheme === 'dark';
    const T = dk ? {
      bg:'#1f1f1f', bg2:'#2d2d2d', hover:'#3c3c3c',
      text:'#e8eaed', text2:'#9aa0a6', muted:'#5f6368',
      border:'#3c3c3c', borderLight:'#333',
      accent:'#8ab4f8', accentBg:'rgba(138,180,248,0.12)',
      red:'#f28b82', redBg:'rgba(242,139,130,0.12)', redBorder:'rgba(242,139,130,0.25)',
      yellow:'#fdd663', yellowBg:'rgba(253,214,99,0.12)',
      green:'#81c995', greenBg:'rgba(129,201,149,0.12)', scrollThumb:'#555'
    } : {
      bg:'#fff', bg2:'#f8f9fa', hover:'#f1f3f4',
      text:'#202124', text2:'#5f6368', muted:'#9aa0a6',
      border:'#e8eaed', borderLight:'#f1f3f4',
      accent:'#1a73e8', accentBg:'#e8f0fe',
      red:'#d93025', redBg:'#fce8e6', redBorder:'#f5c6c2',
      yellow:'#e37400', yellowBg:'#fef7e0',
      green:'#188038', greenBg:'#e6f4ea', scrollThumb:'#dadce0'
    };

    const styles = `<style>
      @keyframes pgPanelIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
      @keyframes pgPanelOut{from{opacity:1}to{opacity:0;transform:translateY(-8px)}}
      @keyframes pgPulse{0%,100%{opacity:.2;transform:scale(.8)}50%{opacity:1;transform:scale(1.2)}}
      #phishguard-root::-webkit-scrollbar{width:4px}
      #phishguard-root::-webkit-scrollbar-thumb{background:${T.scrollThumb};border-radius:4px}
    </style>`;

    const header = `
      <div id="pg-header" style="padding:12px 16px;display:flex;align-items:center;
           justify-content:space-between;border-bottom:1px solid ${T.border};
           background:${T.bg};cursor:move;user-select:none">
        <div style="display:flex;align-items:center;gap:10px;pointer-events:none">
          <div style="width:28px;height:28px;background:${T.accentBg};border-radius:50%;
               display:flex;align-items:center;justify-content:center">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 1L1.5 4.5V8c0 3.866 2.91 7 6.5 7s6.5-3.134 6.5-7V4.5L8 1z"
                    stroke="${T.accent}" stroke-width="1.3" fill="${T.accentBg}"/>
              <path d="M6 8l1.5 1.5L10 6" stroke="${T.accent}" stroke-width="1.4"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <span style="font-size:14px;font-weight:500;color:${T.text}">PhishGuard AI</span>
        </div>
        <button id="pg-close" style="background:none;border:none;cursor:pointer;color:${T.text2};
                width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center"
                onmouseover="this.style.background='${T.hover}'" onmouseout="this.style.background='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>`;

    const wrap = (content) =>
      `${styles}<div style="background:${T.bg};border-radius:12px;overflow:hidden;
       box-shadow:0 2px 12px rgba(0,0,0,${dk ? '.4' : '.15'});animation:pgPanelIn .2s ease">
       ${header}${content}</div>`;

    if (status === 'loading') {
      const dots = [0,1,2].map(i =>
        `<div style="width:8px;height:8px;border-radius:50%;background:${T.accent};
         animation:pgPulse 1.2s ${i*.2}s ease-in-out infinite"></div>`).join('');
      return wrap(`<div style="padding:32px 16px;text-align:center">
        <div style="display:flex;justify-content:center;gap:6px;margin-bottom:16px">${dots}</div>
        <div style="font-size:13px;font-weight:500;color:${T.text}">AI 분석 중...</div>
        <div style="font-size:12px;color:${T.text2};margin-top:6px">${esc(metadata?.senderEmail||'')}</div>
      </div>`);
    }

    if (status === 'error') {
      return wrap(`<div style="padding:20px 16px">
        <div style="display:flex;gap:10px;padding:12px;background:${T.redBg};border-radius:8px">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;margin-top:1px">
            <circle cx="12" cy="12" r="10" stroke="${T.red}" stroke-width="1.5"/>
            <path d="M12 8v5M12 15.5v.5" stroke="${T.red}" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <div>
            <div style="font-size:13px;color:${T.red};font-weight:500;margin-bottom:4px">
              ${esc(data||'오류가 발생했습니다')}</div>
            <div style="font-size:12px;color:${T.text2}">팝업 → 설정에서 API 키를 확인해주세요</div>
          </div>
        </div>
      </div>`);
    }

    const r = data;
    const isHigh = r.riskLevel === 'HIGH';
    const isMed  = r.riskLevel === 'MEDIUM';
    const color  = isHigh ? T.red   : isMed ? T.yellow   : T.green;
    const bg     = isHigh ? T.redBg : isMed ? T.yellowBg : T.greenBg;
    const label  = isHigh ? '높음'  : isMed ? '보통'     : '낮음';

    const icon = isHigh
      ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
           <path d="M12 2L2 20h20L12 2z" stroke="${color}" stroke-width="1.5" fill="${bg}"/>
           <path d="M12 9v5M12 16.5v.5" stroke="${color}" stroke-width="2" stroke-linecap="round"/></svg>`
      : isMed
      ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
           <circle cx="12" cy="12" r="10" stroke="${color}" stroke-width="1.5" fill="${bg}"/>
           <path d="M12 8v5M12 15.5v.5" stroke="${color}" stroke-width="2" stroke-linecap="round"/></svg>`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
           <circle cx="12" cy="12" r="10" stroke="${color}" stroke-width="1.5" fill="${bg}"/>
           <path d="M8 12l2.5 2.5L16 9" stroke="${color}" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    const checklist = (r.checklist || []).map((item, i) => {
      const flagged = item.flagged;
      const tc = flagged ? T.red   : T.text;
      const cc = flagged ? T.red   : T.accent;
      const ib = flagged
        ? `background:${T.redBg};border-radius:8px;padding:10px 12px;margin:4px 0`
        : 'padding:10px 0';
      const reasonBorder = flagged ? T.redBorder : T.border;
      const reason = item.reason
        ? `<div class="pg-reason" id="pg-reason-${i}"
                style="display:none;margin-top:8px;padding:8px 12px;background:${T.bg2};
                       border:1px solid ${reasonBorder};border-radius:6px;font-size:12px;
                       color:${T.text2};line-height:1.6">${esc(item.reason)}</div>` : '';
      const expBtn = item.reason
        ? `<button type="button" class="pg-expand-btn" data-target="pg-reason-${i}"
                   style="background:none;border:none;color:${T.muted};cursor:pointer;
                           margin-left:auto;padding:2px 6px;font-size:10px;border-radius:4px"
                   onmouseover="this.style.background='${T.hover}'"
                   onmouseout="this.style.background='none'">▼</button>` : '';
      return `
        <div style="${ib};border-bottom:1px solid ${T.borderLight}" class="pg-checklist-item">
          <div style="display:flex;align-items:flex-start;gap:8px">
            <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;flex:1">
              <input type="checkbox" class="pg-check"
                     style="margin-top:3px;flex-shrink:0;accent-color:${cc};width:14px;height:14px;cursor:pointer">
              <span style="font-size:13px;line-height:1.6;color:${tc};${flagged?'font-weight:500':''}">
                ${flagged ? '⚠ ' : ''}${esc(item.text)}</span>
            </label>${expBtn}
          </div>${reason}
        </div>`;
    }).join('');

    const indicators = (r.indicators||[]).length
      ? `<div style="padding:12px 16px">
           <div style="font-size:11px;font-weight:500;color:${T.text2};text-transform:uppercase;
                       letter-spacing:.05em;margin-bottom:8px">탐지된 위협 지표</div>
           ${r.indicators.map(x =>
             `<div style="font-size:12px;color:${T.red};padding:8px 12px;background:${T.redBg};
                          border-radius:6px;margin-bottom:4px">${esc(x)}</div>`).join('')}
         </div>` : '';

    const selectionIssues = r._selectionPanel
      ? `<div style="padding:12px 16px 4px">
           <div style="font-size:11px;font-weight:500;color:${T.text2};text-transform:uppercase;
                       letter-spacing:.05em;margin-bottom:8px">의심 항목</div>
           ${(r.suspiciousItems || []).length
             ? r.suspiciousItems.map(item => {
                 const issueHigh = item.level === 'HIGH';
                 const issueColor = issueHigh ? T.red : T.yellow;
                 const issueBg = issueHigh ? T.redBg : T.yellowBg;
                 return `<div style="background:${issueBg};border-radius:8px;padding:10px 12px;margin-bottom:6px">
                   <div style="font-size:12px;color:${issueColor};font-weight:600;line-height:1.5">
                     ${esc(issueHigh ? '높음' : '보통')} · ${esc(item.title || '(제목 없음)')}
                   </div>
                   <div style="font-size:12px;color:${T.text2};line-height:1.6;margin-top:4px">
                     ${esc(item.detail || '제목과 발신자 기준으로 의심 요소가 확인되었습니다.')}
                   </div>
                 </div>`;
               }).join('')
             : `<div style="font-size:12px;color:${T.text2};padding:10px 12px;background:${T.bg2};
                         border-radius:8px">현재 제목과 발신자 기준으로 표시할 의심 항목은 없습니다.</div>`}
         </div>`
      : '';

    const checklistSection = r._selectionPanel
      ? selectionIssues
      : `<div style="padding:12px 16px 4px">
          <div style="font-size:11px;font-weight:500;color:${T.text2};text-transform:uppercase;
                      letter-spacing:.05em;margin-bottom:6px">판단 체크리스트</div>
          ${checklist}
        </div>`;

    const indicatorSection = r._selectionPanel ? '' : indicators;

    return wrap(`
      <div>
        <div style="margin:14px 14px 0;padding:14px 16px;background:${bg};border-radius:10px;
                    display:flex;justify-content:space-between;align-items:center">
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
        <div style="padding:14px 16px;font-size:13px;color:${T.text};line-height:1.7;
                    border-bottom:1px solid ${T.borderLight}">${esc(r.summary||'')}</div>
        <div style="padding:10px 16px;border-bottom:1px solid ${T.borderLight};
                    display:flex;align-items:center;gap:8px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="4" width="20" height="16" rx="2" stroke="${T.text2}" stroke-width="1.5"/>
            <path d="M2 7l10 6 10-6" stroke="${T.text2}" stroke-width="1.5"/>
          </svg>
          <div>
            <div style="font-size:11px;color:${T.text2}">발신자</div>
            <div style="font-size:12px;color:${T.text};font-weight:500">
              ${esc(metadata?.senderEmail||'(알 수 없음)')}</div>
          </div>
        </div>
        ${checklistSection}
        ${indicatorSection}
        <div style="padding:10px 16px;border-top:1px solid ${T.borderLight};
                    font-size:11px;color:${T.muted};text-align:center">
          최종 판단은 사용자에게 있습니다 · PhishGuard AI</div>
      </div>`);
  }

  // ══════════════════════════════════════════════
  // UI: Inbox 배지
  // ══════════════════════════════════════════════

  function injectInboxBadge(row, risk, senderEmail, subject, riskData) {
    row.querySelector('.pg-inbox-badge')?.remove();

    // 위험도별 설정
    const CONFIG = {
      UNCHECKED: { bg: '#f1f3f4', color: '#5f6368', border: '#dadce0', label: '미검사', dot: '#9aa0a6' },
      SAFE     : { bg: '#e6f4ea', color: '#137333', border: '#b7dfbf', label: '낮음', dot: '#34a853' },
      LOW      : { bg: '#e8f0fe', color: '#1557b0', border: '#bdd2f8', label: '낮음', dot: '#4285f4' },
      MEDIUM   : { bg: '#fef7e0', color: '#7d4e00', border: '#f9e4a0', label: '보통', dot: '#f9ab00' },
      HIGH     : { bg: '#fce8e6', color: '#c5221f', border: '#f5c6c2', label: '높음', dot: '#ea4335' },
      BLACKLIST: { bg: '#3c0000', color: '#ffcdd2', border: '#b71c1c', label: '✕ 차단', dot: '#ff5252' }
    };
    const c = CONFIG[risk] || CONFIG.UNCHECKED;

    const badge = document.createElement('div');
    badge.className = 'pg-inbox-badge';
    badge.style.cssText = `
      display:inline-flex;align-items:center;gap:5px;
      margin-left:10px;padding:2px 9px 2px 7px;
      border-radius:999px;font-size:11px;font-weight:600;
      background:${c.bg};color:${c.color};
      border:1px solid ${c.border};
      cursor:default;vertical-align:middle;
      white-space:nowrap;line-height:1.6;
      box-shadow:0 1px 3px rgba(0,0,0,.08);
    `;

    // 점 + 레이블
    badge.innerHTML = `
      <span style="width:6px;height:6px;border-radius:50%;background:${c.dot};flex-shrink:0;display:inline-block"></span>
      <span>${esc(c.label)}</span>
    `;

    // 툴팁 (호버 시 발신자 + 위험 지표 표시)
    badge.title = [
      senderEmail || '',
      ...(riskData?.indicators || []).slice(0, 3)
    ].filter(Boolean).join('\n');

    // 배지를 발신자 이름 뒤에 우선 삽입
    const senderCell = row.querySelector('.yX') || row.querySelector('.yW') || row.querySelector('.bA4');
    const subjectCell = row.querySelector('.bog')?.parentElement;
    const target = senderCell || subjectCell || row.querySelector('.xY');

    if (target) {
      // inline-flex로 붙이기
      target.style.display = 'flex';
      target.style.alignItems = 'center';
      target.appendChild(badge);
    }
  }

  // ══════════════════════════════════════════════
  // UI: 드래그
  // ══════════════════════════════════════════════

  function makeDraggable(el, handle) {
    if (!handle) return;
    let dragging = false, startX, startY, initX, initY;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('#pg-close')) return;
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      const rect = el.getBoundingClientRect();
      initX = rect.left; initY = rect.top;
      el.style.right = 'auto';
      el.style.left  = initX + 'px';
      el.style.top   = initY + 'px';
      const onMove = (e) => {
        if (!dragging) return;
        el.style.left = (initX + e.clientX - startX) + 'px';
        el.style.top  = (initY + e.clientY - startY) + 'px';
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
