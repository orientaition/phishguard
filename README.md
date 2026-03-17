# PhishGuard AI — Chrome Extension

Gemini 2.5 Flash 기반 Gmail 스피어피싱 실시간 탐지 확장프로그램  
React + Vite + Tailwind CSS + Chrome Manifest V3

---

## 프로젝트 구조

```
phishguard/
├── public/
│   ├── manifest.json          ← Chrome MV3 설정
│   └── icons/                 ← 아이콘 (직접 추가)
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── src/
│   ├── background.js          ← Service Worker: Gemini API 호출
│   ├── content.js             ← Gmail DOM 감시 + 분석 패널 주입
│   ├── popup.jsx              ← React 진입점
│   ├── index.css              ← Tailwind + 커스텀 스타일
│   └── components/
│       ├── App.jsx            ← 팝업 쉘 (탭 라우팅)
│       ├── SettingsTab.jsx    ← API 키 · 모델 설정
│       └── StatusTab.jsx      ← 통계 · 상태 · 미리보기
├── popup.html
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
└── package.json
```

---

## 빌드 & 설치

### 1. 의존성 설치
```bash
npm install
```

### 2. 프로덕션 빌드
```bash
npm run build
```
→ `dist/` 폴더가 생성됩니다

### 3. 아이콘 추가
`dist/icons/` 폴더를 만들고 PNG 아이콘 3종을 추가하세요:
- `icon16.png`  (16×16)
- `icon48.png`  (48×48)
- `icon128.png` (128×128)

### 4. Chrome에 로드
1. `chrome://extensions/` 접속
2. **개발자 모드** 활성화 (우측 상단 토글)
3. **압축해제된 확장 프로그램 로드** 클릭
4. `dist/` 폴더 선택

### 5. API 키 설정
1. Chrome 툴바에서 PhishGuard AI 아이콘 클릭
2. **설정** 탭 → Gemini API 키 입력 (`AIza...` 형태)
3. API 키 발급: https://aistudio.google.com/apikey (무료)
4. **[ 저장 ]** 클릭

### 6. 사용
- Gmail(https://mail.google.com) 에서 이메일을 열면 자동 분석
- 오른쪽 상단에 분석 패널이 나타납니다

---

## 작동 원리

```
Gmail 이메일 열람
    ↓
MutationObserver (SPA 감지)
    ↓
div.a3s.aiL 본문 추출 + 메타데이터 (발신자, 제목, 날짜)
    ↓
chrome.runtime.sendMessage → background.js
    ↓
Gemini 2.5 Flash API 호출 (JSON 응답 강제)
    ↓
위험도(HIGH/MEDIUM/LOW) + 신뢰도 % + 체크리스트 + 위협 지표
    ↓
Gmail 페이지에 패널 주입 (fixed position)
```

## BYOK 보안 모델
- API 키는 `chrome.storage.local`에만 저장 (암호화된 브라우저 로컬)
- 외부 서버 없음 — 클라이언트 ↔ Google API 직접 통신
- 서버리스, 완전 무료 운영 가능

## Gmail DOM 선택자 업데이트
Google이 Gmail 클래스명을 변경한 경우:
1. Gmail에서 F12 → 이메일 본문 DOM 확인
2. `src/content.js` 상단 `selectors` 배열 수정

```javascript
const selectors = [
  'div.a3s.aiL',        // 현재 주 선택자
  'div[data-message-id] .a3s',
  '.ii.gt .a3s.aiL',
  'div.gs .a3s',
]
```
