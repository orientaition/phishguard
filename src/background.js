// background.js — Service Worker

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
  return requestModelJson(sys, usr, stored);
}

async function handleMetadataAnalysis({ metadata, preRisk }, stored) {
  const sys = buildMetadataSystem();
  const usr = buildMetadataPrompt(metadata, preRisk);
  return requestModelJson(sys, usr, stored);
}

async function requestModelJson(sys, usr, stored) {
  const model   = stored.selectedModel || 'groq';
  const apiKeys = stored.apiKeys || {};
  let apiKey    = apiKeys[model];

  // groqApiKey 마이그레이션 지원
  if (!apiKey && model === 'groq') apiKey = stored.groqApiKey;

  if (!apiKey || apiKey.trim() === '') {
    throw new Error('API 키가 설정되지 않았습니다. 팝업에서 설정 메뉴를 확인해주세요.');
  }

  let raw   = '';

  if (model === 'groq') {
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
    if (!response.ok) throw new Error(`Groq API 오류: ${response.status}`);
    const data = await response.json();
    raw = data?.choices?.[0]?.message?.content || '';

  } else if (model === 'gpt') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body   : JSON.stringify({
        model          : 'gpt-4o',          // 수정: gpt-5.4 → gpt-4o
        messages       : [{ role: 'system', content: sys }, { role: 'user', content: usr }],
        temperature    : 0.1,
        response_format: { type: 'json_object' }
      })
    });
    if (!response.ok) throw new Error(`GPT API 오류: ${response.status}`);
    const data = await response.json();
    raw = data?.choices?.[0]?.message?.content || '';

  } else if (model === 'gemini') {
    // 수정: gemini-3-flash-preview → gemini-1.5-flash
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
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
    if (!response.ok) throw new Error(`Gemini API 오류: ${response.status}`);
    const data = await response.json();
    raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  try {
    return JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim());
  } catch {
    throw new Error('AI 응답 파싱 실패');
  }
}

function buildMetadataSystem() {
  return `당신은 이메일 스피어피싱을 탐지하는 사이버보안 전문가입니다.

개인정보 보호를 위해 이메일 본문은 제공되지 않습니다.
제공된 정보는 발신자명, 발신자 이메일, 제목, 날짜, 로컬 사전 검사 결과뿐입니다.

문체 규칙:
- 사용자가 보는 모든 문장은 반드시 한국어 존댓말(합니다체 또는 해요체)로 작성하세요.
- 반말, 친구에게 말하는 듯한 표현, 단정적인 명령형을 사용하지 마세요.
- reason과 signals는 팝업에 그대로 표시되므로 자연스럽고 공손한 보안 안내문처럼 작성하세요.

목표:
- 본문을 AI에 보낼 추가 정밀 검사가 필요한지 1차 판단하세요.
- 공식 여부를 추측으로 단정하지 마세요.
- 발신자/주소/제목만으로 판단 근거가 부족하면 낮은 확신으로 표현하세요.
- 본문 내용은 제공되지 않았으므로 본문을 요약하거나 상상하지 마세요.

반드시 아래 JSON 형식으로만 응답하세요.

{
  "needsAdditionalCheck": true 또는 false,
  "riskLevel": "LOW" 또는 "MEDIUM" 또는 "HIGH",
  "confidence": 0~100 사이 정수,
  "reason": "추가 검사가 필요하다고 보거나 필요 없다고 본 보안 근거를 한국어 1~2문장으로 작성",
  "signals": ["발신자/주소/제목/사전 검사에서 관찰된 보안 신호. 없으면 빈 배열"]
}

판단 규칙:
- needsAdditionalCheck는 본문 포함 정밀 분석을 사용자에게 권장해야 할 때만 true로 설정하세요.
- 발신자 이메일과 제목에서 사칭, 긴급성, 계정/결제/보안 조치 요구, 의심 도메인, 로컬 사전 검사 신호가 보이면 true를 고려하세요.
- 근거가 약하고 일반적인 메일로 보이면 false를 사용하세요.
- reason은 팝업에 그대로 표시되므로 본문 요약이 아니라 보안 판단 근거만 작성하세요.`;
}

function buildMetadataPrompt(metadata, preRisk) {
  return `제목: ${metadata?.subject || '(없음)'}
발신자명: ${metadata?.sender || '(없음)'}
발신자 이메일: ${metadata?.senderEmail || '(없음)'}
날짜: ${metadata?.date || '(없음)'}

로컬 사전 검사:
위험도: ${preRisk?.riskLevel || 'UNKNOWN'}
점수: ${preRisk?.score ?? 0}
신호: ${(preRisk?.indicators || []).join(', ') || '(없음)'}`;
}

function buildSystem() {
  return `당신은 이메일 스피어피싱을 탐지하는 사이버보안 전문가입니다.

IMPORTANT:
대부분의 이메일은 정상적인 이메일입니다.
명확한 피싱 징후가 있을 때만 HIGH 위험으로 판단하세요.
불확실한 경우 MEDIUM 또는 LOW를 사용하세요.

문체 규칙:
- 사용자가 보는 모든 문장은 반드시 한국어 존댓말(합니다체 또는 해요체)로 작성하세요.
- 반말, 친구에게 말하는 듯한 표현, 단정적인 명령형을 사용하지 마세요.
- summary, checklist.text, checklist.reason, indicators는 팝업에 그대로 표시되므로 자연스럽고 공손한 보안 안내문처럼 작성하세요.

이메일을 분석하고 반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요.

{
  "riskLevel": "HIGH" 또는 "MEDIUM" 또는 "LOW",
  "confidence": 0~100 사이 정수. 이 메일을 신뢰할 수 있는 정도를 나타냅니다. 0에 가까울수록 신뢰 불가(피싱 가능성 높음), 100에 가까울수록 신뢰 가능(정상 메일 가능성 높음),
  "summary": "한국어 2~3문장 보안 판단 요약. 이메일 본문 내용을 요약하지 말고 피싱 위험 여부, 의심 근거, 사용자 주의점만 작성",
  "checklist": [
    {
      "text": "사용자가 이 이메일에서 직접 확인해야 할 구체적인 점검 항목",
      "flagged": true 또는 false,
      "reason": "이 항목을 flagged 값처럼 판단한 근거. 본문/메타데이터에서 관찰한 내용을 바탕으로 한국어 1~2문장 작성"
    }
  ],
  "indicators": ["탐지된 위협 지표 (없으면 빈 배열)"]
}

체크리스트 생성 규칙:
- 체크리스트는 이메일 제목, 발신자, 발신자 이메일, 날짜, 본문에 실제로 나타난 내용에 맞춰 능동적으로 생성하세요.
- 사전 정의된 보안 점검표를 떠올려 나열하지 말고, 이 이메일에서 관찰한 증거만 근거로 새 항목을 작성하세요.
- 같은 항목 이름이나 표현을 매번 반복하지 말고, 이 이메일에서 사용자가 확인해야 할 가장 중요한 점검 항목 3~6개를 작성하세요.
- 각 항목은 사용자가 바로 판단할 수 있게 본문 속 표현, 요청 대상, 발신자 정보, 맥락 등을 반영해 구체적으로 작성하세요.
- 모든 체크리스트 항목은 팝업 생성 시점에 text, flagged, reason을 완성해야 합니다. reason은 사용자가 항목을 펼쳤을 때 보여줄 판단 근거입니다.
- 위험 근거가 명확한 항목만 flagged: true로 설정하세요.
- flagged: true인 항목의 reason에는 어떤 문구, 도메인, 요청, 발신자 정보가 왜 의심스러운지 구체적으로 설명하세요.
- flagged: false인 항목의 reason에는 어떤 정보 때문에 해당 항목에서 뚜렷한 위험을 발견하지 못했는지 설명하세요.
- 정상 메일로 보이면 무리하게 위험 항목을 만들지 말고, 대부분 flagged: false인 실용적인 확인 항목을 제공하세요.

응답 내용 제한:
- 본문 내용을 친절하게 요약하거나 전달 사항을 정리하지 마세요.
- 행사, 일정, 공지, 업무 요청 등 메일의 일반 내용을 설명하지 말고 보안 판단에 필요한 내용만 언급하세요.
- summary와 checklist는 모두 피싱/사칭/위험 신호/안전 판단 근거/사용자 주의점에만 집중하세요.
- 보안 판단과 직접 관련 없는 본문 정보는 출력하지 마세요.

CRITICAL — flagged 값 규칙:
- flagged: true  → 해당 항목에서 위험/의심 요소가 발견됨 (빨간색 강조 표시됨)
- flagged: false → 해당 항목이 안전함 (기본 색상 표시됨)
- 정상 메일이면 대부분의 항목이 flagged: false여야 합니다.`;
}

function buildPrompt(metadata, body) {
  return `제목: ${metadata.subject   || '(없음)'}
발신자명: ${metadata.sender      || '(없음)'}
발신자 이메일: ${metadata.senderEmail || '(없음)'}
날짜: ${metadata.date         || '(없음)'}

본문:
${body.substring(0, 3000)}`;
}