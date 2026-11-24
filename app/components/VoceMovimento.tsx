'use client'
import { useId } from 'react'
import { FAMIGLIE, VOCI_MANUALI, descrizioneMovimento, famigliaDi, voceManuale, type IdVoce } from '@/lib/movimento-manuale'

// CHE MOVIMENTO E': la voce scelta da chi scrive un movimento a mano, con il numero che la voce chiede (fattura,
// distinta, spedizione) e il testo libero. Le regole stanno in lib/movimento-manuale, le stesse del server.
// Sotto la tendina si legge, prima di registrare, la riga che comparira' nella Lista Movimenti: e' quella che
// vede anche chi riceve il movimento.
//
// Due disposizioni, come i due moduli che la usano: 'griglia' mette etichetta e campo nelle due colonne della
// finestra della scheda cliente; 'colonna' mette l'etichetta sopra il campo, come la scheda sotto-master.

export type ValoreVoce = { voce: IdVoce | ''; numero: string; testo: string }
export const VOCE_INIZIALE: ValoreVoce = { voce: '', numero: '', testo: '' }

const CAMPO: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box' as const, color: '#1a1a1a', background: '#fff' }
const nota = { fontSize: '11.5px', color: '#6b7280', lineHeight: 1.45 }

// `dopoVoce`: i campi dell'importo, che la pagina tiene suoi e che vanno subito dopo la scelta della voce.
// `stileCampo`: lo stile dei campi della pagina che la ospita, perche' i campi della voce siano uguali agli altri.
export default function VoceMovimento({ valore, onChange, layout, dopoVoce, stileCampo }: {
  valore: ValoreVoce, onChange: (v: ValoreVoce) => void, layout: 'griglia' | 'colonna', dopoVoce?: React.ReactNode, stileCampo?: React.CSSProperties,
}) {
  const campo = stileCampo || CAMPO
  const id = useId()
  const v = voceManuale(valore.voce)
  const griglia = layout === 'griglia'

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

  const righe = [
    riga('voce', 'Che movimento è', <>
      <select id={id + 'voce'} value={valore.voce}
        // Cambiando voce il numero cambia significato (una fattura non e' una spedizione): si riparte vuoto.
        onChange={e => onChange({ ...valore, voce: e.target.value as IdVoce | '', numero: '' })}
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
    v?.campo && riga('numero', v.campo.etichetta,
      <input id={id + 'numero'} value={valore.numero} maxLength={60} placeholder={v.campo.esempio}
        onChange={e => onChange({ ...valore, numero: v.campo?.chiave === 'spedizione' ? e.target.value.toUpperCase() : e.target.value })}
        style={campo} />),
    v && riga('testo', 'Testo', <>
      <input id={id + 'testo'} value={valore.testo} maxLength={200} placeholder={v.esempioTesto}
        onChange={e => onChange({ ...valore, testo: e.target.value })} style={campo} />
      {v.testoObbligatorio && <div style={{ ...nota, marginTop: '4px' }}>Per questa voce il testo è obbligatorio.</div>}
    </>),
    v && riga('anteprima', griglia ? 'Lista Movimenti' : 'Nella Lista Movimenti si leggerà',
      <div style={{ padding: '9px 12px', borderRadius: '6px', background: '#f6f6f5', border: '1px dashed #d6d6d3', fontSize: '13px', color: '#1a1a1a', wordBreak: 'break-word' }}>
        {descrizioneMovimento(v, valore.numero, valore.testo)}
      </div>),
  ].filter(Boolean)

  return griglia ? <>{righe}</> : <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>{righe}</div>
}
