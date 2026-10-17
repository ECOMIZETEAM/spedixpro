'use client'
import { useEffect, useState } from 'react'
import { LegendaResi } from '@/app/components/ResiPercentuale'
import { COLORI_RESI, RESI_PERIODI, type PeriodoResi } from '@/lib/resi-percentuale'

// "I TUOI RESI" NEL PORTALE CLIENTE (richiesta di Lorenzo, 17/10/2026): la percentuale di resi del
// cliente, con gli stessi colori e lo stesso conteggio che vede il suo master. In dashboard sui 90 giorni;
// nella sezione Resi col periodo a scelta.

export default function ResiClienteBlocco({ selettore = false }: { selettore?: boolean }) {
  const [giorni, setGiorni] = useState<PeriodoResi>(90)
  const [d, setD] = useState<any>(null)
  const [errore, setErrore] = useState(false)
  useEffect(() => {
    let vivo = true
    setErrore(false)
    fetch(`/api/cliente/resi/percentuale?giorni=${giorni}`, { cache: 'no-store' }).then(r => r.json()).then(x => {
      if (!vivo) return
      if (x && !x.error) setD(x); else setErrore(true)
    }).catch(() => { if (vivo) setErrore(true) })
    return () => { vivo = false }
  }, [giorni])

  const card = { background: '#fff', border: '1px solid #e8e8e8', borderRadius: '8px', padding: '14px 16px' }
  const etichetta = { fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.6px', color: '#999' }
  const messaggio = (l: string) => l === 'ok' ? 'I tuoi resi sono nella norma.'
    : l === 'pochi' ? 'Troppe poche spedizioni nel periodo per dare un giudizio.'
    : l === 'giallo' ? 'Un po’ sopra la norma: controlla indirizzi e recapiti dei destinatari.'
    : l === 'arancione' ? 'Resi alti: ogni reso è un costo. Controlla indirizzi, recapiti e descrizione della merce.'
    : 'Resi molto alti: ogni reso è un costo. Verifica con il tuo referente cosa sta succedendo.'

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <div style={etichetta}>↩ I tuoi resi · ultimi {giorni} giorni</div>
        {selettore && (
          <div style={{ display: 'flex', gap: '5px' }}>
            {RESI_PERIODI.map(g => (
              <button key={g} onClick={() => setGiorni(g)}
                style={{ padding: '5px 10px', borderRadius: '7px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', border: `1px solid ${giorni === g ? '#1a1a1a' : '#d1d5db'}`, background: giorni === g ? '#1a1a1a' : '#fff', color: giorni === g ? '#fff' : '#1a1a1a' }}>
                {g} gg
              </button>
            ))}
          </div>
        )}
      </div>
      {!d ? (
        <div style={{ fontSize: '13px', color: '#999', marginTop: '10px' }}>{errore ? 'Dati non disponibili.' : 'Caricamento…'}</div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '28px', fontWeight: 800, color: d.livello === 'ok' || d.livello === 'pochi' ? '#1a1a1a' : COLORI_RESI[d.livello as keyof typeof COLORI_RESI].fg, lineHeight: 1 }}>{String(d.pct).replace('.', ',')}%</span>
            <span style={{ background: COLORI_RESI[d.livello as keyof typeof COLORI_RESI].bg, border: `1px solid ${COLORI_RESI[d.livello as keyof typeof COLORI_RESI].bd}`, color: COLORI_RESI[d.livello as keyof typeof COLORI_RESI].fg, borderRadius: '999px', padding: '2px 10px', fontSize: '12px', fontWeight: 800 }}>
              {COLORI_RESI[d.livello as keyof typeof COLORI_RESI].etichetta}
            </span>
            <span style={{ fontSize: '12px', color: '#6b7280' }}>{Number(d.resi).toLocaleString('it-IT')} resi su {Number(d.partite).toLocaleString('it-IT')} spedizioni partite</span>
          </div>
          <div style={{ fontSize: '12.5px', fontWeight: 600, color: COLORI_RESI[d.livello as keyof typeof COLORI_RESI].fg, marginTop: '8px' }}>{messaggio(d.livello)}</div>
          <div style={{ marginTop: '10px' }}><LegendaResi /></div>
        </>
      )}
    </div>
  )
}
