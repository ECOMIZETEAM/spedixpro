'use client'
import { useEffect, useId, useState } from 'react'
import {
  FAMIGLIE, NON_E_UNA_RICARICA, VOCI_MANUALI, chiedeCosto, chiedeRicaricaDaStornare, descrizioneMovimento, famigliaDi, nomeRicarica,
  numeroFatturaDaConfermare, sembraUnPacco, testoDelloStorno, voceManuale, type IdVoce, type RicaricaDaStornare,
} from '@/lib/movimento-manuale'

// CHE MOVIMENTO E': la voce scelta da chi scrive un movimento a mano, con il numero che la voce chiede (fattura,
// distinta, spedizione) e il testo libero. Le regole stanno in lib/movimento-manuale, le stesse del server.
// Sotto la tendina si legge, prima di registrare, la riga che comparira' nella Lista Movimenti: e' quella che
// vede anche chi riceve il movimento.
//
// Tre domande in piu' (Lorenzo, 25/11), solo quando servono:
// - «Storno o correzione» col meno: quale ricarica corregge, cosi' la sua riga esce dal Check Ricariche;
// - «Pagamento fattura» con un numero di una cifra: se e' davvero quello;
// - «Spedizione fatta fuori dal portale» col meno: quanto l'ha pagata il master, cosi' il guadagno conta la differenza.
//
// Due disposizioni, come i due moduli che la usano: 'griglia' mette etichetta e campo nelle due colonne della
// finestra della scheda cliente; 'colonna' mette l'etichetta sopra il campo, come la scheda sotto-master.

export type ValoreVoce = { voce: IdVoce | ''; numero: string; testo: string; storna: string; costo: string; numeroConfermato: boolean }
export const VOCE_INIZIALE: ValoreVoce = { voce: '', numero: '', testo: '', storna: '', costo: '', numeroConfermato: false }

const CAMPO: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box' as const, color: '#1a1a1a', background: '#fff' }
const nota = { fontSize: '11.5px', color: '#6b7280', lineHeight: 1.45 }
const avviso: React.CSSProperties = { marginTop: '6px', padding: '8px 10px', borderRadius: '6px', background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: '12px', lineHeight: 1.45 }

type Ricarica = RicaricaDaStornare & { check: string }

// `dopoVoce`: i campi dell'importo, che la pagina tiene suoi e che vanno subito dopo la scelta della voce.
// `stileCampo`: lo stile dei campi della pagina che la ospita, perche' i campi della voce siano uguali agli altri.
// `importo`: quello scritto nella pagina, che decide se servono la ricarica da stornare o il costo.
// `bersaglio`: il cliente o il sotto-master (m:<id>) di cui leggere le ricariche.
export default function VoceMovimento({ valore, onChange, layout, dopoVoce, stileCampo, importo, bersaglio }: {
  valore: ValoreVoce, onChange: (v: ValoreVoce) => void, layout: 'griglia' | 'colonna', dopoVoce?: React.ReactNode, stileCampo?: React.CSSProperties,
  importo?: number, bersaglio?: string,
}) {
  const campo = stileCampo || CAMPO
  const id = useId()
  const v = voceManuale(valore.voce)
  const griglia = layout === 'griglia'
  const imp = typeof importo === 'number' && isFinite(importo) ? importo : 0
  const stornoDiRicarica = chiedeRicaricaDaStornare(v, imp)
  const conCosto = chiedeCosto(v, imp)
  const confermaNumero = numeroFatturaDaConfermare(v, valore.numero)

  // Le ricariche si leggono appena si sceglie lo storno, cosi' sono pronte quando si scrive il meno.
  const [ricariche, setRicariche] = useState<Ricarica[] | null>(null)
  const [errRicariche, setErrRicariche] = useState('')
  const vuoleRicariche = valore.voce === 'storno' && !!bersaglio
  useEffect(() => {
    if (!vuoleRicariche) return
    let vivo = true
    setRicariche(null); setErrRicariche('')
    fetch(`/api/movimenti/ricariche-da-stornare?clienteId=${encodeURIComponent(bersaglio!)}`)
      .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d?.error || 'Errore'); return d })
      .then(d => { if (vivo) setRicariche(Array.isArray(d.ricariche) ? d.ricariche : []) })
      .catch(e => { if (vivo) { setErrRicariche(String(e?.message || 'Errore')); setRicariche([]) } })
    return () => { vivo = false }
  }, [vuoleRicariche, bersaglio])
  const ricaricaScelta = stornoDiRicarica ? (ricariche || []).find(r => r.id === valore.storna) || null : null

  // In griglia l'etichetta sta nella prima colonna, allineata a destra; in colonna sta sopra il campo.
  const riga = (chiave: string, etichetta: string, contenuto: React.ReactNode) => griglia ? (
    <div key={chiave} style={{ display: 'contents' }}>
      <label htmlFor={id + chiave} style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a', textAlign: 'right', alignSelf: 'start', paddingTop: '10px' }}>{etichetta}</label>
      <div>{contenuto}</div>
    </div>
  ) : (
    <div key={chiave}>
      <label htmlFor={id + chiave} style={{ fontSize: '11.5px', fontWeight: 600, color: '#1a1a1a', display: 'block', marginBottom: '4px' }}>{etichetta}</label>
      {contenuto}
    </div>
  )

  const scelta = (valoreScelta: string, titolo: React.ReactNode, sotto: string | null) => {
    const on = valore.storna === valoreScelta
    return (
      <label key={valoreScelta} style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '8px 10px', borderRadius: '6px', cursor: 'pointer',
        border: `1px solid ${on ? '#f97316' : '#e5e7eb'}`, background: on ? '#fff7ed' : '#fff' }}>
        <input type="radio" name={id + 'storna'} checked={on} onChange={() => onChange({ ...valore, storna: valoreScelta })}
          style={{ marginTop: '2px', accentColor: '#f97316', flexShrink: 0 }} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{titolo}</span>
          {sotto && <span style={{ display: 'block', fontSize: '11.5px', color: '#6b7280', marginTop: '1px' }}>{sotto}</span>}
        </span>
      </label>
    )
  }

  const righe = [
    riga('voce', 'Che movimento è', <>
      <select id={id + 'voce'} value={valore.voce}
        // Cambiando voce il numero cambia significato (una fattura non e' una spedizione): si riparte vuoto, e con
        // lui le risposte che la voce di prima chiedeva.
        onChange={e => onChange({ ...valore, voce: e.target.value as IdVoce | '', numero: '', storna: '', costo: '', numeroConfermato: false })}
        style={{ ...campo, color: valore.voce ? '#1a1a1a' : '#6b7280', cursor: 'pointer' }}>
        <option value="" disabled>Scegli che movimento è…</option>
        {FAMIGLIE.map(f => (
          <optgroup key={f.id} label={`${f.nome} — ${f.id === 'soldi' ? 'fuori dal guadagno' : 'nel guadagno'}`}>
            {VOCI_MANUALI.filter(x => x.famiglia === f.id).map(x => <option key={x.id} value={x.id} style={{ color: '#1a1a1a' }}>{x.nome}</option>)}
          </optgroup>
        ))}
      </select>
      {v && (
        <div style={{ ...nota, marginTop: '6px' }}>
          {v.spiega}
          <div style={{ marginTop: '3px', display: 'flex', alignItems: 'center', gap: '6px', color: '#374151', fontWeight: 600 }}>
            <span aria-hidden="true" style={{ width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0, background: v.famiglia === 'soldi' ? '#9ca3af' : '#f97316' }} />
            {famigliaDi(v).guadagno}
          </div>
        </div>
      )}
    </>),
    dopoVoce ? <div key="dopoVoce" style={{ display: 'contents' }}>{dopoVoce}</div> : null,
    v?.campo && riga('numero', v.campo.etichetta, <>
      <input id={id + 'numero'} value={valore.numero} maxLength={60} placeholder={v.campo.esempio}
        // Un numero nuovo va riconfermato.
        onChange={e => onChange({ ...valore, numero: v.campo?.chiave === 'spedizione' ? e.target.value.toUpperCase() : e.target.value, numeroConfermato: false })}
        style={campo} />
      {confermaNumero && (
        <div style={avviso}>
          È davvero la fattura n° {valore.numero.trim()}? Un numero di una cifra di solito è sbagliato: copialo dalla fattura, es. 1479 o 12/FE.
          <label style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '6px', fontWeight: 600, cursor: 'pointer' }}>
            <input type="checkbox" checked={valore.numeroConfermato} onChange={e => onChange({ ...valore, numeroConfermato: e.target.checked })}
              style={{ accentColor: '#f97316', width: '15px', height: '15px', margin: 0 }} />
            Sì, è la fattura n° {valore.numero.trim()}
          </label>
        </div>
      )}
    </>),
    stornoDiRicarica && riga('storna', 'Quale ricarica correggi', <>
      <div id={id + 'storna'} role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {ricariche === null && <div style={{ ...nota, padding: '8px 0' }}>Cerco le ultime ricariche…</div>}
        {errRicariche && <div style={{ ...avviso, marginTop: 0 }}>Non riesco a leggere le ricariche ({errRicariche}). Puoi scegliere «Non è una ricarica» e scriverla nel testo.</div>}
        {ricariche !== null && !errRicariche && ricariche.length === 0 && <div style={{ ...nota, padding: '4px 0' }}>Nessuna ricarica negli ultimi 60 giorni.</div>}
        {(ricariche || []).map(r => { const n = nomeRicarica(r); return scelta(r.id, n.charAt(0).toUpperCase() + n.slice(1), `Check Ricariche: ${r.check}`) })}
        {ricariche !== null && scelta(NON_E_UNA_RICARICA, 'Non è una ricarica', 'Correggi un altro movimento: scrivi quale nel testo.')}
      </div>
      <div style={{ ...nota, marginTop: '6px' }}>Se il bonifico non è arrivato, la ricarica scelta esce dal Check Ricariche.</div>
    </>),
    conCosto && riga('costo', 'Quanto l\'hai pagata tu', <>
      <div style={{ position: 'relative' }}>
        <input id={id + 'costo'} value={valore.costo} inputMode="decimal" placeholder="es. 450"
          onChange={e => onChange({ ...valore, costo: e.target.value })}
          style={{ ...campo, paddingRight: '34px', textAlign: 'right' }} />
        <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#1a1a1a', fontSize: '14px' }}>€</span>
      </div>
      <div style={{ ...nota, marginTop: '4px' }}>Quello che hai pagato al corriere: nel guadagno entra solo la differenza. Il cliente non lo vede.</div>
    </>),
    v && riga('testo', 'Testo', <>
      <input id={id + 'testo'} value={valore.testo} maxLength={200} placeholder={v.esempioTesto}
        onChange={e => onChange({ ...valore, testo: e.target.value })} style={campo} />
      {v.testoObbligatorio && <div style={{ ...nota, marginTop: '4px' }}>Per questa voce il testo è obbligatorio.</div>}
      {sembraUnPacco(v, valore.testo) && (
        <div style={avviso}>Sembra un movimento su un pacco. Se è così, scegli la voce del pacco (Giacenza, Rettifica, o Rimborso per un reso) e scrivi il numero della spedizione: finisce nel suo report e nel guadagno.</div>
      )}
    </>),
    v && riga('anteprima', griglia ? 'Lista Movimenti' : 'Nella Lista Movimenti si leggerà',
      <div style={{ padding: '9px 12px', borderRadius: '6px', background: '#f6f6f5', border: '1px dashed #d6d6d3', fontSize: '13px', color: '#1a1a1a', wordBreak: 'break-word' }}>
        {descrizioneMovimento(v, valore.numero, ricaricaScelta ? testoDelloStorno(ricaricaScelta, valore.testo) : valore.testo)}
      </div>),
  ].filter(Boolean)

  return griglia ? <>{righe}</> : <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>{righe}</div>
}
