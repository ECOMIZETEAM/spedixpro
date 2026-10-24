-- RETTIFICHE ONETRACKING SU SDA EXPRESS L: LE CREA WAVE (decisione di Lorenzo, 24/10/2026).
--
-- Fino a oggi il giro automatico (app/api/tracking/ripesature-auto) lavorava solo per MULTIEXPRESS e solo
-- sui contratti di cui MULTI e' detentore: SDA EXPRESS L e' di LOGIXIA (proprio), quindi la coda di MULTI
-- lo saltava e su 21.875 pacchi misurati da OneTracking (9-24/10) non era nata nessuna rettifica.
-- Ora per SDA EXPRESS L la rettifica la crea Wave verso il suo figlio (quasi sempre MULTI), che la carica
-- da "Dal mio network" e la gira a valle come le altre.

-- 1) LA CODA PER CONTRATTO. Una misura per LDV (la piu' recente, su qualunque gamba: OneTracking la salva
--    sulla gamba letta). Fuori: multicollo, non consegnate, gia' controllate dal giro, e le LDV con una
--    rettifica VIVA che riguarda gia' quel master (fatta da lui o verso di lui). Le righe ANNULLATE
--    (addebito restituito, file LOGIXIA del 12/10 e 12-16/10) non contano: quei pacchi tornano da rettificare.
--    Le rettifiche dei livelli sotto non fermano il giro: lo scalino di quel master e' un altro addebito,
--    e il doppio a valle lo ferma trg_rettifica_no_doppia_ripesatura (stesso pagante).
create or replace function public.prossime_ripesature_contratto(p_master uuid, p_contratto text, lim integer default 100)
returns table(spedizione_id uuid, ldv text, peso numeric, lunghezza numeric, larghezza numeric, altezza numeric)
language sql
security definer
set search_path to 'public'
as $function$
  with ultime as (
    select distinct on (coalesce(nullif(s.tracking_number, ''), s.numero))
           s.id as spedizione_id, coalesce(nullif(s.tracking_number, ''), s.numero) as ldv,
           m.peso, m.lunghezza, m.larghezza, m.altezza, m.letto_il
    from public.ripesature_misure m
    join public.spedizioni s on s.id = m.spedizione_id
    join public.corrieri c on c.id = s.corriere_id
    where c.nome_contratto = p_contratto
      and m.esito = 'misurata'
      and m.lunghezza is not null and m.larghezza is not null and m.altezza is not null
      and s.stato = 'consegnata'
      and coalesce(s.colli, 1) = 1
    order by coalesce(nullif(s.tracking_number, ''), s.numero), m.letto_il desc
  )
  select u.spedizione_id, u.ldv, u.peso, u.lunghezza, u.larghezza, u.altezza
  from ultime u
  where not exists (select 1 from public.spedizioni g join public.rettifiche r on r.spedizione_id = g.id
                    where g.tracking_number = u.ldv
                      and coalesce(r.propagazione, '') <> 'annullata'
                      and (r.master_id = p_master or r.target_master_id = p_master))
    and not exists (select 1 from public.spedizioni g join public.ripesature_check k on k.spedizione_id = g.id
                    where g.tracking_number = u.ldv)
  order by u.letto_il desc
  limit greatest(1, least(coalesce(lim, 100), 500));
$function$;

revoke all on function public.prossime_ripesature_contratto(uuid, text, integer) from public;
revoke all on function public.prossime_ripesature_contratto(uuid, text, integer) from anon;
revoke all on function public.prossime_ripesature_contratto(uuid, text, integer) from authenticated;
grant execute on function public.prossime_ripesature_contratto(uuid, text, integer) to service_role;

-- 2) LA GUARDIA CONTRO LE RIPESATURE DOPPIE non deve contare le righe ANNULLATE. Lo storno del 22/10 le ha
--    segnate in `propagazione` ('annullata'), non in `stato` (che resta 'confermata'): per questa guardia
--    erano ancora vive, e il file giusto di LOGIXIA (o il giro OneTracking di Wave) sarebbe stato respinto
--    come "rettifica doppia" su ognuno di quei pacchi.
create or replace function public.fn_rettifica_no_doppia_ripesatura()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- Solo le righe di RIPESATURA (il peso ricalcolato è diverso da quello dichiarato). Le altre
  -- correzioni sullo stesso pagante — sotto costo, zona disagiata, allineamento margine — sono
  -- cose diverse e devono poter convivere: nello storico sono 15 casi legittimi.
  if new.peso_reale is null or new.peso_iniziale is null
     or abs(new.peso_reale - new.peso_iniziale) <= 0.001 then
    return new;
  end if;

  if exists (
    select 1 from public.rettifiche r
    where r.spedizione_id = new.spedizione_id
      and r.id is distinct from new.id
      and r.cliente_id is not distinct from new.cliente_id
      and r.target_master_id is not distinct from new.target_master_id
      and r.peso_reale is not null and r.peso_iniziale is not null
      and abs(r.peso_reale - r.peso_iniziale) > 0.001
      and coalesce(r.stato, '') <> 'annullata'
      -- annullata = addebito restituito con uno storno (22/10/2026): non occupa il posto
      and coalesce(r.propagazione, '') <> 'annullata'
  ) then
    raise exception 'Ripesatura gia'' addebitata a questo destinatario per la spedizione % (rettifica doppia)', new.numero_spedizione
      using errcode = 'unique_violation';
  end if;
  return new;
end $function$;
