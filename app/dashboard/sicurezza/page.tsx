'use client'
import { useCallback, useEffect, useState } from 'react'
import { COSA_FARE_ALLARME, NOME_ALLARME } from '@/lib/allarmi-sicurezza'

// ALLARMI DI SICUREZZA (super master). Amazon chiede che ogni allarme venga esaminato con l'esito scritto
// (DPP 2.6.2) e che i registri vengano rivisti almeno ogni due settimane (2.6.1): qui si fa, e resta.
// Gli allarmi li scrive il controllo ogni 15 minuti (/api/controllo/allarmi), che manda anche l'email.

const card: React.CSSProperties = { background: '#fff', borderRadius: 8, border: '1px solid #e8e8e8', padding: 16, marginBottom: 16 }
const titolo: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: '#1a1a1a', margin: '0 0 10px' }
const piccolo: React.CSSProperties = { fontSize: 12, color: '#6b7280' }
const area: React.CSSProperties = { width: '100%', minHeight: 64, padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, color: '#1a1a1a', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#666', borderBottom: '1px solid #e8e8e8', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 12.5, color: '#1a1a1a', borderBottom: '1px solid #f0f0f0', verticalAlign: 'top' }
function bottone(attivo: boolean): React.CSSProperties {
  return { background: attivo ? '#1a1a1a' : '#e5e7eb', color: attivo ? '#fff' : '#9ca3af', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: attivo ? 'pointer' : 'not-allowed' }
}
function chip(acceso: boolean): React.CSSProperties {
  return { background: acceso ? '#1a1a1a' : '#fff', color: acceso ? '#fff' : '#555', border: '1px solid ' + (acceso ? '#1a1a1a' : '#ddd'), borderRadius: 20, padding: '5px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }
}

const MOTIVO_RIFIUTO: Record<string, string> = {
  rifiutate_chiave_sconosciuta: 'chiave inesistente',
  rifiutate_chiave_revocata: 'chiave revocata',
  rifiutate_cliente_disattivato: 'cliente disattivato',
  rifiutate_frequenza: 'limite di frequenza superato',
}

const quando = (t: string | null) => t
  ? new Date(t).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—'
const giorno = (t: string | null) => t ? new Date(t).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '—'
const num = (n: number) => Number(n || 0).toLocaleString('it-IT')

export default function AllarmiSicurezzaPage() {
  const [d, setD] = useState<any>(null)
  const [errore, setErrore] = useState('')
  const [filtro, setFiltro] = useState<'aperti' | 'tutti'>('aperti')
  const [bozze, setBozze] = useState<Record<number, string>>({})
  const [aperto, setAperto] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState('')

  const carica = useCallback(async () => {
    setErrore('')
    const r = await fetch('/api/sicurezza/allarmi').then(x => x.json().then(j => ({ ok: x.ok, j }))).catch(() => null)
    if (!r) { setErrore('Errore di rete'); return }
    if (!r.ok) { setErrore(r.j?.error || 'Errore'); return }
    setD(r.j)
  }, [])
  useEffect(() => { carica() }, [carica])

  async function invia(corpo: any): Promise<boolean> {
    setSalvando(true); setMsg('')
    const r = await fetch('/api/sicurezza/allarmi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
      .then(x => x.json().then(j => ({ ok: x.ok, j }))).catch(() => null)
    setSalvando(false)
    if (!r || !r.ok) { setMsg(r?.j?.error || 'Errore di rete'); return false }
    await carica()
    return true
  }

  if (errore) return <div style={{ padding: 24 }}><div style={{ ...card, color: '#b91c1c' }}>{errore}</div></div>
  if (!d) return <div style={{ padding: 24, ...piccolo }}>Caricamento…</div>

  const allarmi: any[] = d.allarmi || []
  const daEsaminare = allarmi.filter(a => !a.esaminato_il)
  const inizio = new Date(d.periodo.dal).getTime()
  const nelPeriodo = allarmi.filter(a => new Date(a.creato_il).getTime() >= inizio)
  const apertiNelPeriodo = nelPeriodo.filter(a => !a.esaminato_il).length
  const ultima = (d.revisioni || [])[0] || null
  const giorniDaUltima = ultima ? Math.floor((Date.now() - new Date(ultima.fatta_il).getTime()) / 86400_000) : null
  const scaduta = giorniDaUltima === null || giorniDaUltima > d.periodo.giorni
  const riep: any[] = d.riepilogo || []
  const voce = (v: string) => riep.filter(r => r.voce === v)
  const totale = (v: string) => voce(v).reduce((s, r) => s + r.n, 0)
  const rifiutate = riep.filter(r => r.voce.startsWith('rifiutate_'))
  const elenco = filtro === 'aperti' ? daEsaminare : allarmi

  const lista = (righe: any[], vuoto: string) => righe.length
    ? <ol style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#1a1a1a' }}>{righe.map((r, i) => <li key={i}>{r.chi || '—'}: <b>{num(r.n)}</b></li>)}</ol>
    : <div style={piccolo}>{vuoto}</div>

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1a1a1a', margin: '0 0 4px' }}>Allarmi di sicurezza</h1>
      <p style={{ ...piccolo, fontSize: 13, margin: '0 0 16px', maxWidth: 760, lineHeight: 1.5 }}>
        Ogni 15 minuti il sistema guarda i registri e, se vede qualcosa fuori dal normale, scrive un allarme e manda
        un'email. Amazon chiede che ogni allarme venga esaminato con l'esito scritto, e che i registri vengano rivisti
        almeno ogni {d.periodo.giorni} giorni. Qui si fa, e resta scritto.
      </p>

      <div style={card}>
        <div style={titolo}>Revisione dei registri</div>
        <div style={{ fontSize: 13, color: scaduta ? '#b91c1c' : '#1a1a1a', marginBottom: 10 }}>
          {ultima
            ? <>Ultima revisione il <b>{giorno(ultima.fatta_il)}</b> ({ultima.fatta_da}), {giorniDaUltima === 0 ? 'oggi' : `${giorniDaUltima} giorni fa`}.{scaduta ? ' Va rifatta.' : ''}</>
            : <>Nessuna revisione ancora: la prima va fatta adesso.</>}
          {' '}Periodo da rivedere: dal <b>{giorno(d.periodo.dal)}</b> a oggi.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Allarmi nel periodo</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#1a1a1a' }}>{nelPeriodo.length}</div>
            <div style={{ ...piccolo, color: apertiNelPeriodo ? '#b91c1c' : '#6b7280' }}>{apertiNelPeriodo ? `${apertiNelPeriodo} da esaminare` : 'tutti esaminati'}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Chiamate API rifiutate nel periodo</div>
            {rifiutate.length
              ? <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5 }}>{rifiutate.map(r => <li key={r.voce}>{MOTIVO_RIFIUTO[r.voce] || r.voce}: <b>{num(r.n)}</b></li>)}</ul>
              : <div style={piccolo}>{d.riepilogo ? 'nessuna' : 'riepilogo non disponibile'}</div>}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Accessi nelle ultime 24 ore</div>
            <div style={{ fontSize: 12.5, marginTop: 4 }}>riusciti: <b>{num(totale('accessi'))}</b> · password sbagliate: <b>{num(totale('accessi_falliti'))}</b></div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Chi ha letto più dati (24 ore)</div>
            {lista(voce('letture'), 'nessuno')}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>«Entra come» per persona (24 ore)</div>
            {lista(voce('entra_come'), 'nessuno')}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Letture dalle API per cliente (24 ore)</div>
            {lista(voce('api'), 'nessuna')}
          </div>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 4 }}>Cosa hai guardato</div>
        <textarea style={area} value={note} onChange={e => setNote(e.target.value)}
          placeholder="Es.: allarmi del periodo esaminati; volumi di lettura nella norma; nessun «entra come» strano." />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <button style={bottone(!salvando && apertiNelPeriodo === 0 && note.trim().length >= 3)}
            disabled={salvando || apertiNelPeriodo > 0 || note.trim().length < 3}
            onClick={async () => { if (await invia({ azione: 'revisione', note })) setNote('') }}>
            Revisione fatta
          </button>
          {apertiNelPeriodo > 0 && <span style={{ ...piccolo, color: '#b91c1c' }}>Prima scrivi l'esito degli allarmi del periodo, qui sotto.</span>}
          {msg && <span style={{ ...piccolo, color: '#b91c1c' }}>{msg}</span>}
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ ...titolo, margin: 0, marginRight: 8 }}>Allarmi</div>
          <button style={chip(filtro === 'aperti')} onClick={() => setFiltro('aperti')}>Da esaminare ({daEsaminare.length})</button>
          <button style={chip(filtro === 'tutti')} onClick={() => setFiltro('tutti')}>Tutti ({allarmi.length})</button>
        </div>
        {!elenco.length && <div style={piccolo}>{filtro === 'aperti' ? 'Nessun allarme da esaminare.' : 'Nessun allarme finora.'}</div>}
        {elenco.map(a => (
          <div key={a.id} style={{ border: '1px solid ' + (a.esaminato_il ? '#e5e7eb' : '#fecaca'), background: a.esaminato_il ? '#fff' : '#fff7f7', borderRadius: 8, padding: '12px 14px', marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: a.esaminato_il ? '#1a1a1a' : '#b91c1c' }}>{NOME_ALLARME[a.tipo] || a.tipo}</div>
              <div style={piccolo}>{quando(a.creato_il)}{a.inviato_il ? '' : ' · email non ancora partita'}</div>
            </div>
            <div style={{ fontSize: 13, color: '#1a1a1a', margin: '4px 0' }}>{a.descrizione}</div>
            {a.chi && <div style={piccolo}>{a.chi}</div>}
            <div style={{ fontSize: 12.5, color: '#374151', margin: '6px 0 8px', lineHeight: 1.5 }}>{COSA_FARE_ALLARME[a.tipo] || 'Va guardato.'}</div>
            {a.esaminato_il && aperto !== a.id ? (
              <div style={{ fontSize: 12.5, background: '#f9fafb', borderRadius: 6, padding: '8px 10px' }}>
                <div><b>Esito:</b> {a.esito}</div>
                <div style={{ ...piccolo, marginTop: 2 }}>{a.esaminato_da || '—'}, {quando(a.esaminato_il)} · <span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => { setAperto(a.id); setBozze(b => ({ ...b, [a.id]: a.esito || '' })) }}>modifica</span></div>
              </div>
            ) : (
              <div>
                <textarea style={area} value={bozze[a.id] ?? ''} onChange={e => setBozze(b => ({ ...b, [a.id]: e.target.value }))}
                  placeholder="Cosa hai verificato e cosa hai fatto. Es.: sentito il cliente, era lui che cambiava gestionale; nessuna azione." />
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button style={bottone(!salvando && (bozze[a.id] || '').trim().length >= 3)}
                    disabled={salvando || (bozze[a.id] || '').trim().length < 3}
                    onClick={async () => { if (await invia({ azione: 'esito', id: a.id, esito: bozze[a.id] })) setAperto(null) }}>
                    Salva esito
                  </button>
                  {aperto === a.id && <button style={chip(false)} onClick={() => setAperto(null)}>Annulla</button>}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={titolo}>Revisioni fatte</div>
        {!(d.revisioni || []).length ? <div style={piccolo}>Nessuna revisione ancora.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Fatta il</th><th style={th}>Da</th><th style={th}>Periodo</th><th style={th}>Allarmi</th><th style={th}>Note</th></tr></thead>
              <tbody>
                {(d.revisioni || []).map((r: any) => (
                  <tr key={r.id}>
                    <td style={td}>{quando(r.fatta_il)}</td>
                    <td style={td}>{r.fatta_da}</td>
                    <td style={td}>{giorno(r.dal)} – {giorno(r.al)}</td>
                    <td style={td}>{r.allarmi}</td>
                    <td style={{ ...td, whiteSpace: 'pre-wrap' }}>{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
