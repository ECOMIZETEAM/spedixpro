'use client'
import { useEffect, useState } from 'react'

const ACCENT = '#f97316'

// L'AVVISO SUI PACCHETTI API.
//
// Si apre sopra il portale e si chiude solo premendo "Ho capito". Lo vede SOLO chi le API le usa
// davvero — chi spedisce dal portale non deve nemmeno sapere che questo messaggio esiste.
//
// Dice tre cose e basta: fino a 50 spedizioni al mese non cambia niente, tu quest'anno ne fai
// tante cosi', e questo e' il pacchetto che ti serve. Un avviso che annuncia un cambiamento senza
// dire cosa cambia PER CHI LEGGE si chiude e si dimentica.
export default function AvvisoApi() {
  const [d, setD] = useState<any>(null)
  const [chiudendo, setChiudendo] = useState(false)

  useEffect(() => {
    fetch('/api/cliente/avvisi').then(r => r.json()).then(x => { if (x?.avviso) setD(x) }).catch(() => { })
  }, [])
  if (!d) return null

  async function hoCapito() {
    setChiudendo(true)
    try { await fetch('/api/cliente/avvisi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avviso: d.avviso }) }) } catch { }
    setD(null)
  }

  const usate = Number(d.stato?.usate || 0)
  const piani = (d.piani || []) as { codice: string; nome: string; limite: number; prezzo: number }[]
  // Il pacchetto che gli serve davvero, sul suo consumo di questo mese.
  const consigliato = piani.find(p => usate <= p.limite) || piani[piani.length - 1]
  const gratis = consigliato?.prezzo === 0

  const riga = { fontSize: '14px', color: '#333', lineHeight: 1.65, margin: '0 0 14px' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,.72)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: '#fff', borderRadius: '14px', maxWidth: '640px', width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.4)' }}>
        <div style={{ background: '#1a1a1a', padding: '18px 28px' }}>
          <div style={{ fontSize: '20px', fontWeight: 800, color: '#fff' }}>Moov<span style={{ color: ACCENT }}>Express</span></div>
        </div>

        <div style={{ padding: '26px 28px' }}>
          <div style={{ fontSize: '17px', fontWeight: 800, color: '#1a1a1a', marginBottom: '14px' }}>
            Le spedizioni via API passano a pacchetti
          </div>

          <p style={riga}>
            Usi le nostre API per spedire dal tuo gestionale o dal tuo negozio online. Da settembre
            questo servizio ha dei pacchetti — ma <strong>fino a 50 spedizioni al mese resta gratis</strong>,
            senza doverci fare niente.
          </p>

          <div style={{
            background: gratis ? '#f0fdf4' : '#fff7ed', border: `1px solid ${gratis ? '#bbf7d0' : '#fed7aa'}`,
            borderRadius: '8px', padding: '14px 16px', margin: '0 0 16px',
          }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: gratis ? '#166534' : '#9a3412' }}>
              {gratis ? 'Per te non cambia niente' : `A te servirebbe il pacchetto ${consigliato?.nome}`}
            </div>
            <div style={{ fontSize: '14px', color: gratis ? '#166534' : '#9a3412', lineHeight: 1.6, marginTop: '6px' }}>
              Questo mese hai spedito <strong>{usate}</strong> {usate === 1 ? 'spedizione' : 'spedizioni'}.
              {gratis
                ? ' Sei dentro il piano gratuito: continui esattamente come adesso.'
                : ` ${consigliato?.limite.toLocaleString('it-IT')} spedizioni al mese, € ${Number(consigliato?.prezzo).toFixed(0)} al mese.`}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: '8px', marginBottom: '16px' }}>
            {piani.map(p => (
              <div key={p.codice} style={{
                border: p.codice === consigliato?.codice ? `2px solid ${ACCENT}` : '1px solid #e8e8e8',
                borderRadius: '10px', padding: '12px 10px', textAlign: 'center',
              }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#8a8a8a', textTransform: 'uppercase' }}>{p.nome}</div>
                <div style={{ fontSize: '19px', fontWeight: 800, color: '#1a1a1a', margin: '3px 0' }}>
                  {p.prezzo > 0 ? `€ ${Number(p.prezzo).toFixed(0)}` : 'Gratis'}
                </div>
                <div style={{ fontSize: '11.5px', color: '#666' }}>{p.limite.toLocaleString('it-IT')} sped./mese</div>
              </div>
            ))}
          </div>

          <p style={{ ...riga, marginBottom: '22px' }}>
            Tutti i pacchetti comprendono tutti i canali di vendita, il salvataggio automatico
            settimanale e gli aggiornamenti gratuiti per sempre. Dal pacchetto Easy in su hai anche
            l’assistenza via chat ed email.
            {!gratis && <> Trovi tutto in <strong>Impostazioni → Chiavi API</strong>, dove puoi attivare il pagamento con carta.</>}
          </p>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            {!gratis && (
              <a href="/cliente/impostazioni/api-key" onClick={hoCapito}
                style={{ background: ACCENT, color: '#fff', textDecoration: 'none', borderRadius: '8px', padding: '11px 20px', fontSize: '14px', fontWeight: 700 }}>
                Vedi i pacchetti
              </a>
            )}
            <button onClick={hoCapito} disabled={chiudendo}
              style={{ background: '#fff', color: '#555', border: '1px solid #d1d5db', borderRadius: '8px', padding: '11px 18px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
              {chiudendo ? '…' : 'Ho capito'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
