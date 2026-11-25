import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { nonStaffMaster } from '@/lib/permessi'
import { ledgerGambeInterne } from '@/lib/gambe-visibilita'
import { conCache } from '@/lib/cache-memoria'
import { giornoRoma, giorniFaRoma, inizioGiornoRomaISO, fineGiornoRomaISO } from '@/lib/date-roma'

export const dynamic = 'force-dynamic'

// I NUMERI DELLA DASHBOARD NUOVA che /api/dashboard non ha (app/components/dashboard-finexy). Solo letture.
//
// - OGGI E' IL GIORNO DI ROMA. /api/dashboard conta «spedite oggi» sul giorno UTC; qui il giorno comincia a
//   mezzanotte italiana, come la distinta.
// - Le spedizioni di oggi sono la SOMMA dei corrieri di oggi (stat_corrieri_v2, la stessa funzione delle Statistiche
//   corrieri, con lo stesso perimetro: la rete del master, i contratti che possiede, senza le gambe interne). Cosi'
//   «Partite oggi» e «di cui SDA 188» non possono mai dire due cose diverse.
// - «Da chiudere» sono solo quelle di OGGI ancora senza distinta, con le stesse regole: daMettereInDistinta di
//   /api/dashboard conta da sempre (Ecomize LL il 24/11/2026: 6.403, quasi tutte gia' consegnate).
// - Il confronto con lo stesso giorno della settimana scorsa si ferma alla STESSA ORA di oggi: contro il giorno intero,
//   alle 13 del 25/11 Ecomize LL risultava −38% (153 contro 247, tutto il mercoledi' prima), alla stessa ora era −11%. L'ora e'
//   il tempo passato dalla mezzanotte di Roma, cosi' anche il giorno del cambio d'ora resta confrontabile.
// - Il grafico delle settimane conta SPEDIZIONI (create e consegnate), non soldi. Il venduto settimana per settimana
//   per chi vende all'ingrosso esce falso: acquisto e vendita cadono in settimane diverse (MULTIEXPRESS, settimana del
//   26/10/2026: +5.670 € sulle spedizioni, −16.486 € di correzione ingrosso), e un master leggerebbe una perdita che
//   non c'e'. Il guadagno ha il suo report, che lavora sul periodo intero. Ultime 8 settimane intere, lunedi'-domenica.
type Corriere = { corriere: string; n: number }

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,cliente_id,ruolo').eq('id', user.id).single()
  // Legge con la chiave di servizio tutta la rete: solo lo staff del master (non il cliente, non l'agente).
  if (nonStaffMaster(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const M = utente!.master_id as string
  const oggi = giornoRoma()

  try {
    const dati = await conCache(`plancia:${M}:${oggi}`, 60_000, async () => {
      const { createAdminSupabase } = await import('@/lib/supabase-admin')
      const { sottoAlberoMasterIds, contrattiPossedutiNomi } = await import('@/lib/rete-masters')
      const admin = createAdminSupabase()
      const [rete, posseduti, gambe, { data: me, error: eMe }] = await Promise.all([
        sottoAlberoMasterIds(admin, M), contrattiPossedutiNomi(admin, M), ledgerGambeInterne(admin, M),
        admin.from('masters').select('tipo_contratto').eq('id', M).maybeSingle(),
      ])
      if (eMe) throw new Error(eMe.message)
      const sub = rete.length ? rete : [M]

      const corrieri = async (dal: string, al: string): Promise<Corriere[]> => {
        const { data, error } = await admin.rpc('stat_corrieri_v2', {
          p_sub: sub, p_master: M, p_dal: dal, p_al: al, p_contratti: posseduti.length ? posseduti : null,
        })
        if (error) throw new Error('corrieri: ' + error.message)
        return ((data || []) as { corriere: string; spedizioni: number }[])
          .map(r => ({ corriere: r.corriere, n: Number(r.spedizioni) || 0 }))
          .filter(r => r.n > 0).sort((a, b) => b.n - a.n)
      }
      const somma = (l: Corriere[]) => l.reduce((t, r) => t + r.n, 0)

      // Le spedizioni di oggi senza distinta: stesso perimetro di stat_corrieri_v2.
      const daChiudere = async () => {
        let q = posseduti.length
          ? admin.from('spedizioni').select('id,corrieri!inner(nome_contratto)', { count: 'exact', head: true }).in('corrieri.nome_contratto', posseduti)
          : admin.from('spedizioni').select('id', { count: 'exact', head: true })
        q = q.in('master_id', sub).is('distinta_id', null).not('stato', 'in', '(annullata)')
          .gte('created_at', inizioGiornoRomaISO(oggi)).lte('created_at', fineGiornoRomaISO(oggi))
        if (gambe.length) q = q.or(`cliente_id.is.null,cliente_id.not.in.(${gambe.join(',')})`)
        const { count, error } = await q
        if (error) throw new Error('da chiudere: ' + error.message)
        return count || 0
      }

      // Le ultime 8 settimane intere: dal lunedi' di 8 settimane fa alla domenica appena passata.
      const dow = (new Date(oggi + 'T12:00:00Z').getUTCDay() + 6) % 7   // 0 = lunedi'
      const lunedi = giorniFaRoma(dow)
      // Per ogni settimana le spedizioni create e quante sono gia' consegnate (stat_corrieri_v2, stesso perimetro).
      const settimane = async () => Promise.all(Array.from({ length: 8 }, async (_, i) => {
        const dal = giorniFaRoma(dow + 56 - i * 7), al = giorniFaRoma(dow + 50 - i * 7)
        const { data, error } = await admin.rpc('stat_corrieri_v2', {
          p_sub: sub, p_master: M, p_dal: inizioGiornoRomaISO(dal), p_al: fineGiornoRomaISO(al), p_contratti: posseduti.length ? posseduti : null,
        })
        if (error) throw new Error('settimane: ' + error.message)
        const righe = (data || []) as { spedizioni: number; consegnate: number }[]
        const create = righe.reduce((t, r) => t + (Number(r.spedizioni) || 0), 0)
        const consegnate = righe.reduce((t, r) => t + (Number(r.consegnate) || 0), 0)
        const [, m, g] = dal.split('-')
        return { dal: `${Number(g)}/${Number(m)}`, create, consegnate, nonConsegnate: create - consegnate }
      }))

      const meseDal = oggi.slice(0, 8) + '01'
      const giornoScorso = giorniFaRoma(7)
      const adesso = Date.now()
      const finoAScorso = new Date(new Date(inizioGiornoRomaISO(giornoScorso)).getTime() + (adesso - new Date(inizioGiornoRomaISO(oggi)).getTime())).toISOString()
      const finoAlle = new Date(adesso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })
      const [corrOggi, corrSettimana, corrMese, nDaChiudere, sett] = await Promise.all([
        corrieri(inizioGiornoRomaISO(oggi), fineGiornoRomaISO(oggi)),
        corrieri(inizioGiornoRomaISO(giornoScorso), finoAScorso),
        corrieri(inizioGiornoRomaISO(meseDal), fineGiornoRomaISO(oggi)),
        daChiudere(), settimane(),
      ])
      return {
        giorno: oggi, lunedi,
        oggi: { totale: somma(corrOggi), perCorriere: corrOggi },
        stessoGiornoSettimanaScorsa: { giorno: giornoScorso, totale: somma(corrSettimana), finoAlle },
        mese: { dal: meseDal, totale: somma(corrMese), perCorriere: corrMese },
        daChiudereOggi: nDaChiudere,
        settimane: sett,
        // Chi e' a fattura va sotto zero ed e' normale: niente rosso (REGOLE.md). Senza tipo vale a scalare.
        aScalare: String((me as { tipo_contratto?: string | null } | null)?.tipo_contratto || 'credito_scalare') === 'credito_scalare',
      }
    })
    return NextResponse.json(dati)
  } catch (e) {
    return NextResponse.json({ error: (e as Error)?.message || 'Errore' }, { status: 500 })
  }
}
