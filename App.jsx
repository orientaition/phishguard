import { useState, useEffect } from 'react'

export default function App() {
  const [stats, setStats] = useState({ high: 0, medium: 0, low: 0, total: 0 })
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // chrome.storage에서 통계 로드
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      chrome.storage.local.get(['stats'], (data) => {
        if (data.stats) setStats(data.stats)
        setReady(true)
      })
    } else {
      setReady(true)
    }
  }, [])

  function resetStats() {
    const zero = { high: 0, medium: 0, low: 0, total: 0 }
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      chrome.storage.local.set({ stats: zero })
    }
    setStats(zero)
  }

  return (
    <div style={{ width: 320, background: '#080808', color: '#e8e8e8', fontFamily: '"JetBrains Mono", monospace' }}>

      {/* Header */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #1a1a1a', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 5, background: 'rgba(255,60,60,0.1)', border: '1px solid rgba(255,60,60,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 1L1.5 4.5V8c0 3.866 2.91 7 6.5 7s6.5-3.134 6.5-7V4.5L8 1z" stroke="#ff3c3c" strokeWidth="1.3" fill="rgba(255,60,60,0.1)" />
              <path d="M8 5.5V9.5M8 11v.5" stroke="#ff3c3c" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#ccc' }}>PhishGuard AI</div>
            <div style={{ fontSize: 9, color: '#444', fontFamily: 'sans-serif', marginTop: 1 }}>Gmail 스피어피싱 탐지</div>
          </div>
        </div>
        {/* 활성 상태 뱃지 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 3, background: 'rgba(0,212,106,0.05)', border: '1px solid rgba(0,212,106,0.2)' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00d46a', boxShadow: '0 0 6px rgba(0,212,106,0.6)' }} />
          <span style={{ fontSize: 9, color: '#00d46a', letterSpacing: '0.15em', textTransform: 'uppercase' }}>Active</span>
        </div>
      </div>

      {/* 안내 */}
      <div style={{ padding: '14px 14px 0', fontSize: 11, color: '#555', fontFamily: 'sans-serif', lineHeight: 1.6 }}>
        Gmail에서 이메일을 열면 자동으로 피싱 여부를 분석합니다.
      </div>

      {/* 통계 */}
      <div style={{ padding: '14px 14px 0' }}>
        <div style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#333', marginBottom: 10 }}>분석 통계</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {[
            { label: '위험',   value: stats.high,          color: '#ff3c3c', bg: 'rgba(255,60,60,0.06)',   border: 'rgba(255,60,60,0.15)' },
            { label: '주의',   value: stats.medium,        color: '#ffb800', bg: 'rgba(255,184,0,0.06)',  border: 'rgba(255,184,0,0.15)' },
            { label: '안전',   value: stats.low,           color: '#00d46a', bg: 'rgba(0,212,106,0.06)', border: 'rgba(0,212,106,0.15)' },
            { label: '총 분석', value: stats.total || 0,   color: '#888',    bg: 'rgba(136,136,136,0.04)', border: 'rgba(136,136,136,0.1)' },
          ].map(s => (
            <div key={s.label} style={{ padding: '10px', borderRadius: 4, background: s.bg, border: `1px solid ${s.border}`, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: s.color, opacity: 0.7, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 작동 원리 */}
      <div style={{ padding: '14px 14px 0' }}>
        <div style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#333', marginBottom: 8 }}>작동 원리</div>
        {[
          'MutationObserver로 Gmail 이메일 열람 감지',
          '발신자 · 제목 · 본문 자동 추출',
          'Gemini 2.5 Flash로 피싱 여부 분석',
          '위험도 + 체크리스트 화면에 표시',
        ].map((t, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 9, color: '#2a2a2a', flexShrink: 0 }}>{'0' + (i + 1)}</span>
            <span style={{ fontSize: 10, color: 'rgba(136,136,136,0.7)', fontFamily: 'sans-serif', lineHeight: 1.5 }}>{t}</span>
          </div>
        ))}
      </div>

      {/* 초기화 + Footer */}
      <div style={{ padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #111', marginTop: 14 }}>
        <span style={{ fontSize: 9, color: '#222', letterSpacing: '0.08em' }}>v1.0.0 · Gemini 2.5 Flash</span>
        <button
          onClick={resetStats}
          style={{ background: 'none', border: '1px solid #1e1e1e', borderRadius: 3, color: '#444', fontSize: 9, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.08em', textTransform: 'uppercase' }}
        >
          통계 초기화
        </button>
      </div>
    </div>
  )
}