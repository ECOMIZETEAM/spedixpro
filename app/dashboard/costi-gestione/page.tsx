'use client'
import { useEffect, useMemo, useState } from 'react'
import { useDialog } from '@/app/components/DialogProvider'
import { CATEGORIE_PROPOSTE, dataFineDaDurata, quotaNelPeriodo, riepilogoCosti, type CostoGestione } from '@/lib/costi-gestione'

// COSTI DI GESTIONE: le spese dell'azienda che il portale non conosce (personale, affitto, mezzi,
// marketing...). Il titolare le segna qui una volta, con quanto e per quanto tempo; la dashboard e il
// Report Guadagno le tolgono dal Guadagno Totale e mostrano l'utile netto. Non muovono soldi.

const ARANCIO = '#f97316', ROSSO = '#dc2626', VERDE = '#16a34a', NERO = '#1a1a1a'
const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
const OGNI: Record<string, string> = { mensile: 'al mese', annuale: "all'anno", una_tantum: 'una volta' }
const NUOVA = '__nuova__'

const eur = (x: number) => '€ ' + Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const it = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '')
function oggiStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function meseDi(anno: number, mese: number) {
  const fine = new Date(Date.UTC(anno, mese + 1, 0)).getUTCDate()
  const mm = String(mese + 1).padStart(2, '0')
  return { dal: `${anno}-${mm}-01`, al: `${anno}-${mm}-${String(fine).padStart(2, '0')}` }
}

type Form = {
  categoria: string, nuovaCategoria: string, descrizione: string, importo: string,
  periodicita: 'mensile' | 'annuale' | 'una_tantum', dataInizio: string,
  durata: 'mesi' | 'anni' | 'sempre' | 'data', durataNumero: string, dataFine: string, note: string,
}
const vuoto = (): Form => ({
  categoria: CATEGORIE_PROPOSTE[0], nuovaCategoria: '', descrizione: '', importo: '', periodicita: 'mensile',
  dataInizio: oggiStr().slice(0, 8) + '01', durata: 'sempre', durataNumero: '12', dataFine: '', note: '',
})

export default function CostiGestionePage() {
  const dialog = useDialog()
  const [voci, setVoci] = useState<CostoGestione[]>([])
  const [loading, setLoading] = useState(true)
  const [negato, setNegato] = useState('')
  const [form, setForm] = useState<Form>(vuoto)
  const [modifica, setModifica] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [errore, setErrore] = useState('')
  const [successo, setSuccesso] = useState('')
  const [mese, setMese] = useState(() => { const d = new Date(); return { anno: d.getFullYear(), mese: d.getMonth() } })

  async function carica() {
    setLoading(true)
    try {
      const res = await fetch('/api/costi-gestione')
      const j = await res.json()
      if (res.status === 403 || res.status === 401) setNegato(j.error || 'Non autorizzato')
      else if (j.error) setErrore(j.error)
      else setVoci(j.voci || [])
    } catch { setErrore('Impossibile caricare i costi') }
    setLoading(false)
  }
  useEffect(() => { carica() }, [])

  const set = (k: keyof Form, v: string) => setForm(f => ({ ...f, [k]: v }))
  const categorie = useMemo(() => {
    const usate = voci.map(v => v.categoria).filter(c => !CATEGORIE_PROPOSTE.includes(c))
    return [...CATEGORIE_PROPOSTE, ...Array.from(new Set(usate)).sort()]
  }, [voci])

  const periodoMese = meseDi(mese.anno, mese.mese)
  const riepilogo = riepilogoCosti(voci, periodoMese.dal, periodoMese.al)
  const spostaMese = (n: number) => setMese(m => { const d = new Date(m.anno, m.mese + n, 1); return { anno: d.getFullYear(), mese: d.getMonth() } })

  // La stessa voce che salverebbe il server, per far leggere prima cosa succede ("in tutto 4.500 €").
  const anteprima = useMemo(() => {
    const importo = Number(form.importo)
    if (!(importo > 0) || !form.dataInizio) return null
    let fine: string | null = form.dataInizio
    if (form.periodicita !== 'una_tantum') {
      const n = Math.floor(Number(form.durataNumero))
      if (form.durata === 'sempre') fine = null
      else if (form.durata === 'data') fine = form.dataFine && form.dataFine >= form.dataInizio ? form.dataFine : ''
      else fine = n >= 1 ? dataFineDaDurata(form.dataInizio, form.durata === 'anni' ? n * 12 : n) : ''
      if (fine === '') return null
    }
    const voce = { importo, periodicita: form.periodicita, data_inizio: form.dataInizio, data_fine: fine }
    const nome = form.descrizione.trim() || 'Questa voce'
    if (form.periodicita === 'una_tantum') return `${nome}: ${eur(importo)} una volta sola, il ${it(form.dataInizio)}.`
    const ogni = form.periodicita === 'annuale' ? `${eur(importo)} all'anno (${eur(importo / 12)} al mese)` : `${eur(importo)} al mese`
    if (!fine) return `${nome}: ${ogni} dal ${it(form.dataInizio)}, senza scadenza.`
    return `${nome}: ${ogni} dal ${it(form.dataInizio)} al ${it(fine)}, in tutto ${eur(quotaNelPeriodo(voce, form.dataInizio, fine))}.`
  }, [form])

  async function salva() {
    setErrore(''); setSuccesso('')
    const categoria = form.categoria === NUOVA ? form.nuovaCategoria.trim() : form.categoria
    if (!categoria) { setErrore('Scrivi il nome della nuova categoria'); return }
    setSaving(true)
    const res = await fetch('/api/costi-gestione', {
      method: modifica ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, categoria, id: modifica || undefined }),
    })
    const j = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok || j.error) { setErrore(j.error || 'Salvataggio non riuscito'); return }
    setSuccesso(modifica ? 'Voce aggiornata.' : 'Costo aggiunto.')
    setModifica(null)
    setForm(f => ({ ...vuoto(), categoria: categoria, periodicita: f.periodicita }))
    carica()
  }

  function apriModifica(v: CostoGestione) {
    setErrore(''); setSuccesso('')
    setModifica(v.id)
    setForm({
      categoria: v.categoria, nuovaCategoria: '', descrizione: v.descrizione, importo: String(v.importo),
      periodicita: v.periodicita, dataInizio: v.data_inizio,
      // Una voce gia' salvata si riapre con la sua data di fine: per chiuderla (la persona non lavora
      // piu' con te) basta spostare quella, senza rifare il conto dei mesi.
      durata: v.periodicita === 'una_tantum' ? 'sempre' : v.data_fine ? 'data' : 'sempre',
      durataNumero: '12', dataFine: v.data_fine || '', note: v.note || '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function elimina(v: CostoGestione) {
    const ok = await dialog.confirm({
      title: `Eliminare «${v.descrizione}»?`,
      message: v.periodicita === 'una_tantum'
        ? 'La voce sparisce anche dal mese in cui era stata segnata.'
        : 'La voce sparisce anche dai mesi passati, e l\'utile netto di quei mesi torna più alto. Se il costo è solo finito (la persona non lavora più con te), è meglio Modifica e mettere la data di fine.',
      confirmText: 'Elimina', danger: true,
    })
    if (!ok) return
    const res = await fetch(`/api/costi-gestione?id=${v.id}`, { method: 'DELETE' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || j.error) { setErrore(j.error || 'Eliminazione non riuscita'); return }
    if (modifica === v.id) { setModifica(null); setForm(vuoto()) }
    carica()
  }

  if (negato) {
    return (
      <div>
        <h1 style={h1}>Costi di gestione</h1>
        <div style={{ ...card, color: '#6b7280', fontSize: '13px' }}>{negato}</div>
      </div>
    )
  }

  const oggi = oggiStr()
  const stato = (v: CostoGestione) => {
    if (v.data_inizio > oggi) return { testo: `${v.periodicita === 'una_tantum' ? 'Prevista il' : 'Inizia il'} ${it(v.data_inizio)}`, colore: '#2563eb' }
    if (v.periodicita === 'una_tantum') return { testo: 'Pagata', colore: '#6b7280' }
    if (v.data_fine && v.data_fine < oggi) return { testo: `Finita il ${it(v.data_fine)}`, colore: '#6b7280' }
    return { testo: 'In corso', colore: VERDE }
  }

  return (
    <div>
      <style>{`@media (max-width:900px){.grid2{grid-template-columns:1fr !important}}`}</style>
      <h1 style={h1}>Costi di gestione</h1>
      <p style={{ fontSize: '13px', color: '#8a8a8a', margin: '0 0 16px' }}>
        Le spese della tua azienda che non passano dal portale: personale, autisti, affitto, mezzi, sito, marketing…
        Le segni una volta, con quanto e per quanto tempo: la dashboard e il Report Guadagno le tolgono dal Guadagno Totale e ti mostrano l&apos;utile netto.
        Le vedi solo tu e i tuoi admin: non arrivano a operatori, agenti, clienti, né al master sopra di te. Non muovono il credito di nessuno.
      </p>

      {errore && <div style={avvisoErr}>⚠️ {errore}</div>}
      {successo && <div style={avvisoOk}>✅ {successo}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)', gap: '16px', marginBottom: '16px' }} className="grid2">
        {/* Modulo */}
        <div style={{ ...card, marginBottom: 0 }}>
          <div style={titolo}>{modifica ? 'Modifica la voce' : 'Aggiungi un costo'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={lbl}>Categoria</label>
              <select value={form.categoria} onChange={e => set('categoria', e.target.value)} style={inp}>
                {categorie.map(c => <option key={c} value={c}>{c}</option>)}
                <option value={NUOVA}>+ Nuova categoria…</option>
              </select>
              {form.categoria === NUOVA && (
                <input value={form.nuovaCategoria} onChange={e => set('nuovaCategoria', e.target.value)} maxLength={60}
                  placeholder="es. Pulizie magazzino" style={{ ...inp, marginTop: '6px' }} autoFocus />
              )}
            </div>
            <div>
              <label style={lbl}>Voce</label>
              <input value={form.descrizione} onChange={e => set('descrizione', e.target.value)} maxLength={120}
                placeholder="es. Luigi Capotondi, affitto magazzino, Google Ads" style={inp} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={lbl}>Importo (€, senza IVA)</label>
              <input type="number" min="0" step="0.01" value={form.importo} onChange={e => set('importo', e.target.value)} placeholder="1500" style={inp} />
            </div>
            <div>
              <label style={lbl}>Ogni quanto</label>
              <select value={form.periodicita} onChange={e => set('periodicita', e.target.value)} style={inp}>
                <option value="mensile">Al mese</option>
                <option value="annuale">All&apos;anno</option>
                <option value="una_tantum">Una volta sola</option>
              </select>
            </div>
            <div>
              <label style={lbl}>{form.periodicita === 'una_tantum' ? 'Data' : 'Dal'}</label>
              <input type="date" value={form.dataInizio} onChange={e => set('dataInizio', e.target.value)} style={inp} />
            </div>
          </div>

          {form.periodicita !== 'una_tantum' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={lbl}>Validità</label>
                <select value={form.durata} onChange={e => set('durata', e.target.value)} style={inp}>
                  <option value="sempre">Senza scadenza</option>
                  <option value="mesi">Per un numero di mesi</option>
                  <option value="anni">Per un numero di anni</option>
                  <option value="data">Fino a una data</option>
                </select>
              </div>
              {(form.durata === 'mesi' || form.durata === 'anni') && (
                <div>
                  <label style={lbl}>{form.durata === 'mesi' ? 'Quanti mesi' : 'Quanti anni'}</label>
                  <input type="number" min="1" step="1" value={form.durataNumero} onChange={e => set('durataNumero', e.target.value)} style={inp} />
                </div>
              )}
              {form.durata === 'data' && (
                <div>
                  <label style={lbl}>Fino al (incluso)</label>
                  <input type="date" value={form.dataFine} onChange={e => set('dataFine', e.target.value)} style={inp} />
                </div>
              )}
            </div>
          )}

          <div style={{ marginBottom: '12px' }}>
            <label style={lbl}>Note (facoltative)</label>
            <input value={form.note} onChange={e => set('note', e.target.value)} maxLength={300} placeholder="es. contratto a tempo determinato" style={inp} />
          </div>

          {anteprima && <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px', color: NERO, marginBottom: '12px' }}>{anteprima}</div>}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={salva} disabled={saving} style={{ ...btnPrimario, opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Salvataggio…' : modifica ? 'Salva modifiche' : 'Aggiungi'}
            </button>
            {modifica && <button onClick={() => { setModifica(null); setForm(vuoto()); setErrore('') }} style={btnSecondario}>Annulla</button>}
          </div>
        </div>

        {/* Riepilogo del mese */}
        <div style={{ ...card, marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <button onClick={() => spostaMese(-1)} style={btnFreccia} aria-label="Mese precedente">‹</button>
            <div style={{ fontSize: '13px', fontWeight: 700, color: NERO }}>{MESI[mese.mese]} {mese.anno}</div>
            <button onClick={() => spostaMese(1)} style={btnFreccia} aria-label="Mese successivo">›</button>
          </div>
          <div style={{ fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.4px' }}>Costi di gestione del mese</div>
          <div style={{ fontSize: '26px', fontWeight: 800, color: ROSSO, margin: '2px 0 10px' }}>{loading ? '…' : eur(riepilogo.totale)}</div>
          {riepilogo.perCategoria.map(c => (
            <div key={c.categoria} style={{ padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px' }}>
                <b style={{ color: NERO }}>{c.categoria}</b><b style={{ color: NERO }}>{eur(c.importo)}</b>
              </div>
              {c.voci.map(v => (
                <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '11.5px', color: '#8a8a8a', marginTop: '2px' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.descrizione}</span><span>{eur(v.importo)}</span>
                </div>
              ))}
            </div>
          ))}
          {!loading && !riepilogo.perCategoria.length && <div style={{ fontSize: '12.5px', color: '#9ca3af' }}>Nessun costo in questo mese.</div>}
        </div>
      </div>

      {/* Elenco */}
      <div style={card}>
        <div style={titolo}>Le tue voci</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
            <thead>
              <tr>{['Categoria', 'Voce', 'Importo', 'Ogni', 'Dal', 'Al', `${MESI[mese.mese]} ${mese.anno}`, 'Stato', ''].map((h, i) => (
                <th key={i} style={{ textAlign: i >= 2 && i <= 6 && i !== 3 ? 'right' : 'left', padding: '8px 10px', fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {voci.map(v => {
                const st = stato(v)
                return (
                  <tr key={v.id} style={{ background: modifica === v.id ? '#fff7ed' : undefined }}>
                    <td style={td}>{v.categoria}</td>
                    <td style={{ ...td, whiteSpace: 'normal', minWidth: '160px' }}>
                      {v.descrizione}
                      {v.note && <div style={{ fontSize: '11px', color: '#9ca3af' }}>{v.note}</div>}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{eur(v.importo)}</td>
                    <td style={td}>{OGNI[v.periodicita]}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{it(v.data_inizio)}</td>
                    <td style={{ ...td, textAlign: 'right', color: v.data_fine || v.periodicita === 'una_tantum' ? NERO : '#9ca3af' }}>{v.periodicita === 'una_tantum' ? '—' : v.data_fine ? it(v.data_fine) : 'senza scadenza'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{eur(quotaNelPeriodo(v, periodoMese.dal, periodoMese.al))}</td>
                    <td style={{ ...td, color: st.colore, fontWeight: 600 }}>{st.testo}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button onClick={() => apriModifica(v)} style={btnLink}>Modifica</button>
                      <button onClick={() => elimina(v)} style={{ ...btnLink, color: ROSSO }}>Elimina</button>
                    </td>
                  </tr>
                )
              })}
              {!loading && !voci.length && <tr><td colSpan={9} style={{ padding: '22px', textAlign: 'center', color: '#9ca3af' }}>Nessuna voce. Aggiungi il primo costo qui sopra: per esempio lo stipendio di un dipendente, al mese, per 3 mesi.</td></tr>}
              {loading && <tr><td colSpan={9} style={{ padding: '22px', textAlign: 'center', color: '#9ca3af' }}>Caricamento…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const h1 = { fontSize: '20px', fontWeight: 700, color: NERO, margin: '0 0 2px' }
const card = { background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', padding: '16px', marginBottom: '16px' }
const titolo = { fontSize: '13px', fontWeight: 700, color: NERO, marginBottom: '12px' }
const lbl = { fontSize: '12px', fontWeight: 600 as const, color: NERO, display: 'block' as const, marginBottom: '4px' }
const inp = { width: '100%', padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', color: NERO, background: '#fff', boxSizing: 'border-box' as const }
const td = { padding: '8px 10px', color: NERO, borderBottom: '1px solid #f6f6f6', whiteSpace: 'nowrap' as const, verticalAlign: 'top' as const }
const btnPrimario = { padding: '9px 22px', background: ARANCIO, color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700 as const, cursor: 'pointer' }
const btnSecondario = { padding: '9px 18px', background: '#fff', color: NERO, border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', fontWeight: 600 as const, cursor: 'pointer' }
const btnLink = { background: 'none', border: 'none', color: ARANCIO, fontSize: '12px', fontWeight: 600 as const, cursor: 'pointer', padding: '0 6px' }
const btnFreccia = { background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '6px', width: '30px', height: '28px', fontSize: '16px', cursor: 'pointer', color: NERO }
const avvisoErr = { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: ROSSO }
const avvisoOk = { background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: VERDE }
