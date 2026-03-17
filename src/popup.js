// popup.js

const apiInput  = document.getElementById('api-input');
const eyeBtn    = document.getElementById('eye-btn');
const eyeIcon   = document.getElementById('eye-icon');
const keyStatus = document.getElementById('key-status');
const btnSave   = document.getElementById('btn-save');
const btnClear  = document.getElementById('btn-clear');
const btnReset  = document.getElementById('btn-reset');
const badgeDot  = document.getElementById('badge-dot');
const badgeTxt  = document.getElementById('badge-txt');

// ── 초기 로드 ─────────────────────────────────────────────────────────
chrome.storage.local.get(['groqApiKey', 'stats'], (data) => {
  // 키 상태
  if (data.groqApiKey) {
    apiInput.value = data.groqApiKey;
    setKeyStatus(true);
    setActiveBadge(true);
  } else {
    setKeyStatus(false);
    setActiveBadge(false);
  }

  // 통계
  const s = data.stats || { high: 0, medium: 0, low: 0, total: 0 };
  document.getElementById('s-high').textContent   = s.high   || 0;
  document.getElementById('s-medium').textContent = s.medium || 0;
  document.getElementById('s-low').textContent    = s.low    || 0;
  document.getElementById('s-total').textContent  = s.total  || 0;
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
  if (!key) {
    keyStatus.textContent = '⚠ 키를 입력해주세요';
    keyStatus.className   = 'key-status err';
    return;
  }
  if (!key.startsWith('gsk_')) {
    keyStatus.textContent = '⚠ Groq 키는 gsk_ 로 시작합니다';
    keyStatus.className   = 'key-status err';
    return;
  }
  chrome.storage.local.set({ groqApiKey: key }, () => {
    setKeyStatus(true);
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
  chrome.storage.local.remove(['groqApiKey'], () => {
    apiInput.value = '';
    setKeyStatus(false);
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
function setKeyStatus(ok) {
  keyStatus.textContent = ok ? '✓ 키 저장됨 · 분석 활성화' : '키 미설정 · console.groq.com 에서 무료 발급';
  keyStatus.className   = 'key-status ' + (ok ? 'ok' : '');
}

function setActiveBadge(ok) {
  badgeDot.style.background = ok ? '#00d46a' : '#ffb800';
  badgeTxt.textContent      = ok ? 'Active' : 'No Key';
  badgeTxt.style.color      = ok ? '#00d46a' : '#ffb800';
  document.querySelector('.badge').style.borderColor = ok ? 'rgba(0,212,106,0.2)' : 'rgba(255,184,0,0.2)';
  document.querySelector('.badge').style.background  = ok ? 'rgba(0,212,106,0.05)' : 'rgba(255,184,0,0.05)';
}