'use client'
import { useState, useEffect } from 'react'
import { card, cardH, th, td, btnSec, eur, Testata, Avviso, Vuoto } from '../comune'

// GLI ADDEBITI DELLA LOGISTICA: cosa e' stato fatturato, e cosa si sta per fatturare.
//
// L'ANTEPRIMA E' PARTE DEL PRODOTTO, non una prova da fare una volta: prima di lasciar partire un
// addebito automatico si guarda chi pagherebbe quanto. Un addebito che parte a sorpresa su clienti
// veri e' il guasto peggiore, e qui non puo' succedere senza che qualcuno abbia guardato.

export default function AddebitiPage() {
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; x: string } | null>(null)
  const [giacenza, setGiacenza] = useState<any>(null)
  const [uscite, setUscite] = useState<any>(null)
  const [storico, setStorico] = useState<any[]>([])
  const [carico, setCarico] = useState(false)

  useEffect(() => { guarda() }, [])
  async function guarda() {
    setCarico(true)
    try {
      const [g, u, s] = await Promise.all([
        fetch('/api/logistica/addebito-mensile?anteprima=1').then(r => r.json()).catch(() => null),
        fetch('/api/logistica/addebito-uscite?anteprima=1').then(r => r.json()).catch(() => null),
        fetch('/api/logistica/addebiti').then(r => r.json()).catch(() => []),
      ])
      if (g?.error || u?.error) setMsg({ t: 'err', x: g?.error || u?.error })
      setGiacenza(g); setUscite(u); setStorico(Array.isArray(s) ? s : [])
    } finally { setCarico(false) }
  }

  const Riquadro = ({ titolo, spiega, dato, righe }: any) => (
    <div style={{ ...card, flex: 1, minWidth: '320px' }}>
      <div style={cardH}>{titolo}</div>
      <div style={{ padding: '16px' }}>
        <div style={{ fontSize: '12.5px', color: '#6b7280', marginBottom: '10px' }}>{spiega}</div>
        <div style={{ fontSize: '28px', fontWeight: 700, color: dato > 0 ? '#15803d' : '#9ca3af' }}>{eur(dato)}</div>
        <div style={{ borderTop: '1px solid #f5f5f5', marginTop: '12px', paddingTop: '10px' }}>
          {(righe || []).map((r: any, i: number) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', color: '#374151', padding: '3px 0' }}>
              <span>{r.cliente} <span style={{ color: '#9ca3af' }}>· {r.posti ?? r.spedizioni}</span></span>
              <b>{eur(r.importo)}</b>
            </div>
          ))}
          {!righe?.length && <div style={{ fontSize: '12.5px', color: '#9ca3af' }}>Niente da addebitare.</div>}
        </div>
      </div>
    </div>
  )

  return (
    <div>
      <Testata titolo="Addebiti logistica" sottotitolo="Cosa verrebbe fatturato adesso, e cosa è già stato fatturato. Guardare non addebita niente." />
      <Avviso msg={msg} />

      <div style={{ marginBottom: '14px' }}>
        <button onClick={guarda} disabled={carico} style={{ ...btnSec, opacity: carico ? 0.6 : 1 }}>{carico ? 'Guardo…' : 'Aggiorna anteprima'}</button>
      </div>

      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
        <Riquadro
          titolo={`Giacenza — ${giacenza?.mese || 'questo mese'}`}
          spiega={`${giacenza?.posti_da_fatturare ?? 0} posti da fatturare${giacenza?.gia_fatturati ? ` · ${giacenza.gia_fatturati} già fatturati, non si ripetono` : ''}`}
          dato={giacenza?.totale ?? 0} righe={giacenza?.clienti}
        />
        <Riquadro
          titolo="Uscite — preparazione pacchi"
          spiega={`${uscite?.da_addebitare ?? 0} spedizioni da addebitare · clienti col servizio attivo: ${uscite?.attivi ?? 0}`}
          dato={uscite?.totale ?? 0} righe={uscite?.clienti}
        />
      </div>

      <div style={{ ...card, marginTop: '4px' }}>
        <div style={cardH}>Già addebitato</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Quando</th><th style={th}>Cliente</th><th style={th}>Cosa</th><th style={th}>Descrizione</th><th style={th}>Importo</th></tr></thead>
            <tbody>
              {storico.map((a: any) => (
                <tr key={a.id}>
                  <td style={td}>{new Date(a.created_at).toLocaleDateString('it-IT')}</td>
                  <td style={td}>{a.clienti?.ragione_sociale || '—'}</td>
                  <td style={td}>{a.tipo === 'giacenza' ? `Giacenza ${a.mese || ''}` : 'Uscita'}</td>
                  <td style={{ ...td, color: '#6b7280' }}>{a.descrizione || '—'}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{eur(a.importo)}</td>
                </tr>
              ))}
              {!storico.length && <tr><td colSpan={5}><Vuoto testo="Non è ancora stato addebitato niente." /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
        I giri automatici non sono ancora accesi: finché non lo sono, questi numeri restano una previsione.
      </div>
    </div>
  )
}
