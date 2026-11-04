-- SENTINELLA: la funzione controllo_giornaliero() che riempie l'email delle 7.
--
-- PERCHE' COSI'. Dal 14/10/2026 la Sentinella non partiva piu': ogni mattina "canceling statement due
-- to statement timeout". Il database interrompe dopo 8 secondi ogni chiamata dall'applicazione, e la
-- funzione ci stava sempre meno:
--  - i saldi di master e clienti si ricalcolavano rileggendo il registro dei movimenti per OGNI master
--    (56, senza indice utile: coalesce(master_target_id, master_id)) e per OGNI cliente (2.117);
--  - quasi ogni controllo era scritto due volte (una per il valore, una per l'allarme) e si eseguiva
--    due volte, compresi i conteggi su tracking_events (3,8 milioni di righe) e spedizioni.
-- Qui ogni controllo si calcola UNA volta, e tutti i saldi escono da UN solo passaggio sui movimenti,
-- raggruppati per le chiavi che servono. Righe, ordine, soglie e allarmi sono quelli di prima.
--
-- In piu', in fondo, la riga "privacy": ordini Amazon che a quest'ora avrebbero gia' dovuto perdere
-- i dati personali (32 giorni = soglia di 30 piu' due notti di margine). La pulizia notturna e' rimasta
-- ferma da meta' settembre al 19/10 senza che nessuno se ne accorgesse; la Sentinella arriva ogni
-- mattina. Lo dichiariamo ad Amazon come controllo giornaliero: deve girare davvero.
--
-- Da incollare nell'editor SQL di Supabase. CREATE OR REPLACE conserva permessi e proprietario.

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
-- Le ultime 48 ore servono a due controlli: si leggono una volta. I movimenti senza master_target_id
-- li scartano entrambi i controlli dopo (join sul master, "is not null"), come prima.
mov_recenti as materialized (
  select * from movimenti mv
   where mv.created_at > now() - interval '48 hours'
     and mv.master_target_id not in (select id from demo_master)
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
),
privacy_amazon as (
  select (select count(*) from ordini_importati
            where order_id ~ '^\d{3}-\d{7}-\d{7}$'
              and destinatario <> '[dati rimossi]' and created_at < now() - interval '32 days')
       + (select count(*) from ordini_ecommerce
            where piattaforma = 'amazon' and destinatario is not null
              and created_at < now() - interval '32 days') as n
),
v as (
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
  union all
  select 'soldi', 'saldi master che non quadrano col registro', (select n from master_non_quadrano)::numeric, 'zero', (select n from master_non_quadrano) > 0
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
)
select * from v;
$function$;
