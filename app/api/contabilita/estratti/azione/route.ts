import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { registraAudit } from '@/lib/audit'
import { eDiscendente } from '@/lib/rete-masters'
import { chiSei } from '@/lib/contabilita-accesso'
import { metodoEstrattoValido, pulisciIban, pulisciNome, sottoSulConto } from '@/lib/contabilita-banca'
import { norma, type Target } from '@/lib/contabilita-abbina'
import { assegnaPagatore, escludiPagatore, includiPagatore, scollegaRiga } from '@/lib/contabilita-estratti'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// LE AZIONI SULL'ESTRATTO CONTO (lib/contabilita-estratti), del titolare e dei suoi admin:
//  - pagatore: "questo pagatore e' quel cliente", o quei profili (risponde a "di chi e'?");
//  - escludi: "non e' un cliente" (un rimborso, un giroconto); includi: lo annulla;
//  - scollega: toglie un abbinamento sbagliato;
//  - metodo: una ricarica che non era un bonifico (es. contrassegni compensati) esce dall'attesa;
//  - voce: il nome della voce per le uscite verso una controparte (es. "E.M EXPRESS LTD" → "Fornitore");
//  - gira / annulla_giro: la ricarica al sotto-master per i bonifici dei suoi clienti arrivati sul conto
//    (Ecomize LL, Dg Express), e il suo annullo. Li fa il database in una transazione sola.
// Ogni scrittura porta il master della sessione: dal browser arrivano solo id e nomi.

const DATA = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f-]{36}$/i

// Un cliente suo, o di un sotto-master i cui clienti pagano sul suo conto (conti_condivisi): ARIOLDI GIULIA,
// cliente di Ecomize LL, paga con i bonifici di SALVATORE PELLE sul conto di Ecomize Solution.
async function target(admin: any, masterId: string, t: unknown, reteIds: string[]): Promise<Target | null> {
  const s = String(t || '')
  const sotto = s.startsWith('m:')
  const id = sotto ? s.slice(2) : s
  if (!UUID.test(id)) return null
  if (sotto) return (await eDiscendente(admin, id, masterId)) ? { tipo: 'master', id } : null
  const { data } = await admin.from('clienti').select('id,master_id').eq('id', id).maybeSingle()
  return data && reteIds.includes((data as any).master_id) ? { tipo: 'cliente', id } : null
}

export async function POST(req: NextRequest) {
  const c = await chiSei(); if ('errore' in c) return c.errore
  const b = await req.json().catch(() => ({} as any))
  const admin = createAdminSupabase()
  const periodo = { dal: String(b?.dal || ''), al: String(b?.al || '') }
  const audit = (azione: string, dettaglio: string) => registraAudit({ utenteId: c.userId, ruolo: c.ruolo, azione, dettaglio })
  try {
    const sotto = await sottoSulConto(admin, c.masterId)
    const reteIds = [c.masterId, ...sotto.map(x => x.id)]
    switch (String(b?.azione || '')) {
      case 'pagatore': {
        if (!DATA.test(periodo.dal) || !DATA.test(periodo.al)) return NextResponse.json({ error: 'Periodo non valido' }, { status: 400 })
        const nome = pulisciNome(b?.nome)
        if (!nome) return NextResponse.json({ error: 'Pagatore senza nome' }, { status: 400 })
        // Uno o piu' clienti: piu' profili dello stesso cliente pagati con un bonifico solo (LA NUOVA POSTA S.N.C.).
        const scelti = [...new Set((Array.isArray(b?.targets) ? b.targets : [b?.target]).map((x: unknown) => String(x || '')).filter(Boolean))]
        if (!scelti.length || scelti.length > 6) return NextResponse.json({ error: 'Scegli da 1 a 6 clienti' }, { status: 400 })
        const targets: Target[] = []
        for (const x of scelti) {
          const t = await target(admin, c.masterId, x, reteIds)
          if (!t) return NextResponse.json({ error: 'Cliente non trovato fra i tuoi' }, { status: 404 })
          targets.push(t)
        }
        const iban = pulisciIban(b?.iban)
        if (targets.length > 1 && !iban) return NextResponse.json({ error: 'Più clienti insieme solo per un bonifico con IBAN' }, { status: 400 })
        const esito = await assegnaPagatore(admin, c.masterId, c.userId, { nome, iban, targets }, periodo)
        await audit('estratto_pagatore', `${nome}${iban ? ` (${iban})` : ''} → ${targets.map(t => `${t.tipo}:${t.id}`).join(', ')}`)
        return NextResponse.json({ ok: true, ...esito })
      }
      case 'escludi': {
        const nome = pulisciNome(b?.nome)
        if (!nome) return NextResponse.json({ error: 'Pagatore senza nome' }, { status: 400 })
        await escludiPagatore(admin, c.masterId, { nome, iban: pulisciIban(b?.iban) })
        await audit('estratto_escludi', nome)
        return NextResponse.json({ ok: true })
      }
      case 'includi': {
        const nome = pulisciNome(b?.nome)
        if (!nome) return NextResponse.json({ error: 'Pagatore senza nome' }, { status: 400 })
        await includiPagatore(admin, c.masterId, { nome, iban: pulisciIban(b?.iban) })
        await audit('estratto_includi', nome)
        return NextResponse.json({ ok: true })
      }
      case 'scollega': {
        if (!UUID.test(String(b?.riga_id || ''))) return NextResponse.json({ error: 'Movimento non valido' }, { status: 400 })
        await scollegaRiga(admin, c.masterId, b.riga_id)
        await audit('estratto_scollega', b.riga_id)
        return NextResponse.json({ ok: true })
      }
      case 'metodo': {
        const id = String(b?.ricarica_id || '')
        if (!UUID.test(id) || !metodoEstrattoValido(b?.metodo)) return NextResponse.json({ error: 'Dati non validi' }, { status: 400 })
        // Anche le ricariche dei sotto-master sul conto: decide Ecomize Solution (Lorenzo, 10/11).
        const { data: rc } = await admin.from('ricariche_check').select('id,master_id,target_tipo,target_id').eq('id', id).in('master_id', reteIds).maybeSingle()
        if (!rc) return NextResponse.json({ error: 'Ricarica non trovata' }, { status: 404 })
        // "Giro" solo per una ricarica del master a un sotto-master sul suo conto.
        if (b.metodo === 'giro' && !(rc.master_id === c.masterId && rc.target_tipo === 'master' && sotto.some(x => x.id === rc.target_id))) {
          return NextResponse.json({ error: 'Il giro vale solo per le ricariche a un sotto-master i cui clienti pagano sul tuo conto' }, { status: 400 })
        }
        // Una ricarica gia' girata resta un bonifico: prima si annulla il giro.
        const { data: gir, error: eg } = await admin.from('giri_bonifici_ricariche').select('giro_id').eq('ricarica_id', id).eq('attivo', true).limit(1)
        if (eg && !/does not exist|Could not find|schema cache/i.test(eg.message || '')) return NextResponse.json({ error: eg.message }, { status: 500 })
        if (gir?.length) return NextResponse.json({ error: 'Questa ricarica è già stata girata al sotto-master: prima annulla il giro' }, { status: 409 })
        const { data, error } = await admin.from('ricariche_check').update({ metodo: b.metodo, mittente: b.metodo === 'bonifico' ? undefined : null })
          .eq('id', id).eq('master_id', rc.master_id).select('id')
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        if (!data?.length) return NextResponse.json({ error: 'Ricarica non trovata' }, { status: 404 })
        await audit('estratto_metodo', `${id} → ${b.metodo}`)
        return NextResponse.json({ ok: true })
      }
      case 'voce': {
        const controparte = norma(String(b?.controparte || ''))
        const voce = pulisciNome(b?.voce).slice(0, 60)
        if (!controparte) return NextResponse.json({ error: 'Controparte mancante' }, { status: 400 })
        if (!voce) {
          await admin.from('uscite_voci').delete().eq('master_id', c.masterId).eq('controparte', controparte)
        } else {
          const { error } = await admin.from('uscite_voci').upsert({ master_id: c.masterId, controparte, voce, aggiornato_il: new Date().toISOString() }, { onConflict: 'master_id,controparte' })
          if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        }
        return NextResponse.json({ ok: true })
      }
      case 'gira': {
        // La ricarica al sotto-master per le ricariche dei suoi clienti pagate in banca. I controlli veri (sono
        // del sotto-master, pagate da un bonifico di questo conto, dal giorno del giro, mai girate) li rifa' il
        // database dentro la transazione: qui solo la forma.
        const s = sotto.find(x => x.id === String(b?.sotto || ''))
        if (!s) return NextResponse.json({ error: 'Questo sotto-master non paga sul tuo conto' }, { status: 404 })
        const ids: string[] = [...new Set<string>((Array.isArray(b?.ricariche) ? b.ricariche : []).map((x: unknown) => String(x || '')))].filter(x => UUID.test(x))
        if (!ids.length || ids.length > 2000) return NextResponse.json({ error: 'Nessuna ricarica da girare' }, { status: 400 })
        const { data, error } = await admin.rpc('gira_bonifici_sotto_master', { p_master: c.masterId, p_sotto: s.id, p_ricariche: ids, p_creato_da: c.userId })
        if (error) return NextResponse.json({ error: error.message }, { status: 409 })
        await audit('estratto_giro', `${s.nome}: ${(data as any)?.ricariche} ricariche, € ${(data as any)?.importo} (giro ${(data as any)?.giro})`)
        return NextResponse.json({ ok: true, ...(data as any) })
      }
      case 'annulla_giro': {
        const giro = String(b?.giro || '')
        if (!UUID.test(giro)) return NextResponse.json({ error: 'Giro non valido' }, { status: 400 })
        const { data, error } = await admin.rpc('annulla_giro_bonifici', { p_master: c.masterId, p_giro: giro, p_annullato_da: c.userId })
        if (error) return NextResponse.json({ error: error.message }, { status: 409 })
        await audit('estratto_giro_annullato', `giro ${giro}: € ${(data as any)?.importo}`)
        return NextResponse.json({ ok: true, ...(data as any) })
      }
      default: return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
    }
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'Errore' }, { status: 500 }) }
}
