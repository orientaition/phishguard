// background.js - Service Worker

const API_RESPONSE_LOGS_KEY = 'apiResponseLogs';
const API_RESPONSE_LOG_LIMIT = 80;
const GPT_MODEL = 'gpt-5.5';
const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const OLLAMA_MODEL = 'qwen3.5:9b';
const OLLAMA_CHAT_URL = 'http://localhost:11434/api/chat';
let apiLogWriteQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_EMAIL') {
    chrome.storage.local.get(['apiKeys', 'selectedModel', 'groqApiKey', 'whitelist', 'blacklist'], (stored) => {
      handleAnalysis(message.payload, stored)
        .then(result => sendResponse({ ok: true, result }))
        .catch(err  => sendResponse({ ok: false, error: err.message }));
    });
    return true;
  }

  if (message.type === 'ANALYZE_METADATA') {
    chrome.storage.local.get(['apiKeys', 'selectedModel', 'groqApiKey', 'whitelist', 'blacklist'], (stored) => {
      handleMetadataAnalysis(message.payload, stored)
        .then(result => sendResponse({ ok: true, result }))
        .catch(err  => sendResponse({ ok: false, error: err.message }));
    });
    return true;
  }

  if (message.type === 'ANALYZE_METADATA_BATCH') {
    chrome.storage.local.get(['apiKeys', 'selectedModel', 'groqApiKey', 'whitelist', 'blacklist'], (stored) => {
      handleMetadataBatchAnalysis(message.payload, stored)
        .then(result => sendResponse({ ok: true, result }))
        .catch(err  => sendResponse({ ok: false, error: err.message }));
    });
    return true;
  }

  if (message.type === 'TEST_API') {
    testModelConnection(message.payload)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'UPDATE_STATS') {
    chrome.storage.local.get(['stats'], data => {
      const stats = data.stats || { high: 0, medium: 0, low: 0, total: 0 };
      const level = message.level?.toLowerCase();
      if (level && stats[level] !== undefined) stats[level]++;
      stats.total = (stats.total || 0) + 1;
      chrome.storage.local.set({ stats });
      sendResponse({ ok: true });
    });
    return true;
  }
});

async function handleAnalysis({ body, metadata }, stored) {
  const sys = buildSystem();
  const usr = buildPrompt(metadata, body);
  return requestModelJson(sys, usr, stored, 'email');
}

async function handleMetadataAnalysis({ metadata, preRisk }, stored) {
  const sys = buildMetadataSystem();
  const usr = buildMetadataPrompt(metadata, preRisk);
  return requestModelJson(sys, usr, stored, 'metadata');
}

async function handleMetadataBatchAnalysis({ items, context }, stored) {
  const safeItems = Array.isArray(items) ? items.slice(0, 80) : [];
  if (safeItems.length === 0) {
    return { results: [] };
  }

  const sys = buildMetadataBatchSystem();
  const usr = buildMetadataBatchPrompt(safeItems);
  return requestModelJson(sys, usr, stored, 'metadataBatch', {
    ...context,
    requestedCount: safeItems.length
  });
}

async function requestModelJson(sys, usr, stored, expectedType, logContext = {}) {
  const startedAt = Date.now();
  const model   = stored.selectedModel || 'groq';
  const apiKeys = stored.apiKeys || {};
  let apiKey    = apiKeys[model];
  let provider  = model;
  let httpStatus = null;
  let raw = '';

  if (!apiKey && model === 'groq') apiKey = stored.groqApiKey;

  if (model !== 'ollama' && (!apiKey || apiKey.trim() === '')) {
    const error = new Error('API 키가 설정되지 않았습니다. 팝업에서 설정 메뉴를 확인해주세요.');
    await appendApiResponseLog({
      status: 'error',
      type: expectedType,
      model,
      provider,
      durationMs: Date.now() - startedAt,
      ...logContext,
      error: error.message
    });
    throw error;
  }

  try {
    if (model === 'groq') {
      provider = 'Groq';
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body   : JSON.stringify({
          model          : 'llama-3.3-70b-versatile',
          messages       : [{ role: 'system', content: sys }, { role: 'user', content: usr }],
          temperature    : 0.1,
          response_format: { type: 'json_object' }
        })
      });
      httpStatus = response.status;
      if (!response.ok) {
        raw = await safeReadResponseText(response);
        throw new Error(`Groq API 오류: ${response.status}`);
      }
      const data = await response.json();
      raw = data?.choices?.[0]?.message?.content || '';

    } else if (model === 'gpt') {
      provider = 'GPT';
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body   : JSON.stringify({
          model          : GPT_MODEL,
          messages       : [{ role: 'system', content: sys }, { role: 'user', content: usr }],
          temperature    : 0.1,
          response_format: { type: 'json_object' }
        })
      });
      httpStatus = response.status;
      if (!response.ok) {
        raw = await safeReadResponseText(response);
        throw new Error(`GPT API 오류: ${response.status}`);
      }
      const data = await response.json();
      raw = data?.choices?.[0]?.message?.content || '';

    } else if (model === 'gemini') {
      provider = 'Gemini 3.1 Flash Lite';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          systemInstruction: { parts: [{ text: sys }] },
          contents         : [{ role: 'user', parts: [{ text: usr }] }],
          generationConfig : { temperature: 0.1, responseMimeType: 'application/json' },
          tools            : [{ googleSearch: {} }]
        })
      });
      httpStatus = response.status;
      if (!response.ok) {
        raw = await safeReadResponseText(response);
        throw new Error(`Gemini API 오류: ${response.status}`);
      }
      const data = await response.json();
      raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    } else if (model === 'ollama') {
      provider = `Ollama Local (${OLLAMA_MODEL})`;
      const response = await fetch(OLLAMA_CHAT_URL, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          model   : OLLAMA_MODEL,
          stream  : false,
          think   : false,
          format  : 'json',
          messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
          options : { temperature: 0.1 }
        })
      });
      httpStatus = response.status;
      if (!response.ok) {
        raw = await safeReadResponseText(response);
        if (response.status === 403) {
          throw new Error('Ollama가 Chrome 확장 프로그램 요청을 차단했습니다. OLLAMA_ORIGINS=* 설정 후 Ollama를 재시작해주세요.');
        }
        throw new Error(`Ollama API 오류: ${response.status}`);
      }
      const data = await response.json();
      raw = data?.message?.content || data?.response || '';

    } else {
      throw new Error(`지원하지 않는 AI 모델입니다: ${model}`);
    }

    const result = normalizeModelResult(parseModelJson(raw), expectedType);
    await appendApiResponseLog({
      status: 'ok',
      type: expectedType,
      model,
      provider,
      httpStatus,
      durationMs: Date.now() - startedAt,
      riskLevel: result.riskLevel,
      confidence: result.confidence,
      itemCount: Array.isArray(result.results) ? result.results.length : undefined,
      ...logContext,
      resultPreview: makePreview(sanitizeResultForLog(result), 24000)
    });
    return result;
  } catch (err) {
    await appendApiResponseLog({
      status: 'error',
      type: expectedType,
      model,
      provider,
      httpStatus,
      durationMs: Date.now() - startedAt,
      ...logContext,
      error: err?.message || String(err),
      rawPreview: makePreview(raw, 8000)
    });
    throw err;
  }
}

async function safeReadResponseText(response) {
  try {
    return await response.text();
  } catch (_) {
    return '';
  }
}

async function testModelConnection(payload = {}) {
  const model = payload.model || 'groq';
  const apiKey = String(payload.apiKey || '').trim();

  if (model !== 'ollama' && !apiKey) {
    throw new Error('API 키를 입력한 뒤 테스트해주세요.');
  }

  if (model === 'ollama') {
    const response = await fetch(OLLAMA_CHAT_URL, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        model   : OLLAMA_MODEL,
        stream  : false,
        think   : false,
        format  : 'json',
        messages: [
          { role: 'system', content: 'Return only JSON.' },
          { role: 'user', content: 'Respond with {"ok":true}.' }
        ],
        options : { temperature: 0 }
      })
    });

    if (!response.ok) {
      const raw = await safeReadResponseText(response);
      if (response.status === 403) {
        throw new Error('Ollama가 Chrome 확장 프로그램 요청을 차단했습니다. OLLAMA_ORIGINS=* 설정 후 Ollama를 재시작해주세요.');
      }
      throw new Error(`Ollama API 오류: ${response.status}${raw ? ` · ${raw.slice(0, 120)}` : ''}`);
    }

    const data = await response.json();
    const raw = data?.message?.content || data?.response || '';
    parseModelJson(raw);
    return { provider: `Ollama Local (${OLLAMA_MODEL})` };
  }

  if (model === 'groq') {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body   : JSON.stringify({
        model          : 'llama-3.3-70b-versatile',
        messages       : [{ role: 'user', content: 'Return only JSON: {"ok":true}' }],
        temperature    : 0,
        response_format: { type: 'json_object' }
      })
    });
    if (!response.ok) throw new Error(`Groq API 오류: ${response.status}`);
    return { provider: 'Groq' };
  }

  if (model === 'gpt') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body   : JSON.stringify({
        model          : GPT_MODEL,
        messages       : [{ role: 'user', content: 'Return only JSON: {"ok":true}' }],
        temperature    : 0,
        response_format: { type: 'json_object' }
      })
    });
    if (!response.ok) throw new Error(`GPT API 오류: ${response.status}`);
    return { provider: 'GPT' };
  }

  if (model === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        contents        : [{ role: 'user', parts: [{ text: 'Return only JSON: {"ok":true}' }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' }
      })
    });
    if (!response.ok) throw new Error(`Gemini API 오류: ${response.status}`);
    return { provider: 'Gemini 3.1 Flash Lite' };
  }

  throw new Error(`지원하지 않는 AI 모델입니다: ${model}`);
}

function appendApiResponseLog(entry) {
  apiLogWriteQueue = apiLogWriteQueue
    .then(() => writeApiResponseLog(entry))
    .catch(() => {});
  return apiLogWriteQueue;
}

function writeApiResponseLog(entry) {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get([API_RESPONSE_LOGS_KEY], data => {
        const logs = Array.isArray(data[API_RESPONSE_LOGS_KEY])
          ? data[API_RESPONSE_LOGS_KEY]
          : [];
        const next = [{
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          at: Date.now(),
          ...entry
        }, ...logs].slice(0, API_RESPONSE_LOG_LIMIT);

        chrome.storage.local.set({ [API_RESPONSE_LOGS_KEY]: next }, resolve);
      });
    } catch (_) {
      resolve();
    }
  });
}

function sanitizeResultForLog(result) {
  return {
    riskLevel: result?.riskLevel,
    confidence: result?.confidence,
    needsAdditionalCheck: result?.needsAdditionalCheck,
    reason: result?.reason,
    summary: result?.summary,
    signals: result?.signals,
    indicators: result?.indicators,
    results: Array.isArray(result?.results)
      ? result.results.slice(0, 80).map(item => ({
          index: item?.index,
          riskLevel: item?.riskLevel,
          confidence: item?.confidence,
          reason: item?.reason,
          signals: item?.signals
        }))
      : undefined,
    checklist: Array.isArray(result?.checklist)
      ? result.checklist.map(item => ({
          text: item?.text,
          flagged: item?.flagged,
          reason: item?.reason
        }))
      : undefined
  };
}

function makePreview(value, limit = 1500) {
  const text = typeof value === 'string'
    ? value
    : JSON.stringify(value, null, 2);
  return String(text || '').slice(0, limit);
}

function parseModelJson(raw) {
  const cleaned = String(raw || '')
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```/g, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('AI 응답 파싱 실패');
  }
}

function normalizeModelResult(result, expectedType) {
  if (expectedType === 'metadataBatch') {
    return normalizeMetadataBatchResult(result);
  }

  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('AI 응답 형식 오류');
  }

  const normalized = { ...result };
  normalized.riskLevel = normalizeModelRiskLevel(normalized.riskLevel);
  normalized.confidence = clampConfidence(
    normalized.confidence,
    defaultConfidenceForRisk(normalized.riskLevel)
  );

  if (expectedType === 'metadata' || Object.prototype.hasOwnProperty.call(normalized, 'needsAdditionalCheck')) {
    normalized.needsAdditionalCheck = Boolean(normalized.needsAdditionalCheck);
    normalized.reason = cleanText(normalized.reason) || '제목과 발신자 기준으로 보안 판단을 완료했습니다.';
    normalized.signals = normalizeNumberedList(normalized.signals)
      .filter(signal => !isTemplateEcho(signal));

    if (normalized.riskLevel !== 'LOW' && normalized.signals.length === 0) {
      normalized.signals = [ensureNumberPrefix(normalized.reason, 0)];
    }
    return normalized;
  }

  normalized.summary = cleanText(normalized.summary) ||
    '이 이메일의 보안 판단을 완료했습니다. 표시된 체크리스트를 기준으로 발신자와 요청 내용을 확인해주세요.';
  normalized.checklist = normalizeChecklist(normalized.checklist);
  normalized.indicators = normalizeNumberedList(normalized.indicators)
    .filter(indicator => !isTemplateEcho(indicator));
  return normalized;
}

function normalizeMetadataBatchResult(result) {
  const list = Array.isArray(result)
    ? result
    : Array.isArray(result?.results)
    ? result.results
    : Array.isArray(result?.items)
    ? result.items
    : Array.isArray(result?.analyses)
    ? result.analyses
    : [];

  if (list.length === 0) {
    throw new Error('AI 배치 응답 형식 오류');
  }

  return {
    results: list.map((item, index) => {
      const normalized = { ...(item || {}) };
      normalized.index = Number(normalized.index ?? normalized.id ?? index + 1);
      normalized.needsAdditionalCheck = Boolean(normalized.needsAdditionalCheck);
      normalized.riskLevel = normalizeModelRiskLevel(normalized.riskLevel);
      normalized.confidence = clampConfidence(
        normalized.confidence,
        defaultConfidenceForRisk(normalized.riskLevel)
      );
      normalized.reason = cleanText(normalized.reason) || '제목과 발신자 기준으로 보안 판단을 완료했습니다.';
      normalized.signals = normalizeNumberedList(normalized.signals)
        .filter(signal => !isTemplateEcho(signal));

      if (normalized.riskLevel !== 'LOW' && normalized.signals.length === 0) {
        normalized.signals = [ensureNumberPrefix(normalized.reason, 0)];
      }

      return normalized;
    })
  };
}

function normalizeModelRiskLevel(level) {
  const value = String(level || '').trim().toUpperCase();
  if (value === 'HIGH' || value === 'CRITICAL' || value === 'DANGEROUS') return 'HIGH';
  if (value === 'MEDIUM') return 'MEDIUM';
  return 'LOW';
}

function clampConfidence(value) {
  const number = Number(value);
  const fallback = Number(arguments.length > 1 ? arguments[1] : 70);
  if (!Number.isFinite(number) || number <= 0) return Number.isFinite(fallback) ? fallback : 70;
  if (number > 0 && number <= 1) return Math.max(0, Math.min(100, Math.round(number * 100)));
  return Math.max(0, Math.min(100, Math.round(number)));
}

function defaultConfidenceForRisk(level) {
  if (level === 'HIGH') return 82;
  if (level === 'MEDIUM') return 74;
  return 72;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map(cleanText).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\n+|(?=\d+\s*[\.)]\s+)/)
      .map(cleanText)
      .filter(Boolean);
  }
  return [];
}

function ensureNumberPrefix(text, index) {
  const cleaned = cleanText(text).replace(/^\d+\s*[\.)]\s*/, '');
  return `${index + 1}. ${cleaned || '확인된 내용 없음'}`;
}

function normalizeNumberedList(value) {
  return normalizeStringArray(value)
    .slice(0, 6)
    .map((item, index) => ensureNumberPrefix(item, index));
}

function isTemplateEcho(text) {
  return /관찰된 .*신호|확인된 .*요구|확인된 신호|작성|내용 없음|탐지된 위협 지표/i.test(String(text || ''));
}

function normalizeChecklist(checklist) {
  const templates = [
    '발신자/도메인 검증: 발신자명과 실제 이메일 주소가 자연스럽게 일치하는지 확인하세요.',
    '링크/도메인 검증: 본문 링크나 표시된 도메인이 공식 주소와 일치하는지 확인하세요.',
    '개인정보/인증 요구: 비밀번호, 인증번호, 결제 정보 입력 요구가 있는지 확인하세요.',
    '긴급성/압박 표현: 계정 정지, 즉시 조치, 제한 시간 같은 압박 표현이 있는지 확인하세요.',
    '첨부파일/외부 파일: 첨부파일이나 외부 문서 열람 요구가 안전한지 확인하세요.',
    '종합 조치: 의심 요소가 있으면 링크 클릭과 첨부파일 실행을 보류하세요.'
  ];
  const input = Array.isArray(checklist) ? checklist : [];

  return templates.map((template, index) => {
    const item = input[index] || {};
    const text = cleanText(item.text) || template;
    const flagged = Boolean(item.flagged);
    const reason = cleanText(item.reason) || (
      flagged
        ? '이 항목에서 의심 요소가 확인되었습니다.'
        : '이 항목에서 뚜렷한 위험 신호는 확인되지 않았습니다.'
    );

    return {
      text: ensureNumberPrefix(text, index),
      flagged,
      reason
    };
  });
}

function buildMetadataSystem() {
  return `당신은 이메일 스피어피싱 여부를 판단하는 사이버보안 분석가입니다.

개인정보 보호를 위해 이메일 본문은 제공되지 않습니다.
제공되는 정보는 발신자명, 발신자 이메일, 제목, 날짜, 로컬 사전 검사 결과뿐입니다.

응답 원칙:
- 사용자가 보는 모든 문장은 한국어 존댓말로 작성하세요.
- 본문 내용을 추측하거나 요약하지 마세요.
- 공식 메일 여부를 추측으로 단정하지 마세요.
- 제목과 발신자만으로 근거가 부족하면 LOW 또는 MEDIUM으로 보수적으로 판단하세요.

반드시 JSON 객체 하나만 응답하세요. 다른 설명 문장은 절대 포함하지 마세요.

출력 템플릿:
{
  "needsAdditionalCheck": true,
  "riskLevel": "LOW",
  "confidence": 75,
  "reason": "제공된 제목, 발신자 이메일, 로컬 신호 중 실제 확인한 값을 근거로 1~2문장 작성",
  "signals": []
}

필드 규칙:
- riskLevel은 LOW, MEDIUM, HIGH 중 하나만 사용하세요.
- confidence는 판단 신뢰도이며 50~95 사이 정수로 작성하세요. 0은 사용하지 마세요.
- signals는 의심 신호가 있을 때만 작성하세요. 뚜렷한 신호가 없으면 빈 배열 []로 두세요.
- signals를 작성할 때는 반드시 "1. 항목명: 내용" 형식의 번호형 문장으로 작성하세요.
- signals와 reason에는 반드시 실제 제목 문구, 실제 발신자 이메일/도메인, 또는 실제 로컬 신호 중 하나를 언급하세요.
- "관찰된 발신자/도메인 신호", "제목에서 확인된 ...", "로컬 검사 결과에서 확인된 신호" 같은 템플릿 문구를 그대로 출력하지 마세요.
- needsAdditionalCheck는 본문 포함 정밀 분석을 사용자에게 권장해야 할 때만 true입니다.
- 명확한 사칭, 긴급한 계정/결제/보안 조치 요구, 의심 도메인, 로컬 위험 신호가 있으면 MEDIUM 이상을 고려하세요.
- 명확한 피싱 징후가 있을 때만 HIGH로 판단하세요.`;
}

function buildMetadataPrompt(metadata, preRisk) {
  return `[검사 대상 메일]
1. 제목: ${metadata?.subject || '(없음)'}
2. 발신자명: ${metadata?.sender || '(없음)'}
3. 발신자 이메일: ${metadata?.senderEmail || '(없음)'}
4. 날짜: ${metadata?.date || '(없음)'}

[로컬 사전 검사]
1. 위험도: ${preRisk?.riskLevel || 'UNKNOWN'}
2. 점수: ${preRisk?.score ?? 0}
3. 신호: ${(preRisk?.indicators || []).join(', ') || '(없음)'}

위 정보를 빠짐없이 확인한 뒤, 지정된 JSON 템플릿으로만 응답하세요.`;
}

function buildMetadataBatchSystem() {
  return `당신은 이메일 스피어피싱 여부를 판단하는 사이버보안 분석가입니다.

개인정보 보호를 위해 이메일 본문과 미리보기는 제공되지 않습니다.
제공되는 정보는 각 메일의 제목, 발신자명, 발신자 이메일, 날짜, 로컬 사전 검사 결과뿐입니다.

중요:
- 입력된 모든 메일을 빠짐없이 각각 분석하세요.
- 출력 results 배열은 입력 메일 개수와 반드시 같아야 합니다.
- 각 결과의 index는 입력에 표시된 index 값을 그대로 사용하세요.
- 하나의 메일 결과를 다른 메일에 재사용하지 말고, 제목/발신자/로컬 신호를 각각 따로 판단하세요.
- 본문 내용을 추측하거나 요약하지 마세요.
- 사용자가 보는 모든 문장은 한국어 존댓말로 작성하세요.
- 명확한 피싱 징후가 있을 때만 HIGH로 판단하세요.
- LOW로 판단하더라도 confidence는 50~95 사이 정수로 작성하세요. 0은 절대 사용하지 마세요.
- reason에는 실제 제목 일부, 실제 발신자 이메일/도메인, 또는 실제 로컬 신호를 최소 하나 포함하세요.
- signals에는 실제로 의심되는 값이 있을 때만 실제 값을 넣으세요. 템플릿 설명문은 쓰지 마세요.

반드시 JSON 객체 하나만 응답하세요. 다른 설명 문장은 절대 포함하지 마세요.

출력 템플릿:
{
  "results": [
    {
      "index": 1,
      "needsAdditionalCheck": false,
      "riskLevel": "LOW",
      "confidence": 75,
      "reason": "제공된 제목, 발신자 이메일, 로컬 신호 중 실제 확인한 값을 근거로 1~2문장 작성",
      "signals": []
    }
  ]
}

필드 규칙:
- riskLevel은 LOW, MEDIUM, HIGH 중 하나만 사용하세요.
- confidence는 50~95 사이 정수입니다. 0은 사용하지 마세요.
- signals는 의심 신호가 있을 때만 작성하세요. 뚜렷한 신호가 없으면 빈 배열 []로 두세요.
- signals를 작성할 때는 반드시 "1. 항목명: 내용" 형식의 번호형 문장으로 작성하세요.
- signals에는 "관찰된 발신자/도메인 신호", "제목에서 확인된 긴급성", "로컬 검사 결과에서 확인된 신호" 같은 템플릿 문구를 그대로 쓰지 마세요.
- 같은 reason을 여러 메일에 반복하지 마세요. 각 메일의 제목/발신자/로컬 신호에 맞게 다르게 작성하세요.
- needsAdditionalCheck는 본문 포함 정밀 분석을 사용자에게 권장해야 할 때만 true입니다.
- 제목/발신자만으로 근거가 부족하면 LOW 또는 MEDIUM으로 보수적으로 판단하세요.`;
}

function buildMetadataBatchPrompt(items) {
  const body = items.map((item, offset) => {
    const index = Number(item?.index || offset + 1);
    const metadata = item?.metadata || {};
    const preRisk = item?.preRisk || {};
    return `[메일 ${index}]
index: ${index}
1. 제목: ${metadata.subject || '(없음)'}
2. 발신자명: ${metadata.sender || '(없음)'}
3. 발신자 이메일: ${metadata.senderEmail || '(없음)'}
4. 날짜: ${metadata.date || '(없음)'}
5. 로컬 위험도: ${preRisk.riskLevel || 'UNKNOWN'}
6. 로컬 점수: ${preRisk.score ?? 0}
7. 로컬 신호: ${(preRisk.indicators || []).join(', ') || '(없음)'}`;
  }).join('\n\n');

  return `[검사 대상 메일 목록]
총 ${items.length}개입니다.

${body}

위 ${items.length}개 메일을 모두 빠짐없이 분석하고, results 배열에 ${items.length}개 결과를 넣어 지정된 JSON 템플릿으로만 응답하세요.`;
}

function buildSystem() {
  return `당신은 이메일 스피어피싱 여부를 판단하는 사이버보안 분석가입니다.

중요 원칙:
- 대부분의 이메일은 정상 메일입니다.
- 명확한 피싱 징후가 있을 때만 HIGH로 판단하세요.
- 불확실한 경우 MEDIUM 또는 LOW를 사용하세요.
- 사용자가 보는 모든 문장은 한국어 존댓말로 작성하세요.
- 이메일 본문 내용을 친절하게 요약하거나 전달 사항처럼 정리하지 마세요.
- 보안 판단, 의심 근거, 사용자 주의점만 작성하세요.

반드시 JSON 객체 하나만 응답하세요. 다른 설명 문장은 절대 포함하지 마세요.

출력 템플릿:
{
  "riskLevel": "LOW",
  "confidence": 75,
  "summary": "한국어 2~3문장 보안 판단 요약",
  "checklist": [
    {
      "text": "1. 발신자/도메인 검증: 사용자가 확인해야 할 내용",
      "flagged": false,
      "reason": "이 항목의 판단 근거"
    },
    {
      "text": "2. 링크/도메인 검증: 사용자가 확인해야 할 내용",
      "flagged": false,
      "reason": "이 항목의 판단 근거"
    },
    {
      "text": "3. 개인정보/인증 요구: 사용자가 확인해야 할 내용",
      "flagged": false,
      "reason": "이 항목의 판단 근거"
    },
    {
      "text": "4. 긴급성/압박 표현: 사용자가 확인해야 할 내용",
      "flagged": false,
      "reason": "이 항목의 판단 근거"
    },
    {
      "text": "5. 첨부파일/외부 파일: 사용자가 확인해야 할 내용",
      "flagged": false,
      "reason": "이 항목의 판단 근거"
    },
    {
      "text": "6. 종합 조치: 사용자가 확인해야 할 내용",
      "flagged": false,
      "reason": "이 항목의 판단 근거"
    }
  ],
  "indicators": []
}

필드 규칙:
- riskLevel은 LOW, MEDIUM, HIGH 중 하나만 사용하세요.
- confidence는 판단 신뢰도이며 50~95 사이 정수입니다. 0은 사용하지 마세요.
- checklist는 반드시 6개 항목을 모두 포함하세요. 항목을 생략하지 마세요.
- checklist.text는 반드시 "1. 항목명: 내용"처럼 번호로 시작해야 합니다.
- flagged는 해당 항목에서 위험/의심 요소가 발견된 경우에만 true입니다.
- flagged가 true인 reason에는 어떤 문구, 도메인, 요청, 발신자 정보가 왜 의심스러운지 구체적으로 작성하세요.
- flagged가 false인 reason에는 해당 항목에서 뚜렷한 위험을 발견하지 못한 근거를 작성하세요.
- indicators는 실제 탐지된 위협 지표가 있을 때만 번호형 배열로 작성하세요. 없으면 빈 배열 []로 두세요.
- indicators에는 실제 문구, 도메인, 요청, 발신자 정보가 없는 템플릿 문구를 넣지 마세요.
- 정상 메일로 보이면 무리하게 위험 항목을 만들지 말고 대부분 flagged: false로 작성하세요.`;
}

function buildPrompt(metadata, body) {
  return `[검사 대상 메일]
1. 제목: ${metadata.subject || '(없음)'}
2. 발신자명: ${metadata.sender || '(없음)'}
3. 발신자 이메일: ${metadata.senderEmail || '(없음)'}
4. 날짜: ${metadata.date || '(없음)'}
5. 본문:
${body.substring(0, 3000)}

위 정보를 빠짐없이 확인한 뒤, 지정된 6개 체크리스트 JSON 템플릿으로만 응답하세요.`;
}
