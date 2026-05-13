# PhishGuard AI

Gmail에서 메일을 열 때 발신자, 제목, 본문, 로컬 규칙을 함께 분석해 스피어피싱 위험을 알려주는 Chrome Manifest V3 확장 프로그램입니다.

PhishGuard AI는 별도 서버 없이 사용자의 브라우저에서 동작합니다. API 키는 사용자가 직접 발급해 입력하는 BYOK 방식이며, 키와 설정은 `chrome.storage.local`에 저장됩니다.

## 주요 기능

- Gmail SPA 화면 감지: `MutationObserver`, URL 변경 감지, 뒤로가기/목록 이동 감지를 함께 사용합니다.
- 메일 상세 화면 분석: 발신자명, 발신자 이메일, 제목, 날짜, 본문을 추출해 AI 분석에 사용합니다.
- 개인정보 우선 흐름: 먼저 메타데이터와 로컬 검사 결과로 추가 정밀검사 필요 여부를 판단하고, 본문 전송 전 사용자 확인을 받습니다.
- 위험도 표시: `HIGH`, `MEDIUM`, `LOW` 위험도와 신뢰도, 판단 요약, 체크리스트, 의심 신호를 표시합니다.
- 고위험 경고: 위험도가 높은 메일은 전체 화면 오버레이와 분석 패널로 경고합니다.
- Gmail 목록 사전 검사: 메일 목록에서 발신자/제목 기반 로컬 위험 신호를 표시합니다.
- 화이트리스트/블랙리스트: 이메일 주소 또는 도메인 단위로 등록할 수 있습니다.
- 분석 통계: 높음/보통/낮음/총 분석 횟수를 누적합니다.
- 테마: 팝업과 분석 패널에서 라이트/다크 모드를 지원합니다.
- 모델 선택: Groq, Gemini, GPT API 키를 모델별로 저장하고 선택할 수 있습니다.

## 지원 모델

현재 코드 기준으로 다음 API 경로를 지원합니다.

| 선택값 | API | 사용 모델 |
| --- | --- | --- |
| `groq` | Groq Chat Completions | `llama-3.3-70b-versatile` |
| `gemini` | Google Generative Language API | `gemini-1.5-flash` |
| `gpt` | OpenAI Chat Completions | `gpt-4o` |

팝업 UI의 표시 문구와 실제 호출 모델이 다를 수 있으므로, 모델 변경 시 [src/background.js](src/background.js)를 함께 확인하세요.

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
2. 오른쪽 위의 개발자 모드를 켭니다.
3. 압축해제된 확장 프로그램 로드를 클릭합니다.
4. 이 프로젝트의 `dist/` 폴더를 선택합니다.

### 4. API 키 설정

1. Chrome 툴바에서 PhishGuard AI 아이콘을 클릭합니다.
2. 설정 탭에서 사용할 AI 모델을 선택합니다.
3. 해당 모델의 API 키를 입력하고 저장합니다.
4. Gmail 탭을 새로고침합니다.

## 사용 방법

1. Gmail에서 메일 목록을 엽니다.
2. 의심 메일을 클릭합니다.
3. PhishGuard가 메일 메타데이터와 로컬 규칙으로 1차 검사를 수행합니다.
4. 필요하면 추가 검사 확인창이 뜹니다.
5. 사용자가 본문 포함 정밀 분석을 승인하면 AI 분석 결과 패널이 표시됩니다.
6. 메일 목록으로 돌아가거나 Gmail 홈으로 이동하면 검사창과 경고창은 자동으로 사라집니다.

## 동작 흐름

```text
Gmail 메일 열람
  -> content.js가 DOM/URL 변화를 감지
  -> 메일 본문과 메타데이터 추출
  -> 목록 사전 검사 캐시, 화이트리스트, 블랙리스트 확인
  -> 메타데이터 기반 1차 AI 검사
  -> 사용자 동의 후 본문 포함 정밀 검사
  -> 위험도, 요약, 체크리스트, 의심 신호 표시
  -> 메일 상세 화면을 벗어나면 PhishGuard UI 제거
```

## 파일 구조

```text
phishguard/
├── manifest.json        # Chrome Manifest V3 설정
├── popup.html           # 확장 프로그램 팝업 UI
├── build.js             # src 파일을 dist로 복사하는 빌드 스크립트
├── package.json
├── src/
│   ├── background.js    # Service Worker, AI API 호출, 통계 업데이트
│   ├── content.js       # Gmail DOM 감지, 분석 패널/경고창 주입
│   └── popup.js         # 팝업 설정, 통계, API 키, 리스트 관리
└── dist/                # Chrome에 로드하는 빌드 산출물
```

## 개발 메모

- 실제 Chrome 확장은 `dist/manifest.json` 기준으로 로드됩니다.
- `src/content.js`를 수정한 뒤에는 반드시 `npm.cmd run build` 또는 `npm run build`를 실행해야 `dist/content.js`에 반영됩니다.
- `dist/`가 Git 추적 대상이 아니면 커밋에는 원본 `src/` 변경만 포함됩니다.
- Gmail DOM 클래스는 바뀔 수 있습니다. 본문/메타데이터 추출이 깨지면 [src/content.js](src/content.js)의 `extractBody()`와 `extractMetadata()` 선택자를 확인하세요.
- Gmail은 SPA라서 `hashchange`만으로 화면 전환을 모두 잡지 못할 수 있습니다. 현재 구현은 DOM 변화, URL polling, 클릭 감지를 함께 사용합니다.

## 보안 모델

- API 키는 사용자의 브라우저 로컬 저장소에만 저장됩니다.
- 별도 백엔드 서버를 사용하지 않습니다.
- 본문은 사용자가 추가 정밀 검사를 승인한 뒤에만 선택한 AI API로 전송됩니다.
- 화이트리스트/블랙리스트도 로컬 저장소에 보관됩니다.

## 문제 해결

### 검사창이 뜨지 않을 때

1. `npm.cmd run build`를 실행했는지 확인합니다.
2. `chrome://extensions/`에서 확장 프로그램을 새로고침합니다.
3. Gmail 탭을 새로고침합니다.
4. 팝업에서 API 키가 저장되어 있는지 확인합니다.
5. Gmail 메일 상세 화면에서 본문이 실제로 로드된 뒤 잠시 기다립니다.

### 메일 목록으로 돌아와도 검사창이 남아 있을 때

1. 최신 `src/content.js`가 `dist/content.js`에 빌드되었는지 확인합니다.
2. 확장 프로그램과 Gmail 탭을 모두 새로고침합니다.
3. URL 변경 감지 또는 Gmail DOM 선택자가 깨졌을 수 있으므로 `isGmailMessageRoute()`, `clearAnalysisUi()`, `extractBody()`를 확인합니다.

## 라이선스

MIT License