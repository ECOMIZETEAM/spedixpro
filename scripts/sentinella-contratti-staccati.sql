-- SENTINELLA, parte 5: i contratti staccati (26/11/2026). Va dopo scripts/stacca-contratto.sql.
--
-- Un master si stacca da un fornitore e ricompra il contratto altrove (pulsante "Stacca"). La riga staccata resta
-- per i pacchi già partiti. Ogni mattina si guarda che:
--   - nessuna spedizione nuova sia nata su un contratto staccato (il database lo vieta: se succede, c'è una porta
--     che lo aggira);
--   - nessun contratto staccato sia tornato acceso (anche questo lo vieta il database);
--   - nessuno compri ancora da una riga staccata (la funzione che stacca lo rifiuta);
--   - non ci siano due contratti attivi con lo stesso nome sullo stesso master (le ricerche per nome sceglierebbero
--     a caso; il vincolo scripts/stacca-contratto-vincolo.sql lo impedisce da quando c'è);
-- e, per informazione, quanti pacchi dei contratti staccati sono ancora aperti e quanti addebiti dopo la partenza
-- (resi, rettifiche, giacenze) sono arrivati su di loro nell'ultimo giorno: devono continuare finché ce ne sono.
--
-- Il SQL Editor esegue le istruzioni una per una: ognuna sta in piedi da sola, e l'unione delle parti si riscrive
-- solo se è ancora quella letta il 26/11 (impronta), nello stesso blocco.

create or replace function public.controllo_giornaliero_5()
 returns table(area text, controllo text, valore numeric, atteso text, allarme boolean)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select 'staccati'::text, 'contratti staccati'::text, count(*)::numeric, 'informativo'::text, false
    from public.corrieri c where c.staccato_il is not null
  union all
  select 'staccati', 'spedizioni nate su un contratto DOPO il suo distacco', count(*)::numeric, 'zero', count(*) > 0
    from public.spedizioni s join public.corrieri c on c.id = s.corriere_id
   where c.staccato_il is not null and s.created_at > c.staccato_il
  union all
  select 'staccati', 'contratti staccati ma accesi', count(*)::numeric, 'zero', count(*) > 0
    from public.corrieri c where c.staccato_il is not null and c.attivo is distinct from false
  union all
  select 'staccati', 'contratti staccati che qualcuno compra ancora (righe a valle accese)', count(distinct c.id)::numeric, 'zero', count(*) > 0
    from public.corrieri c join public.corrieri g on g.fornitore_corriere_id = c.id and g.staccato_il is null
   where c.staccato_il is not null
  union all
  select 'staccati', 'master con due contratti attivi con lo stesso nome', count(*)::numeric, 'zero', count(*) > 0
    from (select 1 from public.corrieri c where c.staccato_il is null
           group by c.master_id, lower(btrim(c.nome_contratto)) having count(*) > 1) d
  union all
  select 'staccati', 'pacchi degli ultimi 120 giorni ancora aperti sui contratti staccati', count(*)::numeric, 'informativo', false
    from public.spedizioni s join public.corrieri c on c.id = s.corriere_id
   where c.staccato_il is not null and s.created_at > now() - interval '120 days'
     and s.stato not in ('consegnata', 'annullata', 'reso_mittente')
  union all
  select 'staccati', 'resi, rettifiche e giacenze delle ultime 24 ore sui pacchi dei contratti staccati', count(*)::numeric, 'informativo', false
    from public.movimenti m join public.spedizioni s on s.id = m.spedizione_id join public.corrieri c on c.id = s.corriere_id
   where c.staccato_il is not null and m.created_at > now() - interval '24 hours'
     and m.tipo in ('reso', 'rettifica', 'giacenza')
$function$;
revoke all on function public.controllo_giornaliero_5() from public, anon, authenticated;
grant execute on function public.controllo_giornaliero_5() to service_role;

-- L'unione delle parti, per lanciarla a mano dall'editor. Si aggiunge la parte 5 solo se l'unione è quella del
-- 26/11 (le parti 1-4): se qualcuno l'ha cambiata, non la si sovrascrive.
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.controllo_giornaliero()'::regprocedure);
  if v_def like '%controllo_giornaliero_5%' then raise notice 'parte 5 già nell''unione'; return; end if;
  if md5(v_def) <> 'fcd0502acfab5528ef4aa82fe60c1518' then
    raise exception 'controllo_giornaliero() è cambiata dal 26/11: non la tocco. Aggiungere a mano la parte 5.';
  end if;
  execute replace(v_def, E'  select * from public.controllo_giornaliero_4()\n',
    E'  select * from public.controllo_giornaliero_4()\n  union all\n  select * from public.controllo_giornaliero_5()\n');
  if pg_get_functiondef('public.controllo_giornaliero()'::regprocedure) not like '%controllo_giornaliero_5%' then
    raise exception 'la parte 5 non è entrata nell''unione: controllare a mano';
  end if;
end $$;

-- Da guardare: le righe della parte 5 (oggi tutte a zero, nessun allarme).
select * from public.controllo_giornaliero_5();
