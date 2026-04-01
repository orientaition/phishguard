// background.js — Service Worker

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_EMAIL') {
    chrome.storage.local.get(['apiKeys', 'selectedModel', 'groqApiKey'], (stored) => {
      handleAnalysis(message.payload, stored)
        .then(result => sendResponse({ ok: true, result }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
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
  const model = stored.selectedModel || 'groq';
  const apiKeys = stored.apiKeys || {};
  let apiKey = apiKeys[model];

  if (!apiKey && model === 'groq') apiKey = stored.groqApiKey; // 마이그레이션 용도

  if (!apiKey || apiKey.trim() === '') {
    throw new Error(`API 키가 설정되지 않았습니다. 팝업에서 설정 메뉴를 확인해주세요.`);
  }

  const sys = buildSystem();
  const usr = buildPrompt(metadata, body);
  let raw = '';

  if (model === 'groq') {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) throw new Error(`Groq API 오류: ${response.status}`);
    const data = await response.json();
    raw = data?.choices?.[0]?.message?.content || '';
  } else if (model === 'gpt') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-5.4',
        messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) throw new Error(`GPT API 오류: ${response.status}`);
    const data = await response.json();
    raw = data?.choices?.[0]?.message?.content || '';
  } else if (model === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents: [{ role: 'user', parts: [{ text: usr }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        tools: [{ googleSearch: {} }] // 제미나이 그라운딩(인터넷 검색)
      }),
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

function buildSystem() {
  return `당신은 이메일 스피어피싱을 탐지하는 사이버보안 전문가입니다.

IMPORTANT:
대부분의 이메일은 정상적인 이메일입니다.
명확한 피싱 징후가 있을 때만 HIGH 위험으로 판단하세요.
불확실한 경우 MEDIUM 또는 LOW를 사용하세요.

이메일을 분석하고 반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요.

{
  "riskLevel": "HIGH" 또는 "MEDIUM" 또는 "LOW",
  "confidence": 0~100 사이 정수. 이 메일을 신뢰할 수 있는 정도를 나타냅니다. 0에 가까울수록 신뢰 불가(피싱 가능성 높음), 100에 가까울수록 신뢰 가능(정상 메일 가능성 높음),
  "summary": "한국어 2~3문장 분석 요약",
  "checklist": [
    { "text": "체크 항목 내용", 
      "flagged": true 또는 false,
      "reason": "flagged가 true인 경우 구체적인 이유를 한국어로 작성 (false인 경우 빈 문자열)" }
  ],
  "indicators": ["탐지된 위협 지표 (없으면 빈 배열)"]
}

체크리스트는 반드시 아래 6개 항목을 포함하세요:
1. 발신자 이메일 주소 철자가 공식 도메인과 정확히 일치하는지 (유사 도메인 탐지)
2. 이메일 내 링크를 클릭하지 않고 공식 사이트로 직접 접속해야 하는지
3. 본문에 긴급한 액션을 요구하는 압박 문구가 있는지
4. 개인정보나 자격증명을 요청하는지
5. 발신자 표시명과 실제 이메일 주소가 불일치하는지
6. 맞춤법 오류, 어색한 번역투가 있는지

CRITICAL — flagged 값 규칙:
- flagged: true  → 해당 항목에서 위험/의심 요소가 발견됨 (빨간색 강조 표시됨)
- flagged: false → 해당 항목이 안전함 (기본 색상 표시됨)
- 정상 메일이면 대부분의 항목이 flagged: false여야 합니다.
- 예: "공식 도메인과 일치" → flagged: false / "유사 도메인 사용" → flagged: true`;
}

function buildPrompt(metadata, body) {
  return `제목: ${metadata.subject || '(없음)'}
발신자명: ${metadata.sender || '(없음)'}
발신자 이메일: ${metadata.senderEmail || '(없음)'}
날짜: ${metadata.date || '(없음)'}

본문:
${body.substring(0, 3000)}`;
}