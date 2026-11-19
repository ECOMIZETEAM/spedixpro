-- SENTINELLA: i controlli che riempiono l'email del mattino.
--
-- PERCHE' COSI'. Dal 14/10/2026 la Sentinella non partiva piu': ogni mattina "canceling statement due
-- to statement timeout". Il database interrompe dopo 8 secondi ogni chiamata dall'applicazione.
--  - 04/11: i saldi di master e clienti si ricalcolavano rileggendo il registro dei movimenti per OGNI
--    master (56, senza indice utile) e per OGNI cliente (2.117), e quasi ogni controllo si eseguiva due
--    volte (valore e allarme). Riscritta in un passaggio: 2-5 secondi.
--  - 10 e 11/11: di nuovo oltre gli 8 secondi, alle 7:00 in punto, quando partono insieme una decina di
--    lavori pianificati e il tracking scrive proprio negli eventi che qui si contano (1,9 s da soli a
--    meta' giornata, leggendo tutti i 3,8 milioni di righe).
-- Quindi ora: DUE funzioni, chiamate una dopo l'altra (ognuna ha i suoi 8 secondi), e l'indice sulla
-- data degli eventi di tracking (scripts/indice-tracking-events-data.sql, da lanciare a parte).
-- controllo_giornaliero() resta, unione delle due, per lanciarla a mano dall'editor SQL.
-- Righe, ordine, soglie e allarmi sono quelli di prima; l'ultima riga e' la "privacy": ordini Amazon
-- che a quest'ora avrebbero gia' dovuto perdere i dati personali (32 giorni = soglia di 30 piu' due
-- notti di margine), controllo giornaliero dichiarato ad Amazon.
--
-- Da incollare nell'editor SQL di Supabase.

-- 1. Attivita': tracking, ripesature, spedizioni senza addebito.
create or replace function public.controllo_giornaliero_1()
 returns table(area text, controllo text, valore numeric, atteso text, allarme boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
with demo_master as (select id from masters where coalesce(demo,false) = true or nome ilike 'Demo —%'),
demo_cliente as (select c.id from clienti c where c.master_id in (select id from demo_master) or c.ragione_sociale ilike '%TEST REVIEW%'),
coda as (
  select count(*) n from ripesature_misure m
  join spedizioni s on s.id = m.spedizione_id join corrieri c on c.id = s.corriere_id
  where m.esito='misurata' and s.stato='consegnata' and coalesce(s.colli,1)=1
    and coalesce(c.proprio,false) and c.nome_contratto ~* 'poste|sda|crono|pdb'
    and c.nome_contratto !~* 'gls|brt|ups|dhl|tnt' and c.master_id='a8d42a25-3711-4343-a6df-ee2ba9bbf08b'::uuid
    and not exists (select 1 from ripesature_check k where k.spedizione_id = s.id)
),
tracking_24h as (select count(*) n from tracking_events where created_at > now() - interval '24 hours'),
stati_24h as (select count(*) n from spedizioni where updated_at > now() - interval '24 hours' and stato <> 'in_lavorazione'),
misure_20h as (select count(*) n from ripesature_misure where letto_il > now() - interval '20 hours'),
valutate_24h as (select count(*) n from ripesature_check where controllato_il > now() - interval '24 hours'),
rettifiche_ferme as (select count(*) n from rettifiche where stato='da_rettificare' and created_at < now() - interval '7 days'),
senza_cronologia as (
  select count(*) n from spedizioni s where s.stato='consegnata' and s.created_at > now() - interval '48 hours'
     and not exists (select 1 from tracking_events t where t.spedizione_id=s.id)
),
senza_addebito as (
  select count(*) n from spedizioni s where s.created_at > now() - interval '24 hours'
     and s.cliente_id is not null and s.stato not in ('annullata','annullamento_manuale')
     and s.cliente_id not in (select id from demo_cliente)
     and not exists (select 1 from movimenti m where m.spedizione_id=s.id and m.cliente_id=s.cliente_id)
)
select 'tracking' area, 'eventi di tracking nelle ultime 24h' controllo, (select n from tracking_24h)::numeric valore,
       'oltre 1.000' atteso, (select n from tracking_24h) < 1000 allarme
union all
select 'tracking', 'stati avanzati nelle ultime 24h', (select n from stati_24h)::numeric, 'oltre 500', (select n from stati_24h) < 500
union all
select 'ripesature', 'misure lette dal corriere nelle ultime 20h', (select n from misure_20h)::numeric,
       'oltre 0 (il Mac gira 3 volte al giorno)', (select n from misure_20h) = 0
union all
select 'ripesature', 'consegnate valutate nelle ultime 24h', (select n from valutate_24h)::numeric, 'oltre 0', (select n from valutate_24h) = 0
union all
select 'ripesature', 'in coda, ancora da valutare', (select n from coda)::numeric, 'cala da sola', (select n from coda) > 5000
union all
select 'ripesature', 'rettifiche in attesa di conferma da oltre 7 giorni', (select n from rettifiche_ferme)::numeric,
       'da guardare se cresce', (select n from rettifiche_ferme) > 200
union all
select 'tracking', 'consegnate senza cronologia (ultime 48h)', (select n from senza_cronologia)::numeric, 'zero', (select n from senza_cronologia) > 20
union all
select 'soldi', 'spedizioni senza addebito al cliente (24h)', (select n from senza_addebito)::numeric, 'zero', (select n from senza_addebito) > 0
$function$;

-- 2. Conti: saldi contro il registro, prenotazioni, addebiti nella rete; e la privacy Amazon.
create or replace function public.controllo_giornaliero_2()
 returns table(area text, controllo text, valore numeric, atteso text, allarme boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
with demo_master as (select id from masters where coalesce(demo,false) = true or nome ilike 'Demo —%'),
demo_cliente as (select c.id from clienti c where c.master_id in (select id from demo_master) or c.ragione_sociale ilike '%TEST REVIEW%'),
-- Un solo passaggio sul registro: i gruppi tengono separate le chiavi di ogni saldo, le somme sono
-- numeric (esatte), quindi sommare i gruppi da' lo stesso totale di prima al centesimo.
mov as materialized (
  select cliente_id, master_id, master_target_id, conto, tipo, sum(importo) as importo,
         count(*) filter (where riferimento like 'PRE:%' and spedizione_id is null
                            and created_at < now() - interval '30 minutes') as prenotazioni
    from movimenti group by cliente_id, master_id, master_target_id, conto, tipo
),
saldo_rete as (
  select coalesce(master_target_id, master_id) as mid, round(sum(importo)::numeric,2) as s
    from mov where cliente_id is null and coalesce(conto,'rete') = 'rete' group by 1
),
saldo_cliente as (
  select cliente_id as cid, round(sum(importo)::numeric,2) as s from mov where cliente_id is not null group by 1
),
saldo_proprio as (
  select master_target_id as mid, round(sum(importo)::numeric,2) as s
    from mov where master_target_id is not null and conto = 'proprio' and tipo <> 'commissione' group by 1
),
saldo_commissioni as (
  select master_target_id as mid, round(sum(importo)::numeric,2) as s
    from mov where master_target_id is not null and tipo = 'commissione' group by 1
),
conti_propri as (
  select count(*) n from masters m left join saldo_proprio p on p.mid = m.id
   where m.id not in (select id from demo_master)
     and abs(round(coalesce(m.credito_proprio,0)::numeric,2) - coalesce(p.s,0)) > 0.005
),
commissioni as (
  select count(*) n from masters m left join saldo_commissioni p on p.mid = m.id
   where m.id not in (select id from demo_master)
     and abs(round(coalesce(m.commissioni_moovexpress,0)::numeric,2) - coalesce(p.s,0)) > 0.005
),
master_non_quadrano as (
  select count(*) n from masters m left join saldo_rete r on r.mid = m.id
   where m.id not in (select id from demo_master)
     and abs(round(m.credito::numeric,2) - coalesce(r.s,0)) > 0.05
),
clienti_non_quadrano as (
  select count(*) n from clienti c left join saldo_cliente r on r.cid = c.id
   where c.id not in (select id from demo_cliente)
     and abs(round(c.credito::numeric,2) - coalesce(r.s,0)) > 0.05
),
prenotazioni as (select coalesce(sum(prenotazioni),0) n from mov),
-- Le ultime 48 ore servono a due controlli: si leggono una volta, e master per master con l'indice
-- (master_target_id, created_at), non scorrendo di nuovo tutto il registro: nelle mattine col database
-- freddo era la seconda lettura intera dei movimenti. I movimenti senza master_target_id li scartavano
-- comunque entrambi i controlli, e master_target_id ha la chiave esterna sui master: stesse righe
-- (verificato il 12/11: 32.490 e 32.490, nessuna differenza).
mov_recenti as materialized (
  select mv.* from masters m
    join movimenti mv on mv.master_target_id = m.id and mv.created_at > now() - interval '48 hours'
   where m.id not in (select id from demo_master)
     and coalesce(mv.riferimento,'') not like 'CORRCONTO-%' and coalesce(mv.riferimento,'') not like 'CORRREG-%'
),
fuori_albero as (
  select count(*) n from mov_recenti mv join masters t on t.id = mv.master_target_id
   where mv.master_id <> mv.master_target_id and mv.master_id is distinct from t.parent_master_id
),
comprato_per_albero as (
  select count(*) n from mov_recenti mv
    join spedizioni s on s.id = mv.spedizione_id join corrieri c on c.id = s.corriere_id
   where mv.master_target_id is not null and mv.tipo not in ('commissione','ricarica')
     and exists (select 1 from corrieri cc where cc.master_id = mv.master_target_id and cc.collegamento_id is not null
                  and lower(btrim(cc.nome_contratto)) = lower(btrim(c.nome_contratto)))
),
privacy_amazon as (
  select (select count(*) from ordini_importati
            where order_id ~ '^\d{3}-\d{7}-\d{7}$'
              and destinatario <> '[dati rimossi]' and created_at < now() - interval '32 days')
       + (select count(*) from ordini_ecommerce
            where piattaforma = 'amazon' and destinatario is not null
              and created_at < now() - interval '32 days') as n
)
select 'soldi' area, 'saldi master che non quadrano col registro' controllo, (select n from master_non_quadrano)::numeric valore,
       'zero' atteso, (select n from master_non_quadrano) > 0 allarme
union all
select 'soldi', 'saldi clienti che non quadrano col registro', (select n from clienti_non_quadrano)::numeric, 'zero', (select n from clienti_non_quadrano) > 0
union all
select 'soldi', 'prenotazioni di credito appese', (select n from prenotazioni)::numeric, 'zero', (select n from prenotazioni) > 3
union all
select 'conti', 'conti dei contratti propri che non quadrano col registro', (select n from conti_propri)::numeric, 'zero', (select n from conti_propri) > 0
union all
select 'conti', 'commissioni MoovExpress che non quadrano col registro', (select n from commissioni)::numeric, 'zero', (select n from commissioni) > 0
union all
select 'conti', 'addebiti fra master da chi non sta sopra (48h)', (select n from fuori_albero)::numeric, 'zero', (select n from fuori_albero) > 0
union all
select 'conti', 'contratti comprati da un altro master addebitati sul conto verso il padre (48h)', (select n from comprato_per_albero)::numeric, 'zero', (select n from comprato_per_albero) > 0
union all
select 'privacy', 'ordini Amazon con dati personali oltre i 30 giorni', (select n from privacy_amazon)::numeric,
       'zero (li cancella purge-pii ogni notte)', (select n from privacy_amazon) > 0
$function$;

-- 3. Le due insieme, per lanciarla a mano dall'editor SQL (dove il limite di 8 secondi non c'e').
create or replace function public.controllo_giornaliero()
 returns table(area text, controllo text, valore numeric, atteso text, allarme boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select * from public.controllo_giornaliero_1()
  union all
  select * from public.controllo_giornaliero_2()
$function$;

-- Come prima: le esegue solo il servizio interno (l'email del mattino), nessun utente.
revoke all on function public.controllo_giornaliero_1() from public, anon, authenticated;
revoke all on function public.controllo_giornaliero_2() from public, anon, authenticated;
revoke all on function public.controllo_giornaliero() from public, anon, authenticated;
grant execute on function public.controllo_giornaliero_1() to service_role;
grant execute on function public.controllo_giornaliero_2() to service_role;
grant execute on function public.controllo_giornaliero() to service_role;
