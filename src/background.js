// background.js — Service Worker

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_EMAIL') {
    // storage에서 키 읽어서 분석
    chrome.storage.local.get(['groqApiKey'], (stored) => {
      handleAnalysis(message.payload, stored.groqApiKey || '')
        .then(result => sendResponse({ ok: true, result }))
        .catch(err   => sendResponse({ ok: false, error: err.message }));
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

async function handleAnalysis({ body, metadata }, apiKey) {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('API 키가 설정되지 않았습니다. 팝업에서 Groq API 키를 입력해주세요.');
  }

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: buildSystem() },
        { role: 'user',   content: buildPrompt(metadata, body) },
      ],
      temperature: 0.1,
      max_tokens:  1024,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Groq API ${response.status}: ${err?.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const raw  = data?.choices?.[0]?.message?.content || '';

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
  "confidence": 0~100 사이 정수,
  "summary": "한국어 2~3문장 분석 요약",
  "checklist": [
    { "text": "체크 항목 내용", "flagged": true 또는 false }
  ],
  "indicators": ["탐지된 위협 지표 (없으면 빈 배열)"]
}

체크리스트는 반드시 아래 6개 항목을 포함하세요:
1. 발신자 이메일 주소 철자가 공식 도메인과 정확히 일치하는지 (유사 도메인 탐지)
2. 이메일 내 링크를 클릭하지 않고 공식 사이트로 직접 접속해야 하는지
3. 본문에 긴급한 액션을 요구하는 압박 문구가 있는지
4. 개인정보나 자격증명을 요청하는지
5. 발신자 표시명과 실제 이메일 주소가 불일치하는지
6. 맞춤법 오류, 어색한 번역투가 있는지`;
}

function buildPrompt(metadata, body) {
  return `제목: ${metadata.subject || '(없음)'}
발신자명: ${metadata.sender || '(없음)'}
발신자 이메일: ${metadata.senderEmail || '(없음)'}
날짜: ${metadata.date || '(없음)'}

본문:
${body.substring(0, 3000)}`;
}