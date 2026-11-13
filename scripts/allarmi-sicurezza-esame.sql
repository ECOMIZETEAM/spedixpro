-- ESAME DEGLI ALLARMI E REVISIONE DEI REGISTRI (politica Amazon sui dati, 2.6.1 e 2.6.2).
--
-- Amazon chiede due cose che devono restare scritte: che ogni allarme venga esaminato (con l'esito), e
-- che i registri vengano rivisti almeno ogni due settimane. La pagina Allarmi di sicurezza
-- (/dashboard/sicurezza, solo super master) scrive qui; la Sentinella del mattino ricorda le scadenze.
--
-- Il riepilogo per la revisione legge il registro accessi solo per le ultime 24 ore: quattordici giorni
-- sono 470.000 righe e 10,8 secondi (misurato il 13/11/2026), oltre il limite di 8 secondi di ogni
-- richiesta. Per i quattordici giorni bastano gli allarmi, che il controllo ogni 15 minuti ha gia'
-- ricavato dal registro intero.
--
-- Da incollare nell'editor SQL di Supabase dopo scripts/allarmi-sicurezza.sql.

-- 1. Chi ha esaminato l'allarme (tabella nuova e piccola: aggiungere la colonna non ferma niente).
alter table public.allarmi_sicurezza add column if not exists esaminato_da uuid;

-- 2. Le revisioni dei registri: chi, quando, quale periodo, quanti allarmi c'erano, cosa ha visto.
create table if not exists public.revisioni_sicurezza (
  id bigint generated always as identity primary key,
  fatta_il timestamptz not null default now(),
  fatta_da uuid not null,
  dal timestamptz not null,
  al timestamptz not null,
  allarmi int not null default 0,
  note text
);
create index if not exists idx_revisioni_sicurezza_fatta on public.revisioni_sicurezza (fatta_il desc);
alter table public.revisioni_sicurezza enable row level security;
revoke all on public.revisioni_sicurezza from public, anon, authenticated;
grant select, insert on public.revisioni_sicurezza to service_role;

-- 3. Il riepilogo per chi fa la revisione. Le ultime 24 ore del registro accessi (letture, "entra come",
--    accessi, API per cliente) e, dal giorno indicato, le chiamate API rifiutate per motivo.
--    «chi» e' un utente, tranne per 'api' dove e' un cliente.
create or replace function public.riepilogo_registri(p_dal timestamptz)
 returns table(voce text, chi uuid, n bigint)
 language sql
 stable security definer
 set search_path to ''
as $function$
  with r as materialized (
    select a.utente_id, a.azione, a.dettaglio from public.audit_accessi a
     where a.created_at > now() - interval '24 hours'
  )
  (select 'letture'::text, r.utente_id, count(*) from r
    where r.utente_id is not null
      and r.azione in ('tracking_view', 'ordini_lista', 'ordini_importati_lista', 'etichetta_download', 'etichette_bulk')
    group by r.utente_id order by 3 desc limit 10)
  union all
  (select 'entra_come', r.utente_id, count(*) from r
    where r.azione like 'impersona\_%' and r.utente_id is not null
    group by r.utente_id order by 3 desc limit 10)
  union all
  (select 'api', substring(r.dettaglio from 'cliente ([0-9a-f-]{36})')::uuid, count(*) from r
    where r.azione in ('api_spedizione', 'api_etichetta') and r.dettaglio ~ 'cliente [0-9a-f-]{36}'
    group by 2 order by 3 desc limit 5)
  union all
  (select 'accessi', null::uuid, count(*) from r where r.azione = 'accesso')
  union all
  (select 'accessi_falliti', null::uuid, count(*) from r where r.azione = 'accesso_fallito')
  union all
  (select 'rifiutate_' || c.motivo, null::uuid, count(*) from public.chiamate_rifiutate c
    where c.quando >= p_dal group by c.motivo)
$function$;
revoke all on function public.riepilogo_registri(timestamptz) from public, anon, authenticated;
grant execute on function public.riepilogo_registri(timestamptz) to service_role;

-- 4. La Sentinella ricorda le scadenze: revisione oltre i 14 giorni, allarmi lasciati senza esame.
create or replace function public.controllo_giornaliero_3()
 returns table(area text, controllo text, valore numeric, atteso text, allarme boolean)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select 'sicurezza'::text, 'minuti dall''ultimo giro degli allarmi di sicurezza'::text,
         coalesce(round(extract(epoch from now() - max(g.ultimo)) / 60), 99999)::numeric,
         'sotto 30 (gira ogni 15)'::text,
         coalesce(max(g.ultimo) < now() - interval '30 minutes', true)
    from public.allarmi_giro g
  union all
  select 'sicurezza', 'allarmi di sicurezza nelle ultime 24h', count(*)::numeric, 'ognuno va esaminato', false
    from public.allarmi_sicurezza a where a.creato_il > now() - interval '24 hours'
  union all
  select 'sicurezza', 'allarmi di sicurezza non esaminati da oltre 3 giorni', count(*)::numeric,
         'zero (Allarmi di sicurezza, scrivi l''esito)', count(*) > 0
    from public.allarmi_sicurezza a where a.esaminato_il is null and a.creato_il < now() - interval '3 days'
  union all
  select 'sicurezza', 'giorni dall''ultima revisione dei registri',
         coalesce(floor(extract(epoch from now() - max(r.fatta_il)) / 86400), 9999)::numeric,
         'al massimo 14 (Allarmi di sicurezza, Revisione fatta)',
         coalesce(max(r.fatta_il) < now() - interval '14 days', true)
    from public.revisioni_sicurezza r
  union all
  select 'sicurezza', 'allarmi di sicurezza non spediti per email da oltre un''ora', count(*)::numeric, 'zero', count(*) > 0
    from public.allarmi_sicurezza a where a.inviato_il is null and a.creato_il < now() - interval '1 hour'
  union all
  select 'sicurezza', 'controllo della verifica in due passaggi attivo nel database',
         (exists (select 1 from pg_catalog.pg_roles r, unnest(r.rolconfig) c
                   where r.rolname = 'authenticator' and c = 'pgrst.db_pre_request=public.controllo_richiesta'))::int::numeric,
         '1', not exists (select 1 from pg_catalog.pg_roles r, unnest(r.rolconfig) c
                   where r.rolname = 'authenticator' and c = 'pgrst.db_pre_request=public.controllo_richiesta')
  union all
  select 'sicurezza', 'account con la verifica in due passaggi attiva', count(distinct f.user_id)::numeric, 'cresce fino al 24/11', false
    from auth.mfa_factors f where f.status = 'verified'
$function$;
revoke all on function public.controllo_giornaliero_3() from public, anon, authenticated;
grant execute on function public.controllo_giornaliero_3() to service_role;
