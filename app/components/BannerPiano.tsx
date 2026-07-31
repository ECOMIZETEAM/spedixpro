'use client'
import { useEffect, useState } from 'react'

// AVVISO SUL PIANO, in cima a ogni pagina del portale.
//
// Due soglie: dal 90% un avviso arancione ("stai per finire"), al 100% un avviso rosso — a quel
// punto le spedizioni sono gia' bloccate dal server, e il banner serve a spiegare perche' e a
// dare la strada per ripartire (l'upgrade).
//
// A un cliente non arriva ne' il numero ne' il nome di chi ha superato il limite: solo che al
// momento non si puo' spedire e a chi rivolgersi.
export default function BannerPiano({ linkUpgrade = null }: { linkUpgrade?: string | null }) {
  const [s, setS] = useState<any>(null)

  useEffect(() => {
    let vivo = true
    const carica = () => fetch('/api/piano/stato').then(r => r.json()).then(d => { if (vivo) setS(d) }).catch(() => {})
    carica()
    // Il piano puo' sbloccarsi mentre uno sta lavorando (upgrade fatto da un'altra scheda, o dal
    // master sopra): senza un ricontrollo periodico resterebbe il banner rosso di prima.
    // 5 minuti: lo stato cambia di rado, e questo giro lo fa OGNI scheda aperta di OGNI utente.
    const t = setInterval(carica, 300000)
    return () => { vivo = false; clearInterval(t) }
  }, [])

  if (!s || s.error) return null
  const bloccato = !!s.bloccato
  const avviso = !bloccato && !!s.avviso
  if (!bloccato && !avviso) return null

  const rosso = bloccato
  const box = {
    display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' as const,
    background: rosso ? '#fef2f2' : '#fff7ed',
    border: `1px solid ${rosso ? '#fecaca' : '#fed7aa'}`,
    borderRadius: '8px', padding: '11px 16px', marginBottom: '16px',
    fontSize: '13px', color: rosso ? '#b91c1c' : '#9a3412',
  }

  return (
    <div style={box} role="status">
      <span style={{ fontSize: '15px' }}>{rosso ? '⛔' : '⚠️'}</span>
      <div style={{ flex: 1, minWidth: '220px' }}>
        {bloccato ? (
          <><strong>{s.motivo === 'pagamento' ? 'Account sospeso.' : 'Spedizioni sospese.'}</strong> {s.messaggio}</>
        ) : s.giorniPerPagare !== null ? (
          <>
            <strong>Canone non riuscito.</strong>{' '}
            {s.giorniPerPagare > 0
              ? <>Hai <strong>{s.giorniPerPagare} {s.giorniPerPagare === 1 ? 'giorno' : 'giorni'}</strong> per sistemare il pagamento.</>
              : <>Il pagamento va sistemato <strong>oggi</strong>.</>}
            {' '}Dopo, le spedizioni si fermano — anche per i tuoi clienti e i tuoi sotto-master.
          </>
        ) : (
          <>
            <strong>Stai per esaurire il piano.</strong>{' '}
            Hai usato <strong>{Number(s.usato).toLocaleString('it-IT')}</strong> delle{' '}
            {Number(s.limite).toLocaleString('it-IT')} spedizioni di questo mese ({s.perc}%).
            {' '}Al 100% le spedizioni si fermano, anche per la tua rete.
          </>
        )}
        {typeof s.perc === 'number' && s.limite > 0 && s.motivo !== 'pagamento' && s.giorniPerPagare === null && (
          <div style={{ marginTop: '7px', height: '5px', borderRadius: '3px', background: rosso ? '#fee2e2' : '#ffedd5', overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, s.perc)}%`, height: '100%', background: rosso ? '#dc2626' : '#f97316' }} />
          </div>
        )}
      </div>
      {linkUpgrade && (s.bloccatoDaMe || avviso) && (
        <a href={linkUpgrade} style={{
          background: rosso ? '#b91c1c' : '#f97316', color: '#fff', textDecoration: 'none',
          borderRadius: '6px', padding: '7px 14px', fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap',
        }}>{s.motivo === 'pagamento' || s.giorniPerPagare !== null ? 'Sistema il pagamento' : 'Passa a un piano superiore'}</a>
      )}
    </div>
  )
}
