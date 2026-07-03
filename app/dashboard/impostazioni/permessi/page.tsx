'use client'
import { useState, useEffect } from 'react'

type Perm = { k: string; l: string; o: boolean; a: boolean }
type Gruppo = { t: string; p: Perm[] }

const GRUPPI: Gruppo[] = [
  { t: 'Spedizioni', p: [
    { k: 'admin.shippings.index', l: 'Visualizza elenco spedizioni', o: true, a: true },
    { k: 'admin.shippings.create', l: 'Crea nuove spedizioni', o: true, a: true },
    { k: 'admin.shippings.edit', l: 'Modifica spedizioni', o: true, a: true },
    { k: 'admin.shippings.delete', l: 'Elimina spedizioni', o: true, a: true },
    { k: 'admin.shippings.cancelled.index', l: 'Visualizza spedizioni cancellate', o: true, a: true },
  ]},
  { t: 'Giacenze', p: [
    { k: 'admin.stocks.index', l: 'Visualizza giacenze', o: true, a: true },
    { k: 'admin.stocks.edit', l: 'Modifica giacenze', o: true, a: true },
    { k: 'admin.stocks.update', l: 'Aggiorna giacenze', o: true, a: true },
  ]},
  { t: 'Contrassegni', p: [
    { k: 'admin.cod.index', l: 'Visualizza contrassegni', o: true, a: true },
    { k: 'admin.cod.update', l: 'Aggiorna contrassegni', o: true, a: true },
    { k: 'admin.cod.excel', l: 'Esporta contrassegni in Excel', o: true, a: true },
    { k: 'admin.cod.bulk_update', l: 'Aggiornamento massivo contrassegni', o: true, a: true },
    { k: 'admin.codlists.index', l: 'Visualizza distinte contrassegni', o: true, a: true },
    { k: 'admin.codlists.uploadfile', l: 'Carica file contrassegni', o: true, a: true },
  ]},
  { t: 'Rettifiche peso', p: [
    { k: 'admin.shippings.weight_corrections.index', l: 'Visualizza rettifiche peso', o: true, a: false },
    { k: 'admin.shippings.weight_corrections.uploadfile', l: 'Carica file rettifiche peso', o: true, a: false },
    { k: 'admin.shippings.weight_corrections.confirm', l: 'Conferma rettifiche peso', o: true, a: false },
    { k: 'admin.shippings.weight_corrections.delete', l: 'Elimina rettifiche peso', o: true, a: false },
  ]},
  { t: 'Ritiri', p: [
    { k: 'admin.pickups.index', l: 'Visualizza ritiri', o: true, a: false },
  ]},
  { t: 'Distinte spedizioni', p: [
    { k: 'admin.shippinglists.create', l: 'Crea distinte spedizioni', o: true, a: true },
    { k: 'admin.shippinglists.index', l: 'Visualizza distinte spedizioni', o: true, a: true },
    { k: 'admin.shippinglists.confirm', l: 'Conferma distinte spedizioni', o: true, a: true },
    { k: 'admin.shippinglists.print', l: 'Stampa distinte spedizioni', o: true, a: true },
  ]},
  { t: 'Resi', p: [
    { k: 'admin.renderlist.scan', l: 'Scansiona resi', o: true, a: false },
    { k: 'admin.renderlist.index', l: 'Visualizza distinte resi', o: true, a: false },
  ]},
  { t: 'Listini prezzi', p: [
    { k: 'admin.pricelists.create', l: 'Crea listini prezzi', o: false, a: true },
    { k: 'admin.pricelists.index', l: 'Visualizza listini prezzi', o: true, a: false },
    { k: 'admin.pricelists.edit', l: 'Modifica listini prezzi', o: true, a: false },
    { k: 'admin.pricelists.delete', l: 'Elimina listini prezzi', o: false, a: false },
    { k: 'admin.pricelists.vector', l: 'Gestisci listini corrieri', o: false, a: false },
    { k: 'admin.pricelists.zones.index', l: 'Visualizza zone tariffarie', o: true, a: false },
    { k: 'admin.pricelists.zones.create', l: 'Crea zone tariffarie', o: true, a: false },
    { k: 'admin.pricelists.zones.edit', l: 'Modifica zone tariffarie', o: true, a: false },
  ]},
  { t: 'Clienti', p: [
    { k: 'admin.clients.create', l: 'Crea nuovi clienti', o: false, a: true },
    { k: 'admin.clients.index', l: 'Visualizza elenco clienti', o: true, a: true },
    { k: 'admin.clients.view', l: 'Visualizza dettagli cliente', o: true, a: false },
    { k: 'admin.clients.edit', l: 'Modifica clienti', o: false, a: false },
    { k: 'admin.clients.options', l: 'Gestisci opzioni cliente', o: false, a: false },
    { k: 'admin.clients.credit', l: 'Gestisci credito cliente', o: true, a: false },
  ]},
  { t: 'Autisti', p: [
    { k: 'admin.drivers.index', l: 'Visualizza elenco autisti', o: true, a: false },
    { k: 'admin.drivers.create', l: 'Crea nuovi autisti', o: true, a: false },
    { k: 'admin.drivers.resetpassword', l: 'Reimposta password autisti', o: false, a: false },
    { k: 'admin.drivers.delete', l: 'Elimina autisti', o: false, a: false },
    { k: 'admin.drivers.collections', l: 'Gestisci ritiri autisti', o: true, a: false },
    { k: 'admin.drivers.pickuplists', l: 'Visualizza liste ritiri autisti', o: true, a: false },
    { k: 'admin.drivers.deliveries', l: 'Visualizza consegne autisti', o: true, a: false },
    { k: 'admin.drivers.fleetmap', l: 'Visualizza mappa flotta autisti', o: false, a: false },
  ]},
  { t: 'Consumabili', p: [
    { k: 'admin.consumables.create', l: 'Crea materiali consumabili', o: true, a: false },
    { k: 'admin.consumables.index', l: 'Visualizza materiali consumabili', o: true, a: false },
  ]},
  { t: 'Fatture', p: [
    { k: 'admin.invoice.create', l: 'Crea fatture', o: true, a: false },
    { k: 'admin.invoice.index', l: 'Visualizza fatture', o: true, a: true },
  ]},
  { t: 'Report', p: [
    { k: 'admin.reports.shippings', l: 'Report spedizioni', o: true, a: false },
    { k: 'admin.reports.stocks', l: 'Report giacenze', o: true, a: false },
    { k: 'admin.reports.shippinglists', l: 'Report liste spedizioni', o: true, a: false },
    { k: 'admin.reports.cod', l: 'Report contrassegni', o: true, a: false },
    { k: 'admin.reports.pickups', l: 'Report ritiri', o: true, a: false },
    { k: 'admin.reports.priceupdates', l: 'Report aggiornamenti prezzi', o: true, a: false },
    { k: 'admin.reports.consumables', l: 'Report materiali consumabili', o: true, a: false },
    { k: 'admin.reports.invoices', l: 'Report fatture', o: true, a: false },
    { k: 'admin.reports.rendershippings', l: 'Report rese spedizioni', o: true, a: false },
    { k: 'admin.reports.sms.clients', l: 'Report SMS clienti', o: true, a: false },
    { k: 'admin.reports.sms.admin', l: 'Report SMS amministrazione', o: false, a: false },
  ]},
  { t: 'Notifiche', p: [
    { k: 'admin.notification', l: 'Gestisci notifiche', o: false, a: false },
  ]},
  { t: 'Circuito Interno', p: [
    { k: 'admin.interno.deliveries.out', l: 'Gestisci consegne in uscita', o: true, a: false },
    { k: 'admin.interno.deliveries.in', l: 'Gestisci consegne in entrata', o: true, a: false },
    { k: 'admin.interno.inbound.scan', l: 'Scansiona merce in entrata', o: true, a: false },
    { k: 'admin.interno.outbound.scan', l: 'Scansiona merce in uscita', o: true, a: false },
    { k: 'admin.interno.cod.sent', l: 'Gestisci contrassegni inviati', o: true, a: false },
    { k: 'admin.interno.cod.received', l: 'Gestisci contrassegni ricevuti', o: true, a: false },
    { k: 'admin.interno.codlists.index', l: 'Visualizza liste contrassegni interne', o: true, a: false },
    { k: 'admin.interno.codlists.generate', l: 'Genera liste contrassegni', o: true, a: false },
    { k: 'admin.interno.codlists.excelexport', l: 'Esporta liste contrassegni in Excel', o: true, a: false },
    { k: 'admin.interno.stocks', l: 'Gestisci giacenze interne', o: true, a: false },
  ]},
]

export default function PermessiPage() {
  const [op, setOp] = useState<Record<string, boolean>>({})
  const [ag, setAg] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: string; text: string } | null>(null)

  useEffect(() => {
    const defO: Record<string, boolean> = {}
    const defA: Record<string, boolean> = {}
    GRUPPI.forEach(g => g.p.forEach(x => { defO[x.k] = x.o; defA[x.k] = x.a }))
    fetch('/api/permessi')
      .then(r => r.json())
      .then(d => {
        const sp = (d && d.permessi) || {}
        if (sp.operatore) Object.keys(sp.operatore).forEach(k => { defO[k] = !!sp.operatore[k] })
        if (sp.agente) Object.keys(sp.agente).forEach(k => { defA[k] = !!sp.agente[k] })
        setOp(defO); setAg(defA); setLoading(false)
      })
      .catch(() => { setOp(defO); setAg(defA); setLoading(false) })
  }, [])

  const salva = async () => {
    setSaving(true); setMsg(null)
    try {
      const res = await fetch('/api/permessi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permessi: { operatore: op, agente: ag } }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error((d && d.error) || 'Errore durante il salvataggio')
      setMsg({ type: 'ok', text: 'Permessi salvati con successo' })
    } catch (e: any) {
      setMsg({ type: 'err', text: (e && e.message) || 'Errore' })
    }
    setSaving(false)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cellCenter: React.CSSProperties = { textAlign: 'center', verticalAlign: 'middle' }
  const badge = (txt: string, bg: string): React.CSSProperties => ({ background: bg, color: '#fff', padding: '3px 12px', borderRadius: 4, fontSize: 12, fontWeight: 700, display: 'inline-block' })

  return (
    <div style={{ padding: 24, background: '#eef1f4', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 26, fontWeight: 400, color: '#3a3a3a', margin: 0 }}>Gestione Permessi</h1>
      <p style={{ color: '#8a8a8a', marginTop: 6, marginBottom: 18 }}>Gestisci i permessi per i ruoli Admin, Operator e Agent</p>

      {msg && (
        <div style={{ padding: '12px 16px', borderRadius: 6, marginBottom: 16, color: '#fff', background: msg.type === 'ok' ? '#27ae60' : '#e74c3c' }}>{msg.text}</div>
      )}

      <div style={{ background: '#fff', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '2px solid #2c3e6b' }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#2c3e50', margin: 0 }}>Permessi per Ruolo</h2>
          <span style={badge('Il ruolo Admin ha sempre tutti i permessi', '#3bbcd4')}>Il ruolo Admin ha sempre tutti i permessi</span>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Caricamento permessi...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e3e6ea' }}>
                <th style={{ textAlign: 'left', padding: '14px 20px', fontSize: 15, color: '#2c3e50' }}>Permesso</th>
                <th style={{ ...cellCenter, padding: '14px 10px', width: '18%' }}><span style={badge('Admin', '#dc3545')}>Admin</span></th>
                <th style={{ ...cellCenter, padding: '14px 10px', width: '18%' }}><span style={badge('Operator', '#e69016')}>Operator</span></th>
                <th style={{ ...cellCenter, padding: '14px 10px', width: '18%' }}><span style={badge('Agent', '#3bbcd4')}>Agent</span></th>
              </tr>
            </thead>
            <tbody>
              {GRUPPI.map(g => (
                <>
                  <tr key={g.t} style={{ background: '#f4f6f8' }}>
                    <td colSpan={4} style={{ padding: '10px 20px', fontWeight: 700, color: '#2f80c7' }}>
                      <span style={{ display: 'inline-block', width: 10, height: 10, background: '#2f80c7', borderRadius: 2, marginRight: 8 }} />{g.t}
                    </td>
                  </tr>
                  {g.p.map(x => (
                    <tr key={x.k} style={{ borderBottom: '1px solid #eef0f2' }}>
                      <td style={{ padding: '12px 20px' }}>
                        <div style={{ color: '#33475b', fontSize: 15 }}>{x.l}</div>
                        <div style={{ color: '#b5651d', fontSize: 12, marginTop: 2 }}>{x.k}</div>
                      </td>
                      <td style={cellCenter}>
                        <input type="checkbox" checked disabled readOnly style={{ width: 17, height: 17, accentColor: '#9aa4ad', cursor: 'not-allowed' }} />
                      </td>
                      <td style={cellCenter}>
                        <input type="checkbox" checked={!!op[x.k]} onChange={e => setOp({ ...op, [x.k]: e.target.checked })} style={{ width: 17, height: 17, accentColor: '#2563eb', cursor: 'pointer' }} />
                      </td>
                      <td style={cellCenter}>
                        <input type="checkbox" checked={!!ag[x.k]} onChange={e => setAg({ ...ag, [x.k]: e.target.checked })} style={{ width: 17, height: 17, accentColor: '#2563eb', cursor: 'pointer' }} />
                      </td>
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
        <button onClick={salva} disabled={saving || loading} style={{ background: saving ? '#7fa8e0' : '#2563eb', color: '#fff', border: 'none', padding: '12px 28px', borderRadius: 6, fontSize: 15, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
          {saving ? 'Salvataggio...' : 'Salva permessi'}
        </button>
      </div>
    </div>
  )
}