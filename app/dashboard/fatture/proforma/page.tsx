'use client'
import { useEffect, useState } from 'react'
import SelectCercabile from '@/app/components/SelectCercabile'
import DateRangePicker from '@/app/components/DateRangePicker'
import { useDialog } from '@/app/components/DialogProvider'
import { giornoRoma } from '@/lib/date-roma'

// FATTURA PROFORMA: il master sceglie un cliente e un periodo, vede quanto il cliente gli deve voce per
// voce (spedizioni, rettifiche, giacenze, resi, servizi, voci a mano, meno i rimborsi), e la crea:
// numero suo, PDF col dettaglio, invio per email. Il calcolo e' tutto nella rotta (lib/fatture/proforma):
// la pagina mostra, non conta.

const eur = (n: number) => '€ ' + Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const giorno = (g: string) => g ? `${g.slice(8, 10)}/${g.slice(5, 7)}/${g.slice(0, 4)}` : ''
const quando = (iso: string) => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// Il mese scorso, nei giorni di Roma: la proforma piu' chiesta e' quella del mese appena chiuso.
function meseScorso(): { dal: string; al: string } {
  const [a, m] = giornoRoma().split('-').map(Number)
  const anno = m === 1 ? a - 1 : a, mese = m === 1 ? 12 : m - 1
  const fine = new Date(Date.UTC(anno, mese, 0)).getUTCDate()
  const mm = String(mese).padStart(2, '0')
  return { dal: `${anno}-${mm}-01`, al: `${anno}-${mm}-${String(fine).padStart(2, '0')}` }
}

const NERO = '#1a1a1a', ARANCIO = '#f97316', GRIGIO = '#6b7280'
const card = { background: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', padding: '16px', marginBottom: '16px' }
const lbl = { fontSize: '11px', fontWeight: 600 as const, color: NERO, display: 'block' as const, marginBottom: '4px' }
const sel = { padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '12px', background: '#fff', color: NERO, width: '100%' }
const btnP = { padding: '9px 20px', background: ARANCIO, color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700 as const, cursor: 'pointer' }
const btnS = { padding: '6px 12px', background: '#fff', color: NERO, border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '12px', fontWeight: 600 as const, cursor: 'pointer' }
const th = { textAlign: 'left' as const, padding: '8px 10px', fontSize: '11px', color: GRIGIO, fontWeight: 600 as const, borderBottom: '1px solid #e5e7eb' }
const td = { padding: '8px 10px', fontSize: '13px', color: NERO, borderBottom: '1px solid #f3f4f6' }

export default function FatturaProformaPage() {
  const dialog = useDialog()
  const [clienti, setClienti] = useState<any[]>([])
  const [clienteId, setClienteId] = useState('')
  const [periodo, setPeriodo] = useState(meseScorso())
  const [anteprima, setAnteprima] = useState<any>(null)
  const [occupato, setOccupato] = useState('')
  const [elenco, setElenco] = useState<any[]>([])
  const [erroreElenco, setErroreElenco] = useState('')

  useEffect(() => {
    fetch('/api/clienti/lista').then(r => r.json()).then(d => setClienti(Array.isArray(d) ? d.filter((c: any) => c?.id && !String(c.id).startsWith('m:')) : [])).catch(() => {})
    caricaElenco()
  }, [])

  async function caricaElenco() {
    const r = await fetch('/api/fatture/proforma').catch(() => null)
    const d = await r?.json().catch(() => null)
    setElenco(Array.isArray(d) ? d : [])
    setErroreElenco(Array.isArray(d) ? '' : 'Elenco delle proforme non letto: ' + (d?.error || 'errore di rete'))
  }

  // Cambiare cliente o date rende vecchia l'anteprima: si toglie, cosi' non si crea su cifre di prima.
  function scegliCliente(v: string) { setClienteId(v); setAnteprima(null) }
  function scegliPeriodo(dal: string, al: string) { setPeriodo({ dal, al }); setAnteprima(null) }

  async function chiama(crea: boolean) {
    const r = await fetch('/api/fatture/proforma', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clienteId, dal: periodo.dal, al: periodo.al, crea }),
    }).catch(() => null)
    const d = await r?.json().catch(() => null)
    if (!r?.ok || !d) throw new Error(d?.error || 'errore di rete')
    return d
  }

  async function calcola() {
    if (!clienteId) { await dialog.alert({ title: 'Manca il cliente', message: 'Scegli il cliente della proforma.' }); return }
    setOccupato('calcolo')
    try { setAnteprima(await chiama(false)) }
    catch (e: any) { await dialog.alert({ title: 'Errore', message: e.message }) }
    finally { setOccupato('') }
  }

  async function crea() {
    setOccupato('crea')
    try {
      const d = await chiama(true)
      setAnteprima(null)
      await caricaElenco()
      window.open(`/api/fatture/proforma/${d.id}/pdf`, '_blank')
    } catch (e: any) { await dialog.alert({ title: 'Proforma non creata', message: e.message }) }
    finally { setOccupato('') }
  }

  async function invia(p: any) {
    const email = await dialog.prompt({ title: `Invia la proforma ${p.numero}`, message: `A quale indirizzo mandarla? Parte a nome tuo, col PDF allegato.`, defaultValue: p.inviata_a || p.email || '', confirmText: 'Invia' })
    if (email == null) return
    setOccupato('invia:' + p.id)
    try {
      const r = await fetch(`/api/fatture/proforma/${p.id}/invia`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }).catch(() => null)
      const d = await r?.json().catch(() => null)
      if (!r?.ok) throw new Error(d?.error || 'errore di rete')
      await caricaElenco()
      await dialog.alert({ title: 'Inviata', message: `Proforma ${p.numero} inviata a ${d.inviata_a}.` })
    } catch (e: any) { await dialog.alert({ title: 'Errore', message: e.message }) }
    finally { setOccupato('') }
  }

  const a = anteprima
  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: NERO, margin: '0 0 2px' }}>Fattura proforma</h1>
      <p style={{ fontSize: '13px', color: GRIGIO, margin: '0 0 16px' }}>
        Tutto quello che un cliente ti deve in un periodo: spedizioni, rettifiche, giacenze, resi, servizi e voci registrate a mano, meno i rimborsi. Vale per i clienti a credito e per quelli a fattura. Non è una fattura: non va allo SDI.
      </p>

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '12px', alignItems: 'end' }}>
          <div><label style={lbl}>Cliente</label>
            <SelectCercabile value={clienteId} onChange={e => scegliCliente(e.target.value)} style={sel}>
              <option value="">Scegli il cliente…</option>
              {clienti.map((c: any) => <option key={c.id} value={c.id}>{c.ragione_sociale}{c.codice_cliente ? ` (${c.codice_cliente})` : ''}</option>)}
            </SelectCercabile>
          </div>
          <div><label style={lbl}>Periodo</label>
            <DateRangePicker dal={periodo.dal} al={periodo.al} onChange={scegliPeriodo} />
          </div>
          <div><button onClick={calcola} disabled={!!occupato} style={{ ...btnP, opacity: occupato ? 0.6 : 1 }}>{occupato === 'calcolo' ? 'Calcolo…' : 'Calcola'}</button></div>
        </div>
      </div>

      {a && (
        <div style={card}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: NERO, marginBottom: '10px' }}>
            Anteprima — dal {giorno(periodo.dal)} al {giorno(periodo.al)}
          </div>
          {!a.movimenti ? (
            <div style={{ fontSize: '13px', color: GRIGIO }}>Nel periodo il cliente non ha spese: non c&apos;è niente da mettere in proforma.</div>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse', maxWidth: '640px' }}>
                <thead><tr><th style={th}>Voce</th><th style={{ ...th, textAlign: 'right' }}>Quante</th><th style={{ ...th, textAlign: 'right' }}>Importo</th></tr></thead>
                <tbody>
                  {a.righe.map((r: any) => (
                    <tr key={r.voce}><td style={td}>{r.descrizione}</td><td style={{ ...td, textAlign: 'right' }}>{r.quantita}</td><td style={{ ...td, textAlign: 'right' }}>{eur(r.importo)}</td></tr>
                  ))}
                  <tr><td style={{ ...td, fontWeight: 700 }}>Imponibile</td><td style={td}></td><td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{eur(a.imponibile)}</td></tr>
                  <tr><td style={td}>IVA {a.aliquota}%{a.aliquota === 0 && a.natura ? ` (${a.natura})` : ''}</td><td style={td}></td><td style={{ ...td, textAlign: 'right' }}>{eur(a.iva)}</td></tr>
                  <tr><td style={{ ...td, fontWeight: 700 }}>Totale</td><td style={td}></td><td style={{ ...td, textAlign: 'right', fontWeight: 700, color: ARANCIO }}>{eur(a.totale)}</td></tr>
                </tbody>
              </table>
              {(a.ricariche?.n > 0 || a.contrassegni?.n > 0) && (
                <div style={{ marginTop: '12px', padding: '10px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '12px', color: GRIGIO, maxWidth: '616px' }}>
                  <b style={{ color: NERO }}>Per informazione, non inclusi nel totale:</b>
                  {a.ricariche?.n > 0 && <div>Ricariche nel periodo: {a.ricariche.n} per {eur(a.ricariche.importo)}</div>}
                  {a.contrassegni?.n > 0 && <div>Contrassegni accreditati nel periodo: {a.contrassegni.n} per {eur(a.contrassegni.importo)}</div>}
                </div>
              )}
              <div style={{ marginTop: '14px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={crea} disabled={!!occupato} style={{ ...btnP, opacity: occupato ? 0.6 : 1 }}>{occupato === 'crea' ? 'Creazione…' : 'Crea proforma'}</button>
                <span style={{ fontSize: '12px', color: GRIGIO }}>{a.movimenti} movimenti nel dettaglio. Prende il prossimo numero della serie proforma dell&apos;anno.</span>
              </div>
            </>
          )}
        </div>
      )}

      <div style={card}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: NERO, marginBottom: '10px' }}>Proforme create</div>
        {erroreElenco && <div style={{ padding: '10px 12px', marginBottom: '10px', border: '1px solid #fecaca', borderRadius: '6px', background: '#fef2f2', color: '#b91c1c', fontSize: '12px' }}>{erroreElenco}</div>}
        {!elenco.length && !erroreElenco ? <div style={{ fontSize: '13px', color: GRIGIO }}>Nessuna proforma ancora.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
              <thead><tr>
                <th style={th}>Numero</th><th style={th}>Creata</th><th style={th}>Cliente</th><th style={th}>Periodo</th>
                <th style={{ ...th, textAlign: 'right' }}>Totale</th><th style={th}>Inviata</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {elenco.map(p => (
                  <tr key={p.id}>
                    <td style={{ ...td, fontWeight: 700 }}>{p.numero}</td>
                    <td style={td}>{quando(p.created_at)}</td>
                    <td style={td}>{p.cliente}</td>
                    <td style={td}>{giorno(p.dal)} – {giorno(p.al)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{eur(p.totale)}</td>
                    <td style={{ ...td, fontSize: '12px', color: p.inviata_il ? NERO : GRIGIO }}>{p.inviata_il ? `${p.inviata_a} · ${quando(p.inviata_il)}` : 'Non ancora'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <a href={`/api/fatture/proforma/${p.id}/pdf`} target="_blank" rel="noreferrer" style={{ ...btnS, textDecoration: 'none', marginRight: '6px' }}>PDF</a>
                      <button onClick={() => invia(p)} disabled={!!occupato} style={btnS}>{occupato === 'invia:' + p.id ? 'Invio…' : 'Invia per email'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
