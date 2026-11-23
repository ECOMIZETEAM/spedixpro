-- SENTINELLA, parte 4: pesi e resi (22/11/2026). Gia' applicata in produzione (migrazione
-- controllo_giornaliero_4_pesi_resi); qui per averla nel repo come le altre parti.
--
-- PESI. Le multicollo Spedisci create dal portale salvavano come peso reale quello del PRIMO collo, dal primo
-- commit: 4.418 spedizioni, riallineate il 22/11. Ora si guarda ogni giorno che peso reale = somma dei colli, e
-- che nessuna spedizione sia fatturata sotto il peso reale senza una rettifica confermata.
-- RESI. Un reso che il fornitore fa pagare e il cliente non paga e' una perdita che non lascia errori: si guarda
-- la coda degli addebiti, i pacchi a reso senza addebito al cliente, i resi fatturati su pacchi non a reso e il
-- titolare pagato due volte.
-- Due trappole trovate costruendola: le copie dei pacchi condivisi (gambe derivate) davano falsi «senza addebito»,
-- quindi si guarda solo il pacco originale (numero = tracking_number); e il reso addebitato PRIMA della fattura
-- del fornitore e' giusto (141 casi in 30 giorni), il doppio pagamento e' solo la riga di reso DOPO.
--
-- La rotta /api/controllo/sentinella chiama le parti una alla volta (8 secondi a chiamata); questa gira in ~0,3 s.

create or replace function public.controllo_giornaliero_4()
 returns table(area text, controllo text, valore numeric, atteso text, allarme boolean)
 language sql
 stable security definer
 set search_path to ''
as $function$
  with multi as (
    select s.peso_reale::numeric as pr, a.n, a.n_ok, a.somma
      from public.spedizioni s
      cross join lateral (
        select count(*) as n,
               count(*) filter (where coalesce(nullif(x->>'peso', '')::numeric, 0) > 0) as n_ok,
               round(sum(nullif(x->>'peso', '')::numeric), 3) as somma
          from jsonb_array_elements(case when jsonb_typeof(s.colli_dettaglio) = 'array' then s.colli_dettaglio else '[]'::jsonb end) x
      ) a
     where s.created_at > now() - interval '48 hours' and s.colli > 1 and s.stato <> 'annullata'
  )
  select 'pesi'::text, 'multicollo delle ultime 48 ore col peso reale diverso dalla somma dei colli'::text,
         count(*)::numeric, 'zero'::text, count(*) > 0
    from multi where n > 0 and n_ok = n and abs(pr - somma) > 0.01
  union all
  select 'pesi', 'spedizioni delle ultime 48 ore fatturate sotto il peso reale (senza rettifica confermata)',
         count(*)::numeric, 'zero', count(*) > 0
    from public.spedizioni s
   where s.created_at > now() - interval '48 hours' and s.stato <> 'annullata'
     and s.peso_fatturato > 0 and s.peso_fatturato + 0.01 < s.peso_reale
     and not exists (select 1 from public.rettifiche r where r.spedizione_id = s.id and r.confermata)
  union all
  select 'resi', 'resi in coda di addebito con errori', count(*)::numeric, 'zero', count(*) > 0
    from public.resi_da_addebitare q where q.tentativi > 0
  union all
  select 'resi', 'resi in coda di addebito da oltre 24 ore', count(*)::numeric, 'zero (la coda gira ogni giorno)', count(*) > 0
    from public.resi_da_addebitare q where q.creato_il < now() - interval '24 hours'
  union all
  select 'resi', 'pacchi a reso negli ultimi 7 giorni, col cliente, senza addebito al cliente dopo 6 ore',
         count(*)::numeric, 'zero', count(*) > 0
    from public.spedizioni s
   where s.stato = 'reso_mittente' and s.reso_il > now() - interval '7 days' and s.reso_il < now() - interval '6 hours'
     and s.cliente_id is not null and s.numero = coalesce(s.tracking_number, s.numero)
     and not exists (select 1 from public.movimenti m where m.spedizione_id = s.id and m.tipo = 'reso' and m.cliente_id is not null)
  union all
  select 'resi', 'pacchi passati a reso nelle ultime 24 ore', count(*)::numeric, 'informativo', false
    from public.spedizioni s
   where s.stato = 'reso_mittente' and s.reso_il > now() - interval '24 hours' and s.numero = coalesce(s.tracking_number, s.numero)
  union all
  select 'resi', 'resi fatturati dal fornitore negli ultimi 7 giorni su pacchi non a reso',
         count(*)::numeric, 'zero (se ci sono: da mettere a reso o da contestare al fornitore)', count(*) > 0
    from public.movimenti m join public.spedizioni s on s.id = m.spedizione_id
   where m.riferimento like 'RESOFORN-%' and m.created_at > now() - interval '7 days' and s.stato <> 'reso_mittente'
  union all
  select 'resi', 'titolare pagato due volte: riga di reso dopo il costo del fornitore, ultimi 30 giorni',
         count(*)::numeric, 'zero', count(*) > 0
    from public.movimenti f
   where f.riferimento like 'RESOFORN-%' and f.created_at > now() - interval '30 days'
     and exists (select 1 from public.movimenti r
                  where r.spedizione_id = f.spedizione_id and r.tipo = 'reso' and r.cliente_id is null
                    and r.master_target_id = f.master_target_id and r.master_id = r.master_target_id
                    and r.created_at > f.created_at)
$function$;

-- L'unione delle quattro parti, per lanciarla a mano dall'editor SQL. Sostituisce quella di
-- scripts/allarmi-sicurezza.sql (parti 1-3): se si rilancia quello, rilanciare poi questo.
create or replace function public.controllo_giornaliero()
 returns table(area text, controllo text, valore numeric, atteso text, allarme boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select * from public.controllo_giornaliero_1()
  union all
  select * from public.controllo_giornaliero_2()
  union all
  select * from public.controllo_giornaliero_3()
  union all
  select * from public.controllo_giornaliero_4()
$function$;

-- Le esegue solo il servizio interno (l'email del mattino), nessun utente.
revoke all on function public.controllo_giornaliero_4() from public, anon, authenticated;
revoke all on function public.controllo_giornaliero() from public, anon, authenticated;
grant execute on function public.controllo_giornaliero_4() to service_role;
grant execute on function public.controllo_giornaliero() to service_role;
