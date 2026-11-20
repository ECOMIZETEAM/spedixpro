import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
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
  if (!vedeLaRete(utente)) return NextResponse.json([])

  // Dettaglio di UN file, al clic.
  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    const { data, error } = await supabase.from('cod_files').select(COLONNE + ',riepilogo')
      .eq('id', id).eq('master_id', utente?.master_id).maybeSingle()
    // Colonna non ancora creata: si risponde col file senza dettaglio, come per i file caricati prima del 20/11/2026.
    if (error) {
      const { data: base } = await supabase.from('cod_files').select(COLONNE).eq('id', id).eq('master_id', utente?.master_id).maybeSingle()
      return NextResponse.json(base ? { ...(base as any), riepilogo: null } : null)
    }
    return NextResponse.json(data || null)
  }

  const conRiepilogo = await supabase.from('cod_files')
    .select(COLONNE + ',dettaglio:riepilogo->versione,blocchi_non_caricati:riepilogo->blocchiNonCaricati')
    .eq('master_id', utente?.master_id).order('created_at', { ascending: false }).limit(20)
  if (!conRiepilogo.error) return NextResponse.json(conRiepilogo.data || [])
  // Senza la colonna riepilogo l'elenco resta quello di prima.
  const { data } = await supabase.from('cod_files').select(COLONNE)
    .eq('master_id', utente?.master_id).order('created_at', { ascending: false }).limit(20)
  return NextResponse.json(data || [])
}
