import { createAdminSupabase } from '@/lib/supabase-admin'

// AUDIT LOG accessi a dati personali / azioni amministrative (requisito Amazon DPP: registri di
// controllo, conservazione >=12 mesi, revisione bisettimanale). Best-effort: non blocca mai il flusso.
export async function registraAudit(p: {
  utenteId?: string | null
  ruolo?: string | null
  azione: string
  risorsa?: string | null
  dettaglio?: string | null
}) {
  try {
    const admin = createAdminSupabase()
    await admin.from('audit_accessi').insert({
      utente_id: p.utenteId || null,
      ruolo: p.ruolo || null,
      azione: p.azione,
      risorsa: p.risorsa || null,
      dettaglio: p.dettaglio || null,
    })
  } catch { /* l'audit non deve mai rompere l'operazione */ }
}
