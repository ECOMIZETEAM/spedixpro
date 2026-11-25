'use client'
// La finestra per scrivere o cambiare una voce tua: promemoria, evento o riunione.
import { useEffect, useRef, useState } from 'react'
import type { EventoMio, TipoMio, Collegamento } from './tipi'
import { AVVISI, NOME_TIPO } from './tipi'
import { componi, valoreData, valoreOra, piuGiorni, inizioGiorno } from './date'
import { salvaMio } from './deposito'
import Ic from './icone'

export type Bozza = { inizio: Date; fine?: Date | null; tuttoIlGiorno?: boolean; tipo?: TipoMio; titolo?: string; collegamento?: Collegamento | null }

const SEGNAPOSTO: Record<TipoMio, string> = {
  promemoria: 'Es. Richiamare Rossi per il listino nuovo',
  evento: 'Es. Inventario del magazzino',
  riunione: 'Es. Riunione con il referente BRT',
}

export default function FinestraEvento({ evento, bozza, onChiudi, onSalvato }: {
  evento?: EventoMio | null
  bozza?: Bozza | null
  onChiudi: () => void
  onSalvato: (e: EventoMio, nuovo: boolean) => void
}) {
  const parti = evento
    ? { inizio: new Date(evento.inizio), fine: evento.fine ? new Date(evento.fine) : null, tutto: evento.tutto_il_giorno, tipo: evento.tipo }
    : { inizio: bozza?.inizio || new Date(), fine: bozza?.fine ?? null, tutto: !!bozza?.tuttoIlGiorno, tipo: bozza?.tipo || 'promemoria' as TipoMio }
  const fineIniz = parti.fine || new Date(parti.inizio.getTime() + 60 * 60000)
  const [tipo, setTipo] = useState<TipoMio>(parti.tipo)
  const [titolo, setTitolo] = useState(evento?.titolo || bozza?.titolo || '')
  const [data, setData] = useState(valoreData(parti.inizio))
  const [oraDa, setOraDa] = useState(valoreOra(parti.inizio))
  const [oraA, setOraA] = useState(valoreOra(fineIniz))
  // per un evento di più giorni: la data dell'ultimo giorno
  const [dataA, setDataA] = useState(valoreData(parti.fine || parti.inizio))
  const [tutto, setTutto] = useState(parti.tutto)
  const [avviso, setAvviso] = useState<number | null>(evento ? evento.avviso_minuti : (parti.tipo === 'promemoria' ? 0 : 10))
  const [luogo, setLuogo] = useState(evento?.luogo || '')
  const [note, setNote] = useState(evento?.note || '')
  const [salvando, setSalvando] = useState(false)
  const [errore, setErrore] = useState('')
  const [titoloVuoto, setTitoloVuoto] = useState(false)
  const collegamento = evento?.collegamento ?? bozza?.collegamento ?? null
  const campoTitolo = useRef<HTMLInputElement>(null)

  useEffect(() => { const t = setTimeout(() => campoTitolo.current?.focus(), 60); return () => clearTimeout(t) }, [])
  useEffect(() => {
    const tasto = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onChiudi() }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); salva() }
    }
    window.addEventListener('keydown', tasto, true)
    return () => window.removeEventListener('keydown', tasto, true)
  })

  const puntuale = tipo === 'promemoria'
  async function salva() {
    if (salvando) return
    const t = titolo.trim()
    if (!t) { setTitoloVuoto(true); setErrore('Scrivi un titolo'); campoTitolo.current?.focus(); return }
    let inizio: Date, fine: Date | null
    if (tutto) {
      inizio = inizioGiorno(componi(data, '00:00'))
      const ultimo = inizioGiorno(componi(puntuale ? data : dataA, '00:00'))
      fine = ultimo > inizio ? ultimo : null
    } else {
      inizio = componi(data, oraDa)
      fine = puntuale ? null : componi(data, oraA)
      if (fine && fine <= inizio) fine = piuGiorni(fine, 1)   // 23:00 → 01:00: finisce il giorno dopo
    }
    setSalvando(true); setErrore('')
    try {
      const e = await salvaMio({
        id: evento?.id, tipo, titolo: t, inizio: inizio.toISOString(), fine: fine ? fine.toISOString() : null,
        tutto_il_giorno: tutto, luogo: puntuale ? null : (luogo.trim() || null), note: note.trim() || null,
        avviso_minuti: avviso, collegamento, fatto: evento?.fatto ?? false,
      })
      onSalvato(e, !evento)
    } catch (err: any) {
      setErrore(err?.message || 'Salvataggio non riuscito'); setSalvando(false)
    }
  }

  return (
    <>
      <div className="cal-velo" onClick={onChiudi} />
      <div className="cal-finestra" role="dialog" aria-modal="true" aria-labelledby="cal-finestra-titolo">
        <div className="cal-finestra-testa">
          <h2 id="cal-finestra-titolo">{evento ? `Modifica ${NOME_TIPO[evento.tipo].toLowerCase()}` : 'Nuova voce'}</h2>
          <button className="cal-tondo" onClick={onChiudi} aria-label="Chiudi"><Ic n="x" /></button>
        </div>
        <div className="cal-finestra-corpo">
          <div className="cal-tipi" role="group" aria-label="Tipo">
            {(['promemoria', 'evento', 'riunione'] as TipoMio[]).map(t => (
              <button key={t} className={`cal-t--${t}`} aria-pressed={tipo === t} onClick={() => setTipo(t)}><i />{NOME_TIPO[t]}</button>
            ))}
          </div>
          <label className={`cal-campo cal-titolo-campo${titoloVuoto ? ' cal-campo--errore' : ''}`}>
            <span>Titolo</span>
            <input ref={campoTitolo} value={titolo} maxLength={200} placeholder={SEGNAPOSTO[tipo]}
              onChange={e => { setTitolo(e.target.value); if (titoloVuoto) { setTitoloVuoto(false); setErrore('') } }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); salva() } }} />
          </label>
          {collegamento && (
            <div className="cal-legame" style={{ cursor: 'default' }}>
              <i><Ic n="pacco" /></i>
              <div><b>{collegamento.etichetta || 'Spedizione'}</b><span>Collegato alla spedizione: dal calendario la riapri con un clic</span></div>
            </div>
          )}
          <div className={`cal-campi${tutto && puntuale ? ' cal-campi--due' : ''}`} style={tutto && !puntuale ? { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } : undefined}>
            <label className="cal-campo"><span>{tutto && !puntuale ? 'Dal' : 'Giorno'}</span>
              <input type="date" value={data} onChange={e => { setData(e.target.value); if (dataA < e.target.value) setDataA(e.target.value) }} required />
            </label>
            {tutto && !puntuale && (
              <label className="cal-campo"><span>Al</span>
                <input type="date" value={dataA} min={data} onChange={e => setDataA(e.target.value)} />
              </label>
            )}
            {!tutto && (
              <label className="cal-campo"><span>{puntuale ? 'Alle' : 'Dalle'}</span>
                <input type="time" value={oraDa} step={300} onChange={e => {
                  // spostando l'inizio, la fine si sposta con lui (stessa durata)
                  const prima = componi(data, oraDa), dopo = componi(data, e.target.value), fine = componi(data, oraA)
                  setOraDa(e.target.value)
                  if (!puntuale && fine > prima) setOraA(valoreOra(new Date(fine.getTime() + (dopo.getTime() - prima.getTime()))))
                }} />
              </label>
            )}
            {!tutto && !puntuale && (
              <label className="cal-campo"><span>Alle</span>
                <input type="time" value={oraA} step={300} onChange={e => setOraA(e.target.value)} />
              </label>
            )}
            {tutto && puntuale && <div />}
          </div>
          <button type="button" className="cal-interruttore" role="switch" aria-checked={tutto} onClick={() => setTutto(!tutto)}>
            <i />Tutto il giorno
          </button>
          <div className="cal-campi cal-campi--due">
            <label className="cal-campo"><span>Avvisami</span>
              <select value={avviso == null ? '' : String(avviso)} onChange={e => setAvviso(e.target.value === '' ? null : Number(e.target.value))}>
                {AVVISI.map(a => <option key={String(a.v)} value={a.v == null ? '' : String(a.v)}>{a.l}</option>)}
              </select>
            </label>
            {!puntuale
              ? <label className="cal-campo"><span>Dove</span><input value={luogo} maxLength={200} placeholder={tipo === 'riunione' ? 'Ufficio, telefono, link…' : 'Facoltativo'} onChange={e => setLuogo(e.target.value)} /></label>
              : <div />}
          </div>
          <label className="cal-campo"><span>Note</span>
            <textarea value={note} maxLength={4000} placeholder="Facoltative" onChange={e => setNote(e.target.value)} />
          </label>
          {errore && <div className="cal-msg" role="alert">{errore}</div>}
        </div>
        <div className="cal-finestra-piede">
          <small>⌘ Invio per salvare</small>
          <span className="cal-spazio" />
          <button className="cal-tasto cal-tasto--chiaro" onClick={onChiudi}>Annulla</button>
          <button className="cal-tasto cal-tasto--nero" onClick={salva} disabled={salvando}>{salvando ? 'Salvo…' : 'Salva'}</button>
        </div>
      </div>
    </>
  )
}
