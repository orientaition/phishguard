const entryInput = document.getElementById('entry-input');
const entryType = document.getElementById('entry-type');
const addBtn = document.getElementById('add-btn');
const refreshBtn = document.getElementById('refresh-btn');
const closeBtn = document.getElementById('close-btn');
const searchInput = document.getElementById('search-input');
const whitelistList = document.getElementById('whitelist-list');
const blacklistList = document.getElementById('blacklist-list');
const whitelistCount = document.getElementById('whitelist-count');
const blacklistCount = document.getElementById('blacklist-count');
const clearWhitelist = document.getElementById('clear-whitelist');
const clearBlacklist = document.getElementById('clear-blacklist');
const statusEl = document.getElementById('status');

let whitelist = [];
let blacklist = [];
let statusTimer = null;

document.addEventListener('DOMContentLoaded', loadLists);
refreshBtn?.addEventListener('click', loadLists);
closeBtn?.addEventListener('click', () => window.close());
addBtn?.addEventListener('click', addEntry);
searchInput?.addEventListener('input', renderLists);
entryInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addEntry();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
});

clearWhitelist?.addEventListener('click', () => clearList('whitelist'));
clearBlacklist?.addEventListener('click', () => clearList('blacklist'));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.whitelist) whitelist = normalizeList(changes.whitelist.newValue);
  if (changes.blacklist) blacklist = normalizeList(changes.blacklist.newValue);
  if (changes.whitelist || changes.blacklist) renderLists();
});

function loadLists() {
  chrome.storage.local.get(['whitelist', 'blacklist'], (data) => {
    whitelist = normalizeList(data.whitelist);
    blacklist = normalizeList(data.blacklist);
    renderLists();
  });
}

function addEntry() {
  const entry = normalizeEntry(entryInput.value);
  const type = entryType.value === 'blacklist' ? 'blacklist' : 'whitelist';

  if (!entry) {
    showStatus('도메인 또는 이메일 주소를 입력해주세요.');
    return;
  }

  if (!isValidEntry(entry)) {
    showStatus('example.com 또는 user@example.com 형식으로 입력해주세요.');
    return;
  }

  const target = type === 'whitelist' ? whitelist : blacklist;
  const other = type === 'whitelist' ? blacklist : whitelist;
  const movedFromOther = other.includes(entry);

  if (target.includes(entry) && !movedFromOther) {
    showStatus('이미 등록된 항목입니다.');
    return;
  }

  if (!target.includes(entry)) target.push(entry);

  if (type === 'whitelist') {
    whitelist = sortList(target);
    blacklist = sortList(blacklist.filter(item => item !== entry));
  } else {
    blacklist = sortList(target);
    whitelist = sortList(whitelist.filter(item => item !== entry));
  }

  saveLists(() => {
    entryInput.value = '';
    showStatus(movedFromOther ? '반대 목록에서 이동했습니다.' : '목록에 추가했습니다.');
    renderLists();
  });
}

function clearList(type) {
  const isWhite = type === 'whitelist';
  const list = isWhite ? whitelist : blacklist;
  if (list.length === 0) return;
  if (!confirm(`${isWhite ? '화이트리스트' : '블랙리스트'}를 모두 비울까요?`)) return;

  if (isWhite) whitelist = [];
  else blacklist = [];

  saveLists(() => {
    showStatus('목록을 비웠습니다.');
    renderLists();
  });
}

function renderLists() {
  whitelistCount.textContent = whitelist.length;
  blacklistCount.textContent = blacklist.length;
  renderList(whitelistList, whitelist, 'whitelist');
  renderList(blacklistList, blacklist, 'blacklist');
}

function renderList(container, list, type) {
  const query = normalizeText(searchInput.value);
  const filtered = query
    ? list.filter(entry => normalizeText(entry).includes(query))
    : list;

  container.replaceChildren();

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = list.length === 0
      ? '아직 등록된 항목이 없습니다.'
      : '검색 결과가 없습니다.';
    container.appendChild(empty);
    return;
  }

  filtered.forEach(entry => {
    container.appendChild(createDomainItem(entry, type));
  });
}

function createDomainItem(entry, type) {
  const item = document.createElement('div');
  item.className = 'domain-item';

  const main = document.createElement('div');
  main.className = 'domain-main';

  const name = document.createElement('div');
  name.className = 'domain-name';
  name.textContent = entry;

  const kind = document.createElement('div');
  kind.className = 'domain-kind';
  kind.textContent = entry.includes('@') ? '이메일 주소' : '도메인';

  main.append(name, kind);

  const actions = document.createElement('div');
  actions.className = 'item-actions';

  const moveBtn = document.createElement('button');
  moveBtn.type = 'button';
  moveBtn.className = 'small-btn';
  moveBtn.textContent = type === 'whitelist' ? '차단으로' : '허용으로';
  moveBtn.addEventListener('click', () => moveEntry(entry, type));

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'small-btn danger';
  deleteBtn.textContent = '삭제';
  deleteBtn.addEventListener('click', () => removeEntry(entry, type));

  actions.append(moveBtn, deleteBtn);
  item.append(main, actions);
  return item;
}

function moveEntry(entry, currentType) {
  if (currentType === 'whitelist') {
    whitelist = whitelist.filter(item => item !== entry);
    if (!blacklist.includes(entry)) blacklist.push(entry);
    blacklist = sortList(blacklist);
  } else {
    blacklist = blacklist.filter(item => item !== entry);
    if (!whitelist.includes(entry)) whitelist.push(entry);
    whitelist = sortList(whitelist);
  }

  saveLists(() => {
    showStatus('항목을 이동했습니다.');
    renderLists();
  });
}

function removeEntry(entry, type) {
  if (type === 'whitelist') {
    whitelist = whitelist.filter(item => item !== entry);
  } else {
    blacklist = blacklist.filter(item => item !== entry);
  }

  saveLists(() => {
    showStatus('항목을 삭제했습니다.');
    renderLists();
  });
}

function saveLists(callback) {
  chrome.storage.local.set({
    whitelist: sortList(whitelist),
    blacklist: sortList(blacklist)
  }, callback);
}

function normalizeEntry(value) {
  let entry = normalizeText(value);
  entry = entry.replace(/^mailto:/, '');

  if (!entry) return '';
  if (entry.includes('@')) return entry;

  entry = entry.replace(/^https?:\/\//, '');
  entry = entry.split(/[/?#]/)[0];
  entry = entry.replace(/:\d+$/, '');
  entry = entry.replace(/^\.+|\.+$/g, '');
  entry = entry.replace(/^www\./, '');
  return entry;
}

function normalizeList(list) {
  return sortList((list || [])
    .map(normalizeEntry)
    .filter(isValidEntry));
}

function sortList(list) {
  return [...new Set(list)].sort((a, b) => a.localeCompare(b));
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEntry(entry) {
  const emailPattern = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
  const domainPattern = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;
  return emailPattern.test(entry) || domainPattern.test(entry);
}

function showStatus(message) {
  clearTimeout(statusTimer);
  statusEl.textContent = message;
  statusEl.classList.add('show');
  statusTimer = setTimeout(() => {
    statusEl.classList.remove('show');
  }, 1800);
}
