'use client'
// Il tracking dell'Elenco spedizioni con la grafica nuova (18/11, Lorenzo: «il pop up del tracking mi piaceva che usciva
// sulla destra tipo a tendina»): gli stessi dati e le stesse tre schede della finestra di oggi (Tracking, Colli,
// Ripesature), in una tendina che scivola da destra. Si chiude con ×, con Esc o cliccando fuori.
import { useEffect, useState } from 'react'
import { numeroMostrato } from '@/lib/numero-spedizione'
import { dataEventoIt } from '@/lib/tracking-eventi'
import { vettoreFisico } from '@/lib/vettore'
import SchedaRipesatura from '@/app/components/SchedaRipesatura'
import { Icona } from './icone'

type Scheda = 'tracking' | 'colli' | 'ripesature'
const euro = (n: any) => n == null || !isFinite(Number(n)) ? '—' : '€ ' + Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function TrackingLaterale({ s, st, dati, caricando, scheda, setScheda, chiudi, stampa, dettaglio, cliente = false }: {
  s: any; st?: { bg: string; color: string; label: string }; dati: any; caricando: boolean
  scheda: Scheda; setScheda: (x: Scheda) => void; chiudi: () => void; stampa: () => void; dettaglio: () => void
  // nel portale cliente (19/11): dei soldi si mostra solo quanto ha pagato lui, mai costo e margine di chi rivende
  cliente?: boolean
}) {
  // l'uscita: prima scivola via, poi si smonta
  const [via, setVia] = useState(false)
  const esci = () => { setVia(true); setTimeout(chiudi, 260) }
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') esci() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const eventi: any[] = dati?.eventi || []
  const luogo = [s.dest_citta, s.dest_provincia ? `(${s.dest_provincia})` : ''].filter(Boolean).join(' ')
  // come nella riga: «Bastia Umbra (PG) 06083», e il paese solo se non è l'Italia
  const localita = [s.dest_citta, s.dest_provincia ? `(${s.dest_provincia})` : '', s.dest_cap, s.dest_paese && s.dest_paese !== 'IT' ? `· ${s.dest_paese}` : ''].filter(Boolean).join(' ')
  const indirizzo = [s.dest_indirizzo, localita].filter(Boolean).join(', ')
  const margine = s.margine == null ? null : Number(s.margine)

  return (
    <div className={'tl-velo' + (via ? ' tl-via' : '')} onClick={esci}>
      <aside className="tl" role="dialog" aria-label={`Tracking ${numeroMostrato(s.numero, s.tracking_number)}`} onClick={e => e.stopPropagation()}>
        <header className="tl-testa">
          <div className="tl-riga1">
            <span className="tl-vettore">{vettoreFisico(s.corrieri || {})}</span>
            <div className="tl-chi">
              <b>{dati?.corriere || s.corrieri?.nome_contratto || '…'}</b>
              <span>{[s.clienti?.ragione_sociale, s.id_ordine ? `Ordine ${s.id_ordine}` : ''].filter(Boolean).join(' · ')}</span>
            </div>
            <button type="button" className="tl-x" onClick={esci} aria-label="Chiudi">×</button>
          </div>
          <div className="tl-numero">{numeroMostrato(s.numero, s.tracking_number)}</div>
          <div className="tl-stato">
            {st && <span className="tl-pillola" style={{ background: st.bg, color: st.color }}>{st.label}</span>}
            {luogo && <span className="tl-dove">{luogo}</span>}
          </div>
          <nav className="tl-schede">
            {(['tracking', 'colli', 'ripesature'] as Scheda[]).map(k => (
              <button key={k} type="button" aria-pressed={scheda === k} onClick={() => setScheda(k)}>
                {k === 'tracking' ? 'Tracking' : k === 'colli' ? 'Colli' : 'Ripesature'}
              </button>
            ))}
          </nav>
        </header>

        <div className="tl-corpo">
          {scheda === 'tracking' && <>
            <section>
              <h3>Tracking</h3>
              {caricando ? <div className="tl-vuoto">Caricamento del tracking…</div>
                : !eventi.length ? (
                  <div className="tl-vuoto">
                    {dati?.error ? `Errore: ${dati.error}` : 'Nessun evento disponibile al momento: il dettaglio arriverà con il prossimo aggiornamento del corriere.'}
                    {dati?.tracking_number && <div className="tl-piccolo">Tracking: {dati.tracking_number}</div>}
                  </div>
                ) : (
                  <ol className="tl-eventi">
                    {eventi.map((e, i) => (
                      <li key={i} className={i === 0 ? 'tl-ultimo' : undefined} style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}>
                        <time>{dataEventoIt(e.date || e.data || e.datetime || e.timestamp || e.eventDate) || '—'}</time>
                        <i aria-hidden="true" />
                        <div>
                          <b>{e.description || e.descrizione || e.status || e.evento || e.message || e.eventDescription || JSON.stringify(e)}</b>
                          {(e.location || e.luogo || e.place || e.eventLocation) && <span>{e.location || e.luogo || e.place || e.eventLocation}</span>}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
            </section>

            <section>
              <h3>Destinatario</h3>
              <div className="tl-dest">
                <b>{s.dest_nome}</b>
                {indirizzo && <span>{indirizzo}</span>}
                {s.dest_telefono && <span>{s.dest_telefono}</span>}
                {s.dest_email && <span>{s.dest_email}</span>}
              </div>
              {(dati?.contenuto || dati?.cliente) && (
                <dl className="tl-voci">
                  {dati?.contenuto && <><dt>Contenuto</dt><dd>{dati.contenuto}</dd></>}
                  {dati?.cliente && <><dt>Creato da</dt><dd>{dati.cliente}</dd></>}
                </dl>
              )}
            </section>

            {cliente ? (
            <section>
              <h3>Costo</h3>
              <div className="tl-soldi tl-soldi--uno">
                <div><span>Totale della spedizione</span><b>{euro(s.costo_totale)}</b></div>
              </div>
            </section>
            ) : (
            <section>
              <h3>Soldi <em>solo per te</em></h3>
              <div className="tl-soldi">
                <div><span>Al cliente</span><b>{euro(s.prezzo_cliente ?? s.costo_mostrato ?? s.costo_totale)}</b></div>
                <div><span>Costo</span><b>{euro(s.prezzo_corriere)}</b></div>
                <div className={margine == null ? undefined : margine < 0 ? 'tl-meno' : 'tl-piu'}><span>Margine</span><b>{euro(margine)}</b></div>
              </div>
            </section>
            )}
          </>}

          {scheda === 'colli' && (
            <section>
              {!dati?.colli_dettaglio?.length ? (
                <div className="tl-vuoto">
                  Spedizione a collo singolo
                  {s.tracking_number && <div className="tl-piccolo">Tracking: {s.tracking_number}</div>}
                </div>
              ) : (
                <div className="tl-colli">
                  {dati.colli_dettaglio.map((c: any, i: number) => (
                    <div key={i}>
                      <b>Collo {c.numero} di {dati.colli_dettaglio.length}</b>
                      {c.lunghezza && <span>{c.lunghezza} × {c.larghezza} × {c.altezza} cm · {c.peso} kg</span>}
                      {c.etichetta_url && <span className="tl-piccolo">Tracking collo: {c.etichetta_url.includes('base64') ? 'PDF disponibile' : c.etichetta_url}</span>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {scheda === 'ripesature' && <section className="tl-ripesature"><SchedaRipesatura dati={dati?.ripesatura} /></section>}
        </div>

        <footer className="tl-piede">
          <button type="button" onClick={stampa}><Icona id="i-stampa" />Etichetta</button>
          <button type="button" className="tl-avanti" onClick={dettaglio}>Dettaglio completo<Icona id="i-chevron" /></button>
        </footer>
      </aside>
    </div>
  )
}
