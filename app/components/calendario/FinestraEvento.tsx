'use client'
// La finestra per scrivere o cambiare una voce tua: promemoria, evento o riunione. Fase 2: «Si ripete» e, per lo staff
// del master, «Invita» (staff, agenti e clienti dello stesso master).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { EventoMio, TipoMio, Collegamento, Ricorrenza, StatoInvito } from './tipi'
import { AVVISI, NOME_TIPO } from './tipi'
import { componi, valoreData, valoreOra, piuGiorni, inizioGiorno, giornoSettimana, GIORNI, MESI } from './date'
import { salvaMio, cercaPersone, type Persona } from './deposito'
import { descriviRicorrenza } from '@/lib/calendario-ricorrenza'
import Ic from './icone'

export type Bozza = { inizio: Date; fine?: Date | null; tuttoIlGiorno?: boolean; tipo?: TipoMio; titolo?: string; collegamento?: Collegamento | null }

const SEGNAPOSTO: Record<TipoMio, string> = {
  promemoria: 'Es. Richiamare Rossi per il listino nuovo',
  evento: 'Es. Inventario del magazzino',
  riunione: 'Es. Riunione con il referente BRT',
}
type Ripeti = 'no' | 'giorno' | 'settimana' | 'feriali' | 'mese' | 'anno' | 'personalizza'
const LETTERE = ['L', 'M', 'M', 'G', 'V', 'S', 'D']
const NOME_RUOLO: Record<string, string> = { master: 'titolare', admin: 'admin', operatore: 'operatore', agente: 'agente', cliente: 'cliente' }
const NOME_STATO: Record<StatoInvito, string> = { in_attesa: 'in attesa', accettato: 'partecipa', rifiutato: 'non partecipa' }

// la ricorrenza salvata → la scelta della tendina (le forme semplici hanno il loro nome, il resto è «personalizza»)
function scelta(r: Ricorrenza | null | undefined, giornoInizio: number): Ripeti {
  if (!r) return 'no'
  const semplice = r.ogni === 1
  if (r.freq === 'giorno' && semplice) return 'giorno'
  if (r.freq === 'settimana' && semplice && r.giorni?.length === 1 && r.giorni[0] === giornoInizio) return 'settimana'
  if (r.freq === 'settimana' && semplice && r.giorni?.length === 5 && [0, 1, 2, 3, 4].every((g) => r.giorni!.includes(g))) return 'feriali'
  if (r.freq === 'mese' && semplice) return 'mese'
  if (r.freq === 'anno' && semplice) return 'anno'
  return 'personalizza'
}

export default function FinestraEvento({ evento, bozza, puoInvitare, onChiudi, onSalvato }: {
  evento?: EventoMio | null
  bozza?: Bozza | null
  puoInvitare: boolean
  onChiudi: () => void
  onSalvato: (e: EventoMio, nuovo: boolean) => void
}) {
  // di una voce che si ripete si modifica la SERIE: si parte dall'inizio della serie, non dall'occorrenza aperta
  const parti = evento
    ? {
        inizio: new Date(evento.serie_inizio || evento.inizio),
        fine: (evento.serie_fine !== undefined ? evento.serie_fine : evento.fine) ? new Date((evento.serie_fine !== undefined ? evento.serie_fine : evento.fine)!) : null,
        tutto: evento.tutto_il_giorno, tipo: evento.tipo,
      }
    : { inizio: bozza?.inizio || new Date(), fine: bozza?.fine ?? null, tutto: !!bozza?.tuttoIlGiorno, tipo: bozza?.tipo || 'promemoria' as TipoMio }
  const fineIniz = parti.fine || new Date(parti.inizio.getTime() + 60 * 60000)
  const [tipo, setTipo] = useState<TipoMio>(parti.tipo)
  const [titolo, setTitolo] = useState(evento?.titolo || bozza?.titolo || '')
  const [data, setData] = useState(valoreData(parti.inizio))
  const [oraDa, setOraDa] = useState(valoreOra(parti.inizio))
  const [oraA, setOraA] = useState(valoreOra(fineIniz))
  const [dataA, setDataA] = useState(valoreData(parti.fine || parti.inizio))
  const [tutto, setTutto] = useState(parti.tutto)
  const [avviso, setAvviso] = useState<number | null>(evento ? evento.avviso_minuti : (parti.tipo === 'promemoria' ? 0 : 10))
  const [luogo, setLuogo] = useState(evento?.luogo || '')
  const [note, setNote] = useState(evento?.note || '')
  // ── si ripete ──
  const giornoInizio = giornoSettimana(componi(data, '12:00'))
  const [ripeti, setRipeti] = useState<Ripeti>(scelta(evento?.ricorrenza, giornoSettimana(parti.inizio)))
  const [freq, setFreq] = useState<Ricorrenza['freq']>(evento?.ricorrenza?.freq || 'settimana')
  const [ogni, setOgni] = useState(String(evento?.ricorrenza?.ogni || 1))
  const [giorni, setGiorni] = useState<number[]>(evento?.ricorrenza?.giorni?.length ? evento.ricorrenza.giorni : [giornoSettimana(parti.inizio)])
  const [fineTipo, setFineTipo] = useState<'mai' | 'data' | 'volte'>(evento?.ricorrenza?.fino ? 'data' : evento?.ricorrenza?.volte ? 'volte' : 'mai')
  const [fino, setFino] = useState(evento?.ricorrenza?.fino || valoreData(piuGiorni(parti.inizio, 90)))
  const [volte, setVolte] = useState(String(evento?.ricorrenza?.volte || 10))
  // ── invitati ──
  const [scelti, setScelti] = useState<{ id: string; nome: string; ruolo: string; stato?: StatoInvito }[]>(
    (evento?.invitati || []).map((i) => ({ id: i.utente_id, nome: i.nome, ruolo: i.ruolo, stato: i.stato })))
  const [cerca, setCerca] = useState('')
  const [trovati, setTrovati] = useState<Persona[] | null>(null)
  const [cercando, setCercando] = useState(false)
  const [elencoAperto, setElencoAperto] = useState(false)

  const [salvando, setSalvando] = useState(false)
  const [errore, setErrore] = useState('')
  const [titoloVuoto, setTitoloVuoto] = useState(false)
  const collegamento = evento?.collegamento ?? bozza?.collegamento ?? null
  const campoTitolo = useRef<HTMLInputElement>(null)
  const serie = !!evento?.ricorrenza

  useEffect(() => { const t = setTimeout(() => campoTitolo.current?.focus(), 60); return () => clearTimeout(t) }, [])
  useEffect(() => {
    const tasto = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); if (elencoAperto) setElencoAperto(false); else onChiudi() }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); salva() }
    }
    window.addEventListener('keydown', tasto, true)
    return () => window.removeEventListener('keydown', tasto, true)
  })
  // la ricerca delle persone: lo staff e gli agenti appena si apre, i clienti scrivendo (attesa breve fra un tasto e l'altro)
  useEffect(() => {
    if (!elencoAperto || !puoInvitare) return
    let vivo = true
    setCercando(true)
    const t = setTimeout(() => {
      cercaPersone(cerca.trim()).then((p) => { if (vivo) setTrovati(p) }).catch((e) => { if (vivo) { setTrovati([]); setErrore(e?.message || 'Ricerca non riuscita') } }).finally(() => { if (vivo) setCercando(false) })
    }, cerca ? 250 : 0)
    return () => { vivo = false; clearTimeout(t) }
  }, [cerca, elencoAperto, puoInvitare])

  const puntuale = tipo === 'promemoria'
  const invita = puoInvitare && !puntuale
  const dataInizio = componi(data, '12:00')
  const opzioniRipeti: { v: Ripeti; l: string }[] = [
    { v: 'no', l: 'Non si ripete' },
    { v: 'giorno', l: 'Ogni giorno' },
    { v: 'settimana', l: `Ogni settimana di ${GIORNI[giornoInizio]}` },
    { v: 'feriali', l: 'Dal lunedì al venerdì' },
    { v: 'mese', l: `Ogni mese il giorno ${dataInizio.getDate()}` },
    { v: 'anno', l: `Ogni anno il ${dataInizio.getDate()} ${MESI[dataInizio.getMonth()]}` },
    { v: 'personalizza', l: 'Personalizza…' },
  ]
  const ricorrenza = useMemo((): Ricorrenza | null => {
    if (ripeti === 'no') return null
    const base: Ricorrenza =
      ripeti === 'giorno' ? { freq: 'giorno', ogni: 1 }
        : ripeti === 'settimana' ? { freq: 'settimana', ogni: 1, giorni: [giornoInizio] }
          : ripeti === 'feriali' ? { freq: 'settimana', ogni: 1, giorni: [0, 1, 2, 3, 4] }
            : ripeti === 'mese' ? { freq: 'mese', ogni: 1 }
              : ripeti === 'anno' ? { freq: 'anno', ogni: 1 }
                : { freq, ogni: Math.max(1, Math.min(99, parseInt(ogni) || 1)), giorni: freq === 'settimana' ? (giorni.length ? giorni : [giornoInizio]) : null }
    return { ...base, fino: fineTipo === 'data' ? fino : null, volte: fineTipo === 'volte' ? Math.max(1, Math.min(999, parseInt(volte) || 1)) : null }
  }, [ripeti, freq, ogni, giorni, fineTipo, fino, volte, giornoInizio])

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
    if (ricorrenza?.fino && ricorrenza.fino < data) { setErrore('La ripetizione finisce prima di cominciare'); return }
    setSalvando(true); setErrore('')
    try {
      const e = await salvaMio({
        id: evento?.id, tipo, titolo: t, inizio: inizio.toISOString(), fine: fine ? fine.toISOString() : null,
        tutto_il_giorno: tutto, luogo: puntuale ? null : (luogo.trim() || null), note: note.trim() || null,
        avviso_minuti: avviso, collegamento,
        // «fatto» di una serie vive giorno per giorno; di una voce singola resta com'era
        fatto: evento && !evento.ricorrenza ? evento.fatto : false,
        ricorrenza,
        // gli invitati si mandano solo da chi può invitare; un promemoria non ne ha
        ...(puoInvitare ? { invitati: puntuale ? [] : scelti.map((s) => s.id) } : {}),
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
          {serie && <div className="cal-nota"><Ic n="ripeti" /><div>Si ripete: le modifiche valgono per <b>tutta la serie</b>. Per togliere un giorno solo, aprilo dal calendario e scegli «Elimina» → «Solo questa».</div></div>}
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
          <div className="cal-campi" style={tutto ? { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } : undefined}>
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
          <div className="cal-riga-campi">
            <button type="button" className="cal-interruttore" role="switch" aria-checked={tutto} onClick={() => setTutto(!tutto)}>
              <i />Tutto il giorno
            </button>
            <label className="cal-campo cal-campo--stretto"><span className="cal-nascosto">Si ripete</span>
              <select value={ripeti} onChange={e => setRipeti(e.target.value as Ripeti)} aria-label="Si ripete">
                {opzioniRipeti.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </label>
          </div>
          {ripeti === 'personalizza' && (
            <div className="cal-ripeti">
              <div className="cal-ripeti-riga">
                <span>Ogni</span>
                <input type="number" min={1} max={99} value={ogni} onChange={e => setOgni(e.target.value)} aria-label="Ogni quanto" />
                <select value={freq} onChange={e => setFreq(e.target.value as Ricorrenza['freq'])} aria-label="Unità">
                  <option value="giorno">{ogni === '1' ? 'giorno' : 'giorni'}</option>
                  <option value="settimana">{ogni === '1' ? 'settimana' : 'settimane'}</option>
                  <option value="mese">{ogni === '1' ? 'mese' : 'mesi'}</option>
                  <option value="anno">{ogni === '1' ? 'anno' : 'anni'}</option>
                </select>
              </div>
              {freq === 'settimana' && (
                <div className="cal-giorni" role="group" aria-label="Giorni della settimana">
                  {LETTERE.map((l, i) => (
                    <button key={i} type="button" aria-pressed={giorni.includes(i)} title={GIORNI[i]}
                      onClick={() => setGiorni(g => g.includes(i) ? (g.length > 1 ? g.filter(x => x !== i) : g) : [...g, i].sort())}>{l}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {ripeti !== 'no' && (
            <div className="cal-ripeti">
              <div className="cal-ripeti-riga cal-ripeti-fine" role="radiogroup" aria-label="Fine della ripetizione">
                <span>Fine</span>
                <label><input type="radio" checked={fineTipo === 'mai'} onChange={() => setFineTipo('mai')} />mai</label>
                <label><input type="radio" checked={fineTipo === 'data'} onChange={() => setFineTipo('data')} />il
                  <input type="date" value={fino} min={data} onChange={e => { setFino(e.target.value); setFineTipo('data') }} /></label>
                <label><input type="radio" checked={fineTipo === 'volte'} onChange={() => setFineTipo('volte')} />dopo
                  <input type="number" min={1} max={999} value={volte} onChange={e => { setVolte(e.target.value); setFineTipo('volte') }} /> volte</label>
              </div>
              {ricorrenza && <div className="cal-ripeti-frase"><Ic n="ripeti" />{descriviRicorrenza(ricorrenza, componi(data, oraDa))}</div>}
            </div>
          )}
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
          {invita && (
            <div className="cal-campo">
              <span>Invita</span>
              <div className="cal-invita">
                {scelti.map(s => (
                  <span key={s.id} className={`cal-persona${s.stato ? ' cal-persona--' + s.stato : ''}`} title={s.stato ? NOME_STATO[s.stato] : 'nuovo invito'}>
                    {s.nome}<small>{NOME_RUOLO[s.ruolo] || s.ruolo}{s.stato ? ' · ' + NOME_STATO[s.stato] : ''}</small>
                    <button type="button" onClick={() => setScelti(x => x.filter(y => y.id !== s.id))} aria-label={`Togli ${s.nome}`}><Ic n="x" /></button>
                  </span>
                ))}
                <div className="cal-invita-cerca">
                  <input value={cerca} placeholder={scelti.length ? 'Aggiungi un’altra persona…' : 'Cerca nel tuo staff, fra gli agenti e i clienti…'}
                    onChange={e => { setCerca(e.target.value); setElencoAperto(true) }} onFocus={() => setElencoAperto(true)}
                    onBlur={() => setTimeout(() => setElencoAperto(false), 160)} aria-label="Cerca persone da invitare" />
                  {elencoAperto && (
                    <div className="cal-invita-elenco" role="listbox">
                      {cercando && !trovati && <div className="cal-invita-vuoto">Cerco…</div>}
                      {trovati && trovati.filter(p => !scelti.some(s => s.id === p.id)).length === 0 && !cercando &&
                        <div className="cal-invita-vuoto">{cerca ? 'Nessuno con questo nome' : 'Scrivi il nome di un cliente per trovarlo'}</div>}
                      {(trovati || []).filter(p => !scelti.some(s => s.id === p.id)).map(p => (
                        <button key={p.id} type="button" role="option" aria-selected={false}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => { setScelti(x => [...x, { id: p.id, nome: p.nome, ruolo: p.ruolo }]); setCerca('') }}>
                          <b>{p.nome}</b><small>{[NOME_RUOLO[p.ruolo] || p.ruolo, p.azienda && p.azienda !== p.nome ? p.azienda : null].filter(Boolean).join(' · ')}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <small className="cal-aiuto">Chi inviti riceve un’email e trova la voce nel suo calendario, con titolo, orari, luogo e note. Non vede gli altri invitati né la spedizione collegata.</small>
            </div>
          )}
          <label className="cal-campo"><span>Note</span>
            <textarea value={note} maxLength={4000} placeholder={invita && scelti.length ? 'Le vedono anche gli invitati' : 'Facoltative'} onChange={e => setNote(e.target.value)} />
          </label>
          {errore && <div className="cal-msg" role="alert">{errore}</div>}
        </div>
        <div className="cal-finestra-piede">
          <small>⌘ Invio per salvare</small>
          <span className="cal-spazio" />
          <button className="cal-tasto cal-tasto--chiaro" onClick={onChiudi}>Annulla</button>
          <button className="cal-tasto cal-tasto--nero" onClick={salva} disabled={salvando}>{salvando ? 'Salvo…' : scelti.some(s => !s.stato) && invita ? 'Salva e invita' : 'Salva'}</button>
        </div>
      </div>
    </>
  )
}
