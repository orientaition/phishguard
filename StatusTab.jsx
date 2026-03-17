import { useState, useEffect } from 'react'

export default function StatusTab({ storage }) {
  const [stats,  setStats]  = useState({ high: 0, medium: 0, low: 0, total: 0 })
  const [hasKey, setHasKey] = useState(null) // null = loading

  useEffect(() => {
    loadData()
    // 포커스마다 갱신 (팝업 재열기 대응)
    window.addEventListener('focus', loadData)
    return () => window.removeEventListener('focus', loadData)
  }, [])

  async function loadData() {
    const d = await storage.get(['apiKey', 'stats'])
    setHasKey(!!d.apiKey)
    if (d.stats) setStats(d.stats)
  }

  async function resetStats() {
    const reset = { high: 0, medium: 0, low: 0, total: 0 }
    await storage.set({ stats: reset })
    setStats(reset)
  }

  return (
    <div className="p-4 space-y-5 animate-slide-in">

      {/* Status */}
      <div className="flex items-center gap-3 px-3 py-3 bg-surface border border-border rounded">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
          hasKey === null ? 'bg-muted' :
          hasKey ? 'bg-green shadow-[0_0_6px_rgba(0,212,106,0.6)]' : 'bg-amber'
        }`} />
        <div>
          <div className="text-[10px] tracking-wide text-text/80">
            {hasKey === null ? '확인 중...' :
             hasKey ? 'Gmail 모니터링 중' : 'API 키 미설정'}
          </div>
          <div className="text-[9px] text-muted font-sans mt-0.5">
            {hasKey ? 'MutationObserver 활성 · 이메일 자동 감지' : '설정 탭에서 Gemini API 키를 입력해주세요'}
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionLabel>분석 통계</SectionLabel>
          <button
            onClick={resetStats}
            className="text-[9px] text-muted/50 hover:text-muted transition-colors tracking-widest uppercase"
          >
            초기화
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <StatCard value={stats.high}   label="위험"  color="#ff3c3c" bg="rgba(255,60,60,0.06)"  border="rgba(255,60,60,0.12)" />
          <StatCard value={stats.medium} label="주의"  color="#ffb800" bg="rgba(255,184,0,0.06)" border="rgba(255,184,0,0.12)" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <StatCard value={stats.low}   label="안전"  color="#00d46a" bg="rgba(0,212,106,0.06)" border="rgba(0,212,106,0.12)" />
          <StatCard value={stats.total || 0} label="총 분석" color="#888" bg="rgba(136,136,136,0.04)" border="rgba(136,136,136,0.1)" />
        </div>
      </div>

      {/* How it works */}
      <div>
        <SectionLabel>작동 원리</SectionLabel>
        <div className="space-y-1.5 mt-2">
          {[
            { step: '01', text: 'MutationObserver로 Gmail SPA 이메일 열람 감지' },
            { step: '02', text: '발신자 · 제목 · 본문 DOM 추출' },
            { step: '03', text: 'Gemini 2.5에 분석 요청 (본문 최대 3,000자)' },
            { step: '04', text: '위험도 + 사용자 판단 유도형 체크리스트 표시' },
          ].map(item => (
            <div key={item.step} className="flex gap-3 items-start">
              <span className="text-[9px] text-muted/40 tracking-widest mt-0.5 flex-shrink-0 font-mono">{item.step}</span>
              <span className="text-[10px] text-muted/70 font-sans leading-relaxed">{item.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Checklist preview */}
      <div>
        <SectionLabel>체크 항목 미리보기</SectionLabel>
        <div className="mt-2 space-y-1">
          {[
            '발신자 이메일 철자가 공식 도메인과 일치하나요?',
            '링크 대신 공식 사이트로 직접 접속하세요',
            '긴급한 액션을 요구하는 압박 문구가 있나요?',
            '개인정보 / 자격증명을 요청하나요?',
            '발신자명과 실제 이메일이 일치하나요?',
            '어색한 번역투나 맞춤법 오류가 있나요?',
          ].map((t, i) => (
            <div key={i} className="flex gap-2 items-start py-1">
              <div className="w-3 h-3 border border-muted/30 rounded-sm flex-shrink-0 mt-0.5" />
              <span className="text-[10px] text-muted/60 font-sans leading-relaxed">{t}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

function StatCard({ value, label, color, bg, border }) {
  return (
    <div
      className="px-3 py-3 rounded border text-center"
      style={{ background: bg, borderColor: border }}
    >
      <div className="text-2xl font-bold tracking-tight" style={{ color }}>
        {value}
      </div>
      <div className="text-[9px] tracking-[0.1em] uppercase mt-0.5" style={{ color: color + '88' }}>
        {label}
      </div>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] tracking-[0.14em] uppercase text-muted/50">{children}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}
