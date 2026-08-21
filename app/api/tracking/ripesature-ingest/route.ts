import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { autorizzaHarvester, MASTER_DETENTORE_PDB } from '@/lib/ripesature-harvester'
import { calcolaRipesature } from '@/lib/ripesature-calcolo'
import { creaRettificaDaEsito } from '@/lib/ripesature-crea'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Riceve dallo script locale il RIPESATO di un lotto di consegnate PDB e, per ognuna, crea la
// rettifica IN ATTESA (mai confermata: la carica MULTIEXPRESS a mano). Solo-recuperi + anti-doppio
// per spedizione stanno in creaRettificaDaEsito. Idempotente: ripesature_check + anti-doppio.
// body: { righe: [{ spedizione_id, ldv, peso?, lunghezza?, larghezza?, altezza?, no_misure? }] }
export async function POST(req: NextRequest) {
  const admin = createAdminSupabase()
  if (!(await autorizzaHarvester(req, admin))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const righe = Array.isArray(body?.righe) ? body.righe : []
  const ora = () => new Date().toISOString()
  let rettificate = 0, noMisure = 0, gia = 0, ok = 0, errori = 0, recuperoTot = 0

  for (const r of righe) {
    const sid = r?.spedizione_id
    const ldv = String(r?.ldv || '')
    if (!sid || !ldv) continue
    const l = Number(r?.lunghezza) || 0, w = Number(r?.larghezza) || 0, h = Number(r?.altezza) || 0
    const peso = Number(r?.peso) || 0
    if (r?.no_misure || !(l && w && h)) {
      await admin.from('ripesature_check').upsert({ spedizione_id: sid, controllato_il: ora(), esito: 'no-misure' })
      noMisure++; continue
    }
    try {
      const rip = {
        idOrdine: ldv, idVerifiche: [], ldv, addebitoFornitore: 0,
        colli: [{ peso, lunghezza: l, larghezza: w, altezza: h }],
        dataChiusura: '', mittente: '', destinatario: '',
      }
      const [esito] = await calcolaRipesature(admin, [rip as any])
      const cr = await creaRettificaDaEsito(admin, MASTER_DETENTORE_PDB, esito)
      const e = cr.creata ? 'rettificata'
        : (cr.motivo || '').includes('gia') ? 'gia-rettificata'
        : (cr.motivo || '').includes('errore') ? 'errore'
        : (cr.motivo || '').includes('trovata') ? 'non-trovata'
        : 'ok'
      await admin.from('ripesature_check').upsert({
        spedizione_id: sid, controllato_il: ora(), esito: e,
        rettifica_id: cr.rettificaId || null, recupero: cr.recupero || null, dettaglio: cr.motivo || null,
      })
      if (cr.creata) { rettificate++; recuperoTot += cr.recupero || 0 }
      else if (e === 'gia-rettificata') gia++
      else if (e === 'errore') errori++
      else ok++
    } catch (err: any) {
      await admin.from('ripesature_check').upsert({ spedizione_id: sid, controllato_il: ora(), esito: 'errore', dettaglio: String(err?.message || err).slice(0, 150) })
      errori++
    }
  }

  return NextResponse.json({
    ok: true, ricevute: righe.length,
    rettificate, noMisure, giaRettificate: gia, okNessuna: ok, errori,
    recuperoTot: Math.round(recuperoTot * 100) / 100,
  })
}
