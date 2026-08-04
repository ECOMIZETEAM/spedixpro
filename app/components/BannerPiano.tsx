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
// IL TEMPO CHE RESTA, DETTO COME LO DIREBBE UNA PERSONA.
// "2 giorni" letto di sera e "2 giorni" letto di mattina non sono la stessa cosa: sotto le 48 ore
// si passa alle ore, e nell'ultima ora ai minuti, perche' e' li' che serve muoversi.
function tempoMancante(scadenza: string | null, ora: number): string {
  if (!scadenza) return ''
  const ms = new Date(scadenza).getTime() - ora
  if (!(ms > 0)) return ''
  const minuti = Math.floor(ms / 60000)
  const ore = Math.floor(minuti / 60)
  const giorni = Math.floor(ore / 24)
  if (giorni >= 2) return `${giorni} giorni e ${ore % 24} ore`
  if (ore >= 1) return `${ore} ${ore === 1 ? 'ora' : 'ore'} e ${minuti % 60} min`
  return `${minuti} ${minuti === 1 ? 'minuto' : 'minuti'}`
}

export default function BannerPiano({ linkUpgrade = null }: { linkUpgrade?: string | null }) {
  const [s, setS] = useState<any>(null)
  const [ora, setOra] = useState(() => Date.now())

  // Il conto alla rovescia scende mentre lo si guarda: un numero fermo lo si legge come una data
  // lontana. Ogni minuto basta — sotto l'ora si vedono i minuti scalare, ed e' quello che serve.
  useEffect(() => {
    const t = setInterval(() => setOra(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

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
  // Il congelato ha gia' la sua schermata sopra il portale: qui basta il limite.
  const bloccato = !!s.bloccato
  const avviso = !bloccato && !!s.avviso
  if (!bloccato && !avviso) return null

  // Se il fondo non ha ancora la scadenza esatta (installazioni vecchie), si ripiega sui giorni.
  const mancante = tempoMancante(s.scadenzaPagamento, ora)
    || (s.giorniPerPagare > 0 ? `${s.giorniPerPagare} ${s.giorniPerPagare === 1 ? 'giorno' : 'giorni'}` : '')

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
            {/* QUELLO CHE SUCCEDE DAVVERO, non quello che succedeva prima.
                Il banner diceva che si fermano le spedizioni "anche per i tuoi clienti e i tuoi
                sotto-master": non e' vero e non lo e' mai stato nelle intenzioni — chi sta sotto
                il canone non lo deve. A fermarsi e' solo chi non ha pagato, e solo lui. Dirgli il
                falso, per giunta piu' grave del vero, lo mette in allarme con i suoi clienti per
                una cosa che non succedera'. */}
            <strong>Canone non riuscito.</strong>{' '}
            {mancante
              ? <>Ti resta <strong>{mancante}</strong> per sistemare il pagamento.</>
              : <>Il pagamento va sistemato <strong>adesso</strong>.</>}
            {' '}Dopo non potrai più operare dal portale: i tuoi clienti e i tuoi sotto-master
            continuano a spedire normalmente.
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
