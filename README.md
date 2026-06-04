# PhishGuard AI

Gmail에서 메일을 열 때 발신자, 제목, 본문, 로컬 규칙을 함께 분석해 스피어피싱 위험을 알려주는 Chrome Manifest V3 확장 프로그램입니다.

PhishGuard AI는 별도 서버 없이 사용자의 브라우저에서 동작합니다. API 키는 사용자가 직접 발급해 입력하는 BYOK 방식이며, 키와 설정은 `chrome.storage.local`에 저장됩니다.

---

## 주요 기능

### 📥 Gmail 목록 사전 검사
- 메일 목록에서 각 메일 옆에 위험도 배지를 표시합니다 (`✓ 신뢰` / `● 낮음` / `● 주의` / `▲ 위험` / `✕ 차단`)
- 화이트리스트 도메인은 **초록**, 블랙리스트 도메인은 **검정/빨강**으로 즉시 표시합니다
- `▲ 위험` / `✕ 차단` 메일을 클릭하면 열리기 전에 경고 오버레이가 먼저 표시됩니다

### 🔍 브랜드 사칭 감지
- 발신자 표시명에 브랜드명이 포함되어 있지만 실제 도메인이 공식 도메인과 다르면 자동으로 **위험**으로 분류합니다
- 지원 브랜드: GitHub, Google, Microsoft, Apple, Amazon, Kakao, Naver, 신한/KB/하나/우리은행, SKT/KT/LG U+, 배민, 쿠팡, Toss 등 40여 개

### 🌐 외국어 메일 번역 분석
- 영어, 일본어, 중국어 등 외국어로 작성된 메일은 AI가 한국어로 번역한 뒤 분석합니다
- 분석 결과(요약, 체크리스트)는 항상 한국어로 출력됩니다

### 🤖 AI 정밀 분석
- 개인정보 보호 우선 흐름: 메타데이터만으로 1차 검사 후, 사용자 동의를 받은 뒤에만 본문을 AI에 전송합니다
- 위험도(`HIGH` / `MEDIUM` / `LOW`), 신뢰도, 판단 요약, 6개 항목 체크리스트, 위협 지표를 표시합니다
- 체크리스트에서 **안전한 항목은 초록색으로 미리 체크**, 위험한 항목은 빨간색으로 강조해 사용자가 직접 확인하게 합니다
- 체크리스트 하단에 AI 판별 결과임을 명시하는 면책 문구가 표시됩니다

### 🖥️ 로컬 AI 지원 (Ollama)
- 인터넷 없이 자신의 PC에서 직접 AI 모델을 실행할 수 있습니다
- API 키가 필요 없으며, 메일 내용이 외부 서버로 전송되지 않습니다
- 설치 방법은 아래 [Ollama 설정](#ollama-로컬-ai-설정) 섹션을 참고하세요

### 📋 화이트리스트 / 블랙리스트
- 이메일 주소 또는 도메인 단위로 등록할 수 있습니다
- JSON 파일로 내보내기/가져오기를 지원합니다 (도메인 목록 관리 창)
- 목록 변경 시 메일 목록의 배지가 즉시 재갱신됩니다

### 📊 분석 통계 및 로그
- 위험도별(높음/보통/낮음) 분석 횟수를 누적 표시합니다
- 통계를 JSON 파일로 내보낼 수 있습니다
- AI API 호출 기록을 별도 로그 창에서 확인할 수 있습니다

### 🛠️ 개발자 모드 (모델 비교)
일반 사용자에게는 노출되지 않는 연구/개발용 기능입니다.

**활성화 방법:** 팝업 하단 `v1.0.0` 텍스트를 **5번 빠르게 클릭**

활성화하면 AI 분석 완료 후 화면 왼쪽 하단에 **⚖️ 모델 비교** 버튼이 나타납니다.
- API 키가 설정된 모든 모델(Groq, GPT, Gemini, Ollama)로 동시에 분석합니다
- 모델별 위험도 / 신뢰도 / 응답 속도를 테이블로 비교합니다
- 비교 결과는 누적 저장되며, JSON 파일로 내보낼 수 있습니다 (최대 200건)

---

## 지원 모델

| 선택값 | API | 사용 모델 |
|---|---|---|
| `groq` | Groq Chat Completions | `llama-3.3-70b-versatile` |
| `gemini` | Google Generative Language API | `gemini-3.1-flash-lite` |
| `gpt` | OpenAI Chat Completions | `gpt-5.5` |
| `ollama` | Ollama Local API | `qwen3.5:9b` (기본값, 변경 가능) |

팝업 UI의 표시 문구와 실제 호출 모델이 다를 수 있으므로, 모델 변경 시 [src/background.js](src/background.js) 상단의 상수를 확인하세요.

---

## 설치 및 실행

### 1. 저장소 받기

```bash
git clone https://github.com/orientaition/phishguard.git
cd phishguard
```

### 2. 빌드

```bash
npm run build
```

PowerShell 실행 정책 때문에 `npm`이 막히면 Windows에서는 아래 명령을 사용하세요.

```powershell
npm.cmd run build
```

빌드가 끝나면 `dist/` 폴더에 Chrome에서 로드할 파일이 복사됩니다.

### 3. Chrome에 로드

1. Chrome에서 `chrome://extensions/`로 이동합니다.
2. 오른쪽 위의 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램 로드**를 클릭합니다.
4. 이 프로젝트의 `dist/` 폴더를 선택합니다.

### 4. API 키 설정

1. Chrome 툴바에서 PhishGuard AI 아이콘을 클릭합니다.
2. 팝업에서 사용할 AI 모델을 선택합니다.
3. 해당 모델의 API 키를 입력하고 저장합니다.
4. Gmail 탭을 새로고침합니다.

> **Ollama(로컬 AI)** 를 사용하면 API 키 없이도 분석할 수 있습니다. 아래 섹션을 참고하세요.

---

## Ollama 로컬 AI 설정

인터넷 없이 자신의 PC에서 AI 분석을 실행할 수 있습니다.

### 1. Ollama 설치

https://ollama.com/download 에서 운영체제에 맞는 설치 파일을 다운로드해 실행합니다.

### 2. 모델 다운로드

```bash
ollama pull qwen3.5:9b
```

> RAM 16GB 이상, NVIDIA GPU 권장. GPU가 있으면 자동으로 가속됩니다.

### 3. CORS 설정 (Chrome 확장 연동 필수)

**Windows 시스템 환경 변수에 추가:**
1. 시작 → "시스템 환경 변수 편집" 검색
2. 환경 변수 → 시스템 변수 → 새로 만들기
3. 변수 이름: `OLLAMA_ORIGINS` / 변수 값: `*`
4. 확인 후 Ollama 재시작 (트레이 아이콘 → Quit → 다시 실행)

**Mac / Linux:**
```bash
OLLAMA_ORIGINS=* ollama serve
```

### 4. 팝업에서 Ollama 선택 후 API 테스트

팝업 → 모델 선택에서 **Ollama Local** 선택 → **API 테스트** 버튼으로 연결 확인

---

## 사용 방법

1. Gmail에서 메일 목록을 엽니다 → 각 메일 옆에 위험도 배지가 표시됩니다.
2. `▲ 위험` / `✕ 차단` 메일을 클릭하면 경고 오버레이가 먼저 뜹니다.
3. 메일을 열면 PhishGuard가 메타데이터와 로컬 규칙으로 1차 검사를 수행합니다.
4. 추가 검사가 필요하면 **"본문 포함 정밀 분석"** 동의 창이 나타납니다.
5. 동의하면 AI 분석 결과 패널이 표시됩니다.
6. 체크리스트에서 위험 항목을 직접 확인하고 체크합니다.
7. 메일 목록으로 돌아가면 PhishGuard UI가 자동으로 사라집니다.

---

## 동작 흐름

```text
Gmail 메일 목록
  -> 각 메일의 발신자/제목 알고리즘 분석
  -> 화이트리스트/블랙리스트 매칭
  -> 브랜드 사칭 감지
  -> 위험도 배지 표시 (▲ 위험 / ✕ 차단은 클릭 인터셉트)

Gmail 메일 열람
  -> content.js가 DOM/URL 변화를 감지
  -> 메일 본문과 메타데이터 추출
  -> 외국어 감지 → 한국어 번역 후 분석
  -> 메타데이터 기반 1차 AI 검사
  -> 사용자 동의 후 본문 포함 정밀 검사
  -> 위험도, 요약, 체크리스트, 의심 신호 표시
  -> 메일 상세 화면을 벗어나면 PhishGuard UI 제거
```

---

## 파일 구조

```text
phishguard/
├── manifest.json        # Chrome Manifest V3 설정
├── popup.html           # 확장 프로그램 팝업 UI
├── domains.html         # 화이트리스트/블랙리스트 관리 창
├── logs.html            # AI API 응답 로그 창
├── build.js             # src 파일을 dist로 복사하는 빌드 스크립트
├── package.json
├── src/
│   ├── background.js    # Service Worker, AI API 호출, 모델 비교
│   ├── content.js       # Gmail DOM 감지, 분석 패널/경고창 주입
│   ├── popup.js         # 팝업 설정, 통계, API 키, 개발자 모드
│   ├── domains.js       # 도메인 목록 관리 (JSON 가져오기/내보내기)
│   └── logs.js          # API 응답 로그 뷰어
├── tools/               # 개발자용 프롬프트 평가 도구
│   ├── prompt_eval_gui.py          # Python GUI 대시보드
│   ├── evaluate-phishing-prompt.mjs # Node.js 평가 엔진
│   └── README.md
└── dist/                # Chrome에 로드하는 빌드 산출물
```

---

## 개발 메모

- 실제 Chrome 확장은 `dist/manifest.json` 기준으로 로드됩니다.
- `src/` 수정 후에는 반드시 `npm run build`를 실행해야 `dist/`에 반영됩니다.
- `dist/`가 `.gitignore`에 포함된 경우 커밋에는 `src/` 변경만 포함됩니다.
- Gmail DOM 클래스는 바뀔 수 있습니다. 본문/메타데이터 추출이 깨지면 `extractBody()`와 `extractMetadata()`의 선택자를 확인하세요.
- Gmail은 SPA라서 `hashchange`만으로 화면 전환을 모두 잡지 못할 수 있습니다. 현재 구현은 DOM 변화, URL polling, 클릭 감지를 함께 사용합니다.

---

## 보안 모델

- API 키는 사용자의 브라우저 로컬 저장소(`chrome.storage.local`)에만 저장됩니다.
- 별도 백엔드 서버를 사용하지 않습니다.
- 본문은 사용자가 정밀 분석을 승인한 뒤에만 선택한 AI API로 전송됩니다.
- Ollama 사용 시 메일 내용이 외부로 전혀 나가지 않습니다.
- 화이트리스트/블랙리스트도 로컬 저장소에만 보관됩니다.

---

## 문제 해결

### 검사창이 뜨지 않을 때

1. `npm run build`를 실행했는지 확인합니다.
2. `chrome://extensions/`에서 확장 프로그램을 새로고침합니다.
3. Gmail 탭을 새로고침합니다.
4. 팝업에서 API 키가 저장되어 있는지 확인합니다.
5. Gmail 메일 상세 화면에서 본문이 로드된 뒤 잠시 기다립니다.

### Ollama 연결 실패 시

1. 트레이 아이콘에서 Ollama가 실행 중인지 확인합니다.
2. 시스템 환경 변수 `OLLAMA_ORIGINS=*` 이 설정되어 있는지 확인합니다.
3. 환경 변수 설정 후 Ollama를 완전히 재시작합니다 (작업 관리자에서 프로세스 종료 후 재실행).
4. 터미널에서 `ollama list`로 모델이 설치되어 있는지 확인합니다.

### 메일 목록으로 돌아와도 검사창이 남아 있을 때

1. 최신 `src/content.js`가 빌드되었는지 확인합니다.
2. 확장 프로그램과 Gmail 탭을 모두 새로고침합니다.

---

## 라이선스

MIT License
