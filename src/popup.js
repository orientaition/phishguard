// popup.js

const modelSelect = document.getElementById('model-select');
const apiInput    = document.getElementById('api-input');
const eyeBtn      = document.getElementById('eye-btn');
const eyeIcon     = document.getElementById('eye-icon');
const keyStatus   = document.getElementById('key-status');
const btnSave     = document.getElementById('btn-save');
const btnClear    = document.getElementById('btn-clear');
const btnReset    = document.getElementById('btn-reset');
const badgeDot    = document.getElementById('badge-dot');
const badgeTxt    = document.getElementById('badge-txt');

let apiKeys = {};

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
  document.getElementById('s-high').textContent   = s.high   || 0;
  document.getElementById('s-medium').textContent = s.medium || 0;
  document.getElementById('s-low').textContent    = s.low    || 0;
  document.getElementById('s-total').textContent  = s.total  || 0;
});

// ── 모델 변경 ──────────────────────────────────────────────────────────
function loadKeyForSelectedModel() {
  const model = modelSelect.value;
  const key = apiKeys[model];
  if (key) {
    apiInput.value = key;
    setKeyStatus(true, model);
    setActiveBadge(true);
  } else {
    apiInput.value = '';
    setKeyStatus(false, model);
    setActiveBadge(false);
  }
}

modelSelect.addEventListener('change', () => {
  const model = modelSelect.value;
  chrome.storage.local.set({ selectedModel: model });
  loadKeyForSelectedModel();
});

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
eyeBtn.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const isPassword = apiInput.type === 'password';
  apiInput.type = isPassword ? 'text' : 'password';
  eyeIcon.innerHTML = isPassword
    ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
       <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
       <line x1="1" y1="1" x2="23" y2="23"/>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
});

// ── 저장 ─────────────────────────────────────────────────────────────
btnSave.addEventListener('click', () => {
  const key = apiInput.value.trim();
  const model = modelSelect.value;
  
  if (!key) {
    keyStatus.textContent = '⚠ 키를 입력해주세요';
    keyStatus.className   = 'key-status err';
    return;
  }
  
  apiKeys[model] = key;
  chrome.storage.local.set({ apiKeys, selectedModel: model }, () => {
    setKeyStatus(true, model);
    setActiveBadge(true);
    btnSave.textContent = '✓  저장됨';
    btnSave.classList.add('saved');
    setTimeout(() => {
      btnSave.textContent = '[ 저장 ]';
      btnSave.classList.remove('saved');
    }, 2000);
  });
});

// ── Enter 키로 저장 ───────────────────────────────────────────────────
apiInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnSave.click();
});

// ── 초기화 ────────────────────────────────────────────────────────────
btnClear.addEventListener('click', () => {
  const model = modelSelect.value;
  delete apiKeys[model];
  chrome.storage.local.set({ apiKeys }, () => {
    apiInput.value = '';
    setKeyStatus(false, model);
    setActiveBadge(false);
  });
});

// ── 통계 초기화 ───────────────────────────────────────────────────────
btnReset.addEventListener('click', () => {
  const zero = { high: 0, medium: 0, low: 0, total: 0 };
  chrome.storage.local.set({ stats: zero }, () => {
    document.getElementById('s-high').textContent   = 0;
    document.getElementById('s-medium').textContent = 0;
    document.getElementById('s-low').textContent    = 0;
    document.getElementById('s-total').textContent  = 0;
  });
});

// ── 유틸 ─────────────────────────────────────────────────────────────
function setKeyStatus(ok, model) {
  let issueUrl = '발급 사이트 확인 요망';
  if (model === 'groq') issueUrl = 'console.groq.com 에서 발급 가능';
  else if (model === 'gemini') issueUrl = 'aistudio.google.com 에서 발급 가능';
  else if (model === 'gpt') issueUrl = 'platform.openai.com 에서 발급 가능';

  keyStatus.textContent = ok ? '✓ 키 저장됨 · 분석 활성화' : `키 미설정 · ${issueUrl}`;
  keyStatus.className   = 'key-status ' + (ok ? 'ok' : '');
}

function setActiveBadge(ok) {
  badgeDot.style.background = ok ? '#00d46a' : '#ffb800';
  badgeTxt.textContent      = ok ? 'Active' : 'No Key';
  badgeTxt.style.color      = ok ? '#00d46a' : '#ffb800';
  document.querySelector('.badge').style.borderColor = ok ? 'rgba(0,212,106,0.2)' : 'rgba(255,184,0,0.2)';
  document.querySelector('.badge').style.background  = ok ? 'rgba(0,212,106,0.05)' : 'rgba(255,184,0,0.05)';
}