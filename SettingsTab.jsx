import { useState, useEffect, useRef } from 'react'

export default function SettingsTab({ storage }) {
  const [apiKey,  setApiKey]  = useState('')
  const [model,   setModel]   = useState('gemini-2.5-flash-preview-05-20')
  const [show,    setShow]    = useState(false)
  const [status,  setStatus]  = useState('idle') // idle | saving | saved | error
  const [error,   setError]   = useState('')
  const inputRef = useRef(null)

  // ── 초기 로드 ─────────────────────────────────────────────────────────
  useEffect(() => {
    storage.get(['apiKey', 'model']).then(d => {
      if (d.apiKey) setApiKey(d.apiKey)
      if (d.model)  setModel(d.model)
    }).catch(() => {})
  }, [])

  // ── 저장 ─────────────────────────────────────────────────────────────
  async function handleSave() {
    setError('')
    const key = apiKey.trim()

    if (!key) {
      setError('API 키를 입력해주세요')
      inputRef.current?.focus()
      return
    }
    if (!key.startsWith('AIza')) {
      setError('Gemini API 키는 AIza 로 시작해야 합니다')
      return
    }

    setStatus('saving')
    try {
      // chrome.storage.local.set 은 콜백 기반 — Promise 래핑을 명시적으로
      await new Promise((resolve, reject) => {
        if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
          chrome.storage.local.set({ apiKey: key, model }, () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message))
            } else {
              resolve()
            }
          })
        } else {
          // 개발 환경 fallback
          localStorage.setItem('pg_apiKey', key)
          localStorage.setItem('pg_model',  model)
          resolve()
        }
      })
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 2200)
    } catch (e) {
      setStatus('error')
      setError('저장 실패: ' + e.message)
    }
  }

  // ── 초기화 ────────────────────────────────────────────────────────────
  async function handleClear() {
    try {
      await new Promise((resolve, reject) => {
        if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
          chrome.storage.local.remove(['apiKey'], () => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
            else resolve()
          })
        } else {
          localStorage.removeItem('pg_apiKey')
          resolve()
        }
      })
      setApiKey('')
      setError('')
      setStatus('idle')
    } catch (e) {
      setError('초기화 실패: ' + e.message)
    }
  }

  // ── Eye 토글 (type="button" 필수 — form submit 방지) ─────────────────
  function toggleShow(e) {
    e.preventDefault()
    e.stopPropagation()
    setShow(prev => !prev)
    // 토글 후 input 포커스 유지
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const btnLabel =
    status === 'saving' ? '저장 중...' :
    status === 'saved'  ? '✓  저장됨'  :
    '[ 저장 ]'

  const btnCls = `
    flex-1 py-2.5 text-[10px] font-semibold tracking-[0.12em] uppercase
    border rounded transition-all duration-150 active:scale-[0.98]
    disabled:opacity-40 disabled:cursor-not-allowed
    ${status === 'saved'
      ? 'bg-green/8 border-green/25 text-green'
      : 'bg-red/10 border-red/25 text-red hover:bg-red/18 hover:border-red/40'}
  `

  return (
    <div className="p-4 space-y-5">

      {/* ── API Key 입력 ───────────────────────────────── */}
      <div className="space-y-2">
        <Label>Gemini API 키</Label>
        <div className="relative">
          <input
            ref={inputRef}
            type={show ? 'text' : 'password'}
            value={apiKey}
            onChange={e => { setApiKey(e.target.value); setError(''); setStatus('idle') }}
            onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
            placeholder="AIza..."
            spellCheck={false}
            autoComplete="off"
            className="
              w-full px-3 py-2.5 pr-9
              bg-surface border border-border rounded
              text-[11px] text-text placeholder:text-muted
              focus:outline-none focus:border-[#333]
              transition-colors duration-150 font-mono
            "
          />
          {/* type="button" 없으면 Enter 키에 submit처럼 반응해서 toggle 안 됨 */}
          <button
            type="button"
            onMouseDown={toggleShow}
            tabIndex={-1}
            className="
              absolute right-2.5 top-1/2 -translate-y-1/2
              text-muted hover:text-dim transition-colors
              flex items-center justify-center
              w-6 h-6
            "
            title={show ? '숨기기' : '보기'}
          >
            {show ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>

        {/* API 키 상태 표시 */}
        <div className="flex items-center gap-1.5">
          {apiKey && (
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              apiKey.startsWith('AIza') ? 'bg-green' : 'bg-amber'
            }`} />
          )}
          <span className="text-[9px] text-muted/60 font-sans">
            {apiKey
              ? apiKey.startsWith('AIza')
                ? `키 입력됨 · ${apiKey.length}자`
                : '⚠ AIza 로 시작하는 키를 입력해주세요'
              : <><a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer"
                    className="text-red/50 hover:text-red/80 underline underline-offset-2 transition-colors">
                    aistudio.google.com
                  </a>{' '}에서 무료 발급</>
            }
          </span>
        </div>
      </div>

      {/* ── 모델 선택 ───────────────────────────────────── */}
      <div className="space-y-2">
        <Label>모델</Label>
        <div className="relative">
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="
              w-full px-3 py-2.5 pr-8
              bg-surface border border-border rounded
              text-[11px] text-text
              focus:outline-none focus:border-[#333]
              transition-colors duration-150 font-mono
              cursor-pointer appearance-none
            "
          >
            <option value="gemini-2.5-flash-preview-05-20">Gemini 2.5 Flash (권장)</option>
            <option value="gemini-2.0-flash">Gemini 2.0 Flash (빠름)</option>
            <option value="gemini-1.5-pro">Gemini 1.5 Pro (정확)</option>
          </select>
          {/* 드롭다운 화살표 */}
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted">
            <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor">
              <path d="M0 0l5 6 5-6z" />
            </svg>
          </div>
        </div>
      </div>

      {/* ── 에러 메시지 ─────────────────────────────────── */}
      {error && (
        <div className="text-[10px] text-red font-sans px-3 py-2 bg-red/5 border border-red/15 rounded leading-relaxed">
          {error}
        </div>
      )}

      {/* ── 버튼 ────────────────────────────────────────── */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={status === 'saving'}
          className={btnCls}
        >
          {btnLabel}
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="
            px-4 py-2.5 text-[10px] tracking-[0.1em] uppercase
            border border-border text-muted rounded
            hover:border-[#2a2a2a] hover:text-dim
            transition-all duration-150 active:scale-[0.98]
          "
        >
          초기화
        </button>
      </div>

      {/* ── BYOK 안내 ───────────────────────────────────── */}
      <div className="pt-1 border-t border-border">
        <p className="text-[9px] text-muted/40 font-sans leading-relaxed">
          BYOK 모델 — 키는 chrome.storage.local에만 저장되며
          외부 서버로 전송되지 않습니다.
          모든 API 호출은 브라우저 ↔ Google API 직접 통신합니다.
        </p>
      </div>
    </div>
  )
}

function Label({ children }) {
  return (
    <div className="text-[9px] tracking-[0.14em] uppercase text-muted/70 mb-1">
      {children}
    </div>
  )
}

function EyeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  )
}