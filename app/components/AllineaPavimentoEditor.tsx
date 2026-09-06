'use client'
import { useEffect, useState } from 'react'
import { useDialog } from '@/app/components/DialogProvider'

// Riquadro "Allinea al minimo" DENTRO l'editor del listino: compare solo se QUESTO listino+corriere
// ha fasce sotto il prezzo minimo del contratto (pavimento). Stessa funzione della pagina dedicata,
// ma scoped al corriere aperto. Inerte finché il pavimento è dormiente (l'endpoint torna vuoto).
export default function AllineaPavimentoEditor({ listinoId, corriereNome }: { listinoId: string; corriereNome: string }) {
  const dialog = useDialog()
  const [fasce, setFasce] = useState<{ peso_max: number; prezzo: number; pavimento: number }[]>([])
  const [base, setBase] = useState<'pavimento' | 'attuale'>('pavimento')
  const [margineTipo, setMargineTipo] = useState<'fisso' | 'perc'>('perc')
  const [margineValore, setMargineValore] = useState('0')
  const [salvando, setSalvando] = useState(false)

  const carica = () => {
    fetch('/api/network/pavimento-da-adeguare').then(r => r.ok ? r.json() : null).then(j => {
      const g = (j?.gruppi || []).find((x: any) => x.listino_id === listinoId && x.corriere_nome === corriereNome)
      setFasce(g?.fasce || [])
    }).catch(() => {})
  }
  useEffect(() => { carica() }, [listinoId, corriereNome])
  if (!fasce.length) return null

  const eur = (n: number) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
  const mv = Math.max(0, parseFloat(margineValore.replace(',', '.')) || 0)
  const radio = (attivo: boolean) => ({ padding: '6px 12px', borderRadius: '7px', border: '1px solid ' + (attivo ? '#f97316' : '#d1d5db'), background: attivo ? '#fff7ed' : '#fff', color: attivo ? '#9a3412' : '#374151', fontWeight: attivo ? 700 : 500, cursor: 'pointer', fontSize: '12px' } as const)

  async function allinea() {
    if (!await dialog.confirm({ title: 'Allinea al minimo', message: `${fasce.length} fasce di ${corriereNome} sono sotto il minimo. ${base === 'pavimento' ? 'Le porto al minimo' : 'Parto dal prezzo attuale'} e aggiungo ${margineTipo === 'perc' ? mv + '%' : eur(mv)}. Solo aumenti. Procedo?`, confirmText: 'Allinea' })) return
    setSalvando(true)
    try {
      const r = await fetch('/api/network/pavimento-allinea', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listinoId, corriereNome, base, margineTipo, margineValore: mv }),
      })
      const j = await r.json()
      if (j?.success) { await dialog.alert({ title: 'Fatto', message: `${j.aggiornate} fasce aggiornate.` }); window.location.reload() }
      else await dialog.alert({ title: 'Errore', message: j?.error || 'Allineamento non riuscito.' })
    } finally { setSalvando(false) }
  }

  return (
    <div style={{ background: '#fff7ed', border: '1px solid #fdba74', borderRadius: '10px', padding: '14px 16px', marginBottom: '14px' }}>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#9a3412', marginBottom: '4px' }}>⚠️ {fasce.length} {fasce.length === 1 ? 'fascia' : 'fasce'} sotto il prezzo minimo del contratto</div>
      <div style={{ fontSize: '12px', color: '#7c2d12', marginBottom: '10px' }}>
        Su queste fasce il cliente non vede il prezzo e non può spedire. Fasce: {fasce.map(f => `${f.peso_max}kg (${eur(f.prezzo)}→min ${eur(f.pavimento)})`).join(', ')}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button style={radio(base === 'pavimento')} onClick={() => setBase('pavimento')}>Dal minimo</button>
          <button style={radio(base === 'attuale')} onClick={() => setBase('attuale')}>Dal prezzo attuale</button>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button style={radio(margineTipo === 'perc')} onClick={() => setMargineTipo('perc')}>%</button>
          <button style={radio(margineTipo === 'fisso')} onClick={() => setMargineTipo('fisso')}>€ fisso</button>
          <input value={margineValore} onChange={e => setMargineValore(e.target.value)} inputMode="decimal"
            style={{ width: '72px', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '7px', fontSize: '12px', color: '#1a1a1a' }} />
        </div>
        <button disabled={salvando} onClick={allinea}
          style={{ padding: '8px 18px', background: '#f97316', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 700, cursor: salvando ? 'default' : 'pointer', opacity: salvando ? 0.6 : 1 }}>
          {salvando ? 'Allineo…' : 'Allinea al minimo'}
        </button>
      </div>
    </div>
  )
}
