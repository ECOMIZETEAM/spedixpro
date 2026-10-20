-- SENTINELLA: riga "privacy" in controllo_giornaliero() (email delle 7).
--
-- Perche': la pulizia dei dati personali Amazon (app/api/privacy/purge-pii) e' rimasta ferma da meta'
-- settembre a 19/10/2026 senza che nessuno se ne accorgesse — 23.486 ordini Amazon spediti oltre la
-- soglia ancora con nome, indirizzo e telefono del compratore. I registri del cron lo dicevano
-- (anonimizzati=0 ogni notte), ma nessuno li apre. La Sentinella invece arriva ogni mattina.
--
-- Conta gli ordini Amazon che a quest'ora avrebbero gia' dovuto perdere i dati: 32 giorni = soglia di
-- 30 piu' due notti di margine. Allarme sopra zero: una notte saltata o fallita si vede il giorno dopo.
--
-- Da applicare INSIEME al rilascio della correzione di purge-pii: prima, segnalerebbe ogni mattina
-- l'arretrato che solo quel rilascio smaltisce. CREATE OR REPLACE conserva permessi e proprietario
-- (eseguibile solo da service_role, come prima: verificare dopo con gli advisors).

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
privacy_amazon as (
  select (select count(*) from ordini_importati
            where order_id ~ '^\d{3}-\d{7}-\d{7}$' and stato in ('spedito', 'unito')
              and destinatario <> '[dati rimossi]' and created_at < now() - interval '32 days')
       + (select count(*) from ordini_ecommerce
            where piattaforma = 'amazon' and destinatario is not null
              and created_at < now() - interval '32 days') as n
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
  select 'privacy', 'ordini Amazon con dati personali oltre i 30 giorni',
         (select n from privacy_amazon)::numeric,
         'zero (li cancella purge-pii ogni notte)',
         (select n from privacy_amazon) > 0
)
select * from v;
$function$;
