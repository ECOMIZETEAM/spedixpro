import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vedeLaRete } from '@/lib/ruoli'

// Colonne dell'elenco "File processati". Il riepilogo (cod_files.riepilogo: dove e' finita ogni riga e perche'
// quelle scartate, decine di KB per file) NON si legge qui: si legge solo al clic, per id. Dall'elenco servono
// solo due cose del riepilogo, entrambe piccole: se c'e' e quanti blocchi non sono stati confermati.
const COLONNE = 'id,nome_file,righe_file,spedizioni_processate,cod_file,cod_sistema,cod_da_pagare,cod_in_distinte,errori,created_at'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  // Gli estratti dei contrassegni incassati sono documenti interni del master: dicono quanto il
  // corriere gli ha girato e quando. Senza questo controllo bastava `master_id` — che hanno anche le
  // utenze cliente — per scaricarsi l'elenco.
  if (!vedeLaRete(utente) || !utente?.master_id) return NextResponse.json([])
  // cod_files si legge e si scrive SOLO dal server (client di servizio + il controllo qui sopra + il filtro
  // sul master): dal 20/11/2026 l'utente non ha piu' permessi diretti sulla tabella. Prima un'utenza cliente,
  // col suo token e la regola "stesso master", poteva leggere, modificare e cancellare i file del master.
  const admin = createAdminSupabase()

  // Dettaglio di UN file, al clic.
  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    const { data } = await admin.from('cod_files').select(COLONNE + ',riepilogo')
      .eq('id', id).eq('master_id', utente.master_id).maybeSingle()
    return NextResponse.json(data || null)
  }

  const { data } = await admin.from('cod_files')
    .select(COLONNE + ',dettaglio:riepilogo->versione,blocchi_non_caricati:riepilogo->blocchiNonCaricati')
    .eq('master_id', utente.master_id).order('created_at', { ascending: false }).limit(20)
  return NextResponse.json(data || [])
}
