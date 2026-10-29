'use client'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import BarraAvanzamento from '@/app/components/BarraAvanzamento'
import { useDialog } from '@/app/components/DialogProvider'
import { leggiFatturaBrt, descriviVoce } from '@/lib/fattura-brt'
import { riepilogaFattura, daGirare, type EsitoPagina } from '@/lib/controllo-fattura-riepilogo'

/* CONTROLLO FATTURA CORRIERE. Il detentore carica la fattura di BRT (il file TIVAF) e vede spedizione per
 * spedizione quanto ha fatturato BRT, quanto Moove gli ha registrato come costo, e il perché di ogni
 * differenza: peso rimisurato, voci che il listino non ha, listino non allineato, spedizioni annullate che
 * BRT ha fatturato lo stesso.
 *
 * L'addebito ai clienti NON si fa qui: le differenze di peso si mandano alla Rettifica Costi come un file
 * "solo pesi", e lì si confermano come ogni altra rettifica. Una porta sola per i soldi dei pesi. */

export type EsitoControllo = EsitoPagina
type Contratto = { id: string; nome: string; attivo: boolean }
type FatturaStorico = {
  id: string; corriere_id: string | null; nome_contratto: string; numero_fattura: string; data_fattura: string | null; nome_file: string | null
  righe: number; andate: number; totale_corriere: number; costo_moove: number; differenza: number; non_trovate: number; totale_non_trovate: number
  da_girare: number; euro_da_girare: number; rettifiche_file_id: string | null; created_at: string
  girate: { inviate: number; confermate: number; euroConfermati: number; euroInAttesa: number } | null; aTuoCarico: number
}
type Filtro = 'perdita' | 'tutte' | 'peso' | 'supplemento' | 'voce' | 'tariffa' | 'annullata' | 'non_trovata' | 'rientri'

// Pacchetti da 200: il listino si rifà con la funzione dell'addebito (~0,1 s a destinazione), così ogni
// richiesta resta lontana dal tempo massimo anche sulle fatture dei detentori grandi.
const PACCHETTO = 200
const PER_PAGINA = 50

const C = {
  testo: '#101828', attenuato: '#667085', filo: '#eaecf0', fondoTenue: '#f9fafb',
  arancio: '#f97316', arancioScuro: '#c2410c', arancioTenue: '#fff7ed', arancioOrlo: '#fed7aa',
  rosso: '#d92d20', rossoTenue: '#fef3f2', rossoOrlo: '#fecdca',
  verde: '#067647', verdeTenue: '#ecfdf3', verdeOrlo: '#abefc6',
  ambra: '#b54708', ambraTenue: '#fffaeb', ambraOrlo: '#fedf89',
}
const carta = { background: '#fff', border: `1px solid ${C.filo}`, borderRadius: '14px', boxShadow: '0 1px 2px rgba(16,24,40,.05)' }
const cifre = { fontVariantNumeric: 'tabular-nums' as const }

const euro = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const conSegno = (n: number) => (n > 0.005 ? '+' : n < -0.005 ? '−' : '') + euro(Math.abs(n))
const kg = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 2 }) + ' kg'
const r2 = (n: number) => Math.round(n * 100) / 100
const FASCE = [3, 5, 10, 20, 30, 50, 100]
const fascia = (p: number) => { const f = FASCE.find(x => p <= x); return f ? `fino a ${f} kg` : 'oltre 100 kg' }
const coloreImporto = (n: number) => n > 0.005 ? C.rosso : n < -0.005 ? C.verde : C.attenuato

// Icone a linea (griglia 24, tratto 1,7, estremi tondi), nel colore del testo che le contiene.
const TRATTI: Record<string, string> = {
  fattura: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6 M9 16h3',
  carica: 'M12 15V4 M7.5 8.5 12 4l4.5 4.5 M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15',
  bilancia: 'M12 4v16 M8 20h8 M5 8h14 M5 8l-3 6.5a3 3 0 0 0 6 0z M19 8l-3 6.5a3 3 0 0 0 6 0z',
  etichetta: 'M3 12.2V4a1 1 0 0 1 1-1h8.2a1 1 0 0 1 .7.3l7.8 7.8a1 1 0 0 1 0 1.4l-8.2 8.2a1 1 0 0 1-1.4 0l-7.8-7.8a1 1 0 0 1-.3-.7z M7.5 7.5h.01',
  cursori: 'M4 20v-6 M4 10V4 M12 20v-8 M12 8V4 M20 20v-4 M20 12V4 M2 14h4 M10 8h4 M18 16h4',
  annullata: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M15 9l-6 6 M9 9l6 6',
  pacco: 'M21 8 12 3 3 8l9 5 9-5z M3 8v8l9 5 9-5V8 M12 13v8',
  cerca: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4',
  scarica: 'M12 4v11 M7.5 10.5 12 15l4.5-4.5 M4 19h16',
  freccia: 'M5 12h14 M13 6l6 6-6 6',
  euro: 'M17 6.5A6.5 6.5 0 1 0 17 17.5 M4 10h9 M4 14h9',
  sale: 'M3 17l6-6 4 4 8-8 M15 7h6v6',
  spunta: 'M20 6 9 17l-5-5',
  avviso: 'M12 9v4 M12 17h.01 M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  rientro: 'M9 14 4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3',
}
function Icona({ nome, size = 18, colore }: { nome: string; size?: number; colore?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colore || 'currentColor'} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
      {TRATTI[nome].split(' M').map((d, i) => <path key={i} d={(i ? 'M' : '') + d} />)}
    </svg>
  )
}
function Tessera({ nome, colore, fondo }: { nome: string; colore: string; fondo: string }) {
  return <span style={{ width: 36, height: 36, borderRadius: 10, background: fondo, color: colore, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icona nome={nome} size={19} /></span>
}
function Pillola({ children, colore, fondo, orlo }: { children: ReactNode; colore: string; fondo: string; orlo: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, color: colore, background: fondo, border: `1px solid ${orlo}`, whiteSpace: 'nowrap' }}>{children}</span>
}

const MOTIVI: Record<string, { nome: string; icona: string }> = {
  peso: { nome: 'Peso o volume rimisurato da BRT', icona: 'bilancia' },
  supplemento: { nome: 'Supplementi previsti dal tuo listino', icona: 'pacco' },
  voce: { nome: 'Voci BRT che il listino non ha', icona: 'etichetta' },
  tariffa: { nome: 'Listino non allineato a BRT', icona: 'cursori' },
  annullata: { nome: 'Annullate in Moove, fatturate da BRT', icona: 'annullata' },
  non_calcolabile: { nome: 'Destinazione senza prezzo nel listino', icona: 'avviso' },
}

export default function ControlloFattura({ iniziale }: { iniziale?: { contratti: Contratto[]; esiti: EsitoControllo[]; nomeFile: string; storico?: FatturaStorico[] } }) {
  const dialog = useDialog()
  const [contratti, setContratti] = useState<Contratto[] | null>(iniziale?.contratti ?? null)
  const [contrattoId, setContrattoId] = useState(iniziale?.contratti?.[0]?.id ?? '')
  const [nomeFile, setNomeFile] = useState(iniziale?.nomeFile ?? '')
  const [esiti, setEsiti] = useState<EsitoControllo[]>(iniziale?.esiti ?? [])
  const [avvisi, setAvvisi] = useState<string[]>([])
  const [avanz, setAvanz] = useState<{ fatti: number; totale: number; da: number; etichetta: string } | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('perdita')
  const [cerca, setCerca] = useState('')
  const [pagina, setPagina] = useState(1)
  const [inviando, setInviando] = useState(false)
  const [trascina, setTrascina] = useState(false)
  const [fatturaId, setFatturaId] = useState<string | null>(null)
  const [rettificheInviate, setRettificheInviate] = useState(false)
  const [storico, setStorico] = useState<FatturaStorico[] | null>(iniziale?.storico ?? null)
  const fileRef = useRef<HTMLInputElement>(null)

  const caricaStorico = () => fetch('/api/fatture-corriere/storico').then(r => r.json()).then(d => setStorico(d.fatture || [])).catch(() => setStorico([]))
  useEffect(() => {
    if (iniziale) return
    fetch('/api/fatture-corriere/analizza').then(r => r.json()).then(d => {
      const c = d.contratti || []
      setContratti(c); if (c.length === 1) setContrattoId(c[0].id)
    }).catch(() => setContratti([]))
    caricaStorico()
  }, [iniziale])

  async function apriFattura(id: string) {
    const d = await fetch('/api/fatture-corriere/storico?fattura=' + id).then(r => r.json()).catch(() => ({ error: 'Errore di connessione' }))
    if (d.error) { await dialog.alert({ title: 'Fattura non aperta', message: d.error }); return }
    setFatturaId(id); setNomeFile(d.fattura.nome_file || ''); setRettificheInviate(!!d.fattura.rettifiche_file_id)
    if (d.fattura.corriere_id) setContrattoId(d.fattura.corriere_id)
    setEsiti(d.esiti || []); setAvvisi([]); setPagina(1); setFiltro('perdita'); setCerca('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const chiudiFattura = () => { setEsiti([]); setFatturaId(null); setNomeFile(''); setAvvisi([]); setRettificheInviate(false) }

  async function caricaFile(file: File) {
    if (!contrattoId) { await dialog.alert({ title: 'Scegli il contratto', message: 'Prima scegli il contratto BRT a cui si riferisce la fattura.' }); return }
    if (fileRef.current) fileRef.current.value = ''
    // BRT scrive il file in ISO-8859-1: letto come UTF-8, le accentate dei destinatari diventerebbero rombi.
    const testo = new TextDecoder('iso-8859-1').decode(await file.arrayBuffer())
    const { righe, errori } = leggiFatturaBrt(testo)
    if (!righe.length) { await dialog.alert({ title: 'File non letto', message: errori.join(' ') || 'Nessuna riga nel file.' }); return }
    chiudiFattura()
    setNomeFile(file.name); setAvvisi(errori); setPagina(1); setFiltro('perdita'); setCerca('')
    const tutti: EsitoControllo[] = []
    const inizio = Date.now()
    let id: string | null = null
    setAvanz({ fatti: 0, totale: righe.length, da: inizio, etichetta: 'Confronto la fattura con le tue spedizioni' })
    for (let i = 0; i < righe.length; i += PACCHETTO) {
      const res: Response = await fetch('/api/fatture-corriere/analizza', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id
          ? { fatturaId: id, righe: righe.slice(i, i + PACCHETTO) }
          : { contrattoId, righe: righe.slice(i, i + PACCHETTO), testata: { numeroFattura: righe[0].numeroFattura, dataFattura: righe[0].dataFattura, nomeFile: file.name } }),
      })
      const d: any = await res.json().catch(() => ({ error: 'Risposta non valida' }))
      // La stessa fattura già controllata non si rifà: si riapre quella salvata.
      if (d.giaCaricata) {
        setAvanz(null)
        await dialog.alert({ title: 'Fattura già caricata', message: `La fattura n. ${righe[0].numeroFattura} l'hai già controllata il ${new Date(d.giaCaricata.il).toLocaleDateString('it-IT')}: la riapro.` })
        await apriFattura(d.giaCaricata.id); return
      }
      // A metà: si ferma e lo dice. Un controllo parziale presentato come completo farebbe credere che
      // le spedizioni mancanti non ci siano. Nello storico resta "in corso" e ricaricando riparte da capo.
      if (!res.ok || d.error) {
        setAvanz(null)
        await dialog.alert({ title: 'Controllo interrotto', message: `${d.error || 'Errore'} — controllate ${tutti.length} righe su ${righe.length}. Ricarica il file: riparte da capo.` })
        setEsiti(tutti); return
      }
      id = d.fatturaId
      tutti.push(...d.esiti)
      setAvanz({ fatti: Math.min(i + PACCHETTO, righe.length), totale: righe.length, da: inizio, etichetta: 'Confronto la fattura con le tue spedizioni' })
    }
    // I totali dello storico li rifà il server dalle righe salvate.
    await fetch('/api/fatture-corriere/analizza', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fatturaId: id, chiudi: true }) }).catch(() => null)
    setFatturaId(id); setAvanz(null); setEsiti(tutti)
    caricaStorico()
  }

  const trovate = useMemo(() => esiti.filter(e => e.spedizione), [esiti])
  const daRettificare = useMemo(() => esiti.filter(daGirare), [esiti])
  const totali = useMemo(() => riepilogaFattura(esiti), [esiti])

  // COSA ALLINEARE NEL LISTINO: a parità di peso, di quanto il listino si scosta da BRT, per zona e fascia.
  // Solo dove le spedizioni sono almeno tre: un caso isolato non è una regola da correggere.
  const allineare = useMemo(() => {
    const g = new Map<string, { zona: string; fascia: string; n: number; tariffa: number }>()
    for (const e of trovate) {
      const t = e.motivi.find(m => m.tipo === 'tariffa'); if (!t || !e.zona) continue
      const k = e.zona + '|' + fascia(e.riga.pesoTassato)
      const v = g.get(k) || { zona: e.zona, fascia: fascia(e.riga.pesoTassato), n: 0, tariffa: 0 }
      v.n++; v.tariffa += t.importo; g.set(k, v)
    }
    return Array.from(g.values()).filter(v => v.n >= 3).sort((a, b) => Math.abs(b.tariffa) - Math.abs(a.tariffa))
  }, [trovate])

  const passa = (e: EsitoControllo, f: Filtro) => {
    if (f === 'tutte') return true
    if (f === 'perdita') return (e.differenza ?? 0) > 0.005
    if (f === 'non_trovata') return !e.spedizione
    if (f === 'rientri') return !e.riga.andata
    return e.motivi.some(m => m.tipo === f && Math.abs(m.importo) >= 0.01)
  }
  const conteggi = useMemo(() => {
    const out = {} as Record<Filtro, number>
    for (const f of ['perdita', 'tutte', 'peso', 'supplemento', 'voce', 'tariffa', 'annullata', 'non_trovata', 'rientri'] as Filtro[]) out[f] = esiti.filter(e => passa(e, f)).length
    return out
  }, [esiti])
  const filtrate = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    return esiti.filter(e => passa(e, filtro) && (!q || [e.riga.segnacollo, e.riga.rifNumerico, e.spedizione?.numero, e.spedizione?.chi, e.riga.destinatario, e.riga.localita, e.riga.cap]
      .some(x => String(x || '').toLowerCase().includes(q))))
      .sort((a, b) => (b.differenza ?? b.brt) - (a.differenza ?? a.brt))
  }, [esiti, filtro, cerca])
  const pagine = Math.max(1, Math.ceil(filtrate.length / PER_PAGINA))
  const pag = Math.min(pagina, pagine)
  const visibili = filtrate.slice((pag - 1) * PER_PAGINA, pag * PER_PAGINA)

  async function mandaAllaRettifica() {
    const euroPeso = r2(daRettificare.reduce((s, e) => s + (e.motivi.find(m => m.tipo === 'peso')?.importo || 0), 0))
    const ok = await dialog.confirm({
      title: 'Mandare le differenze di peso alla Rettifica?',
      message: `${daRettificare.length} spedizioni che BRT ha tassato più del peso registrato in Moove (col tuo listino ${euro(euroPeso)} in più). `
        + 'Diventano rettifiche "da confermare" nella pagina Rettifica Costi, col peso tassato da BRT: lì ognuno paga col proprio listino, '
        + 'cliente o sotto-master che sia. Finché non le confermi non si muove un euro. Le spedizioni già rettificate vengono saltate.',
      confirmText: 'Manda alla Rettifica',
    })
    if (!ok) return
    setInviando(true)
    // Lo stesso formato e lo stesso giro della pagina Rettifica: due colonne, lettera di vettura e peso.
    // La rotta li riconosce come file "solo pesi" e li passa dal motore delle rettifiche, coi suoi controlli.
    // Il peso come NUMERO: la Rettifica legge i chili col punto decimale e un numero lo prende così com'è.
    const righe = daRettificare.map(e => ({ ldv: e.spedizione!.numero, peso: r2(e.riga.pesoTassato) }))
    const nome = `Fattura BRT ${esiti[0]?.riga.numeroFattura || ''} - differenze di peso`
    const quante = 50
    let da = 0, fileId: string | undefined, creati = 0, gia = 0, nonTrovate = 0, errore = ''
    const inizio = Date.now()
    setAvanz({ fatti: 0, totale: righe.length, da: inizio, etichetta: 'Creo le rettifiche' })
    while (da < righe.length) {
      const res = await fetch('/api/rettifiche/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nomeFile: nome, righe, da, quante, fileId }),
      })
      const d = await res.json().catch(() => ({ error: 'Risposta non valida' }))
      if (d?.error) { errore = d.error; break }
      if (d?.tipo !== 'ripesature') { errore = 'La Rettifica non ha riconosciuto le righe come file di pesi.'; break }
      creati += d.creato || 0; gia += d.giaCaricate || 0; nonTrovate += d.totali?.nonTrovate || 0
      fileId = d.fileId || fileId
      const avanti = (d.da || 0) + (d.quante || 0)
      if (avanti <= da) break
      da = avanti
      setAvanz({ fatti: Math.min(da, righe.length), totale: righe.length, da: inizio, etichetta: 'Creo le rettifiche' })
      if (d.finito) break
    }
    setAvanz(null); setInviando(false)
    // Nello storico la fattura ricorda in quale file di rettifiche sono finite le sue differenze: da lì si
    // legge, mese per mese, quanto è stato davvero girato ai clienti.
    if (fileId && fatturaId) {
      await fetch('/api/fatture-corriere/analizza', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fatturaId, rettificheFileId: fileId }) }).catch(() => null)
      setRettificheInviate(true); caricaStorico()
    }
    await dialog.alert({
      title: errore ? 'Invio interrotto' : 'Rettifiche create',
      message: (errore ? errore + ' — ' : '') + `Create ${creati} rettifiche su ${righe.length} spedizioni.`
        + (gia ? ` ${gia} erano già state rettificate e sono state saltate.` : '')
        + (nonTrovate ? ` ${nonTrovate} non sono state trovate dalla Rettifica.` : '')
        + ' Le trovi in Spedizioni → Rettifica Costi: controllale e premi Conferma.',
    })
  }

  async function scaricaExcel() {
    const { utils, writeFile } = await import('xlsx')
    const righe = filtrate.map(e => ({
      'Segnacollo BRT': e.riga.segnacollo, 'Spedizione Moove': e.spedizione?.numero || '', 'Chi ha spedito': e.spedizione?.chi || '',
      'Destinazione': `${e.riga.cap} ${e.riga.localita} (${e.riga.provincia})`, 'Bolla': e.riga.tipoBolla,
      'Peso Moove (kg)': e.spedizione?.peso ?? '', 'Peso tassato BRT (kg)': r2(e.riga.pesoTassato),
      'BRT (€)': e.brt, 'Nolo BRT (€)': e.riga.nolo,
      'Voci BRT': e.riga.voci.map(v => `${descriviVoce(v.sigla).nome} ${v.importo.toFixed(2)}`).join(' + '),
      'Costo Moove (€)': e.moove ?? '', 'Listino al peso BRT (€)': e.listino ?? '', 'Differenza (€)': e.differenza ?? '',
      'Perché': e.spedizione ? e.motivi.map(m => m.testo).join(' | ') : 'Non trovata in Moove',
    }))
    const wb = utils.book_new(); utils.book_append_sheet(wb, utils.json_to_sheet(righe), 'Controllo fattura')
    writeFile(wb, `controllo-fattura-brt-${esiti[0]?.riga.numeroFattura || 'export'}.xlsx`)
  }

  const scegliFile = () => { if (!avanz) fileRef.current?.click() }
  const contrattoNome = contratti?.find(c => c.id === contrattoId)?.nome
  const diff = totali.differenza
  const conRisultati = esiti.length > 0 && !avanz
  const maxMotivo = Math.max(0.01, ...Object.values(totali.perMotivo).map(v => Math.abs(v.euro)))

  // ── TESTATA: titolo e contratto, sempre visibili ──
  const testata = (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <Tessera nome="fattura" colore={C.arancio} fondo={C.arancioTenue} />
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.testo, margin: 0, letterSpacing: '-.01em' }}>Controllo fattura corriere</h1>
          <p style={{ fontSize: 13.5, color: C.attenuato, margin: '4px 0 0', maxWidth: 640, lineHeight: 1.5 }}>
            Confronta la fattura di BRT con le tue spedizioni: dove hai speso più del previsto, perché, e cosa girare ai clienti.
          </p>
        </div>
      </div>
      {!!contratti?.length && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, ...carta, borderRadius: 10, padding: '6px 6px 6px 12px' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.attenuato, textTransform: 'uppercase', letterSpacing: '.04em' }}>Contratto</span>
          <select value={contrattoId} onChange={e => setContrattoId(e.target.value)} disabled={!!avanz}
            style={{ padding: '7px 30px 7px 10px', border: `1px solid ${C.filo}`, borderRadius: 8, fontSize: 13.5, fontWeight: 600, color: C.testo, background: C.fondoTenue, cursor: 'pointer' }}>
            {contratti.length > 1 && <option value="">Scegli…</option>}
            {contratti.map(c => <option key={c.id} value={c.id}>{c.nome}{c.attivo ? '' : ' (non attivo)'}</option>)}
          </select>
        </label>
      )}
    </div>
  )

  if (contratti && !contratti.length) {
    return (
      <div>
        {testata}
        <div style={{ ...carta, padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex' }}><Tessera nome="pacco" colore={C.attenuato} fondo={C.fondoTenue} /></div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.testo, marginTop: 12 }}>Nessun contratto BRT tuo</div>
          <div style={{ fontSize: 13, color: C.attenuato, marginTop: 4 }}>La fattura del corriere la controlla chi ha il contratto con BRT: qui compaiono i contratti BRT diretti che detieni.</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ color: C.testo }}>
      {testata}
      <input ref={fileRef} type="file" accept=".csv,.CSV,text/csv" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) caricaFile(f) }} />

      {/* ── CARICAMENTO: area grande, si trascina o si clicca ── */}
      {!conRisultati && (<>
        <div
          role="button" tabIndex={0} onClick={scegliFile} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') scegliFile() }}
          onDragOver={e => { e.preventDefault(); if (!avanz) setTrascina(true) }}
          onDragLeave={() => setTrascina(false)}
          onDrop={e => { e.preventDefault(); setTrascina(false); const f = e.dataTransfer.files?.[0]; if (f && !avanz) caricaFile(f) }}
          style={{
            ...carta, borderRadius: 16, border: `2px dashed ${trascina ? C.arancio : '#d0d5dd'}`, background: trascina ? C.arancioTenue : '#fff',
            padding: avanz ? '28px 28px' : '48px 24px', textAlign: 'center', cursor: avanz ? 'default' : 'pointer', transition: 'all .15s',
          }}>
          {avanz ? (
            <div style={{ maxWidth: 620, margin: '0 auto', textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <Tessera nome="fattura" colore={C.arancio} fondo={C.arancioTenue} />
                <div><div style={{ fontWeight: 700, fontSize: 14 }}>{nomeFile}</div><div style={{ fontSize: 12.5, color: C.attenuato }}>Contratto {contrattoNome}</div></div>
              </div>
              <BarraAvanzamento fatti={avanz.fatti} totale={avanz.totale} iniziatoIl={avanz.da} etichetta={avanz.etichetta} />
            </div>
          ) : (<>
            <span style={{ width: 64, height: 64, borderRadius: 18, background: C.arancioTenue, color: C.arancio, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${C.arancioOrlo}` }}>
              <Icona nome="carica" size={30} />
            </span>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 16 }}>Trascina qui la fattura BRT</div>
            <div style={{ fontSize: 13.5, color: C.attenuato, marginTop: 6 }}>oppure scegli il file dal computer</div>
            <button type="button" onClick={e => { e.stopPropagation(); scegliFile() }}
              style={{ marginTop: 18, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 10, border: 'none', background: C.arancio, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', boxShadow: '0 1px 2px rgba(16,24,40,.1)' }}>
              <Icona nome="carica" size={17} /> Scegli il file
            </button>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 18 }}>
              <Pillola colore={C.attenuato} fondo={C.fondoTenue} orlo={C.filo}>Dettaglio fattura BRT "TIVAF", file .csv</Pillola>
              <Pillola colore={C.attenuato} fondo={C.fondoTenue} orlo={C.filo}>Arriva con la fattura, una volta al mese</Pillola>
              {contrattoNome && <Pillola colore={C.arancioScuro} fondo={C.arancioTenue} orlo={C.arancioOrlo}>Contratto {contrattoNome}</Pillola>}
            </div>
          </>)}
        </div>

        {!avanz && !!storico?.length && (
          <div style={{ ...carta, marginTop: 16, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', borderBottom: `1px solid ${C.filo}` }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Fatture controllate</div>
                <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 2 }}>Mese per mese: quanto ha fatturato il corriere, quanto hai girato ai clienti e quanto è rimasto a te</div>
              </div>
              <div style={{ fontSize: 12.5, color: C.attenuato, ...cifre }}>
                Totale a tuo carico: <b style={{ color: coloreImporto(storico.reduce((t, f) => t + f.aTuoCarico, 0)), fontSize: 14 }}>{conSegno(r2(storico.reduce((t, f) => t + f.aTuoCarico, 0)))}</b>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ background: C.fondoTenue }}>
                  {[['Mese', 'left'], ['Fattura', 'left'], ['Fatturato', 'right'], ['Costo in Moove', 'right'], ['Differenza', 'right'], ['Girato ai clienti', 'right'], ['A tuo carico', 'right'], ['', 'right']].map(([h, a], i) => (
                    <th key={i} style={{ padding: '9px 14px', fontSize: 11.5, fontWeight: 600, color: C.attenuato, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', textAlign: a as any, borderBottom: `1px solid ${C.filo}` }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>{storico.map((f, i) => (
                  <tr key={f.id} style={{ borderTop: i ? `1px solid ${C.filo}` : 'none' }}>
                    <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 700, textTransform: 'capitalize' }}>{f.data_fattura ? new Date(f.data_fattura).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }) : '—'}</div>
                      <div style={{ fontSize: 12, color: C.attenuato, marginTop: 2 }}>{f.nome_contratto}</div>
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <div style={{ fontWeight: 600 }}>n. {f.numero_fattura}</div>
                      <div style={{ fontSize: 12, color: C.attenuato, marginTop: 2 }}>{f.righe.toLocaleString('it-IT')} righe{f.non_trovate ? ` · ${f.non_trovate} fuori Moove` : ''}</div>
                    </td>
                    <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 600, ...cifre }}>{euro(Number(f.totale_corriere))}</td>
                    <td style={{ padding: '11px 14px', textAlign: 'right', ...cifre }}>{euro(Number(f.costo_moove))}</td>
                    <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 600, color: coloreImporto(Number(f.differenza)), ...cifre }}>{conSegno(Number(f.differenza))}</td>
                    <td style={{ padding: '11px 14px', textAlign: 'right', ...cifre }}>
                      {f.girate ? (<>
                        <div style={{ fontWeight: 600 }}>{euro(f.girate.euroConfermati)}</div>
                        {f.girate.euroInAttesa > 0.005 && <div style={{ fontSize: 12, color: C.ambra, marginTop: 2 }}>{euro(f.girate.euroInAttesa)} da confermare</div>}
                      </>) : f.da_girare ? <span style={{ fontSize: 12, color: C.ambra }}>{f.da_girare} da mandare</span> : <span style={{ color: '#98a2b3' }}>—</span>}
                    </td>
                    <td style={{ padding: '11px 14px', textAlign: 'right', ...cifre }}>
                      <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 8, fontWeight: 700, color: coloreImporto(f.aTuoCarico), background: f.aTuoCarico > 0.005 ? C.rossoTenue : f.aTuoCarico < -0.005 ? C.verdeTenue : C.fondoTenue }}>{conSegno(f.aTuoCarico)}</span>
                    </td>
                    <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                      <button onClick={() => apriFattura(f.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 8, border: `1px solid ${C.filo}`, background: '#fff', fontSize: 12.5, fontWeight: 600, color: C.testo, cursor: 'pointer' }}>
                        Apri <Icona nome="freccia" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}

        {!avanz && !storico?.length && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12, marginTop: 16 }}>
            {[
              ['bilancia', 'Peso rimisurato', 'BRT ha pesato o misurato il pacco più del dichiarato: la differenza si gira al cliente con la Rettifica.'],
              ['pacco', 'Supplementi', 'Fuori misura e gli altri supplementi che BRT mette dopo: se nel tuo listino hanno un prezzo, sono previsti.'],
              ['etichetta', 'Voci fuori listino', 'Le voci di BRT che nel tuo listino non hanno un prezzo, o la parte che il prezzo non copre.'],
              ['cursori', 'Listino da allineare', 'A parità di peso, dove il tuo listino è più basso (o più alto) di quanto chiede BRT.'],
              ['annullata', 'Annullate ma fatturate', 'Spedizioni annullate e rimborsate in Moove che BRT ti ha fatturato lo stesso.'],
            ].map(([ic, t, d]) => (
              <div key={t} style={{ ...carta, padding: 16, display: 'flex', gap: 12 }}>
                <Tessera nome={ic} colore={C.testo} fondo={C.fondoTenue} />
                <div><div style={{ fontSize: 13.5, fontWeight: 700 }}>{t}</div><div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 3, lineHeight: 1.45 }}>{d}</div></div>
              </div>
            ))}
          </div>
        )}
      </>)}

      {avvisi.map((a, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: C.ambra, background: C.ambraTenue, border: `1px solid ${C.ambraOrlo}`, borderRadius: 10, padding: '10px 12px', marginTop: 12 }}>
          <Icona nome="avviso" size={16} /> {a}
        </div>
      ))}

      {conRisultati && (<>
        {/* ── LA FATTURA CARICATA ── */}
        <div style={{ ...carta, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
          <Tessera nome="fattura" colore={C.arancio} fondo={C.arancioTenue} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              Fattura BRT n. {esiti[0].riga.numeroFattura}{esiti[0].riga.dataFattura ? ` del ${new Date(esiti[0].riga.dataFattura).toLocaleDateString('it-IT')}` : ''}
            </div>
            <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 2 }}>
              {nomeFile} · {esiti.length.toLocaleString('it-IT')} righe: {totali.andate.toLocaleString('it-IT')} spedizioni e {totali.rientri} rientri · contratto {contrattoNome}
            </div>
          </div>
          <button onClick={chiudiFattura} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 9, border: `1px solid ${C.filo}`, background: '#fff', fontSize: 13, fontWeight: 600, color: C.testo, cursor: 'pointer' }}>
            <Icona nome="fattura" size={16} /> Tutte le fatture
          </button>
          <button onClick={scegliFile} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 9, border: `1px solid ${C.filo}`, background: '#fff', fontSize: 13, fontWeight: 600, color: C.testo, cursor: 'pointer' }}>
            <Icona nome="carica" size={16} /> Carica un'altra fattura
          </button>
        </div>

        {/* ── I NUMERI ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 14 }}>
          {[
            { ic: 'fattura', t: 'Fatturato da BRT', v: euro(totali.totaleCorriere), n: `${esiti.length.toLocaleString('it-IT')} righe in fattura`, c: C.testo },
            { ic: 'euro', t: 'Costo registrato in Moove', v: euro(totali.costoMoove), n: `sulle ${trovate.length.toLocaleString('it-IT')} spedizioni trovate`, c: C.testo },
            { ic: 'sale', t: 'Differenza', v: conSegno(diff), n: diff > 0.005 ? 'BRT ti costa più di quanto vedi' : diff < -0.005 ? 'vedi un costo più alto del vero' : 'torna al centesimo', c: coloreImporto(diff), evid: true },
            { ic: 'bilancia', t: 'Da girare ai clienti', v: String(daRettificare.length), n: 'spedizioni col peso BRT più alto', c: daRettificare.length ? C.arancioScuro : C.testo },
            { ic: 'pacco', t: 'Non trovate in Moove', v: String(totali.nonTrovate), n: totali.nonTrovate ? `${euro(totali.totaleNonTrovate)} spedite fuori dal portale` : 'tutte abbinate', c: totali.nonTrovate ? C.ambra : C.testo },
          ].map(k => (
            <div key={k.t} style={{ ...carta, padding: 16, ...(k.evid ? { borderColor: diff > 0.005 ? C.rossoOrlo : C.verdeOrlo, background: diff > 0.005 ? C.rossoTenue : C.verdeTenue } : {}) }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: C.attenuato }}><Icona nome={k.ic} size={15} /> {k.t}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: k.c, marginTop: 8, letterSpacing: '-.02em', ...cifre }}>{k.v}</div>
              <div style={{ fontSize: 12, color: C.attenuato, marginTop: 2 }}>{k.n}</div>
            </div>
          ))}
        </div>

        {/* ── PERCHÉ E COSA CORREGGERE ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12, marginBottom: 14 }}>
          <div style={{ ...carta, padding: '16px 18px' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Dove nasce la differenza</div>
            <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 2, marginBottom: 12 }}>Somma per motivo, sulle spedizioni trovate in Moove</div>
            {Object.entries(totali.perMotivo).sort((a, b) => b[1].euro - a[1].euro).map(([k, v]) => (
              <div key={k} style={{ padding: '9px 0', borderTop: `1px solid ${C.filo}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: C.attenuato, display: 'inline-flex' }}><Icona nome={MOTIVI[k]?.icona || 'avviso'} size={17} /></span>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{MOTIVI[k]?.nome || k}</span>
                  <span style={{ fontSize: 12, color: C.attenuato, ...cifre }}>{v.n} sped.</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: coloreImporto(v.euro), minWidth: 90, textAlign: 'right', ...cifre }}>{conSegno(r2(v.euro))}</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: C.fondoTenue, marginTop: 7, marginLeft: 27 }}>
                  <div style={{ height: 6, borderRadius: 3, width: `${Math.max(2, Math.abs(v.euro) / maxMotivo * 100)}%`, background: v.euro > 0.005 ? '#f97066' : '#47cd89' }} />
                </div>
                {k === 'voce' && Object.entries(totali.perVoce).sort((a, b) => b[1].euro - a[1].euro).map(([s, w]) => (
                  <div key={s} style={{ display: 'flex', fontSize: 12.5, color: C.attenuato, marginTop: 5, marginLeft: 27 }}>
                    <span style={{ flex: 1 }}>{descriviVoce(s).nome} <span style={{ opacity: .7 }}>· sigla "{s}"</span></span>
                    <span style={{ ...cifre }}>{w.n} · {euro(r2(w.euro))}</span>
                  </div>
                ))}
              </div>
            ))}
            {!Object.keys(totali.perMotivo).length && <div style={{ fontSize: 13, color: C.verde, display: 'flex', gap: 6, alignItems: 'center' }}><Icona nome="spunta" size={16} /> Nessuna differenza: la fattura torna con Moove.</div>}
            {totali.rientri > 0 && (
              <div style={{ display: 'flex', gap: 8, fontSize: 12.5, color: C.attenuato, background: C.fondoTenue, borderRadius: 9, padding: '9px 11px', marginTop: 10 }}>
                <Icona nome="rientro" size={16} /> {totali.rientri} rientri per {euro(totali.totaleRientri)}: non si confrontano col nolo dell'andata, il reso si addebita col suo flusso.
              </div>
            )}
          </div>

          <div style={{ ...carta, padding: '16px 18px' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Cosa allineare nel listino</div>
            <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 2, marginBottom: 12 }}>A parità di peso: scarto medio fra il tuo listino e BRT, per zona e fascia (almeno 3 spedizioni)</div>
            {allineare.length ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ color: C.attenuato, fontSize: 11.5, textAlign: 'left' }}>
                  <th style={{ fontWeight: 600, padding: '0 0 6px' }}>Zona e fascia</th><th style={{ fontWeight: 600, padding: '0 0 6px', textAlign: 'right' }}>Sped.</th>
                  <th style={{ fontWeight: 600, padding: '0 0 6px', textAlign: 'right' }}>Listino vs BRT</th><th style={{ fontWeight: 600, padding: '0 0 6px', textAlign: 'right' }}>Totale</th>
                </tr></thead>
                <tbody>{allineare.slice(0, 8).map(a => (
                  <tr key={a.zona + a.fascia} style={{ borderTop: `1px solid ${C.filo}` }}>
                    <td style={{ padding: '9px 0' }}><b>{a.zona}</b> <span style={{ color: C.attenuato }}>{a.fascia}</span></td>
                    <td style={{ padding: '9px 0', textAlign: 'right', ...cifre }}>{a.n}</td>
                    <td style={{ padding: '9px 0', textAlign: 'right' }}>
                      {a.tariffa > 0
                        ? <Pillola colore={C.rosso} fondo={C.rossoTenue} orlo={C.rossoOrlo}>più basso di {euro(r2(a.tariffa / a.n))}</Pillola>
                        : <Pillola colore={C.verde} fondo={C.verdeTenue} orlo={C.verdeOrlo}>più alto di {euro(r2(-a.tariffa / a.n))}</Pillola>}
                    </td>
                    <td style={{ padding: '9px 0', textAlign: 'right', fontWeight: 700, color: coloreImporto(a.tariffa), ...cifre }}>{conSegno(r2(a.tariffa))}</td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <div style={{ fontSize: 13, color: C.attenuato }}>Nessuno scarto ricorrente fra listino e BRT.</div>}
            <div style={{ fontSize: 12, color: C.attenuato, marginTop: 10, lineHeight: 1.45 }}>
              "Più basso" vuol dire che il listino ti fa vedere un costo minore di quello vero: il margine che leggi è gonfiato. "Più alto" il contrario.
            </div>
          </div>
        </div>

        {/* ── DA GIRARE AI CLIENTI: l'unico gesto che porta a muovere soldi, con scritto cosa fa ── */}
        {daRettificare.length > 0 && (
          <div style={{ ...carta, background: C.arancioTenue, borderColor: C.arancioOrlo, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
            <Tessera nome="bilancia" colore={C.arancioScuro} fondo="#fff" />
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>
                {daRettificare.length} spedizion{daRettificare.length === 1 ? 'e' : 'i'} da girare ai clienti
                <span style={{ color: C.arancioScuro, marginLeft: 8, ...cifre }}>{conSegno(r2(daRettificare.reduce((s, e) => s + (e.motivi.find(m => m.tipo === 'peso')?.importo || 0), 0)))}</span>
              </div>
              <div style={{ fontSize: 12.5, color: '#475467', marginTop: 3, lineHeight: 1.45 }}>
                {rettificheInviate
                  ? 'Le hai già mandate alla Rettifica: le trovi in Rettifica Costi, da confermare. Rimandarle non le raddoppia, quelle già create vengono saltate.'
                  : 'BRT le ha tassate più del peso registrato in Moove. Diventano rettifiche da confermare in Rettifica Costi, ognuno paga col proprio listino: finché non le confermi non si muove nulla.'}
              </div>
            </div>
            {rettificheInviate ? (
              <a href="/dashboard/spedizioni/rettifica"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10, border: `1px solid ${C.arancioOrlo}`, fontSize: 13.5, fontWeight: 700, background: '#fff', color: C.arancioScuro, textDecoration: 'none' }}>
                Apri Rettifica Costi <Icona nome="freccia" size={16} />
              </a>
            ) : (
              <button onClick={mandaAllaRettifica} disabled={inviando}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10, border: 'none', fontSize: 13.5, fontWeight: 700, background: C.arancio, color: '#fff', cursor: inviando ? 'default' : 'pointer', boxShadow: '0 1px 2px rgba(16,24,40,.1)' }}>
                Manda alla Rettifica <Icona nome="freccia" size={16} />
              </button>
            )}
          </div>
        )}

        {/* ── LE SPEDIZIONI ── */}
        <div style={{ ...carta, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderBottom: `1px solid ${C.filo}` }}>
            <div style={{ display: 'inline-flex', background: C.fondoTenue, border: `1px solid ${C.filo}`, borderRadius: 10, padding: 3, flexWrap: 'wrap' }}>
              {([['perdita', 'Con perdita'], ['tutte', 'Tutte'], ['peso', 'Peso'], ['supplemento', 'Supplementi'], ['voce', 'Voci'], ['tariffa', 'Listino'], ['annullata', 'Annullate'], ['non_trovata', 'Non trovate'], ['rientri', 'Rientri']] as [Filtro, string][])
                .filter(([k]) => k === 'perdita' || k === 'tutte' || conteggi[k] > 0)
                .map(([k, l]) => (
                  <button key={k} onClick={() => { setFiltro(k); setPagina(1) }}
                    style={{ padding: '6px 11px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      background: filtro === k ? '#fff' : 'transparent', color: filtro === k ? C.testo : C.attenuato, boxShadow: filtro === k ? '0 1px 3px rgba(16,24,40,.12)' : 'none' }}>
                    {l} <span style={{ fontSize: 11.5, color: filtro === k ? C.arancioScuro : C.attenuato, marginLeft: 3, ...cifre }}>{conteggi[k]}</span>
                  </button>
                ))}
            </div>
            <div style={{ flex: '1 1 240px', display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${C.filo}`, borderRadius: 10, padding: '0 10px', color: C.attenuato }}>
              <Icona nome="cerca" size={16} />
              <input value={cerca} onChange={e => { setCerca(e.target.value); setPagina(1) }} placeholder="Cerca spedizione, segnacollo, cliente, località"
                style={{ flex: 1, border: 'none', outline: 'none', padding: '8px 0', fontSize: 13.5, color: C.testo, background: 'transparent' }} />
            </div>
            <button onClick={scaricaExcel} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 10, border: `1px solid ${C.filo}`, background: '#fff', fontSize: 13, fontWeight: 600, color: C.testo, cursor: 'pointer' }}>
              <Icona nome="scarica" size={16} /> Excel
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.fondoTenue, textAlign: 'left' }}>
                  {[['Spedizione', 'left'], ['Destinazione', 'left'], ['Peso Moove → BRT', 'left'], ['BRT', 'right'], ['Moove', 'right'], ['Differenza', 'right'], ['Perché', 'left']].map(([h, a]) => (
                    <th key={h} style={{ padding: '10px 14px', fontSize: 11.5, fontWeight: 600, color: C.attenuato, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', textAlign: a as any, borderBottom: `1px solid ${C.filo}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibili.map((e, i) => {
                  const cresce = !!e.spedizione && e.riga.pesoTassato > e.spedizione.peso + 0.005
                  return (
                    <tr key={e.riga.segnacollo + e.riga.rifNumerico + i} style={{ borderTop: i ? `1px solid ${C.filo}` : 'none', verticalAlign: 'top' }}>
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 700, color: e.spedizione ? C.arancioScuro : C.testo, fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', fontSize: 12.5 }}>{e.spedizione?.numero || e.riga.segnacollo || '—'}</div>
                        <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 3 }}>{e.spedizione?.chi || 'Non in Moove'}</div>
                        <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                          {!e.riga.andata && <Pillola colore={C.attenuato} fondo={C.fondoTenue} orlo={C.filo}>Rientro</Pillola>}
                          {e.spedizione?.stato === 'annullata' && <Pillola colore={C.rosso} fondo={C.rossoTenue} orlo={C.rossoOrlo}>Annullata</Pillola>}
                          {!e.spedizione && <Pillola colore={C.ambra} fondo={C.ambraTenue} orlo={C.ambraOrlo}>Non trovata</Pillola>}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {/* La località la scrive BRT; se nel file manca si prende quella della spedizione. */}
                        <div style={{ fontWeight: 600 }}>{e.riga.localita || e.spedizione?.citta || '—'}</div>
                        <div style={{ fontSize: 12.5, color: C.attenuato, marginTop: 2 }}>{e.riga.cap} · {e.riga.provincia}{e.zona && e.zona !== 'Italia' ? ` · ${e.zona}` : ''}</div>
                      </td>
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', ...cifre }}>
                        <span style={{ color: C.attenuato }}>{e.spedizione ? kg(e.spedizione.peso) : '—'}</span>
                        <span style={{ margin: '0 6px', color: '#98a2b3' }}>→</span>
                        <b style={{ color: cresce ? C.rosso : C.testo }}>{kg(r2(e.riga.pesoTassato))}</b>
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap', ...cifre }}>
                        <div style={{ fontWeight: 600 }}>{euro(e.brt)}</div>
                        <div style={{ fontSize: 11.5, color: C.attenuato, marginTop: 2 }}>nolo {euro(e.riga.nolo)}</div>
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap', ...cifre }}>{e.moove != null ? euro(e.moove) : <span style={{ color: '#98a2b3' }}>—</span>}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {e.differenza != null
                          ? <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 8, fontWeight: 700, fontSize: 13, ...cifre, color: coloreImporto(e.differenza),
                              background: e.differenza > 0.005 ? C.rossoTenue : e.differenza < -0.005 ? C.verdeTenue : C.fondoTenue }}>{conSegno(e.differenza)}</span>
                          : <span style={{ color: '#98a2b3' }}>—</span>}
                      </td>
                      <td style={{ padding: '12px 14px', minWidth: 340, maxWidth: 520 }}>
                        {!e.spedizione ? <span style={{ color: C.attenuato, fontSize: 12.5 }}>Nessuna spedizione dei tuoi contratti con riferimento {e.riga.rifNumerico || '—'} o segnacollo {e.riga.segnacollo || '—'}.</span>
                          : !e.riga.andata ? <span style={{ color: C.attenuato, fontSize: 12.5 }}>Rientro: il reso si addebita col suo flusso.</span>
                          : e.motivi.length ? e.motivi.map((m, j) => (
                            <div key={j} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: j ? 7 : 0 }}>
                              <span style={{ color: coloreImporto(m.importo), marginTop: 1 }}><Icona nome={MOTIVI[m.tipo]?.icona || 'avviso'} size={15} /></span>
                              <span style={{ fontSize: 12.5, lineHeight: 1.45, color: '#344054' }}>
                                <b style={{ color: coloreImporto(m.importo), ...cifre }}>{conSegno(m.importo)}</b> {m.testo}
                              </span>
                            </div>
                          ))
                          : <span style={{ color: C.verde, fontSize: 12.5, display: 'inline-flex', gap: 6, alignItems: 'center' }}><Icona nome="spunta" size={15} /> Torna al centesimo</span>}
                      </td>
                    </tr>
                  )
                })}
                {!visibili.length && (
                  <tr><td colSpan={7} style={{ padding: '36px 16px', textAlign: 'center', color: C.attenuato }}>
                    {filtro === 'perdita' ? 'Nessuna spedizione in perdita: su questa fattura non hai speso più di quanto vedi in Moove.' : 'Nessuna riga con questo filtro.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {pagine > 1 && (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: `1px solid ${C.filo}`, fontSize: 13, color: C.attenuato }}>
              <span>{((pag - 1) * PER_PAGINA + 1).toLocaleString('it-IT')}–{Math.min(pag * PER_PAGINA, filtrate.length).toLocaleString('it-IT')} di {filtrate.length.toLocaleString('it-IT')}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pag <= 1} style={{ padding: '7px 12px', border: `1px solid ${C.filo}`, borderRadius: 9, background: '#fff', fontWeight: 600, color: pag <= 1 ? '#98a2b3' : C.testo, cursor: pag <= 1 ? 'default' : 'pointer' }}>Precedente</button>
                <button onClick={() => setPagina(p => Math.min(pagine, p + 1))} disabled={pag >= pagine} style={{ padding: '7px 12px', border: `1px solid ${C.filo}`, borderRadius: 9, background: '#fff', fontWeight: 600, color: pag >= pagine ? '#98a2b3' : C.testo, cursor: pag >= pagine ? 'default' : 'pointer' }}>Successiva</button>
              </div>
            </div>
          )}
        </div>
      </>)}
    </div>
  )
}
