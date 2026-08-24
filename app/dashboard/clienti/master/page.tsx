'use client'
import { useState, useEffect } from 'react'
import { useDialog } from '@/app/components/DialogProvider'

interface NodoMaster {
  id: string
  nome: string
  email: string
  attivo: boolean
}
interface NodoCliente {
  id: string
  ragione_sociale: string
  email: string
  attivo: boolean
}

function NodoAlbero({ masterId, nome, isRoot }: { masterId: string; nome: string; isRoot?: boolean }) {
  // `dialog` era usato in risincronizza() ma dichiarato SOLO nell'altro componente del file:
  // qui non esisteva, e al click su "Risincronizza" la pagina si rompeva con un errore a runtime
  // (il progetto ignora gli errori di tipo in compilazione, quindi non emergeva prima).
  const dialog = useDialog()
  const [espanso, setEspanso] = useState(false)
  const [caricato, setCaricato] = useState(false)
  const [masters, setMasters] = useState<NodoMaster[]>([])
  const [clienti, setClienti] = useState<NodoCliente[]>([])
  const [loading, setLoading] = useState(false)
  const [sync, setSync] = useState('')

  async function risincronizza(e: React.MouseEvent) {
    e.stopPropagation()
    if (!await dialog.confirm({ title: `Risincronizzare il listino di "${nome}"?`, message: 'Ricopia contratti e prezzi assegnati dal padre. Le sue modifiche ai prezzi ereditati verranno sovrascritte.', confirmText: 'Risincronizza' })) return
    setSync('...')
    try {
      const res = await fetch(`/api/master/${masterId}/sync-listino?force=1`, { method: 'POST' })
      const d = await res.json()
      if (d.error) { setSync('err'); await dialog.alert({ title: 'Errore', message: d.error }) }
      else { setSync('ok'); await dialog.alert({ title: 'Fatto', message: d.ok ? `Listino risincronizzato (${d.corrieri ?? 0} corrieri, ${d.fasce ?? 0} fasce).` : `Esito: ${d.reason || 'nessuna azione'}` }) }
    } catch { setSync('err'); await dialog.alert({ title: 'Errore', message: 'Errore di rete.' }) }
  }

  async function toggleEspandi() {
    if (!espanso && !caricato) {
      setLoading(true)
      const res = await fetch(`/api/master/figli?parent_id=${masterId}`)
      const data = await res.json()
      setMasters(data.masters || [])
      setClienti(data.clienti || [])
      setCaricato(true)
      setLoading(false)
    }
    setEspanso(!espanso)
  }

  return (
    <div style={{ marginLeft: isRoot ? 0 : '24px' }}>
      <div onClick={toggleEspandi} style={{
        display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px',
        cursor: 'pointer', borderRadius: '6px', background: isRoot ? '#fff7ed' : '#fff',
        border: '1px solid #e8e8e8', marginBottom: '4px',
      }}>
        <span style={{ fontSize: '11px', color: '#999', width: '14px', display: 'inline-block', transform: espanso ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s' }}>▶</span>
        <span style={{ fontSize: '14px' }}>{isRoot ? '👑' : '🏢'}</span>
        <span style={{ fontWeight: '700', fontSize: '13px', color: '#1a1a1a' }}>{nome}</span>
        {isRoot && <span style={{ fontSize: '10px', color: '#f97316', fontWeight: '700', background: '#fff7ed', padding: '2px 6px', borderRadius: '4px' }}>ROOT</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
          <a href={`/dashboard/clienti/master/${masterId}`}
            onClick={e => e.stopPropagation()}
            title="Modifica anagrafica / accesso"
            style={{ fontSize: '11px', fontWeight: 700, color: '#1a1a1a', background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: '5px', padding: '3px 8px', textDecoration: 'none' }}>
            ✎ Modifica
          </a>
          {!isRoot && (
            <button onClick={risincronizza}
              title="Ricopia il listino assegnato dal padre nel Listino Corrieri di questo master"
              style={{ fontSize: '11px', fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '5px', padding: '3px 8px', cursor: 'pointer' }}>
              {sync === '...' ? '⟳…' : '⟳ Risincronizza'}
            </button>
          )}
          {!isRoot && (
            <a href={`/api/master/${masterId}/impersona`} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              title="Accedi come questo master"
              style={{ fontSize: '11px', fontWeight: 700, color: '#ea580c', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '5px', padding: '3px 8px', textDecoration: 'none' }}>
              ↪ Accedi
            </a>
          )}
        </span>
      </div>

      {espanso && (
        <div style={{ marginLeft: '14px', borderLeft: '1px dashed #ddd', paddingLeft: '10px' }}>
          {loading && <div style={{ fontSize: '12px', color: '#999', padding: '8px' }}>Caricamento...</div>}

          {!loading && masters.map(m => (
            <NodoAlbero key={m.id} masterId={m.id} nome={m.nome} />
          ))}

          {!loading && clienti.map(c => (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 12px',
              borderRadius: '6px', background: '#f9fafb', border: '1px solid #f0f0f0',
              marginBottom: '4px', marginLeft: '24px',
            }}>
              <span style={{ fontSize: '13px' }}>👤</span>
              <span style={{ fontSize: '12.5px', color: '#1a1a1a' }}>{c.ragione_sociale}</span>
              <span style={{ fontSize: '11px', color: '#999' }}>{c.email}</span>
            </div>
          ))}

          {!loading && !masters.length && !clienti.length && (
            <div style={{ fontSize: '12px', color: '#bbb', padding: '8px 12px' }}>Nessun figlio</div>
          )}
        </div>
      )}
    </div>
  )
}

// Pannello "Nuovi master registrati": le richieste auto-registrate dalla vetrina (stato da_approvare)
// della propria rete. Approva = attiva + crea accesso + credenziali; Rifiuta = chiude + email cortese.
function NuoviMaster() {
  const dialog = useDialog()
  const [righe, setRighe] = useState<any[]>([])
  const [azione, setAzione] = useState('')
  async function carica() {
    const d = await fetch('/api/master/da-approvare').then(r => r.json()).catch(() => [])
    setRighe(Array.isArray(d) ? d : [])
  }
  useEffect(() => { carica() }, [])
  async function gestisci(id: string, nome: string, tipo: 'approva' | 'rifiuta') {
    const ok = tipo === 'approva'
      ? await dialog.confirm({ title: `Approvare "${nome}"?`, message: 'Attiva il master, crea l\'accesso e gli manda le credenziali. Poi gli assegni i contratti/listino.', confirmText: 'Approva' })
      : await dialog.confirm({ title: `Rifiutare "${nome}"?`, message: 'La richiesta viene chiusa e gli arriva un\'email cortese.', danger: true, confirmText: 'Rifiuta' })
    if (!ok) return
    setAzione(id)
    const res = await fetch('/api/master/da-approvare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, azione: tipo }) })
    const d = await res.json().catch(() => ({}))
    setAzione('')
    if (!res.ok || d?.error) { await dialog.alert({ title: 'Errore', message: d?.error || 'Operazione non riuscita' }); return }
    if (tipo === 'approva') {
      await dialog.alert({ title: 'Master attivato', message: d.credenzialiInviate === false ? `${nome} è attivo, ma l'email con le credenziali non è partita: mandagliela a mano.` : `${nome} è attivo e ha ricevuto le credenziali. Ora assegnagli i contratti/listino.` })
    }
    carica()
  }
  if (!righe.length) return null
  return (
    <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '16px 18px', marginBottom: '18px' }}>
      <div style={{ fontSize: '14px', fontWeight: 800, color: '#9a3412', marginBottom: '12px' }}>🆕 Nuovi master registrati — da approvare ({righe.length})</div>
      <div style={{ display: 'grid', gap: '10px' }}>
        {righe.map(r => (
          <div key={r.id} style={{ background: '#fff', border: '1px solid #fed7aa', borderRadius: '8px', padding: '12px 14px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a' }}>{r.nome}</span>
              <span style={{ fontSize: '12px', color: '#f97316', fontWeight: 700, background: '#fff7ed', padding: '2px 8px', borderRadius: '20px' }}>{r.piano_nome}</span>
              <span style={{ fontSize: '11.5px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: r.contratti_preferenza === 'propri' ? '#eef2ff' : r.contratti_preferenza === 'misto' ? '#fef9c3' : '#f0fdf4', color: r.contratti_preferenza === 'propri' ? '#4338ca' : r.contratti_preferenza === 'misto' ? '#854d0e' : '#15803d' }}>{r.contratti_preferenza === 'propri' ? 'Porta i suoi contratti' : r.contratti_preferenza === 'misto' ? 'Misto: nostri + suoi' : 'Vuole i listini MoovExpress'}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                <button onClick={() => gestisci(r.id, r.nome, 'approva')} disabled={azione === r.id} style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', opacity: azione === r.id ? 0.6 : 1 }}>{azione === r.id ? '…' : '✓ Approva'}</button>
                <button onClick={() => gestisci(r.id, r.nome, 'rifiuta')} disabled={azione === r.id} style={{ background: '#fff', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: '6px', padding: '5px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>Rifiuta</button>
              </span>
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
              <span>✉ {r.email}</span>
              {r.telefono && <span>☎ {r.telefono}</span>}
              {r.piva && <span>P.IVA {r.piva}</span>}
              {r.volume_stimato && <span>~{r.volume_stimato}/mese</span>}
              {Array.isArray(r.corrieri_interesse) && r.corrieri_interesse.length > 0 && <span>Corrieri: {r.corrieri_interesse.join(', ')}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ElencoMasterPage() {
  const dialog = useDialog()
  const [root, setRoot] = useState<{ id: string; nome: string } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/master/root').then(r => r.json()).then(d => {
      setRoot(d)
      setLoading(false)
    })
  }, [])

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>Elenco Master</h1>
        <p style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>
          Clicca sulle tendine per espandere e vedere i master e clienti sottostanti
        </p>
      </div>

      <NuoviMaster />

      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', padding: '20px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#999', padding: '40px' }}>Caricamento...</div>
        ) : root ? (
          <NodoAlbero masterId={root.id} nome={root.nome} isRoot />
        ) : (
          <div style={{ textAlign: 'center', color: '#999', padding: '40px' }}>Master non trovato</div>
        )}
      </div>
    </div>
  )
}
