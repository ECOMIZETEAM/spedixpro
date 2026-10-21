-- SENTINELLA: OGNI SPEDIZIONE SUL CONTO GIUSTO (21/10/2026).
--
-- Lorenzo: "non deve esistere che una spedizione finisce su un conto dove non deve andare". Il 21/10
-- ne sono uscite di quattro tipi, tutte invisibili per settimane perche' nessun controllo le cercava:
--   1. conto proprio che non torna col suo registro: righe di prova del 3/10 che non avevano mosso il
--      saldo (Wave, Ecomize LL, LOGIXIA);
--   2. commissioni che non tornano col loro registro (Ecomize LL, stesse prove);
--   3. addebito fra master fatto da chi NON sta sopra nell'albero: la rettifica di 282343J006009 del
--      13/10, scritta sul conto Wave→MULTI da LOGIXIA e su quello principale di MULTI da Wave;
--   4. contratto comprato da un altro master addebitato sul conto verso il padre invece che sul ledger
--      presso chi lo vende: stessa rettifica, e 92 giacenze SDA EXPRESS L a carico di MULTI (8-14/10).
-- I controlli 3 e 4 guardano le ultime 48 ore: la sentinella gira ogni mattina, quindi un errore nuovo
-- si vede il giorno dopo. Le correzioni scritte apposta (CORRCONTO-/CORRREG-) non sono errori.
-- I controlli di prima restano identici.

create or replace function public.controllo_giornaliero()
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
conti_propri as (
  select count(*) n from masters m where m.id not in (select id from demo_master)
    and abs(round(coalesce(m.credito_proprio,0)::numeric,2) - coalesce((select round(sum(mv.importo)::numeric,2) from movimenti mv
         where mv.master_target_id = m.id and mv.conto = 'proprio' and mv.tipo <> 'commissione'),0)) > 0.005
),
commissioni as (
  select count(*) n from masters m where m.id not in (select id from demo_master)
    and abs(round(coalesce(m.commissioni_moovexpress,0)::numeric,2) - coalesce((select round(sum(mv.importo)::numeric,2) from movimenti mv
         where mv.master_target_id = m.id and mv.tipo = 'commissione'),0)) > 0.005
),
fuori_albero as (
  select count(*) n from movimenti mv join masters t on t.id = mv.master_target_id
   where mv.created_at > now() - interval '48 hours'
     and mv.master_id <> mv.master_target_id and mv.master_id is distinct from t.parent_master_id
     and mv.master_target_id not in (select id from demo_master)
     and coalesce(mv.riferimento,'') not like 'CORRCONTO-%' and coalesce(mv.riferimento,'') not like 'CORRREG-%'
),
comprato_per_albero as (
  select count(*) n from movimenti mv
    join spedizioni s on s.id = mv.spedizione_id join corrieri c on c.id = s.corriere_id
   where mv.created_at > now() - interval '48 hours'
     and mv.master_target_id is not null and mv.tipo not in ('commissione','ricarica')
     and mv.master_target_id not in (select id from demo_master)
     and coalesce(mv.riferimento,'') not like 'CORRCONTO-%' and coalesce(mv.riferimento,'') not like 'CORRREG-%'
     and exists (select 1 from corrieri cc where cc.master_id = mv.master_target_id and cc.collegamento_id is not null
                  and lower(btrim(cc.nome_contratto)) = lower(btrim(c.nome_contratto)))
),
v as (
  select 'tracking' area, 'eventi di tracking nelle ultime 24h' controllo,
         (select count(*) from tracking_events where created_at > now() - interval '24 hours')::numeric valore,
         'oltre 1.000' atteso,
         (select count(*) from tracking_events where created_at > now() - interval '24 hours') < 1000 allarme
  union all
  select 'tracking', 'stati avanzati nelle ultime 24h',
         (select count(*) from spedizioni where updated_at > now() - interval '24 hours' and stato <> 'in_lavorazione')::numeric,
         'oltre 500',
         (select count(*) from spedizioni where updated_at > now() - interval '24 hours' and stato <> 'in_lavorazione') < 500
  union all
  select 'ripesature', 'misure lette dal corriere nelle ultime 20h',
         (select count(*) from ripesature_misure where letto_il > now() - interval '20 hours')::numeric,
         'oltre 0 (il Mac gira 3 volte al giorno)',
         (select count(*) from ripesature_misure where letto_il > now() - interval '20 hours') = 0
  union all
  select 'ripesature', 'consegnate valutate nelle ultime 24h',
         (select count(*) from ripesature_check where controllato_il > now() - interval '24 hours')::numeric,
         'oltre 0',
         (select count(*) from ripesature_check where controllato_il > now() - interval '24 hours') = 0
  union all
  select 'ripesature', 'in coda, ancora da valutare', (select n from coda)::numeric, 'cala da sola', (select n from coda) > 5000
  union all
  select 'ripesature', 'rettifiche in attesa di conferma da oltre 7 giorni',
         (select count(*) from rettifiche where stato='da_rettificare' and created_at < now() - interval '7 days')::numeric,
         'da guardare se cresce',
         (select count(*) from rettifiche where stato='da_rettificare' and created_at < now() - interval '7 days') > 200
  union all
  select 'tracking', 'consegnate senza cronologia (ultime 48h)',
         (select count(*) from spedizioni s where s.stato='consegnata' and s.created_at > now() - interval '48 hours'
            and not exists (select 1 from tracking_events t where t.spedizione_id=s.id))::numeric,
         'zero',
         (select count(*) from spedizioni s where s.stato='consegnata' and s.created_at > now() - interval '48 hours'
            and not exists (select 1 from tracking_events t where t.spedizione_id=s.id)) > 20
  union all
  select 'soldi', 'spedizioni senza addebito al cliente (24h)',
         (select count(*) from spedizioni s where s.created_at > now() - interval '24 hours'
            and s.cliente_id is not null and s.stato not in ('annullata','annullamento_manuale')
            and s.cliente_id not in (select id from demo_cliente)
            and not exists (select 1 from movimenti m where m.spedizione_id=s.id and m.cliente_id=s.cliente_id))::numeric,
         'zero',
         (select count(*) from spedizioni s where s.created_at > now() - interval '24 hours'
            and s.cliente_id is not null and s.stato not in ('annullata','annullamento_manuale')
            and s.cliente_id not in (select id from demo_cliente)
            and not exists (select 1 from movimenti m where m.spedizione_id=s.id and m.cliente_id=s.cliente_id)) > 0
  union all
  select 'soldi', 'saldi master che non quadrano col registro',
         (select count(*) from masters m where m.id not in (select id from demo_master)
            and abs(round(m.credito::numeric,2) - coalesce((select round(sum(mv.importo)::numeric,2) from movimenti mv
                 where mv.cliente_id is null and coalesce(mv.master_target_id, mv.master_id) = m.id
                   and coalesce(mv.conto,'rete') = 'rete'),0)) > 0.05)::numeric,
         'zero',
         (select count(*) from masters m where m.id not in (select id from demo_master)
            and abs(round(m.credito::numeric,2) - coalesce((select round(sum(mv.importo)::numeric,2) from movimenti mv
                 where mv.cliente_id is null and coalesce(mv.master_target_id, mv.master_id) = m.id
                   and coalesce(mv.conto,'rete') = 'rete'),0)) > 0.05) > 0
  union all
  select 'soldi', 'saldi clienti che non quadrano col registro',
         (select count(*) from clienti c where c.id not in (select id from demo_cliente)
            and abs(round(c.credito::numeric,2) - coalesce((select round(sum(mv.importo)::numeric,2) from movimenti mv where mv.cliente_id = c.id),0)) > 0.05)::numeric,
         'zero',
         (select count(*) from clienti c where c.id not in (select id from demo_cliente)
            and abs(round(c.credito::numeric,2) - coalesce((select round(sum(mv.importo)::numeric,2) from movimenti mv where mv.cliente_id = c.id),0)) > 0.05) > 0
  union all
  select 'soldi', 'prenotazioni di credito appese',
         (select count(*) from movimenti where riferimento like 'PRE:%' and spedizione_id is null
            and created_at < now() - interval '30 minutes')::numeric,
         'zero',
         (select count(*) from movimenti where riferimento like 'PRE:%' and spedizione_id is null
            and created_at < now() - interval '30 minutes') > 3
  union all
  select 'conti', 'conti dei contratti propri che non quadrano col registro', (select n from conti_propri)::numeric, 'zero', (select n from conti_propri) > 0
  union all
  select 'conti', 'commissioni MoovExpress che non quadrano col registro', (select n from commissioni)::numeric, 'zero', (select n from commissioni) > 0
  union all
  select 'conti', 'addebiti fra master da chi non sta sopra (48h)', (select n from fuori_albero)::numeric, 'zero', (select n from fuori_albero) > 0
  union all
  select 'conti', 'contratti comprati da un altro master addebitati sul conto verso il padre (48h)', (select n from comprato_per_albero)::numeric, 'zero', (select n from comprato_per_albero) > 0
)
select * from v;
$function$;
