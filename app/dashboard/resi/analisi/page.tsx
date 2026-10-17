'use client'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BadgeResi, LegendaResi, PctRete } from '@/app/components/ResiPercentuale'
import { COLORI_RESI, RESI_PERIODI, type PeriodoResi } from '@/lib/resi-percentuale'

// ANALISI RESI (richiesta di Lorenzo, 17/10/2026): la percentuale di resi di ogni cliente della rete, per
// accorgersi per tempo di chi truffa o sta per fallire. Clienti diretti e sotto-master, che si aprono sui
// propri clienti e sotto-master; un sotto-master porta il totale della sua rete e quanti clienti colorati
// ha dentro. Periodo a scelta: le spedizioni create negli ultimi 30, 90 o 180 giorni (i resi rientrano
// anche dopo un mese: a 30 giorni la percentuale e' piu' bassa del vero).

type Nodo = {
  tipo: 'cliente' | 'master'; id: string; nome: string; partite: number; resi: number; pct: number
  livello: 'pochi' | 'ok' | 'giallo' | 'arancione' | 'rosso'
  allarmi: { giallo: number; arancione: number; rosso: number }; figli?: Nodo[]
}

const IN_ALLARME = (n: Nodo) => n.tipo === 'cliente'
  ? (n.livello === 'giallo' || n.livello === 'arancione' || n.livello === 'rosso')
  : (n.allarmi.giallo + n.allarmi.arancione + n.allarmi.rosso) > 0

export default function AnalisiResiPage() {
  const [giorni, setGiorni] = useState<PeriodoResi>(90)
  const [dati, setDati] = useState<any>(null)
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState('')
  const [aperti, setAperti] = useState<Set<string>>(new Set())
  const [cerca, setCerca] = useState('')
  const [soloAllarme, setSoloAllarme] = useState(false)

  useEffect(() => {
    let vivo = true
    setCaricamento(true); setErrore('')
    fetch(`/api/resi/analisi?giorni=${giorni}`, { cache: 'no-store' }).then(r => r.json()).then(d => {
      if (!vivo) return
      if (d?.error) setErrore(d.error); else setDati(d)
      setCaricamento(false)
    }).catch(() => { if (vivo) { setErrore('Connessione non riuscita'); setCaricamento(false) } })
    return () => { vivo = false }
  }, [giorni])

  // Filtro: un nodo resta se corrisponde lui o qualcuno sotto di lui; con un filtro attivo i rami che
  // portano a un risultato si aprono da soli.
  const testo = cerca.trim().toLowerCase()
  const filtrati: Nodo[] = useMemo(() => {
    const filtra = (nn: Nodo[]): Nodo[] => nn.flatMap(n => {
      const figli = n.figli ? filtra(n.figli) : undefined
      const corrispondeTesto = !testo || n.nome.toLowerCase().includes(testo)
      const corrispondeAllarme = !soloAllarme || (n.tipo === 'cliente' ? IN_ALLARME(n) : false)
      if (n.tipo === 'cliente') return corrispondeTesto && corrispondeAllarme ? [n] : []
      if (figli && figli.length) return [{ ...n, figli }]
      return corrispondeTesto && !soloAllarme ? [{ ...n, figli: testo ? n.figli : figli }] : []
    })
    return filtra(dati?.nodi || [])
  }, [dati, testo, soloAllarme])
  const filtroAttivo = !!testo || soloAllarme

  const card = { background: '#fff', borderRadius: '10px', border: '1px solid #e5e7eb', marginBottom: '14px' }
  const contatore = (livello: 'rosso' | 'arancione' | 'giallo', n: number, etichetta: string) => (
    <div style={{ flex: '1 1 110px', background: COLORI_RESI[livello].bg, border: `1px solid ${COLORI_RESI[livello].bd}`, borderRadius: '10px', padding: '10px 12px' }}>
      <div style={{ fontSize: '24px', fontWeight: 800, color: COLORI_RESI[livello].fg, lineHeight: 1 }}>{n}</div>
      <div style={{ fontSize: '12px', fontWeight: 600, color: COLORI_RESI[livello].fg, marginTop: '4px' }}>{etichetta}</div>
    </div>
  )

  const riga = (n: Nodo, livello: number): ReactNode => {
    const aperto = filtroAttivo || aperti.has(n.id)
    const haFigli = n.tipo === 'master' && !!n.figli?.length
    return (
      <div key={n.tipo + n.id}>
        <div
          onClick={() => haFigli && !filtroAttivo && setAperti(prev => { const x = new Set(prev); x.has(n.id) ? x.delete(n.id) : x.add(n.id); return x })}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: `10px 14px 10px ${14 + livello * 22}px`, borderTop: '1px solid #f3f4f6', cursor: haFigli && !filtroAttivo ? 'pointer' : 'default', background: n.tipo === 'master' ? '#fafafa' : '#fff' }}>
          <span style={{ width: '16px', flexShrink: 0, color: '#1a1a1a', fontSize: '15px', fontWeight: 700, lineHeight: 1 }}>{haFigli ? (aperto ? '▾' : '▸') : ''}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
              {n.tipo === 'master' && <span style={{ background: '#1a1a1a', color: '#fff', padding: '1px 6px', borderRadius: '4px', fontSize: '9.5px', fontWeight: 700, letterSpacing: '0.5px' }}>SOTTO-MASTER</span>}
              <span style={{ fontSize: '13.5px', fontWeight: n.tipo === 'master' ? 700 : 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.nome}</span>
              {n.tipo === 'master' && (['rosso', 'arancione', 'giallo'] as const).filter(l => n.allarmi[l] > 0).map(l => (
                <span key={l} title={`${n.allarmi[l]} clienti ${l === 'rosso' ? 'oltre il 20%' : l === 'arancione' ? 'tra il 10 e il 20%' : 'tra l’8 e il 10%'}`}
                  style={{ fontSize: '11px', fontWeight: 700, color: COLORI_RESI[l].fg, background: COLORI_RESI[l].bg, border: `1px solid ${COLORI_RESI[l].bd}`, borderRadius: '999px', padding: '0 7px' }}>
                  {n.allarmi[l]}
                </span>
              ))}
            </div>
            <div style={{ fontSize: '11.5px', color: '#6b7280', marginTop: '2px' }}>
              {n.resi.toLocaleString('it-IT')} resi su {n.partite.toLocaleString('it-IT')} spedizioni{n.tipo === 'master' ? ' · totale della sua rete' : ''}
            </div>
          </div>
          {n.tipo === 'master' ? <PctRete pct={n.pct} /> : <BadgeResi pct={n.pct} livello={n.livello} />}
        </div>
        {haFigli && aperto && n.figli!.map(f => riga(f, livello + 1))}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '980px' }}>
      <div style={{ marginBottom: '14px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Analisi resi</h1>
        <p style={{ color: '#4b5563', fontSize: '13px', margin: '4px 0 0' }}>
          La percentuale di resi di ogni cliente della tua rete, sulle spedizioni create nel periodo. Un cliente con troppi resi va guardato da vicino: può essere un problema di merce, di destinatari o di affidabilità.
        </p>
      </div>

      <div style={{ ...card, padding: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            {RESI_PERIODI.map(g => (
              <button key={g} onClick={() => setGiorni(g)}
                style={{ padding: '8px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', border: `1px solid ${giorni === g ? '#1a1a1a' : '#d1d5db'}`, background: giorni === g ? '#1a1a1a' : '#fff', color: giorni === g ? '#fff' : '#1a1a1a' }}>
                {g} giorni
              </button>
            ))}
          </div>
          <LegendaResi />
        </div>
        {giorni === 30 && <div style={{ fontSize: '11.5px', color: '#92400e', marginTop: '8px' }}>A 30 giorni molti resi non sono ancora rientrati: la percentuale è più bassa del vero.</div>}
        {dati && !caricamento && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '14px' }}>
            <div style={{ flex: '1 1 160px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '24px', fontWeight: 800, color: '#1a1a1a', lineHeight: 1 }}>{String(dati.totale.pct).replace('.', ',')}%</span>
              </div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>tutta la rete · {dati.totale.resi.toLocaleString('it-IT')} resi su {dati.totale.partite.toLocaleString('it-IT')}</div>
            </div>
            {contatore('rosso', dati.allarmi.rosso, 'clienti oltre il 20%')}
            {contatore('arancione', dati.allarmi.arancione, 'clienti tra 10 e 20%')}
            {contatore('giallo', dati.allarmi.giallo, 'clienti tra 8 e 10%')}
          </div>
        )}
      </div>

      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', padding: '12px 14px' }}>
          <input value={cerca} onChange={e => setCerca(e.target.value)} placeholder="Cerca cliente o sotto-master"
            style={{ flex: '1 1 220px', minWidth: 0, padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', color: '#1a1a1a', background: '#fff' }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', color: '#1a1a1a', cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={soloAllarme} onChange={e => setSoloAllarme(e.target.checked)} />
            Solo clienti oltre soglia
          </label>
        </div>
        {caricamento ? (
          <div style={{ padding: '30px', textAlign: 'center', color: '#6b7280', fontSize: '13px', borderTop: '1px solid #f3f4f6' }}>Calcolo in corso…</div>
        ) : errore ? (
          <div style={{ padding: '30px', textAlign: 'center', color: '#dc2626', fontSize: '13px', borderTop: '1px solid #f3f4f6' }}>{errore}</div>
        ) : !filtrati.length ? (
          <div style={{ padding: '30px', textAlign: 'center', color: '#6b7280', fontSize: '13px', borderTop: '1px solid #f3f4f6' }}>
            {filtroAttivo ? 'Nessun risultato con questi filtri.' : 'Nessuna spedizione partita nel periodo.'}
          </div>
        ) : filtrati.map(n => riga(n, 0))}
      </div>
    </div>
  )
}
