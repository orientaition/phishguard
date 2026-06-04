const API_RESPONSE_LOGS_KEY = 'apiResponseLogs';

const logList = document.getElementById('log-list');
const refreshBtn = document.getElementById('refresh-btn');
const clearBtn = document.getElementById('clear-btn');
const closeBtn = document.getElementById('close-btn');
const searchInput = document.getElementById('search-input');
const statusFilter = document.getElementById('status-filter');
const typeFilter = document.getElementById('type-filter');
const countTotal = document.getElementById('count-total');
const countOk = document.getElementById('count-ok');
const countError = document.getElementById('count-error');
const latestHttp = document.getElementById('latest-http');

const LOG_PREVIEW_LIMIT = 900;
let logs = [];

document.addEventListener('DOMContentLoaded', renderLogs);

refreshBtn?.addEventListener('click', renderLogs);
clearBtn?.addEventListener('click', () => {
  if (!confirm('저장된 API 응답 로그를 모두 비울까요?')) return;
  chrome.storage.local.set({ [API_RESPONSE_LOGS_KEY]: [] }, renderLogs);
});
closeBtn?.addEventListener('click', () => window.close());
searchInput?.addEventListener('input', renderCurrentLogs);
statusFilter?.addEventListener('change', renderCurrentLogs);
typeFilter?.addEventListener('change', renderCurrentLogs);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[API_RESPONSE_LOGS_KEY]) renderLogs();
});

function renderLogs() {
  chrome.storage.local.get([API_RESPONSE_LOGS_KEY], (data) => {
    logs = Array.isArray(data[API_RESPONSE_LOGS_KEY])
      ? data[API_RESPONSE_LOGS_KEY]
      : [];
    renderCurrentLogs();
  });
}

function renderCurrentLogs() {
  const filtered = getFilteredLogs();
  updateSummary(logs);
  logList.replaceChildren();

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = logs.length
      ? '현재 필터에 맞는 로그가 없습니다.'
      : '아직 저장된 API 응답 로그가 없습니다.';
    logList.appendChild(empty);
    return;
  }

  filtered.forEach(log => {
    logList.appendChild(createLogItem(log));
  });
}

function getFilteredLogs() {
  const query = normalize(searchInput?.value);
  const status = statusFilter?.value || 'all';
  const type = typeFilter?.value || 'all';

  return logs.filter(log => {
    if (status !== 'all' && log.status !== status) return false;
    if (type !== 'all' && log.type !== type) return false;
    if (!query) return true;
    return normalize(buildSearchText(log)).includes(query);
  });
}

function buildSearchText(log) {
  return [
    log.status,
    log.type,
    log.model,
    log.provider,
    log.httpStatus,
    log.durationMs,
    log.itemCount,
    log.requestedCount,
    log.selectedCount,
    log.cachedCount,
    log.batchNumber,
    log.batchCount,
    log.batchSize,
    log.selectedModel,
    log.retryMissing,
    log.retryAfterError,
    log.riskLevel,
    log.confidence,
    log.error,
    log.rawPreview,
    log.resultPreview
  ].filter(Boolean).join(' ');
}

function updateSummary(sourceLogs) {
  const ok = sourceLogs.filter(log => log.status === 'ok').length;
  const error = sourceLogs.filter(log => log.status !== 'ok').length;
  const latestWithHttp = sourceLogs.find(log => log.httpStatus);

  countTotal.textContent = sourceLogs.length;
  countOk.textContent = ok;
  countError.textContent = error;
  latestHttp.textContent = latestWithHttp?.httpStatus || '-';
}

function createLogItem(log) {
  const item = document.createElement('article');
  item.className = 'log-item';

  const head = document.createElement('div');
  head.className = 'log-head';

  const left = document.createElement('div');
  const main = document.createElement('div');
  main.className = 'log-main';

  const title = document.createElement('div');
  title.className = 'log-title';
  title.textContent = [
    getLogTypeLabel(log.type),
    log.provider || log.model || 'AI'
  ].filter(Boolean).join(' · ');
  main.appendChild(title);
  main.appendChild(createPill(log.status === 'ok' ? '성공' : '실패', log.status === 'ok' ? 'ok' : 'error'));

  if (log.httpStatus) {
    main.appendChild(createPill(`HTTP ${log.httpStatus}`, log.status === 'ok' ? '' : 'error'));
  }

  if (log.riskLevel) {
    main.appendChild(createPill(
      `${getRiskLabel(log.riskLevel)} ${log.confidence ?? ''}%`.trim(),
      getRiskClass(log.riskLevel)
    ));
  }

  const sub = document.createElement('div');
  sub.className = 'log-sub';
  [
    formatLogTime(log.at),
    Number.isFinite(Number(log.durationMs)) ? `${log.durationMs}ms` : '',
    Number.isFinite(Number(log.batchNumber)) && Number.isFinite(Number(log.batchCount)) ? `배치 ${log.batchNumber}/${log.batchCount}` : '',
    Number.isFinite(Number(log.batchSize)) ? `묶음 ${log.batchSize}개` : '',
    log.selectedModel ? `선택 모델 ${log.selectedModel}` : '',
    log.retryMissing ? '누락 재시도' : '',
    log.retryAfterError ? '오류 재시도' : '',
    Number.isFinite(Number(log.requestedCount)) ? `API 요청 ${log.requestedCount}개` : '',
    Number.isFinite(Number(log.itemCount)) ? `응답 ${log.itemCount}개` : '',
    Number.isFinite(Number(log.selectedCount)) ? `선택 ${log.selectedCount}개` : '',
    Number.isFinite(Number(log.cachedCount)) && Number(log.cachedCount) > 0 ? `캐시 ${log.cachedCount}개` : '',
    log.model ? `model: ${log.model}` : '',
    log.error ? `error: ${log.error}` : ''
  ].filter(Boolean).forEach(text => {
    const span = document.createElement('span');
    span.textContent = text;
    sub.appendChild(span);
  });

  left.append(main, sub);

  const actions = document.createElement('div');
  actions.className = 'log-actions';

  const fullText = buildLogDetail(log);
  const hasLongDetail = fullText.length > LOG_PREVIEW_LIMIT;

  if (hasLongDetail) {
    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'small-btn';
    expandBtn.textContent = '전체보기';
    actions.appendChild(expandBtn);

    expandBtn.addEventListener('click', () => {
      const expanded = expandBtn.dataset.expanded === 'true';
      expandBtn.dataset.expanded = expanded ? 'false' : 'true';
      expandBtn.textContent = expanded ? '전체보기' : '접기';
      detail.classList.toggle('full', !expanded);
      detail.textContent = expanded ? makeLogPreview(fullText) : fullText;
    });
  }

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'small-btn';
  copyBtn.textContent = '복사';
  copyBtn.addEventListener('click', () => copyLogText(log, copyBtn));
  actions.appendChild(copyBtn);

  head.append(left, actions);
  item.appendChild(head);

  const detail = document.createElement('pre');
  detail.className = 'detail';
  detail.textContent = hasLongDetail ? makeLogPreview(fullText) : fullText;
  item.appendChild(detail);

  return item;
}

function createPill(text, variant) {
  const pill = document.createElement('span');
  pill.className = ['pill', variant].filter(Boolean).join(' ');
  pill.textContent = text;
  return pill;
}

function buildLogDetail(log) {
  if (log.status === 'ok') {
    return log.resultPreview || '응답 미리보기가 없습니다.';
  }

  return [
    log.error ? `오류: ${log.error}` : '',
    log.rawPreview ? `응답: ${log.rawPreview}` : ''
  ].filter(Boolean).join('\n\n') || '오류 상세 정보가 없습니다.';
}

function makeLogPreview(text) {
  const value = String(text || '');
  if (value.length <= LOG_PREVIEW_LIMIT) return value;
  return `${value.slice(0, LOG_PREVIEW_LIMIT).trimEnd()}\n\n... 미리보기입니다. 전체보기로 이 로그 전체를 확인할 수 있습니다.`;
}

async function copyLogText(log, button) {
  const text = [
    `${getLogTypeLabel(log.type)} · ${log.provider || log.model || 'AI'}`,
    log.httpStatus ? `HTTP ${log.httpStatus}` : '',
    log.error ? `오류: ${log.error}` : '',
    '',
    buildLogDetail(log)
  ].filter(Boolean).join('\n');

  try {
    await navigator.clipboard.writeText(text);
    button.textContent = '복사됨';
  } catch (_) {
    button.textContent = '실패';
  }
  setTimeout(() => { button.textContent = '복사'; }, 1200);
}

function formatLogTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function getLogTypeLabel(type) {
  if (type === 'metadataBatch') return '간이검사 배치';
  if (type === 'metadata') return '간이검사';
  if (type === 'email') return '정밀검사';
  return '검사';
}

function getRiskLabel(level) {
  if (level === 'HIGH') return '높음';
  if (level === 'MEDIUM') return '보통';
  return '낮음';
}

function getRiskClass(level) {
  if (level === 'HIGH') return 'high';
  if (level === 'MEDIUM') return 'medium';
  return 'low';
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}
