'use client'
// La tendina da destra (dal basso sul telefono) con il dettaglio di una voce: la tua, un ritiro, una giacenza, o il
// gruppo di un giorno affollato («43 ritiri»).
import { useEffect, useState } from 'react'
import type { Voce, RitiroCal, GiacenzaCal } from './tipi'
import { NOME_TIPO, STATO_RITIRO, STATO_RITIRO_PLURALE, ORDINE_STATO_RITIRO, RITIRO_CHIUSO, RITIRO_FALLITO, AVVISI } from './tipi'
import { dataLunga, ora, stessoGiorno, inizioGiorno, daChiave } from './date'
import Ic from './icone'

function quando(v: Voce): string {
  if (v.tuttoIlGiorno) {
    const ultimo = v.fine ? inizioGiorno(v.fine) : null
    return ultimo && ultimo > inizioGiorno(v.inizio) ? `dal ${dataLunga(v.inizio)} al ${dataLunga(ultimo)}` : `${dataLunga(v.inizio)}, tutto il giorno`
  }
  if (!v.fine) return `${dataLunga(v.inizio)} alle ${ora(v.inizio)}`
  if (stessoGiorno(v.inizio, v.fine)) return `${dataLunga(v.inizio)}, ${ora(v.inizio)} – ${ora(v.fine)}`
  return `${dataLunga(v.inizio)} ${ora(v.inizio)} – ${dataLunga(v.fine)} ${ora(v.fine)}`
}

function classeStato(stato: string) {
  if (RITIRO_CHIUSO.has(stato)) return 'cal-chip cal-chip--bene'
  if (RITIRO_FALLITO.has(stato)) return 'cal-chip cal-chip--male'
  if (stato === 'richiesto' || stato === 'rimandato') return 'cal-chip cal-chip--attesa'
  return 'cal-chip cal-chip--neutro'
}

const giorniDa = (giorno: string) => Math.max(0, Math.round((inizioGiorno(new Date()).getTime() - daChiave(giorno).getTime()) / 86400000))
const daQuanto = (giorno: string) => { const n = giorniDa(giorno); return n === 0 ? 'entrata oggi' : n === 1 ? 'da 1 giorno' : `da ${n} giorni` }

export default function SchedaVoce({ voce, cliente, onChiudi, onModifica, onElimina, onFatto, onApriSpedizione }: {
  voce: Voce
  cliente: boolean
  onChiudi: () => void
  onModifica: () => void
  onElimina: () => Promise<void>
  onFatto: (fatto: boolean) => Promise<void>
  onApriSpedizione: (id: string) => void
}) {
  const [conferma, setConferma] = useState(false)
  const [occupato, setOccupato] = useState(false)
  const [errore, setErrore] = useState('')
  useEffect(() => {
    const tasto = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onChiudi() } }
    window.addEventListener('keydown', tasto, true)
    return () => window.removeEventListener('keydown', tasto, true)
  }, [onChiudi])
  useEffect(() => { setConferma(false); setErrore('') }, [voce.chiave])

  const m = voce.mio
  // nel gruppo prima quelli ancora da fare, poi quelli andati male, in fondo quelli fatti; a parità, per mittente
  const ritiri = [...(voce.ritiri || [])].sort((a, b) => (ORDINE_STATO_RITIRO[a.stato] ?? 9) - (ORDINE_STATO_RITIRO[b.stato] ?? 9) || String(a.mittente || a.cliente || '').localeCompare(String(b.mittente || b.cliente || '')))
  const giacenze = voce.giacenze || []
  const gruppo = ritiri.length > 1 || giacenze.length > 1
  const hrefRitiri = cliente ? '/cliente/ritiri' : '/dashboard/ritiri/elenco'
  const hrefGiacenze = cliente ? '/cliente/spedizioni/giacenze' : '/dashboard/spedizioni/giacenze'

  async function fai(f: () => Promise<void>) {
    setOccupato(true); setErrore('')
    try { await f() } catch (e: any) { setErrore(e?.message || 'Operazione non riuscita') } finally { setOccupato(false) }
  }

  // le somme di un gruppo di ritiri per stato: «30 confermati · 12 richiesti · 1 annullato»
  const perStato = new Map<string, number>()
  for (const r of ritiri) perStato.set(r.stato, (perStato.get(r.stato) || 0) + 1)
  const colliTot = ritiri.reduce((t, r) => t + (r.colli || 0), 0)

  return (
    <>
      <div className="cal-velo" onClick={onChiudi} />
      <aside className={`cal-foglio cal-t--${voce.tipo}`} role="dialog" aria-modal="true" aria-labelledby="cal-foglio-titolo">
        <div className="cal-foglio-testa">
          <div style={{ minWidth: 0 }}>
            <span className="cal-chip"><i style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--colore)' }} />{gruppo ? (voce.tipo === 'ritiro' ? 'Ritiri del giorno' : 'Giacenze del giorno') : NOME_TIPO[voce.tipo]}</span>
            <h2 id="cal-foglio-titolo">{voce.titolo}</h2>
          </div>
          <button className="cal-tondo" onClick={onChiudi} aria-label="Chiudi"><Ic n="x" /></button>
        </div>

        <div className="cal-foglio-corpo">
          <div className="cal-dati">
            <div className="cal-dato"><Ic n="calendario" /><div>{quando(voce)}{voce.tipo === 'giacenza' && giacenze.length === 1 && <small>In giacenza {daQuanto(giacenze[0].giorno)}</small>}</div></div>

            {m && m.avviso_minuti != null && (
              <div className="cal-dato"><Ic n="campanella" /><div>{AVVISI.find(a => a.v === m.avviso_minuti)?.l || `${m.avviso_minuti} minuti prima`}<small>{m.tutto_il_giorno ? 'alle 9, ' : ''}nella campanella e per email</small></div></div>
            )}
            {m?.luogo && <div className="cal-dato"><Ic n="luogo" /><div>{m.luogo}</div></div>}
            {m?.note && <div className="cal-dato"><Ic n="note" /><p>{m.note}</p></div>}
            {m?.fatto && <div className="cal-dato"><Ic n="spunta" /><div>Fatto</div></div>}

            {ritiri.length === 1 && <DettaglioRitiro r={ritiri[0]} cliente={cliente} />}
            {giacenze.length === 1 && <DettaglioGiacenza g={giacenze[0]} cliente={cliente} />}
          </div>

          {m?.collegamento && (
            <button className="cal-legame" onClick={() => onApriSpedizione(m.collegamento!.id)}>
              <i><Ic n="pacco" /></i>
              <div><b>{m.collegamento.etichetta || 'Spedizione'}</b><span>Apri la spedizione</span></div>
              <Ic n="destra" />
            </button>
          )}
          {giacenze.length === 1 && (
            <button className="cal-legame" onClick={() => onApriSpedizione(giacenze[0].id)}>
              <i><Ic n="pacco" /></i>
              <div><b>{giacenze[0].numero || 'Spedizione'}</b><span>Apri la spedizione</span></div>
              <Ic n="destra" />
            </button>
          )}

          {gruppo && ritiri.length > 1 && (
            <>
              <div className="cal-somme">
                {[...perStato.entries()].sort((a, b) => (ORDINE_STATO_RITIRO[a[0]] ?? 9) - (ORDINE_STATO_RITIRO[b[0]] ?? 9)).map(([s, n]) => <span key={s} className={classeStato(s)}>{n} {n === 1 ? (STATO_RITIRO[s] || s).toLowerCase() : (STATO_RITIRO_PLURALE[s] || s)}</span>)}
                <span className="cal-chip cal-chip--neutro">{colliTot} colli</span>
              </div>
              <div className="cal-gruppo-righe">
                {ritiri.map(r => (
                  <div key={r.id} className="cal-gruppo-riga">
                    <b>{cliente ? (r.contratto || 'Ritiro') : (r.mittente || r.cliente || 'Ritiro')}</b>
                    <span className={classeStato(r.stato)}>{STATO_RITIRO[r.stato] || r.stato}</span>
                    <small>{[r.citta && `${r.citta}${r.provincia ? ` (${r.provincia})` : ''}`, !cliente && r.contratto, r.colli != null && `${r.colli} ${r.colli === 1 ? 'collo' : 'colli'}`, r.codice && `cod. ${r.codice}`].filter(Boolean).join(' · ')}</small>
                  </div>
                ))}
              </div>
            </>
          )}
          {gruppo && giacenze.length > 1 && (
            <div className="cal-gruppo-righe">
              {giacenze.map(g => (
                <button key={g.id} className="cal-gruppo-riga" style={{ width: '100%', textAlign: 'left' }} onClick={() => onApriSpedizione(g.id)}>
                  <b>{g.destinatario || g.numero || 'Spedizione'}</b>
                  <span className="cal-chip cal-chip--male">{daQuanto(g.giorno)}</span>
                  <small>{[g.numero, g.citta && `${g.citta}${g.provincia ? ` (${g.provincia})` : ''}`, g.motivo, !cliente && g.cliente].filter(Boolean).join(' · ')}</small>
                </button>
              ))}
            </div>
          )}
          {errore && <div className="cal-msg" role="alert">{errore}</div>}
        </div>

        <div className="cal-foglio-piede">
          {m && !conferma && (
            <>
              {m.tipo === 'promemoria' && (
                <button className="cal-tasto cal-tasto--nero" disabled={occupato} onClick={() => fai(() => onFatto(!m.fatto))}>
                  <Ic n="spunta" />{m.fatto ? 'Da rifare' : 'Fatto'}
                </button>
              )}
              <button className="cal-tasto cal-tasto--chiaro" onClick={onModifica}><Ic n="matita" />Modifica</button>
              <button className="cal-tasto cal-tasto--rosso" onClick={() => setConferma(true)} aria-label="Elimina"><Ic n="cestino" />Elimina</button>
            </>
          )}
          {m && conferma && (
            <>
              <span style={{ flexBasis: '100%', fontSize: 13 }}>Eliminare «{m.titolo}»?</span>
              <button className="cal-tasto cal-tasto--chiaro" onClick={() => setConferma(false)}>No, tienila</button>
              <button className="cal-tasto cal-tasto--rosso" disabled={occupato} onClick={() => fai(onElimina)}>Sì, elimina</button>
            </>
          )}
          {voce.tipo === 'ritiro' && <a className="cal-tasto cal-tasto--chiaro" href={hrefRitiri}><Ic n="esterno" />Elenco ritiri</a>}
          {voce.tipo === 'giacenza' && <a className="cal-tasto cal-tasto--nero" href={hrefGiacenze}><Ic n="esterno" />Gestisci le giacenze</a>}
        </div>
      </aside>
    </>
  )
}

function DettaglioRitiro({ r, cliente }: { r: RitiroCal; cliente: boolean }) {
  return (
    <>
      <div className="cal-dato"><Ic n="bandiera" /><div><span className={classeStato(r.stato)}>{STATO_RITIRO[r.stato] || r.stato}</span></div></div>
      {(r.mittente || r.citta) && <div className="cal-dato"><Ic n="luogo" /><div>{r.mittente || '—'}<small>{[r.citta, r.provincia && `(${r.provincia})`].filter(Boolean).join(' ')}</small></div></div>}
      {!cliente && r.cliente && <div className="cal-dato"><Ic n="persona" /><div>{r.cliente}<small>cliente</small></div></div>}
      <div className="cal-dato"><Ic n="furgone" /><div>{r.contratto || 'Corriere'}<small>{[r.colli != null && `${r.colli} ${r.colli === 1 ? 'collo' : 'colli'}`, r.peso != null && `${String(r.peso).replace('.', ',')} kg`, r.codice && `codice ritiro ${r.codice}`].filter(Boolean).join(' · ') || '—'}</small></div></div>
    </>
  )
}

function DettaglioGiacenza({ g, cliente }: { g: GiacenzaCal; cliente: boolean }) {
  return (
    <>
      {g.motivo && <div className="cal-dato"><Ic n="info" /><div>{g.motivo}<small>motivo della giacenza</small></div></div>}
      <div className="cal-dato"><Ic n="luogo" /><div>{g.destinatario || '—'}<small>{[g.citta, g.provincia && `(${g.provincia})`].filter(Boolean).join(' ')}</small></div></div>
      {!cliente && g.cliente && <div className="cal-dato"><Ic n="persona" /><div>{g.cliente}<small>cliente</small></div></div>}
      <div className="cal-dato"><Ic n="furgone" /><div>{g.contratto || 'Corriere'}<small>{g.numero || ''}</small></div></div>
    </>
  )
}
