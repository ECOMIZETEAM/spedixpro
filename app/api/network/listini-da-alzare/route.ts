import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'

// I TUOI CLIENTI COL LISTINO TROPPO BASSO — resoconto per-master, in casa sua.
// Un recupero resta bloccato quando la ripesatura supera l'ULTIMA fascia del listino del cliente e
// quel listino non ha la regola "oltre X kg": il motore non sa prezzarla → non si gira → il master
// dovrebbe assorbirla per un costo che è del cliente. Invece di scoprirlo una alla volta premendo
// Accetta, qui il master vede TUTTI i suoi clienti da sistemare in un colpo: cliente, corriere, fin
// dove arriva oggi il listino, il peso più alto che serve, quanti recuperi (e quanti €) sblocca
// alzando la fascia. Poi alza quei listini e riaccetta.
//
// NON è un foglio globale che vede solo il super master: ogni master lo apre nel proprio portale e
// vede SOLO i propri clienti (target_master_id = suo). MULTIEXPRESS non è il collo di bottiglia.
//
// Il confronto è diretto (peso ripesato vs fascia massima del listino), senza rifare tutta la
// catena: veloce anche su centinaia di righe. La fascia massima si guarda su tutte le zone (le bande
// sono le stesse, cambia il prezzo): se il peso supera la più alta e manca "oltre", è bloccata
// qualunque sia la zona.
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg
  if (!utente?.master_id || !gestisceLaRete(utente)) {
    return NextResponse.json({ clienti: [], totaleRecuperi: 0, totaleImporto: 0 })
  }
  const mio = utente.master_id
  const adminDb = createAdminSupabase()

  // 1) Le rettifiche RICEVUTE ancora da decidere (quelle che tenterebbe di propagare).
  const { data: rettRaw } = await adminDb.from('rettifiche')
    .select('id,spedizione_id,peso_reale,peso_volume_reale,differenza,fuori_sagoma')
    .eq('target_master_id', mio).eq('confermata', true).is('propagazione', null)
  const rett = (rettRaw || []) as any[]
  if (!rett.length) return NextResponse.json({ clienti: [], totaleRecuperi: 0, totaleImporto: 0 })

  // escludo quelle già propagate a metà (hanno una figlia): non sono da decidere
  const ids = rett.map(r => r.id)
  const conFiglia = new Set<string>()
  for (let i = 0; i < ids.length; i += 400) {
    const { data } = await adminDb.from('rettifiche').select('origine_rettifica_id').in('origine_rettifica_id', ids.slice(i, i + 400))
    for (const f of (data || [])) if ((f as any).origine_rettifica_id) conFiglia.add((f as any).origine_rettifica_id)
  }
  const rettOk = rett.filter(r => !conFiglia.has(r.id) && r.spedizione_id)

  // 2) Le loro spedizioni: cliente + corriere. (Le proprie, senza cliente, non c'entrano qui.)
  const spedIds = [...new Set(rettOk.map(r => r.spedizione_id))]
  const sped = new Map<string, { cliente_id: string | null; corriere_id: string | null }>()
  for (let i = 0; i < spedIds.length; i += 300) {
    const { data } = await adminDb.from('spedizioni').select('id,cliente_id,corriere_id').in('id', spedIds.slice(i, i + 300))
    for (const s of (data || [])) sped.set((s as any).id, { cliente_id: (s as any).cliente_id, corriere_id: (s as any).corriere_id })
  }

  // 3) Clienti coinvolti → il loro listino.
  const clienteIds = [...new Set(rettOk.map(r => sped.get(r.spedizione_id)?.cliente_id).filter(Boolean))] as string[]
  const cliente = new Map<string, { nome: string; listino_id: string | null }>()
  for (let i = 0; i < clienteIds.length; i += 300) {
    const { data } = await adminDb.from('clienti').select('id,ragione_sociale,listino_cliente_id').in('id', clienteIds.slice(i, i + 300))
    for (const c of (data || [])) cliente.set((c as any).id, { nome: (c as any).ragione_sociale, listino_id: (c as any).listino_cliente_id })
  }

  // 4) Fasce dei listini coinvolti → per (listino, corriere): fascia massima + c'è "oltre"?
  const listinoIds = [...new Set([...cliente.values()].map(c => c.listino_id).filter(Boolean))] as string[]
  const corriereIds = [...new Set(rettOk.map(r => sped.get(r.spedizione_id)?.corriere_id).filter(Boolean))] as string[]
  const maxFascia = new Map<string, { max: number; oltre: boolean }>()   // key: listino|corriere
  const corriereNome = new Map<string, string>()
  if (listinoIds.length && corriereIds.length) {
    for (let i = 0; i < listinoIds.length; i += 50) {
      const { data } = await adminDb.from('listini_clienti_fasce')
        .select('listino_id,corriere_id,peso_max,tipo')
        .in('listino_id', listinoIds.slice(i, i + 50)).in('corriere_id', corriereIds)
      for (const f of (data || []) as any[]) {
        const k = f.listino_id + '|' + f.corriere_id
        const cur = maxFascia.get(k) || { max: 0, oltre: false }
        if (f.tipo === 'oltre') cur.oltre = true
        else cur.max = Math.max(cur.max, parseFloat(f.peso_max) || 0)
        maxFascia.set(k, cur)
      }
    }
    const { data: cc } = await adminDb.from('corrieri').select('id,nome_contratto').in('id', corriereIds)
    for (const c of (cc || [])) corriereNome.set((c as any).id, (c as any).nome_contratto)
  }

  // 5) Flag per riga: peso ripesato oltre la fascia max E nessun "oltre" → bloccata dal listino.
  const grp = new Map<string, any>()   // key: cliente|corriere
  for (const r of rettOk) {
    const s = sped.get(r.spedizione_id); if (!s?.cliente_id || !s.corriere_id) continue
    const cl = cliente.get(s.cliente_id); if (!cl?.listino_id) continue
    const mf = maxFascia.get(cl.listino_id + '|' + s.corriere_id)
    if (!mf || mf.oltre || mf.max <= 0) continue    // ha "oltre" o non so il max → non la conto qui
    const pesoFatt = Math.max(Number(r.peso_reale) || 0, Number(r.peso_volume_reale) || 0)
    if (pesoFatt <= mf.max) continue                // dentro la fascia → non bloccata dal peso
    const k = s.cliente_id + '|' + s.corriere_id
    const g = grp.get(k) || { cliente: cl.nome, corriere: corriereNome.get(s.corriere_id) || '—', fasciaMax: mf.max, pesoMassimo: 0, recuperi: 0, importo: 0 }
    g.pesoMassimo = Math.max(g.pesoMassimo, pesoFatt)
    g.recuperi += 1
    g.importo += (Number(r.differenza) < 0 ? -Number(r.differenza) : 0) + (Number(r.fuori_sagoma) || 0)
    grp.set(k, g)
  }

  const clienti = [...grp.values()]
    .map(g => ({ ...g, importo: Math.round(g.importo * 100) / 100, pesoMassimo: Math.round(g.pesoMassimo) }))
    .sort((a, b) => b.importo - a.importo)
  return NextResponse.json({
    clienti,
    totaleRecuperi: clienti.reduce((a, c) => a + c.recuperi, 0),
    totaleImporto: Math.round(clienti.reduce((a, c) => a + c.importo, 0) * 100) / 100,
  })
}
