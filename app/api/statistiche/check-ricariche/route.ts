import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vedeLaRete } from '@/lib/perimetro'
import { eTitolareOAdmin, gestisceLaRete } from '@/lib/ruoli'
import { contabilitaAttiva, metodoValido, pulisciNome, ricordaPagatore } from '@/lib/contabilita-banca'
import { fetchAllStretto } from '@/lib/fetch-all'
import { registraAudit } from '@/lib/audit'

// CHECK RICARICHE: monitoraggio bonifici delle ricariche manuali (vedi tabella ricariche_check).
// Ogni master vede SOLO le ricariche che ha fatto lui (master_id esatto): il bonifico arriva a lui.
// Due soglie di alert (modificabili qui): giorni senza bonifico, giorni senza conferma d'arrivo.
// Le righe NASCOSTE (nascosta_il) non si vedono e non suonano: Ecomize Solution ha voluto ripartire da zero
// (12/11) senza cancellare le ricariche abbinate all'estratto conto. Vedi scripts/check-ricariche-nascoste-a-mano.sql.
const GIORNI_NO_BONIFICO = 3
const GIORNI_NO_ARRIVO = 4
const MS_G = 86400000

async function staff(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: u } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
  return vedeLaRete(u) ? { user, master_id: u.master_id, ruolo: (u as any).ruolo as string } : null
}

// Calcola stato e alert di una riga (rispetto ad adesso).
function arricchisci(r: any) {
  const ora = Date.now()
  const eff = r.bonifico_effettuato_il ? new Date(r.bonifico_effettuato_il).getTime() : null
  const arr = r.bonifico_arrivato_il ? new Date(r.bonifico_arrivato_il).getTime() : null
  const ric = r.ricaricato_il ? new Date(r.ricaricato_il).getTime() : ora
  // Pagata in contanti o con contrassegni compensati (lib/contabilita-banca): non e' un bonifico, non si
  // aspetta niente in banca e non deve mai risultare "non ha pagato".
  const altroMetodo = !!r.metodo && r.metodo !== 'bonifico'
  const stato = altroMetodo ? 'altro_metodo' : arr ? 'arrivato' : eff ? 'effettuato' : 'in_attesa'
  const giorniDaRicarica = Math.floor((ora - ric) / MS_G)
  const giorniDaEffettuato = eff ? Math.floor((ora - eff) / MS_G) : null
  const alert_no_bonifico = stato === 'in_attesa' && giorniDaRicarica >= GIORNI_NO_BONIFICO
  const alert_no_arrivo = stato === 'effettuato' && (giorniDaEffettuato ?? 0) >= GIORNI_NO_ARRIVO
  return { ...r, stato, giorniDaRicarica, giorniDaEffettuato, alert_no_bonifico, alert_no_arrivo, alert: alert_no_bonifico || alert_no_arrivo }
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const admin = createAdminSupabase()
  const p = req.nextUrl.searchParams

  // Badge menu: quanti ALERT attivi (righe aperte in allarme). Leggo solo le aperte.
  if (p.get('count')) {
    const { data } = await admin.from('ricariche_check')
      .select('ricaricato_il,bonifico_effettuato_il,bonifico_arrivato_il,metodo')
      .eq('master_id', s.master_id).is('bonifico_arrivato_il', null).is('nascosta_il', null).limit(3000)
    const n = (data || []).map(arricchisci).filter((r: any) => r.alert).length
    return NextResponse.json({ count: n })
  }

  // Chi si puo' scegliere aggiungendo una ricarica a mano: i clienti del master e i suoi sotto-master diretti.
  if (p.get('anagrafiche')) {
    if (!eTitolareOAdmin({ ruolo: s.ruolo })) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    try {
      const [cli, sub] = await Promise.all([
        fetchAllStretto(() => admin.from('clienti').select('id,ragione_sociale').eq('master_id', s.master_id).order('ragione_sociale').order('id')),
        fetchAllStretto(() => admin.from('masters').select('id,nome').eq('parent_master_id', s.master_id).order('nome').order('id')),
      ])
      return NextResponse.json({
        anagrafiche: [...cli.map((c: any) => ({ valore: c.id, nome: c.ragione_sociale || '—', tipo: 'cliente' })),
          ...sub.map((m: any) => ({ valore: 'm:' + m.id, nome: m.nome || '—', tipo: 'master' }))],
      })
    } catch (e: any) { return NextResponse.json({ error: e?.message || 'Errore' }, { status: 500 }) }
  }

  let q = admin.from('ricariche_check').select('*')
    .eq('master_id', s.master_id).is('nascosta_il', null).order('ricaricato_il', { ascending: false }).limit(1000)
  const dal = p.get('dal'), al = p.get('al')
  if (dal) q = q.gte('ricaricato_il', dal)
  if (al) q = q.lte('ricaricato_il', al + 'T23:59:59')
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Le ricariche pagate a pezzi dall'estratto conto (400 € = 200 + 200): quanto e' gia' arrivato. I pezzi li scrive
  // il master che ha il conto (anche per le ricariche dei suoi sotto-master), quindi qui si cercano per ricarica.
  const pezzi = new Map<string, number>()
  const ids = (data || []).map((r: any) => r.id)
  for (let i = 0; i < ids.length; i += 300) {
    const { data: pz, error: ep } = await admin.from('parti_bonifici').select('ricarica_id,importo').in('ricarica_id', ids.slice(i, i + 300))
    if (ep) break   // senza la tabella (prima della migrazione) nessun pezzo
    for (const x of pz || []) pezzi.set(x.ricarica_id, Math.round(((pezzi.get(x.ricarica_id) || 0) + Number(x.importo)) * 100) / 100)
  }
  let righe = (data || []).map((r: any) => ({ ...arricchisci(r), pagato_parti: pezzi.get(r.id) || 0 }))
  const cerca = (p.get('q') || '').trim().toLowerCase()
  if (cerca) righe = righe.filter((r: any) => (r.target_nome || '').toLowerCase().includes(cerca) || (r.mittente || '').toLowerCase().includes(cerca))
  const filtro = p.get('stato')
  if (filtro === 'alert') righe = righe.filter((r: any) => r.alert)
  else if (filtro && ['in_attesa', 'effettuato', 'arrivato'].includes(filtro)) righe = righe.filter((r: any) => r.stato === filtro)

  const riepilogo = {
    scoperto: righe.filter((r: any) => r.stato !== 'arrivato' && r.stato !== 'altro_metodo').reduce((t: number, r: any) => t + Number(r.importo || 0), 0),
    n_in_attesa: righe.filter((r: any) => r.stato === 'in_attesa').length,
    n_effettuato: righe.filter((r: any) => r.stato === 'effettuato').length,
    n_alert: righe.filter((r: any) => r.alert).length,
    soglie: { no_bonifico: GIORNI_NO_BONIFICO, no_arrivo: GIORNI_NO_ARRIVO },
  }
  // contabilita: la pagina mostra "chi ha pagato" anche da scrivere dopo (lib/contabilita-banca).
  return NextResponse.json({ righe, riepilogo, contabilita: contabilitaAttiva(s.master_id), puoAggiungere: eTitolareOAdmin({ ruolo: s.ruolo }) })
}

// Le uniche azioni ammesse, con la GUARDIA sullo stato attuale (transizione rigida). L'update scatta
// SOLO se lo stato di partenza e' quello giusto: cosi' due click, un doppio invio o una richiesta in
// ritardo non possono "saltare" lo stato. È il cuore delle regole rigide sui bonifici.
//   in_attesa --effettuato--> effettuato --arrivato--> arrivato   (+ le due annulla, un passo alla volta)
const AZIONI = ['effettuato', 'arrivato', 'annulla_effettuato', 'annulla_arrivato', 'nota', 'elimina', 'mittente']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const giornoRoma = (d: Date | string) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })
const spostaGiorno = (g: string, n: number) => new Date(Date.parse(g + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)

// RICARICA AGGIUNTA A MANO (Lorenzo, 12/11): una ricarica vecchia di cui si aspetta ancora il bonifico, che
// nel Check Ricariche non c'e' (fatta prima del 19/08, o tolta quando Ecomize ha ripulito l'elenco). E' SOLO
// registro: nessun movimento, il credito del cliente non cambia — per quello c'e' la ricarica vera.
// Titolare o admin: l'operatore ricarica, ma scrivere a mano cosa si aspetta in banca e' del titolare.
async function aggiungi(admin: any, s: { user: any, master_id: string, ruolo: string }, b: any) {
  if (!eTitolareOAdmin({ ruolo: s.ruolo })) return NextResponse.json({ error: 'Solo il titolare o un admin può aggiungere ricariche a mano' }, { status: 403 })
  const t = String(b.target || '')
  const sotto = t.startsWith('m:')
  const targetId = sotto ? t.slice(2) : t
  if (!UUID.test(targetId)) return NextResponse.json({ error: 'Scegli il cliente o il sotto-master' }, { status: 400 })
  let nome: string | null = null
  if (sotto) {
    const { data: m } = await admin.from('masters').select('id,nome,parent_master_id').eq('id', targetId).maybeSingle()
    if (!m || m.parent_master_id !== s.master_id) return NextResponse.json({ error: 'Sotto-master non trovato fra i tuoi' }, { status: 404 })
    nome = m.nome || null
  } else {
    const { data: c } = await admin.from('clienti').select('id,ragione_sociale,master_id').eq('id', targetId).maybeSingle()
    if (!c || c.master_id !== s.master_id) return NextResponse.json({ error: 'Cliente non trovato fra i tuoi' }, { status: 404 })
    nome = c.ragione_sociale || null
  }
  const importo = Math.round(Number(String(b.importo ?? '').replace(',', '.')) * 100) / 100
  if (!Number.isFinite(importo) || importo <= 0 || importo > 100000) return NextResponse.json({ error: 'Importo non valido' }, { status: 400 })
  const giorno = String(b.giorno || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno) || giornoRoma(giorno + 'T12:00:00Z') !== giorno) return NextResponse.json({ error: 'Data non valida' }, { status: 400 })
  if (giorno > giornoRoma(new Date())) return NextResponse.json({ error: 'La data della ricarica non può essere nel futuro' }, { status: 400 })
  if (giorno < '2024-01-01') return NextResponse.json({ error: 'Data troppo vecchia' }, { status: 400 })
  const stato = String(b.stato || '')
  if (!['attesa', 'effettuato', 'arrivato'].includes(stato)) return NextResponse.json({ error: 'Scegli a che punto è il bonifico' }, { status: 400 })
  // Come nella finestra di ricarica: dove la contabilita' e' accesa si dice come ha pagato e chi ha fatto il
  // bonifico; contanti o contrassegni compensati non aspettano niente in banca.
  const conti = contabilitaAttiva(s.master_id)
  const metodo = conti ? (metodoValido(b.metodo) ? b.metodo : 'bonifico') : null
  const bonifico = !metodo || metodo === 'bonifico'
  const mittente = conti && bonifico ? (pulisciNome(b.mittente) || null) : null
  const note = String(b.note || '').trim().slice(0, 500) || null

  // Due ricariche uguali lo stesso giorno sono possibili, ma a mano e' facile scriverne una gia' presente:
  // si chiede conferma. Le nascoste non contano: sono fuori dal Check Ricariche e dall'estratto.
  if (b.conferma !== true) {
    const { data: vicine, error: ev } = await admin.from('ricariche_check').select('id,ricaricato_il')
      .eq('master_id', s.master_id).eq('target_tipo', sotto ? 'master' : 'cliente').eq('target_id', targetId).eq('importo', importo)
      .is('nascosta_il', null).gte('ricaricato_il', spostaGiorno(giorno, -1) + 'T00:00:00Z').lte('ricaricato_il', spostaGiorno(giorno, 1) + 'T23:59:59Z')
    if (ev) return NextResponse.json({ error: ev.message }, { status: 400 })
    if ((vicine || []).some((r: any) => giornoRoma(r.ricaricato_il) === giorno)) {
      const [a, m, g] = giorno.split('-')
      return NextResponse.json({ doppione: true, error: `C'è già una ricarica di € ${importo.toLocaleString('it-IT', { minimumFractionDigits: 2 })} a ${nome || 'questo cliente'} del ${g}/${m}/${a}.` }, { status: 409 })
    }
  }

  const ora = new Date().toISOString()
  const arrivato = bonifico && stato === 'arrivato'
  const { data: riga, error } = await admin.from('ricariche_check').insert({
    master_id: s.master_id, target_tipo: sotto ? 'master' : 'cliente', target_id: targetId, target_nome: nome,
    importo, ricaricato_il: giorno + 'T12:00:00Z', created_by: s.user.id, a_mano: true, note,
    bonifico_effettuato_il: bonifico && stato !== 'attesa' ? ora : null,
    bonifico_arrivato_il: arrivato ? ora : null,
    ...(metodo ? { metodo, mittente } : {}),
  }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await registraAudit({ utenteId: s.user.id, ruolo: s.ruolo, azione: 'check_ricarica_a_mano', risorsa: riga.id,
    dettaglio: `${sotto ? 'master' : 'cliente'}:${targetId} € ${importo} del ${giorno}, ${metodo || 'bonifico'} ${bonifico ? stato : ''}`.trim() })
  if (mittente) {
    try {
      await ricordaPagatore(admin, { masterId: s.master_id, targetTipo: sotto ? 'master' : 'cliente', targetId, nome: mittente, origine: 'ricarica', createdBy: s.user.id, usato: true })
    } catch (e: any) { return NextResponse.json({ ok: true, riga: arricchisci(riga), avviso: 'Ricarica aggiunta, ma il nome non è stato salvato sul cliente: ' + (e?.message || e) }) }
  }
  return NextResponse.json({ ok: true, riga: arricchisci(riga) })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const s = await staff(supabase)
  if (!s) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const admin = createAdminSupabase()
  const b = await req.json().catch(() => ({}))
  if (b?.azione === 'aggiungi') return aggiungi(admin, s, b)
  const id = String(b.id || ''); const azione = String(b.azione || '')
  if (!id || !AZIONI.includes(azione)) return NextResponse.json({ error: 'Dati non validi' }, { status: 400 })

  // La riga dev'essere del MIO master: conoscere un id qualsiasi non basta. E ogni scrittura ripete
  // il vincolo master (eq master_id) come cintura, oltre alla guardia di stato.
  const { data: riga } = await admin.from('ricariche_check')
    .select('id,master_id,target_tipo,target_id,metodo,bonifico_effettuato_il,bonifico_arrivato_il,nascosta_il').eq('id', id).maybeSingle()
  if (!riga || riga.master_id !== s.master_id) return NextResponse.json({ error: 'Riga non trovata nella tua rete' }, { status: 403 })
  // Una riga nascosta non si tocca da qui: se e' abbinata a un bonifico, "elimina" si porterebbe via
  // l'abbinamento (on delete cascade) senza che nessuno la veda.
  if (riga.nascosta_il) return NextResponse.json({ error: 'Questa ricarica è stata tolta dal Check Ricariche' }, { status: 404 })

  const now = new Date().toISOString()

  // Chi ha fatto il bonifico, scritto anche dopo la ricarica (Lorenzo, 10/11): resta sulla ricarica e fra i
  // nomi del cliente, cosi' l'estratto conto lo riconosce. Lo scrive chi puo' ricaricare, dove la
  // contabilita' e' accesa. Una ricarica senza metodo (di prima del campo) diventa "bonifico".
  if (azione === 'mittente') {
    if (!contabilitaAttiva(s.master_id) || !gestisceLaRete({ ruolo: s.ruolo })) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    if (riga.metodo && riga.metodo !== 'bonifico') return NextResponse.json({ error: 'Questa ricarica non è stata pagata con bonifico' }, { status: 400 })
    const nome = pulisciNome(b.mittente)
    const { error } = await admin.from('ricariche_check').update({ mittente: nome || null, metodo: 'bonifico' }).eq('id', id).eq('master_id', s.master_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (nome) {
      try {
        await ricordaPagatore(admin, { masterId: s.master_id, targetTipo: riga.target_tipo, targetId: riga.target_id, nome, origine: 'ricarica', createdBy: s.user.id, usato: true })
      } catch (e: any) { return NextResponse.json({ error: 'Nome salvato sulla ricarica ma non sul cliente: ' + (e?.message || e) }, { status: 500 }) }
    }
    const { data: fresh } = await admin.from('ricariche_check').select('*').eq('id', id).maybeSingle()
    return NextResponse.json({ ok: true, riga: fresh ? arricchisci(fresh) : null })
  }

  if (azione === 'elimina') {
    const { error } = await admin.from('ricariche_check').delete().eq('id', id).eq('master_id', s.master_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, eliminata: true })
  }
  if (azione === 'nota') {
    const { error } = await admin.from('ricariche_check').update({ note: b.note ? String(b.note).slice(0, 500) : null }).eq('id', id).eq('master_id', s.master_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  } else {
    // Transizione RIGIDA: patch + guardia sullo stato di partenza.
    let q: any = admin.from('ricariche_check')
    if (azione === 'effettuato') q = q.update({ bonifico_effettuato_il: now }).is('bonifico_effettuato_il', null)
    else if (azione === 'arrivato') q = q.update({ bonifico_arrivato_il: now }).is('bonifico_arrivato_il', null).not('bonifico_effettuato_il', 'is', null)
    else if (azione === 'annulla_arrivato') q = q.update({ bonifico_arrivato_il: null }).not('bonifico_arrivato_il', 'is', null)
    else /* annulla_effettuato */ q = q.update({ bonifico_effettuato_il: null }).not('bonifico_effettuato_il', 'is', null).is('bonifico_arrivato_il', null)
    const { error } = await q.eq('id', id).eq('master_id', s.master_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    // Se la guardia non ha trovato la riga (0 update) NON e' un errore: la riga era gia' in quello
    // stato o la transizione non era valida. Sotto rileggo e restituisco lo stato VERO: la UI si
    // allinea sempre alla realta', non a un click ottimistico.
  }

  const { data: fresh } = await admin.from('ricariche_check').select('*').eq('id', id).maybeSingle()
  return NextResponse.json({ ok: true, riga: fresh ? arricchisci(fresh) : null })
}
