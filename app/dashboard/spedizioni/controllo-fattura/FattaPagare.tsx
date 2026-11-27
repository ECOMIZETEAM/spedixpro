'use client'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { C, cifre, euro, r2 } from './ui'

/* UNA SPEDIZIONE FUORI DA TUTTO, FATTA PAGARE A QUALCUNO (Lorenzo, 27/11). Sono le righe della fattura che non
 * sono né in Moove né nell'export dell'altro gestionale: a ottobre per Wave 4 arrivi (spedizioni che partono da fuori e
 * arrivano a Wave: 3 da 4,48 €, uno da 94,63 €) e la partenza per Riga da 493,86 €.
 * Il cliente si sceglie fra quelli di Moove (o si scrive, se non c'è) e si scrive quanto gli si è fatto pagare. Poi:
 *  - a un cliente di Moove si può ADDEBITARE in Moove (dalla porta dei movimenti a mano, nel ControlloFattura), oppure
 *    dire che l'ha GIÀ PAGATA fuori da Moove (Lorenzo: «magari l'ha pagata fuori da Moove»);
 *  - a uno che non è in Moove non si addebita niente: già incassati, o da incassare e si dirà dopo.
 * Prima di tutto la finestra dice se GLS l'ha fatta pagare giusta (Lorenzo: "Wave deve sempre sapere se paga
 * giusto"): le stesse regole della contestazione, così l'«in più» di qui è quello che c'è nella contestazione. */

export type ControlloFuori = {
  carburante: { euro: number; percentuale: number | null; listino: number | null; inPiu: number; controllato: boolean } | null
  nolo: { euro: number; riferimento: number | null; inPiu: number; perche: string }
  altreVoci: { nome: string; euro: number }[]
  inPiu: number
  atteso: number
  contestazione: string | null    // dove sta l'«in più»: nella contestazione da mandare, o in quella già mandata
}

export type ClienteScelto = { id?: string; nome: string }
// Come l'ha fatta pagare: addebito in Moove (solo a un cliente o sotto-master di Moove), già incassati fuori da Moove,
// o da incassare (si dirà dopo se ha pagato).
export type ComeFattaPagare = 'addebita' | 'incassati' | 'da_incassare'
type VoceElenco = { id: string; ragione_sociale: string; is_master?: boolean }

export default function FattaPagare({ titolo, sottotitolo, gls, controllo, corriere, onChiudi, onConferma }: {
  titolo: string; sottotitolo: string; gls: number; controllo: ControlloFuori; corriere: string
  onChiudi: () => void
  onConferma: (x: { cliente: ClienteScelto; importo: number; come: ComeFattaPagare }) => Promise<string | null>   // null = fatto, altrimenti l'errore da mostrare
}) {
  const [modo, setModo] = useState<'moove' | 'fuori'>('moove')
  const [elenco, setElenco] = useState<VoceElenco[] | null>(null)
  const [elencoRotto, setElencoRotto] = useState(false)
  const [cerca, setCerca] = useState('')
  const [scelto, setScelto] = useState<VoceElenco | null>(null)
  const [nomeLibero, setNomeLibero] = useState('')
  const [importoTesto, setImportoTesto] = useState('')
  const [errore, setErrore] = useState<string | null>(null)
  const [invio, setInvio] = useState(false)

  // I clienti e i sotto-master di chi guarda: la stessa lista dei filtri dell'elenco spedizioni. Quella rotta, con la
  // sessione scaduta o una lettura non riuscita, risponde un elenco vuoto: un elenco vuoto qui vuol dire «non riesco a
  // leggerli», non «non hai clienti», e non deve spingere a scriverlo a mano.
  useEffect(() => {
    let vivo = true
    fetch('/api/clienti/lista?conMaster=1').then(r => r.ok ? r.json() : null).then(d => {
      if (!vivo) return
      if (Array.isArray(d) && d.length) setElenco(d)
      else { setElenco([]); setElencoRotto(true) }
    }).catch(() => { if (vivo) { setElenco([]); setElencoRotto(true) } })
    return () => { vivo = false }
  }, [])
  const trovati = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    return (elenco || []).filter(c => !q || String(c.ragione_sociale || '').toLowerCase().includes(q)).slice(0, 30)
  }, [elenco, cerca])

  // L'importo come lo scrive una persona: "4,48", "1.234,56" o "4.48".
  const leggiEuro = (x: string) => { const t = String(x).trim().replace(/\s|€/g, ''); const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); return Number.isFinite(n) ? n : NaN }
  const importo = leggiEuro(importoTesto)
  const cliente: ClienteScelto | null = modo === 'moove' ? (scelto ? { id: scelto.id, nome: scelto.ragione_sociale } : null) : (nomeLibero.trim() ? { nome: nomeLibero.trim().slice(0, 120) } : null)
  const pronto = !!cliente && importo > 0 && importo < 1_000_000 && !invio

  async function conferma(come: ComeFattaPagare) {
    if (!cliente) { setErrore(modo === 'moove' ? 'Scegli il cliente.' : 'Scrivi il nome del cliente.'); return }
    if (!(importo > 0)) { setErrore('Scrivi quanto gli fai pagare, per esempio 6,50.'); return }
    setErrore(null); setInvio(true)
    const e = await onConferma({ cliente, importo: r2(importo), come })
    setInvio(false)
    if (e) setErrore(e)
  }

  const riga = (a: string, b: string, colore: string = C.testo, forte = false) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, color: colore, fontWeight: forte ? 700 : 400, padding: '2px 0' }}>
      <span>{a}</span><span style={cifre}>{b}</span>
    </div>
  )
  const pctT = (n: number | null) => n == null ? '' : ` al ${n.toLocaleString('it-IT', { maximumFractionDigits: 2 })}%`
  const k = controllo
  // Un nolo che non si confronta (estero, o nessuna partenza di quel peso nel documento) non è «giusto»: si dice.
  const senzaNolo = k.nolo.riferimento == null && k.nolo.perche ? ` Il nolo non si controlla: ${k.nolo.perche}.` : ''
  const carbOk = !!k.carburante?.controllato
  const tasto = (attivo: boolean): CSSProperties => ({ flex: 1, padding: '8px 10px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${attivo ? C.arancio : C.filo}`, background: attivo ? C.arancioTenue : '#fff', color: attivo ? C.arancioScuro : C.testo })

  return (
    <div onClick={() => { if (!invio) onChiudi() }} style={{ position: 'fixed', inset: 0, background: 'rgba(16,24,40,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 40px rgba(16,24,40,.25)' }}>
        <div style={{ padding: '18px 20px 12px', borderBottom: `1px solid ${C.filo}` }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.testo }}>{titolo}</div>
          <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 3 }}>{sottotitolo}</div>
        </div>

        <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Paga giusto? */}
          <div style={{ border: `1px solid ${k.inPiu > 0.005 ? C.ambraOrlo : C.verdeOrlo}`, background: k.inPiu > 0.005 ? C.ambraTenue : C.verdeTenue, borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.attenuato, textTransform: 'uppercase', letterSpacing: .3, marginBottom: 4 }}>Quanto ti è costata</div>
            {riga('Nolo', euro(k.nolo.euro))}
            {k.carburante && riga(`Carburante${pctT(k.carburante.percentuale)}`, euro(k.carburante.euro))}
            {k.altreVoci.map(v => <div key={v.nome}>{riga(v.nome, euro(v.euro))}</div>)}
            {riga(`Totale ${corriere}`, euro(gls), C.testo, true)}
            <div style={{ borderTop: `1px dashed ${C.filo}`, margin: '6px 0' }} />
            {k.inPiu > 0.005 ? <>
              {k.nolo.inPiu > 0.005 && riga(`Nolo: ${k.nolo.perche}`, `+${euro(k.nolo.inPiu)}`, C.ambra)}
              {k.carburante && k.carburante.inPiu > 0.005 && riga(`Carburante${pctT(k.carburante.percentuale)} invece che${pctT(k.carburante.listino)}`, `+${euro(k.carburante.inPiu)}`, C.ambra)}
              {riga('Col tuo contratto sarebbe', euro(k.atteso), C.testo, true)}
              <div style={{ fontSize: 12.5, color: C.ambra, marginTop: 4, lineHeight: 1.4 }}>
                {euro(k.inPiu)} in più. {k.contestazione || ''}{senzaNolo}
              </div>
            </> : <div style={{ fontSize: 12.5, color: senzaNolo || !carbOk ? C.attenuato : C.verde, lineHeight: 1.4 }}>
              {!carbOk && senzaNolo ? `Non controllata: mancano le regole per questo documento.${senzaNolo}`
                : senzaNolo ? `Carburante giusto.${senzaNolo}` : !carbOk ? 'Nolo giusto; il carburante non si è controllato (manca la percentuale del contratto).' : 'Giusta col tuo contratto.'}
            </div>}
          </div>

          {/* A chi */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.testo, marginBottom: 6 }}>A chi l&apos;hai fatta pagare?</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button onClick={() => { setModo('moove'); setErrore(null) }} style={tasto(modo === 'moove')}>Un cliente in Moove</button>
              <button onClick={() => { setModo('fuori'); setErrore(null) }} style={tasto(modo === 'fuori')}>Un cliente non in Moove</button>
            </div>
            {modo === 'moove' ? (
              scelto ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', border: `1px solid ${C.arancioOrlo}`, background: C.arancioTenue, borderRadius: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.testo }}>{scelto.ragione_sociale}{scelto.is_master ? ' · sotto-master' : ''}</span>
                  <button onClick={() => setScelto(null)} style={{ border: 'none', background: 'none', color: C.arancioScuro, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Cambia</button>
                </div>
              ) : <>
                <input autoFocus value={cerca} onChange={e => setCerca(e.target.value)} placeholder="Cerca il cliente per nome…"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: `1px solid ${C.filo}`, borderRadius: 8, fontSize: 13 }} />
                <div style={{ maxHeight: 180, overflowY: 'auto', border: `1px solid ${C.filo}`, borderTop: 'none', borderRadius: '0 0 8px 8px' }}>
                  {elenco == null ? <div style={{ padding: 10, fontSize: 12.5, color: C.attenuato }}>Carico i clienti…</div>
                    : elencoRotto ? <div style={{ padding: 10, fontSize: 12.5, color: C.rosso }}>Non riesco a leggere i tuoi clienti (forse la sessione è scaduta): chiudi e ricarica la pagina.</div>
                    : !trovati.length ? <div style={{ padding: 10, fontSize: 12.5, color: C.attenuato }}>Nessun cliente con questo nome. Se non è in Moove, scegli «Un cliente non in Moove».</div>
                    : trovati.map(c => (
                      <div key={c.id} onClick={() => { setScelto(c); setErrore(null) }} style={{ padding: '7px 10px', fontSize: 13, cursor: 'pointer', borderBottom: `1px solid ${C.fondoTenue}` }}
                        onMouseEnter={e => (e.currentTarget.style.background = C.fondoTenue)} onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                        {c.ragione_sociale}{c.is_master ? <span style={{ color: C.attenuato }}> · sotto-master</span> : null}
                      </div>
                    ))}
                </div>
              </>
            ) : (
              <input autoFocus value={nomeLibero} onChange={e => setNomeLibero(e.target.value)} placeholder="Nome del cliente" maxLength={120}
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: `1px solid ${C.filo}`, borderRadius: 8, fontSize: 13 }} />
            )}
          </div>

          {/* Quanto */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.testo, marginBottom: 6 }}>Quanto gli fai pagare?</div>
            <input value={importoTesto} onChange={e => setImportoTesto(e.target.value)} placeholder="Importo €" inputMode="decimal"
              style={{ width: 160, padding: '8px 10px', border: `1px solid ${C.filo}`, borderRadius: 8, fontSize: 13 }} />
            {importo > 0 && <span style={{ fontSize: 12.5, marginLeft: 10, color: importo - gls >= 0 ? C.verde : C.rosso, fontWeight: 600 }}>
              {importo - gls >= 0 ? `ti restano ${euro(r2(importo - gls))}` : `ci perdi ${euro(r2(gls - importo))}`}
            </span>}
            <div style={{ fontSize: 12, color: C.attenuato, marginTop: 8, lineHeight: 1.45 }}>
              {modo === 'moove'
                ? <><b>Addebita in Moove</b>: l&apos;importo si scala dal suo credito come «Spedizione fatta fuori dal portale», con questo numero, e lo vede fra i suoi movimenti; i {euro(gls)} pagati a {corriere} restano il tuo costo (lui non li vede). <b>Già incassati</b>: te l&apos;ha già pagata fuori da Moove, si segna solo qui.</>
                : <>In Moove non si muove niente: resta scritto qui, nel conto di questo documento. Se te l&apos;ha già pagata, <b>Già incassati</b>; se no, <b>Da incassare</b> e poi segni «Incassati» o «Non incassati».</>}
            </div>
          </div>

          {errore && <div style={{ fontSize: 12.5, color: C.rosso, background: C.rossoTenue, border: `1px solid ${C.rossoOrlo}`, borderRadius: 8, padding: '8px 10px' }}>{errore}</div>}
        </div>

        <div style={{ padding: '12px 20px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: `1px solid ${C.filo}` }}>
          <button onClick={onChiudi} disabled={invio} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.filo}`, background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Annulla</button>
          <button onClick={() => conferma('incassati')} disabled={!pronto} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${pronto ? C.arancio : C.filo}`, background: '#fff', color: pronto ? C.arancioScuro : C.attenuato, fontSize: 13, fontWeight: 700, cursor: pronto ? 'pointer' : 'default' }}>
            Già incassati
          </button>
          <button onClick={() => conferma(modo === 'moove' ? 'addebita' : 'da_incassare')} disabled={!pronto} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: pronto ? C.arancio : '#fdba8c', color: '#fff', fontSize: 13, fontWeight: 700, cursor: pronto ? 'pointer' : 'default' }}>
            {invio ? 'Un momento…' : modo === 'moove' ? `Addebita${importo > 0 ? ' ' + euro(importo) : ''} in Moove` : 'Da incassare'}
          </button>
        </div>
      </div>
    </div>
  )
}
