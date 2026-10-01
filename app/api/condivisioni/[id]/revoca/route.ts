import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { getPermessiUtente } from '@/lib/permessi'
import { disabilitaContrattoCondiviso } from '@/lib/condivisione-engine'

/* Revoca un collegamento/condivisione che HO CREATO io (sono il venditore). Prima SMONTA i contratti
 * abilitati (spegne/pulisce i corrieri del compratore, revoca le chiavi — lo storico delle spedizioni
 * resta, REGOLE.md), poi mette lo stato → 'revocata'. Lo storico del collegamento non si cancella.
 */

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const perm = await getPermessiUtente()
  if (!perm?.masterId || !perm.isFull) return NextResponse.json({ error: 'Riservato al master' }, { status: 403 })
  const { id } = await params
  const admin = createAdminSupabase()

  // Deve essere una MIA condivisione (sono il fornitore) e ancora viva.
  const { data: c } = await admin.from('corrieri_condivisi')
    .select('id,fornitore_master_id,master_id,corriere_id,stato').eq('id', id).maybeSingle()
  if (!c || c.fornitore_master_id !== perm.masterId) return NextResponse.json({ error: 'Condivisione non trovata.' }, { status: 404 })
  if (!['in_attesa', 'attiva'].includes(c.stato)) return NextResponse.json({ error: 'Già chiusa.' }, { status: 409 })

  // Collegamento (flusso nuovo): smonto ogni contratto abilitato = i corrieri moovexpress del compratore
  // che vengono DA ME. disabilitaContrattoCondiviso disattiva (se hanno spedizioni) o rimuove pulito.
  if (!c.corriere_id) {
    const { data: corrBuyers } = await admin.from('corrieri')
      .select('id,credenziali').eq('master_id', c.master_id).eq('tipo', 'moovexpress')
    for (const cb of (corrBuyers || [])) {
      const cred = (cb.credenziali || {}) as any
      if (cred.fornitore_master_id === perm.masterId && cred.corriere_origine_id) {
        try { await disabilitaContrattoCondiviso(admin, { linkId: id, corriereId: cred.corriere_origine_id }) }
        catch (e: any) { console.error('[condivisioni/revoca] smonto contratto', e?.message) }
      }
    }
  }

  const { error } = await admin.from('corrieri_condivisi')
    .update({ stato: 'revocata', revocata_il: new Date().toISOString() }).eq('id', id)
  if (error) { console.error('[condivisioni/revoca]', error); return NextResponse.json({ error: 'Revoca non riuscita.' }, { status: 500 }) }
  return NextResponse.json({ ok: true })
}
