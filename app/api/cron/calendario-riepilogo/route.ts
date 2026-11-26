import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { giornoRoma, inizioGiornoRomaISO, fineGiornoRomaISO } from '@/lib/date-roma'
import { partiRoma } from '@/lib/calendario-ricorrenza'
import { vociNelPeriodo, promemoriaDaFare } from '@/lib/calendario-server'
import { permessiDiUtente, haPermesso } from '@/lib/permessi'
import { vedeLaRete } from '@/lib/perimetro'
import { isAgente } from '@/lib/agente'
import { perimetroRitiri, perimetroGiacenze, perimetroGiacenzeCliente, soloIlMioMaster, applicaPerimetro, corrieriDelPerimetro, type Perimetro } from '@/lib/perimetro-ritiri-giacenze'
import { inviaEmailRiepilogo } from '@/lib/email'
import { mandaPush } from '@/lib/notifiche-push'
import { masterEDemo } from '@/lib/demo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// IL RIEPILOGO DEL MATTINO DEL CALENDARIO (fase 3, 26/11/2026): alle 7:30 di Roma, per email e come notifica, SOLO a chi
// l'ha acceso (calendario_preferenze.riepilogo_mattino; Lorenzo: «chi lo attiva»), e solo se c'è qualcosa.
// Vercel ragiona in UTC: il giro è chiamato alle 5:30 e alle 6:30 UTC e lavora solo quando a Roma sono le 7 (vale con e
// senza ora legale). Uno al giorno per persona (riepilogo_inviato_il = oggi, scritto PRIMA di spedire).
//
// CHI VEDE COSA: ognuno solo ciò che vede nel portale. Ritiri e giacenze con le stesse regole del calendario (permesso
// della pagina, lib/perimetro-ritiri-giacenze ristretto al proprio master); le voci quelle sue e quelle a cui è
// invitato e non ha detto di no.
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const oraRoma = partiRoma(new Date()).h
  if (oraRoma !== 7) return NextResponse.json({ ok: true, saltato: `a Roma sono le ${oraRoma}` })
  const admin = createAdminSupabase()
  const oggi = giornoRoma()
  const dal = new Date(inizioGiornoRomaISO(oggi)), al = new Date(new Date(fineGiornoRomaISO(oggi)).getTime() + 1)
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://moovexpress.com').replace(/\/$/, '')
  const giorno = dal.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long' })
  const conti = { iscritti: 0, mandati: 0, vuoti: 0, saltati: 0, errori: 0 }

  const { data: chi, error } = await admin.from('calendario_preferenze').select('utente_id,riepilogo_inviato_il').eq('riepilogo_mattino', true).limit(5000)
  if (error) { console.error('[CALENDARIO-RIEPILOGO] iscritti non letti:', error.message); return NextResponse.json({ error: error.message }, { status: 500 }) }
  conti.iscritti = (chi || []).length

  // cinque persone per volta: una costa circa un secondo di letture, e il giro ha cinque minuti
  const persone = (chi || []).filter((c) => c.riepilogo_inviato_il !== oggi)
  for (let i = 0; i < persone.length; i += 5) await Promise.all(persone.slice(i, i + 5).map(async (c) => {
    try {
      // lo prendo io: un riepilogo al giorno anche con due giri sovrapposti
      const { data: presa } = await admin.from('calendario_preferenze').update({ riepilogo_inviato_il: oggi }).eq('utente_id', c.utente_id)
        .or(`riepilogo_inviato_il.is.null,riepilogo_inviato_il.neq.${oggi}`).select('utente_id').maybeSingle()
      if (!presa) return
      const { data: u } = await admin.from('utenti').select('id,ruolo,master_id,cliente_id,nome,cognome,attivo').eq('id', c.utente_id).maybeSingle()
      if (!u || u.attivo === false || !u.master_id || String(u.ruolo || '').toLowerCase() === 'autista') { conti.saltati++; return }
      if (await masterEDemo(u.master_id, admin).catch(() => false)) { conti.saltati++; return }

      // le voci di oggi (le sue e gli inviti non rifiutati), gli inviti da rispondere, i promemoria rimasti indietro
      const voci = (await vociNelPeriodo(admin, u.id, dal, al)).filter((v) => v.invito?.stato !== 'rifiutato')
      const { count: inviti } = await admin.from('calendario_inviti').select('id', { count: 'exact', head: true }).eq('utente_id', u.id).eq('stato', 'in_attesa').is('eliminato_il', null)
      const arretrati = (await promemoriaDaFare(admin, u.id)).filter((v) => new Date(v.inizio) < dal).length

      // ritiri di oggi e giacenze aperte, solo se le vede (stesse regole del calendario)
      const cliente = String(u.ruolo).toLowerCase() === 'cliente' && !!u.cliente_id
      const perm = cliente ? null : await permessiDiUtente(admin, u)
      const vedeR = cliente || ((vedeLaRete(u) || isAgente(u)) && haPermesso(perm, 'admin.pickups.index'))
      const vedeG = cliente || ((vedeLaRete(u) || isAgente(u)) && haPermesso(perm, 'admin.stocks.index'))
      let ritiri: number | null = null, giacenze: number | null = null
      const conta = async (tabella: string, p: Perimetro, filtra: (q: any) => any) => {
        if (p.nessuno) return 0
        const { count, error: e } = await filtra(applicaPerimetro(admin.from(tabella).select(`id, ${corrieriDelPerimetro(p, 'nome_contratto')}`, { count: 'exact', head: true }), p))
        if (e) throw new Error(`${tabella}: ${e.message}`)
        return count || 0
      }
      if (vedeR) ritiri = await conta('ritiri', soloIlMioMaster(await perimetroRitiri(admin, admin, u), u.master_id), (q) => q.eq('data_ritiro', oggi))
      if (vedeG) {
        const pg = cliente ? perimetroGiacenzeCliente(u) : soloIlMioMaster(await perimetroGiacenze(admin, admin, u), u.master_id)
        giacenze = await conta('spedizioni', pg, (q) => q.not('giacenza_data', 'is', null)
          .gte('giacenza_data', new Date(Date.now() - 45 * 86400000).toISOString()).or('giacenza_stato.eq.aperta,giacenza_stato.is.null'))
      }

      // niente da dire: niente email né notifica
      if (!voci.length && !ritiri && !giacenze && !inviti && !arretrati) { conti.vuoti++; return }

      const href = cliente ? '/cliente/calendario' : '/dashboard/calendario'
      const righe = voci.slice(0, 12).map((v) => ({
        ora: v.tutto_il_giorno ? 'giorno' : new Date(v.inizio).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }),
        titolo: v.titolo,
        sotto: [v.luogo, v.invito ? `invito di ${v.invito.organizzatore}` : null].filter(Boolean).join(' · ') || null,
      }))
      const pezzi = [
        voci.length ? `${voci.length} ${voci.length === 1 ? 'voce' : 'voci'} in calendario` : null,
        ritiri ? `${ritiri} ${ritiri === 1 ? 'ritiro' : 'ritiri'}` : null,
        giacenze ? `${giacenze} ${giacenze === 1 ? 'giacenza' : 'giacenze'} da gestire` : null,
        inviti ? `${inviti} ${inviti === 1 ? 'invito' : 'inviti'} da rispondere` : null,
      ].filter(Boolean)
      await mandaPush(admin, u.id, { titolo: 'Il tuo giorno', testo: pezzi.join(' · ') || 'Apri il calendario', link: href, chiave: `riepilogo-${oggi}` }).catch(() => null)

      const { data: acc } = await admin.auth.admin.getUserById(u.id)
      const email = acc?.user?.email
      if (email) {
        const { data: m } = await admin.from('masters').select('logo_url,nome').eq('id', u.master_id).maybeSingle()
        const r = await inviaEmailRiepilogo({
          to: email, giorno, voci: righe, ritiri, giacenze, inviti: inviti || 0, arretrati, link: `${base}${href}`,
          brand: m ? { logo: (m as any).logo_url, nome: (m as any).nome } : undefined,
        })
        if (!r.ok && !/non valida|destinatario interno/.test(r.error || '')) { conti.errori++; console.error('[CALENDARIO-RIEPILOGO] email non mandata:', r.error) }
      }
      conti.mandati++
    } catch (e: any) {
      conti.errori++
      console.error('[CALENDARIO-RIEPILOGO] persona saltata:', c.utente_id, e?.message || e)
    }
  }))
  return NextResponse.json({ ok: true, giorno: oggi, ...conti })
}
