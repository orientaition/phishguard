// ── 안전한 탭 메시지 전송 헬퍼 ─────────────────────────────────────
function sendToGmailTab(message, callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.url?.includes('mail.google.com')) return;
    chrome.tabs.sendMessage(tab.id, message, (response) => {
      if (chrome.runtime.lastError) {
        // content.js 미로드 상태 — 무시
        return;
      }
      if (callback) callback(response);
    });
  });
}

// popup.js

const modelSelect = document.getElementById('model-select');
const apiInput = document.getElementById('api-input');
const eyeBtn = document.getElementById('eye-btn');
const eyeIcon = document.getElementById('eye-icon');
const keyStatus = document.getElementById('key-status');
const apiLabel = document.getElementById('api-label');
const btnSave = document.getElementById('btn-save');
const btnClear = document.getElementById('btn-clear');
const btnTestApi = document.getElementById('btn-test-api');
const btnReset = document.getElementById('btn-reset');
const btnExportStats = document.getElementById('btn-export-stats');
const btnLogs = document.getElementById('btn-logs');
const btnDomains = document.getElementById('btn-domains');
const btnToggle = document.getElementById('btn-toggle');
const themeToggle = document.getElementById('theme-toggle');
const badgeDot = document.getElementById('badge-dot');
const badgeTxt = document.getElementById('badge-txt');

let apiKeys = {};

// ── 테마 로드 & 토글 ────────────────────────────────────────────────
chrome.storage.local.get(['theme'], (data) => {
  const isDark = data.theme === 'dark';
  document.body.classList.toggle('dark', isDark);
  themeToggle.checked = isDark;
});

if (themeToggle) {
  themeToggle.addEventListener('change', () => {
    const isDark = themeToggle.checked;

    document.body.classList.toggle('dark', isDark);

    const theme = isDark ? 'dark' : 'light';

    chrome.storage.local.set({ theme });

    sendToGmailTab({ type: 'SET_THEME', theme });
  });
}

// ── 분석 결과 보기 버튼 ──────────────────────────────────────────────
if (btnToggle) {
  btnToggle.addEventListener('click', () => {
    sendToGmailTab({ type: 'TOGGLE_PANEL' }, () => window.close());
    // Gmail 탭이 없으면 그냥 닫기
    setTimeout(() => window.close(), 300);
  });
}

// ── 초기 로드 ─────────────────────────────────────────────────────────
chrome.storage.local.get(['apiKeys', 'selectedModel', 'groqApiKey', 'stats'], (data) => {
  apiKeys = data.apiKeys || {};

  if (!apiKeys.groq && data.groqApiKey) apiKeys.groq = data.groqApiKey;

  if (data.selectedModel) {
    modelSelect.value = data.selectedModel;
  }

  loadKeyForSelectedModel();

  // 통계
  const s = data.stats || { high: 0, medium: 0, low: 0, total: 0 };
  document.getElementById('s-high').textContent = s.high || 0;
  document.getElementById('s-medium').textContent = s.medium || 0;
  document.getElementById('s-low').textContent = s.low || 0;
  document.getElementById('s-total').textContent = s.total || 0;
});

// ── 모델 변경 ──────────────────────────────────────────────────────────
function loadKeyForSelectedModel() {
  const model = modelSelect.value;
  const isLocalModel = model === 'ollama';
  const key = apiKeys[model];

  if (apiLabel) apiLabel.textContent = isLocalModel ? '로컬 모델' : 'API 키';

  if (isLocalModel) {
    apiInput.value = 'http://localhost:11434 · qwen3.5:9b';
    apiInput.disabled = true;
    if (eyeBtn) eyeBtn.style.display = 'none';
    setKeyStatus(true, model);
    setActiveBadge(true);
  } else if (key) {
    apiInput.disabled = false;
    if (eyeBtn) eyeBtn.style.display = '';
    apiInput.value = key;
    setKeyStatus(true, model);
    setActiveBadge(true);
  } else {
    apiInput.disabled = false;
    if (eyeBtn) eyeBtn.style.display = '';
    apiInput.value = '';
    setKeyStatus(false, model);
    setActiveBadge(false);
  }
}

if (modelSelect) {
  modelSelect.addEventListener('change', () => {

    const model = modelSelect.value;

    chrome.storage.local.set({
      selectedModel: model
    });

    loadKeyForSelectedModel();
  });
}

// ── 탭 전환 ───────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  });
});

// ── Eye 토글 ──────────────────────────────────────────────────────────
if (eyeBtn) {
  eyeBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();

    const isPassword =
      apiInput.type === 'password';

    apiInput.type =
      isPassword ? 'text' : 'password';

    eyeIcon.innerHTML = isPassword
      ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
         <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
         <line x1="1" y1="1" x2="23" y2="23"/>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
         <circle cx="12" cy="12" r="3"/>`;
  });
}

// ── 저장 ─────────────────────────────────────────────────────────────
if (btnSave) {
  btnSave.addEventListener('click', () => {

    const key =
      apiInput.value.trim();

    const model =
      modelSelect.value;

    if (model === 'ollama') {
      chrome.storage.local.set(
        { selectedModel: model },
        () => {

          setKeyStatus(true, model);
          setActiveBadge(true);

          btnSave.textContent =
            '✓ 저장됨';

          btnSave.classList.add('saved');
          setTimeout(() => {

            btnSave.textContent =
              '저장';

            btnSave.classList.remove('saved');

          }, 2000);
        }
      );
      return;
    }

    if (!key) {
      keyStatus.textContent =
        '⚠ 키를 입력해주세요';

      keyStatus.className =
        'key-status err';

      return;
    }

    apiKeys[model] = key;

    chrome.storage.local.set(
      {
        apiKeys,
        selectedModel: model
      },
      () => {

        setKeyStatus(true, model);
        setActiveBadge(true);

        btnSave.textContent =
          '✓ 저장됨';

        btnSave.classList.add('saved');
        setTimeout(() => {

          btnSave.textContent =
            '저장';

          btnSave.classList.remove('saved');

        }, 2000);
      }
    );
  });
}

// ── Enter 키로 저장 ───────────────────────────────────────────────────
if (apiInput) {
  apiInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !apiInput.disabled) {
      btnSave.click();
    }
  });
}

// ── 초기화 ────────────────────────────────────────────────────────────
if (btnClear) {
  btnClear.addEventListener('click', () => {
    const model =
      modelSelect.value;

    if (model === 'ollama') {
      chrome.storage.local.set(
        { selectedModel: model },
        () => {

          loadKeyForSelectedModel();
        }
      );
      return;
    }

    delete apiKeys[model];

    chrome.storage.local.set(
      { apiKeys },
      () => {

        apiInput.value = '';

        setKeyStatus(false, model);

        setActiveBadge(false);
      }
    );
  });
}

// ── 통계 초기화 ───────────────────────────────────────────────────────
if (btnReset) {
  btnReset.addEventListener('click', () => {
    const zero = {
      high: 0,
      medium: 0,
      low: 0,
      total: 0
    };

    chrome.storage.local.set(
      { stats: zero },
      () => {

        document.getElementById('s-high').textContent = 0;
        document.getElementById('s-medium').textContent = 0;
        document.getElementById('s-low').textContent = 0;
        document.getElementById('s-total').textContent = 0;
      }
    );
  });
}

// ── 통계 내보내기 ────────────────────────────────────────────────────
if (btnExportStats) {
  btnExportStats.addEventListener('click', () => {
    chrome.storage.local.get(['stats'], (data) => {
      const s = data.stats || { high: 0, medium: 0, low: 0, total: 0 };
      const exported = {
        exported_at: new Date().toISOString(),
        stats: {
          total  : s.total  || 0,
          high   : s.high   || 0,
          medium : s.medium || 0,
          low    : s.low    || 0
        }
      };
      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `phishguard-stats-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  });
}

// ── API 연결 테스트 ─────────────────────────────────────────────────
if (btnTestApi) {
  btnTestApi.addEventListener('click', () => {
    const model = modelSelect.value;
    const key = model === 'ollama' ? '' : apiInput.value.trim();

    btnTestApi.disabled = true;
    btnTestApi.textContent = '테스트 중...';
    keyStatus.textContent = 'API 연결을 테스트하는 중입니다...';
    keyStatus.className = 'key-status';

    chrome.runtime.sendMessage(
      {
        type: 'TEST_API',
        payload: {
          model,
          apiKey: key
        }
      },
      (response) => {
        btnTestApi.disabled = false;
        btnTestApi.textContent = 'API 테스트';

        if (chrome.runtime.lastError) {
          keyStatus.textContent = `테스트 실패 · ${chrome.runtime.lastError.message}`;
          keyStatus.className = 'key-status err';
          return;
        }

        if (response?.ok) {
          keyStatus.textContent = `✓ 테스트 성공 · ${response.provider || model}`;
          keyStatus.className = 'key-status ok';
          setActiveBadge(true);
        } else {
          keyStatus.textContent = `테스트 실패 · ${response?.error || '응답 없음'}`;
          keyStatus.className = 'key-status err';
          if (model !== 'ollama') setActiveBadge(false);
        }
      }
    );
  });
}

// ── API 응답 로그 ───────────────────────────────────────────────────
if (btnLogs) {
  btnLogs.addEventListener('click', () => {
    openApiLogWindow();
  });
}

if (btnDomains) {
  btnDomains.addEventListener('click', () => {
    openDomainListWindow();
  });
}

function openApiLogWindow() {
  const url = chrome.runtime.getURL('logs.html');
  const options = {
    url,
    type: 'popup',
    width: 940,
    height: 720,
    focused: true
  };

  if (chrome.windows?.create) {
    chrome.windows.create(options, () => window.close());
    return;
  }

  window.open(url, 'phishguard-api-logs', 'width=940,height=720');
  window.close();
}

function openDomainListWindow() {
  const url = chrome.runtime.getURL('domains.html');
  const options = {
    url,
    type: 'popup',
    width: 860,
    height: 640,
    focused: true
  };

  if (chrome.windows?.create) {
    chrome.windows.create(options, () => window.close());
    return;
  }

  window.open(url, 'phishguard-domains', 'width=860,height=640');
  window.close();
}

// ── 유틸 ─────────────────────────────────────────────────────────────
function setKeyStatus(ok, model) {
  let issueUrl = '발급 사이트 확인 요망';
  if (model === 'groq') issueUrl = 'console.groq.com 에서 발급 가능';
  else if (model === 'gemini') issueUrl = 'aistudio.google.com 에서 발급 가능';
  else if (model === 'gpt') issueUrl = 'platform.openai.com 에서 발급 가능';
  else if (model === 'ollama') issueUrl = '로컬 Ollama가 필요합니다';

  keyStatus.textContent = ok
    ? (model === 'ollama' ? '✓ 로컬 Ollama 연결 준비됨' : '✓ 키 저장됨 · 분석 활성화')
    : `키 미설정 · ${issueUrl}`;
  keyStatus.className = 'key-status ' + (ok ? 'ok' : '');
}

function setActiveBadge(ok) {
  const badge = document.querySelector('.badge');
  if (ok) {
    badgeDot.style.background = ''; badgeTxt.style.color = '';
    badge.style.borderColor = ''; badge.style.background = '';
    badgeTxt.textContent = 'Active';
  } else {
    badgeDot.style.background = 'var(--yellow)';
    badgeTxt.textContent = 'No Key';
    badgeTxt.style.color = 'var(--yellow)';
    badge.style.borderColor = 'var(--yellow-border)';
    badge.style.background = 'var(--yellow-bg)';
  }
}

// ── 개발자 모드 (v1.0.0 5번 클릭으로 토글) ────────────────────────
let devClickCount = 0;
let devClickTimer = null;
const devToggle   = document.getElementById('dev-mode-toggle');
const devSection  = document.getElementById('dev-section');
const compareCount = document.getElementById('compare-count');

// 비교 결과 건수 표시
function updateCompareCount() {
  chrome.storage.local.get(['compareResults'], (data) => {
    const results = data.compareResults || [];
    if (compareCount) compareCount.textContent = `저장된 비교 결과: ${results.length}건`;
  });
}

// v1.0.0 텍스트 5번 클릭 → 개발자 모드 토글
devToggle?.addEventListener('click', () => {
  devClickCount++;
  clearTimeout(devClickTimer);
  devClickTimer = setTimeout(() => { devClickCount = 0; }, 2000);

  if (devClickCount >= 5) {
    devClickCount = 0;
    const isVisible = devSection?.style.display !== 'none';
    const nextVisible = !isVisible;
    if (devSection) devSection.style.display = nextVisible ? 'block' : 'none';
    // devMode storage에 저장 → content.js에서 비교 버튼 표시 여부 결정
    chrome.storage.local.set({ devMode: nextVisible });
    if (nextVisible) updateCompareCount();
  }
});

// 모델 비교 결과 JSON 내보내기
document.getElementById('btn-export-compare')?.addEventListener('click', () => {
  chrome.storage.local.get(['compareResults'], (data) => {
    const results = data.compareResults || [];
    if (results.length === 0) {
      alert('저장된 비교 결과가 없습니다.\n메일 분석 후 ⚖️ 모델 비교 버튼을 사용해주세요.');
      return;
    }
    const exported = {
      exported_at   : new Date().toISOString(),
      total         : results.length,
      compareResults: results
    };
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `phishguard-compare-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
});