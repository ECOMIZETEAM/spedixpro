import { createAdminSupabase } from '@/lib/supabase-admin'

// Chi apre la prova della grafica nuova (Lorenzo 21/11: «controllate chi la visualizza e chi vota»). I layout del
// portale master e cliente la chiamano a ogni pagina aperta nella prova, dentro after(): dopo la risposta, senza
// rallentare la pagina. Se il registro non risponde la pagina non se ne accorge (è solo un conteggio).
// Tabella e funzione: scripts/grafica-visite.sql. Le legge /api/grafica/voti, solo per il super master.
export function dispositivoDa(userAgent: string): string {
  if (userAgent.includes('MoovExpressApp/')) return 'app'
  return /Mobi|Android|iPhone|iPad/i.test(userAgent) ? 'telefono' : 'computer'
}

export async function segnaVisitaGrafica(v: { utente: string; master?: string | null; cliente?: string | null; ruolo?: string | null; userAgent: string }) {
  try {
    await createAdminSupabase().rpc('segna_visita_grafica', {
      p_utente: v.utente, p_master: v.master || null, p_cliente: v.cliente || null,
      p_ruolo: v.ruolo || null, p_dispositivo: dispositivoDa(v.userAgent),
    })
  } catch { /* solo un conteggio: se manca una visita non succede niente */ }
}
