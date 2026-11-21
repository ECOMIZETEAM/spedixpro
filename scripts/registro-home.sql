-- ============================================================================================
-- REGISTRO DELLE SPEDIZIONI PER LA HOME DEL MASTER (preparato il 20/11/2026). PRODUZIONE, A ORARIO
-- TRANQUILLO: la PARTE 2 ferma le scritture sulle spedizioni per qualche secondo (la parte di tabella da
-- contare e' ~0,8 GB, le etichette stanno a parte e non si leggono).
--
-- PERCHE'. Le tre funzioni della home (statistiche, contatori, KPI) ricontano a ogni apertura TUTTE le
-- spedizioni della rete: per MULTIEXPRESS 448.000 negli ultimi 12 mesi e tutto lo storico per i KPI.
-- Dal 04/11: 29.000 chiamate ciascuna, medie 849 / 354 / 289 ms, punte di 7,5 secondi. Qui il database
-- tiene un REGISTRO (una riga per master, cliente, contratto, giorno e stato) aggiornato da un trigger, e
-- le funzioni leggono quello: per la rete piu' grande ~100.000 righe di registro invece di 680.000
-- spedizioni, senza ricontare.
--
-- I NUMERI SONO GLI STESSI. Il testo nuovo delle tre funzioni e' stato provato in SOLA LETTURA su tutti i
-- 63 master, col registro calcolato al volo, contro le funzioni di oggi nella stessa istruzione: 63/63
-- identici su statistiche, contatori e KPI (confronto jsonb). Unica differenza voluta: in stati30 le chiavi
-- escono in ordine alfabetico invece che in ordine casuale.
--
-- IL TRIGGER E' COLLAUDATO (21/11, ambiente di prova, stesso testo): 3.000 spedizioni finte, 8.000
-- modifiche a caso (stato, costo, contrassegno, master, cliente, contratto, data, cancellazioni) con
-- consolidamenti sparsi, poi aggiornamenti in blocco: 0 chiavi diverse su 3.024, prima e dopo il
-- consolidamento e dopo le scritture di un utente normale; la marcatura del tracking non scrive niente nel
-- quaderno; un utente normale non legge il registro e non consolida.
--
-- IL GIRO: /api/cron/registro-home consolida ogni due minuti e alle 02:40 UTC verifica (vedi la funzione 5).
--
-- COME SI INCOLLA: una PARTE alla volta, nell'ordine. Dopo la PARTE 3 i due controlli devono dare
-- "tutti uguali" e "0 chiavi diverse": solo allora la PARTE 4. In qualunque momento: RIPRISTINO in fondo.
-- ============================================================================================

-- ===================== PARTE 1: registro, quaderno, trigger (non ancora agganciato), consolida =====

-- 1) IL REGISTRO. Una riga per (master, cliente, contratto, giorno UTC, stato): quante spedizioni, la somma
--    di costo_totale, e i contrassegni consegnati non ancora pagati ne' annullati (cod_aperto). Le chiavi
--    possono essere vuote (cliente_id NULL, created_at NULL): due vuote contano come uguali.
create table if not exists public.riepilogo_spedizioni (
  master_id   uuid,
  cliente_id  uuid,
  corriere_id uuid,
  giorno      date,
  stato       text,
  n           bigint  not null default 0,
  costo       numeric not null default 0,
  cod_aperto  numeric not null default 0,
  constraint riepilogo_spedizioni_chiave unique nulls not distinct (master_id, cliente_id, corriere_id, giorno, stato)
);
create index if not exists idx_riepilogo_spedizioni_master_giorno on public.riepilogo_spedizioni (master_id, giorno);

-- 2) IL QUADERNO DELLE VARIAZIONI. Il trigger qui sotto SCRIVE SOLO RIGHE NUOVE: due spedizioni che
--    cambiano insieme non si aspettano mai a vicenda e non possono bloccarsi (nessuna riga condivisa da
--    aggiornare). Ogni pochi minuti fn_riepilogo_spedizioni_consolida() le riporta nel registro.
create table if not exists public.riepilogo_spedizioni_variazioni (
  id          bigint generated always as identity primary key,
  master_id   uuid,
  cliente_id  uuid,
  corriere_id uuid,
  giorno      date,
  stato       text,
  n           bigint  not null,
  costo       numeric not null,
  cod_aperto  numeric not null
);
create index if not exists idx_riepilogo_variazioni_master on public.riepilogo_spedizioni_variazioni (master_id);

-- Nessuno li legge da fuori: solo le funzioni della home (chiamate col client di servizio) e il trigger.
alter table public.riepilogo_spedizioni enable row level security;
alter table public.riepilogo_spedizioni_variazioni enable row level security;
revoke all on table public.riepilogo_spedizioni from public, anon, authenticated;
revoke all on table public.riepilogo_spedizioni_variazioni from public, anon, authenticated;
grant select on table public.riepilogo_spedizioni to service_role;
grant select on table public.riepilogo_spedizioni_variazioni to service_role;

-- 3) IL TRIGGER. Per ogni spedizione che nasce, cambia o sparisce: -1 sulla chiave di prima, +1 su quella
--    di adesso. Volutamente SENZA blocco d'eccezione: un blocco d'eccezione apre una sotto-transazione a
--    ogni riga, e un aggiornamento in blocco di migliaia di spedizioni ne aprirebbe migliaia (rallenta tutto
--    il database). Qui non c'e' niente che possa fallire: una tabella senza vincoli, valori mai vuoti.
create or replace function public.fn_riepilogo_spedizioni_variazione()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    insert into public.riepilogo_spedizioni_variazioni (master_id, cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto)
    values (old.master_id, old.cliente_id, old.corriere_id, (old.created_at at time zone 'UTC')::date, old.stato,
            -1, -coalesce(old.costo_totale, 0), -(case when old.contrassegno > 0 and old.stato = 'consegnata' and coalesce(old.stato_contrassegno, '') not in ('pagato', 'annullato') then old.contrassegno else 0 end));
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.riepilogo_spedizioni_variazioni (master_id, cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto)
    values (new.master_id, new.cliente_id, new.corriere_id, (new.created_at at time zone 'UTC')::date, new.stato,
            1, coalesce(new.costo_totale, 0), case when new.contrassegno > 0 and new.stato = 'consegnata' and coalesce(new.stato_contrassegno, '') not in ('pagato', 'annullato') then new.contrassegno else 0 end);
  end if;
  return null;
end;
$$;
revoke all on function public.fn_riepilogo_spedizioni_variazione() from public, anon, authenticated;

-- 4) CONSOLIDA: porta le variazioni nel registro, in una transazione sola. Chi legge vede o prima o dopo,
--    mai a meta' (le funzioni sommano registro + variazioni). Due giri insieme non contano due volte: una
--    riga del quaderno la cancella uno solo. Le chiavi tornate a zero si tolgono.
create or replace function public.fn_riepilogo_spedizioni_consolida()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare k integer;
begin
  with tolte as (
    delete from public.riepilogo_spedizioni_variazioni
    returning master_id, cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto
  ), somme as (
    select master_id, cliente_id, corriere_id, giorno, stato,
           sum(n)::bigint as n, sum(costo) as costo, sum(cod_aperto) as cod_aperto
      from tolte group by 1, 2, 3, 4, 5
  )
  insert into public.riepilogo_spedizioni as r (master_id, cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto)
  select master_id, cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto from somme
  on conflict on constraint riepilogo_spedizioni_chiave do update
    set n = r.n + excluded.n, costo = r.costo + excluded.costo, cod_aperto = r.cod_aperto + excluded.cod_aperto;
  get diagnostics k = row_count;
  delete from public.riepilogo_spedizioni where n = 0 and costo = 0 and cod_aperto = 0;
  return k;
end;
$$;
revoke all on function public.fn_riepilogo_spedizioni_consolida() from public, anon, authenticated;
grant execute on function public.fn_riepilogo_spedizioni_consolida() to service_role;
-- La pulizia delle chiavi tornate a zero (in fondo a consolida) gira ogni due minuti: con questo indice
-- trova solo quelle, invece di rileggere tutto il registro a ogni giro. Sono poche, l'indice e' minuscolo.
create index if not exists idx_riepilogo_spedizioni_vuote on public.riepilogo_spedizioni (master_id)
  where n = 0 and costo = 0 and cod_aperto = 0;

-- 5) LA VERIFICA DI NOTTE. Il registro contro le spedizioni, chiave per chiave, in un'istantanea sola
--    (registro, quaderno e spedizioni nello stesso momento: il trigger scrive il quaderno nella stessa
--    transazione della spedizione, quindi i conti tornano anche mentre si lavora). La chiama il giro
--    /api/cron/registro-home alle 02:40 UTC: se una chiave non torna lo scrive nei log con
--    [REGISTRO HOME][DIVERSO]. Rilegge tutte le spedizioni (la parte senza etichette, ~0,8 GB): pochi
--    secondi, per questo una volta al giorno e di notte. Col registro ancora vuoto non confronta niente.
create or replace function public.fn_riepilogo_spedizioni_verifica()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '90s'
as $$
declare r jsonb;
begin
  if not exists (select 1 from public.riepilogo_spedizioni) then
    return jsonb_build_object('registro_vuoto', true);
  end if;
  with vero as (
    select s.master_id, s.cliente_id, s.corriere_id, (s.created_at at time zone 'UTC')::date as giorno, s.stato,
           count(*)::bigint as n, coalesce(sum(s.costo_totale), 0) as costo, coalesce(sum(case when s.contrassegno > 0 and s.stato = 'consegnata' and coalesce(s.stato_contrassegno, '') not in ('pagato', 'annullato') then s.contrassegno else 0 end), 0) as cod_aperto
      from public.spedizioni s group by 1, 2, 3, 4, 5
  ), reg as (
    select master_id, cliente_id, corriere_id, giorno, stato, sum(n)::bigint as n, sum(costo) as costo, sum(cod_aperto) as cod_aperto
      from (select master_id, cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto from public.riepilogo_spedizioni
            union all
            select master_id, cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto from public.riepilogo_spedizioni_variazioni) x
     group by 1, 2, 3, 4, 5 having sum(n) <> 0 or sum(costo) <> 0 or sum(cod_aperto) <> 0
  ), solo_spedizioni as (select * from vero except select * from reg),
     solo_registro as (select * from reg except select * from vero)
  select jsonb_build_object(
    'chiavi_diverse', (select count(*) from solo_spedizioni) + (select count(*) from solo_registro),
    'chiavi', (select count(*) from vero),
    'esempi', coalesce((select jsonb_agg(e) from (
                (select 'nelle spedizioni' as fonte, a.* from solo_spedizioni a limit 3)
                union all
                (select 'nel registro' as fonte, b.* from solo_registro b limit 3)) e), '[]'::jsonb))
    into r;
  return r;
end;
$$;
revoke all on function public.fn_riepilogo_spedizioni_verifica() from public, anon, authenticated;
grant execute on function public.fn_riepilogo_spedizioni_verifica() to service_role;


-- ===================== PARTE 2: aggancio del trigger e caricamento iniziale (blocca le scritture pochi secondi) =====

-- 6) AGGANCIO + CARICAMENTO INIZIALE, NELLA STESSA TRANSAZIONE. Il blocco ferma le SCRITTURE sulle
--    spedizioni (le letture no) fino al commit: cosi' nessuna spedizione puo' cambiare fra il conteggio
--    iniziale e l'accensione del trigger, e il registro parte esatto. Dura il tempo di contare le
--    spedizioni (pochi secondi). Se il blocco non arriva entro 5 secondi si rinuncia e non cambia niente.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
lock table public.spedizioni in share row exclusive mode;
drop trigger if exists trg_riepilogo_spedizioni on public.spedizioni;
drop trigger if exists trg_riepilogo_spedizioni_mod on public.spedizioni;
create trigger trg_riepilogo_spedizioni
  after insert or delete on public.spedizioni
  for each row execute function public.fn_riepilogo_spedizioni_variazione();
-- Solo quando cambia qualcosa che il registro conta: la marcatura del giro tracking (milioni di
-- aggiornamenti al giorno) non lo sveglia nemmeno.
create trigger trg_riepilogo_spedizioni_mod
  after update of master_id, cliente_id, corriere_id, created_at, stato, costo_totale, contrassegno, stato_contrassegno
  on public.spedizioni
  for each row
  when (old.master_id is distinct from new.master_id or old.cliente_id is distinct from new.cliente_id
     or old.corriere_id is distinct from new.corriere_id or old.created_at is distinct from new.created_at
     or old.stato is distinct from new.stato or old.costo_totale is distinct from new.costo_totale
     or old.contrassegno is distinct from new.contrassegno or old.stato_contrassegno is distinct from new.stato_contrassegno)
  execute function public.fn_riepilogo_spedizioni_variazione();
delete from public.riepilogo_spedizioni_variazioni;
delete from public.riepilogo_spedizioni;
insert into public.riepilogo_spedizioni (master_id, cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto)
select s.master_id, s.cliente_id, s.corriere_id, (s.created_at at time zone 'UTC')::date, s.stato,
       count(*), coalesce(sum(s.costo_totale), 0), coalesce(sum(case when s.contrassegno > 0 and s.stato = 'consegnata' and coalesce(s.stato_contrassegno, '') not in ('pagato', 'annullato') then s.contrassegno else 0 end), 0)
  from public.spedizioni s
 group by 1, 2, 3, 4, 5;
commit;


-- ===================== PARTE 3: funzioni nuove ACCANTO alle vecchie (suffisso _r) e controlli =====
create or replace function public.dashboard_statistiche_master_r(p_master uuid)
 returns json
 language sql
 stable
 set search_path to 'public'
as $function$
  with recursive rete as (
    select p_master as id
    union all
    select m.id from public.masters m join rete r on m.parent_master_id = r.id
  ),
  gambe as (select public.fn_ledger_nascosti(p_master) as ids),
  -- Il registro piu' le variazioni non ancora consolidate: insieme fanno il conto esatto di adesso.
  reg as (
    select cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto from public.riepilogo_spedizioni
     where master_id = any (array(select id from rete))
    union all
    select cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto from public.riepilogo_spedizioni_variazioni
     where master_id = any (array(select id from rete))
  ),
  -- Fuori le gambe interne della rete (stessa regola di prima, fn_ledger_nascosti).
  regv as (select * from reg where not coalesce(cliente_id = any ((select ids from gambe)::uuid[]), false)),
  confine as (select now() - interval '30 days' as da,
                     ((now() - interval '30 days') at time zone 'UTC')::date as giorno),
  ultimi30 as (
    select r.stato, r.n from regv r, confine c where r.giorno > c.giorno
    union all
    select s.stato, 1::bigint from public.spedizioni s, confine c
     where s.master_id = any (array(select id from rete))
       and s.created_at >= c.da
       and s.created_at < ((c.giorno + 1)::timestamp at time zone 'UTC')
       and not coalesce(s.cliente_id = any ((select ids from gambe)::uuid[]), false)
  )
  select json_build_object(
    'mensili', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
        select to_char(date_trunc('month', giorno), 'Mon YY') as mese,
               sum(n)::bigint as totale,
               coalesce(sum(costo), 0) as importo
        from regv
        where giorno >= (date_trunc('month', now() at time zone 'UTC') - interval '12 months')::date
          and stato <> 'annullata'
        group by date_trunc('month', giorno)
        having sum(n) > 0
        order by date_trunc('month', giorno)
      ) t
    ),
    'stati30', (
      select coalesce(json_object_agg(stato, n order by stato), '{}'::json) from (
        select stato, sum(n)::bigint n from ultimi30 group by stato having sum(n) > 0
      ) s
    )
  );
$function$;
revoke all on function public.dashboard_statistiche_master_r(uuid) from public, anon, authenticated;
grant execute on function public.dashboard_statistiche_master_r(uuid) to service_role;

create or replace function public.dashboard_contatori_master_r(p_master uuid)
 returns json
 language sql
 stable
 set search_path to 'public'
as $function$
  with recursive rete as (
    select p_master as id
    union all
    select m.id from public.masters m join rete r on m.parent_master_id = r.id
  ),
  gambe as (select public.fn_ledger_nascosti(p_master) as ids),
  -- Il registro piu' le variazioni non ancora consolidate: insieme fanno il conto esatto di adesso.
  reg as (
    select cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto from public.riepilogo_spedizioni
     where master_id = any (array(select id from rete))
    union all
    select cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto from public.riepilogo_spedizioni_variazioni
     where master_id = any (array(select id from rete))
  ),
  -- Fuori le gambe interne della rete (stessa regola di prima, fn_ledger_nascosti).
  regv as (select * from reg where not coalesce(cliente_id = any ((select ids from gambe)::uuid[]), false)),
  confine as (select now() - interval '30 days' as da,
                     ((now() - interval '30 days') at time zone 'UTC')::date as giorno),
  ultimi30 as (
    select r.stato, r.n from regv r, confine c where r.giorno > c.giorno
    union all
    select s.stato, 1::bigint from public.spedizioni s, confine c
     where s.master_id = any (array(select id from rete))
       and s.created_at >= c.da
       and s.created_at < ((c.giorno + 1)::timestamp at time zone 'UTC')
       and not coalesce(s.cliente_id = any ((select ids from gambe)::uuid[]), false)
  )
  select json_build_object(
    'totClienti',    (select count(*) from public.clienti where master_id = p_master),
    'spedizioniMese',(select coalesce(sum(n), 0)::bigint from regv where giorno >= (date_trunc('month', now() at time zone 'UTC'))::date and stato <> 'annullata'),
    'spediteOggi',   (select coalesce(sum(n), 0)::bigint from regv where giorno >= (now() at time zone 'UTC')::date
                        and stato in ('spedita','in_transito','in_consegna','consegnata','in_giacenza','non_consegnato','reso_mittente')),
    'daSpedire',     (select coalesce(sum(n), 0)::bigint from ultimi30 where stato = 'in_lavorazione'),
    'inLavorazione', (select coalesce(sum(n), 0)::bigint from ultimi30 where stato in ('in_lavorazione','spedita'))
  );
$function$;
revoke all on function public.dashboard_contatori_master_r(uuid) from public, anon, authenticated;
grant execute on function public.dashboard_contatori_master_r(uuid) to service_role;

create or replace function public.dashboard_kpi_master_r(p_master uuid)
 returns json
 language sql
 stable
 set search_path to 'public'
as $function$
  with recursive rete as (
    select p_master as id
    union all
    select m.id from public.masters m join rete r on m.parent_master_id = r.id
  ),
  gambe as (select public.fn_ledger_nascosti(p_master) as ids),
  -- Il registro piu' le variazioni non ancora consolidate: insieme fanno il conto esatto di adesso.
  reg as (
    select cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto from public.riepilogo_spedizioni
     where master_id = any (array(select id from rete))
    union all
    select cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto from public.riepilogo_spedizioni_variazioni
     where master_id = any (array(select id from rete))
  ),
  -- Fuori le gambe interne della rete (stessa regola di prima, fn_ledger_nascosti).
  regv as (select * from reg where not coalesce(cliente_id = any ((select ids from gambe)::uuid[]), false)),
  base as (
    select
      coalesce(sum(n) filter (where stato <> 'annullata'), 0)::bigint as spedizioni_totali,
      coalesce(sum(costo) filter (where stato <> 'annullata' and giorno >= (date_trunc('month', now() at time zone 'UTC'))::date), 0) as fatturato_mese,
      coalesce(sum(n) filter (where stato = 'consegnata' and giorno >= (date_trunc('month', now() at time zone 'UTC'))::date), 0)::bigint as consegnate_mese,
      coalesce(sum(n) filter (where stato = 'consegnata'), 0)::bigint as consegnate_totali,
      coalesce(sum(n) filter (where stato in ('spedita','in_transito','in_consegna')), 0)::bigint as in_transito,
      coalesce(sum(n) filter (where stato = 'in_giacenza'), 0)::bigint as in_giacenza,
      coalesce(sum(cod_aperto), 0) as cod_da_rimettere
    from regv
  ),
  per_corriere as (
    select corriere_id, sum(n) as n from regv
    where stato <> 'annullata'
    group by corriere_id having sum(n) > 0
  ),
  per_cliente as (
    select cliente_id, sum(n) as n from regv
    where cliente_id is not null and stato <> 'annullata'
    group by cliente_id having sum(n) > 0
  )
  select json_build_object(
    'spedizioniTotali', b.spedizioni_totali,
    'fatturatoMese',    b.fatturato_mese,
    'consegnateMese',   b.consegnate_mese,
    'consegnateTotali', b.consegnate_totali,
    'inTransito',       b.in_transito,
    'inGiacenza',       b.in_giacenza,
    'codDaRimettere',   b.cod_da_rimettere,
    'clientiTotali',    (select count(*) from public.clienti where master_id = p_master),
    'sottomaster',      (select count(*) from public.masters where parent_master_id = p_master),
    'topCorriere',      (select json_build_object('nome', nome, 'n', n) from (
                           select c.nome_contratto as nome, sum(pc.n)::bigint as n
                           from per_corriere pc join public.corrieri c on c.id = pc.corriere_id
                           group by c.nome_contratto order by n desc, nome limit 1) tc),
    'topCliente',       (select json_build_object('nome', nome, 'n', n) from (
                           select cl.ragione_sociale as nome, sum(pc.n)::bigint as n
                           from per_cliente pc join public.clienti cl on cl.id = pc.cliente_id
                           group by cl.ragione_sociale order by n desc, nome limit 1) tcl)
  ) from base b;
$function$;
revoke all on function public.dashboard_kpi_master_r(uuid) from public, anon, authenticated;
grant execute on function public.dashboard_kpi_master_r(uuid) to service_role;

-- Le funzioni NUOVE (col suffisso _r, accanto alle vecchie) contro le VECCHIE, per TUTTI i master, nella
-- stessa istruzione (stessi dati nello stesso istante). Devono essere tutte true. Prima consolida, poi
-- ricontrolla: devono restare true (il quaderno e il registro insieme danno lo stesso conto).
begin; set local statement_timeout = '120s';
select count(*) as master,
       count(*) filter (where public.dashboard_statistiche_master(id)::jsonb = public.dashboard_statistiche_master_r(id)::jsonb) as statistiche_uguali,
       count(*) filter (where public.dashboard_contatori_master(id)::jsonb   = public.dashboard_contatori_master_r(id)::jsonb)   as contatori_uguali,
       count(*) filter (where public.dashboard_kpi_master(id)::jsonb         = public.dashboard_kpi_master_r(id)::jsonb)         as kpi_uguali
  from public.masters;
commit;

-- Il registro (piu' il quaderno) contro le spedizioni, chiave per chiave: deve dare 0 righe.
begin; set local statement_timeout = '120s';
with vero as (
  select s.master_id, s.cliente_id, s.corriere_id, (s.created_at at time zone 'UTC')::date as giorno, s.stato,
         count(*)::bigint as n, coalesce(sum(s.costo_totale), 0) as costo, coalesce(sum(case when s.contrassegno > 0 and s.stato = 'consegnata' and coalesce(s.stato_contrassegno, '') not in ('pagato', 'annullato') then s.contrassegno else 0 end), 0) as cod_aperto
    from public.spedizioni s group by 1, 2, 3, 4, 5
), reg as (
  select master_id, cliente_id, corriere_id, giorno, stato, sum(n)::bigint as n, sum(costo) as costo, sum(cod_aperto) as cod_aperto
    from (select master_id, cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto from public.riepilogo_spedizioni
          union all
          select master_id, cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto from public.riepilogo_spedizioni_variazioni) x
   group by 1, 2, 3, 4, 5 having sum(n) <> 0 or sum(costo) <> 0 or sum(cod_aperto) <> 0
)
select count(*) as chiavi_diverse from (
  (select * from vero except select * from reg) union all (select * from reg except select * from vero)
) d;
commit;

-- Consolida a mano una volta e rilancia i due controlli: devono restare uguali.
select public.fn_riepilogo_spedizioni_consolida() as variazioni_consolidate;

-- ===================== PARTE 4: le funzioni della home passano al registro =====
create or replace function public.dashboard_statistiche_master(p_master uuid)
 returns json
 language sql
 stable
 set search_path to 'public'
as $function$
  with recursive rete as (
    select p_master as id
    union all
    select m.id from public.masters m join rete r on m.parent_master_id = r.id
  ),
  gambe as (select public.fn_ledger_nascosti(p_master) as ids),
  -- Il registro piu' le variazioni non ancora consolidate: insieme fanno il conto esatto di adesso.
  reg as (
    select cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto from public.riepilogo_spedizioni
     where master_id = any (array(select id from rete))
    union all
    select cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto from public.riepilogo_spedizioni_variazioni
     where master_id = any (array(select id from rete))
  ),
  -- Fuori le gambe interne della rete (stessa regola di prima, fn_ledger_nascosti).
  regv as (select * from reg where not coalesce(cliente_id = any ((select ids from gambe)::uuid[]), false)),
  confine as (select now() - interval '30 days' as da,
                     ((now() - interval '30 days') at time zone 'UTC')::date as giorno),
  ultimi30 as (
    select r.stato, r.n from regv r, confine c where r.giorno > c.giorno
    union all
    select s.stato, 1::bigint from public.spedizioni s, confine c
     where s.master_id = any (array(select id from rete))
       and s.created_at >= c.da
       and s.created_at < ((c.giorno + 1)::timestamp at time zone 'UTC')
       and not coalesce(s.cliente_id = any ((select ids from gambe)::uuid[]), false)
  )
  select json_build_object(
    'mensili', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
        select to_char(date_trunc('month', giorno), 'Mon YY') as mese,
               sum(n)::bigint as totale,
               coalesce(sum(costo), 0) as importo
        from regv
        where giorno >= (date_trunc('month', now() at time zone 'UTC') - interval '12 months')::date
          and stato <> 'annullata'
        group by date_trunc('month', giorno)
        having sum(n) > 0
        order by date_trunc('month', giorno)
      ) t
    ),
    'stati30', (
      select coalesce(json_object_agg(stato, n order by stato), '{}'::json) from (
        select stato, sum(n)::bigint n from ultimi30 group by stato having sum(n) > 0
      ) s
    )
  );
$function$;
revoke all on function public.dashboard_statistiche_master(uuid) from public, anon, authenticated;
grant execute on function public.dashboard_statistiche_master(uuid) to service_role;

create or replace function public.dashboard_contatori_master(p_master uuid)
 returns json
 language sql
 stable
 set search_path to 'public'
as $function$
  with recursive rete as (
    select p_master as id
    union all
    select m.id from public.masters m join rete r on m.parent_master_id = r.id
  ),
  gambe as (select public.fn_ledger_nascosti(p_master) as ids),
  -- Il registro piu' le variazioni non ancora consolidate: insieme fanno il conto esatto di adesso.
  reg as (
    select cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto from public.riepilogo_spedizioni
     where master_id = any (array(select id from rete))
    union all
    select cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto from public.riepilogo_spedizioni_variazioni
     where master_id = any (array(select id from rete))
  ),
  -- Fuori le gambe interne della rete (stessa regola di prima, fn_ledger_nascosti).
  regv as (select * from reg where not coalesce(cliente_id = any ((select ids from gambe)::uuid[]), false)),
  confine as (select now() - interval '30 days' as da,
                     ((now() - interval '30 days') at time zone 'UTC')::date as giorno),
  ultimi30 as (
    select r.stato, r.n from regv r, confine c where r.giorno > c.giorno
    union all
    select s.stato, 1::bigint from public.spedizioni s, confine c
     where s.master_id = any (array(select id from rete))
       and s.created_at >= c.da
       and s.created_at < ((c.giorno + 1)::timestamp at time zone 'UTC')
       and not coalesce(s.cliente_id = any ((select ids from gambe)::uuid[]), false)
  )
  select json_build_object(
    'totClienti',    (select count(*) from public.clienti where master_id = p_master),
    'spedizioniMese',(select coalesce(sum(n), 0)::bigint from regv where giorno >= (date_trunc('month', now() at time zone 'UTC'))::date and stato <> 'annullata'),
    'spediteOggi',   (select coalesce(sum(n), 0)::bigint from regv where giorno >= (now() at time zone 'UTC')::date
                        and stato in ('spedita','in_transito','in_consegna','consegnata','in_giacenza','non_consegnato','reso_mittente')),
    'daSpedire',     (select coalesce(sum(n), 0)::bigint from ultimi30 where stato = 'in_lavorazione'),
    'inLavorazione', (select coalesce(sum(n), 0)::bigint from ultimi30 where stato in ('in_lavorazione','spedita'))
  );
$function$;
revoke all on function public.dashboard_contatori_master(uuid) from public, anon, authenticated;
grant execute on function public.dashboard_contatori_master(uuid) to service_role;

create or replace function public.dashboard_kpi_master(p_master uuid)
 returns json
 language sql
 stable
 set search_path to 'public'
as $function$
  with recursive rete as (
    select p_master as id
    union all
    select m.id from public.masters m join rete r on m.parent_master_id = r.id
  ),
  gambe as (select public.fn_ledger_nascosti(p_master) as ids),
  -- Il registro piu' le variazioni non ancora consolidate: insieme fanno il conto esatto di adesso.
  reg as (
    select cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto from public.riepilogo_spedizioni
     where master_id = any (array(select id from rete))
    union all
    select cliente_id, corriere_id, giorno, stato, n, costo, cod_aperto from public.riepilogo_spedizioni_variazioni
     where master_id = any (array(select id from rete))
  ),
  -- Fuori le gambe interne della rete (stessa regola di prima, fn_ledger_nascosti).
  regv as (select * from reg where not coalesce(cliente_id = any ((select ids from gambe)::uuid[]), false)),
  base as (
    select
      coalesce(sum(n) filter (where stato <> 'annullata'), 0)::bigint as spedizioni_totali,
      coalesce(sum(costo) filter (where stato <> 'annullata' and giorno >= (date_trunc('month', now() at time zone 'UTC'))::date), 0) as fatturato_mese,
      coalesce(sum(n) filter (where stato = 'consegnata' and giorno >= (date_trunc('month', now() at time zone 'UTC'))::date), 0)::bigint as consegnate_mese,
      coalesce(sum(n) filter (where stato = 'consegnata'), 0)::bigint as consegnate_totali,
      coalesce(sum(n) filter (where stato in ('spedita','in_transito','in_consegna')), 0)::bigint as in_transito,
      coalesce(sum(n) filter (where stato = 'in_giacenza'), 0)::bigint as in_giacenza,
      coalesce(sum(cod_aperto), 0) as cod_da_rimettere
    from regv
  ),
  per_corriere as (
    select corriere_id, sum(n) as n from regv
    where stato <> 'annullata'
    group by corriere_id having sum(n) > 0
  ),
  per_cliente as (
    select cliente_id, sum(n) as n from regv
    where cliente_id is not null and stato <> 'annullata'
    group by cliente_id having sum(n) > 0
  )
  select json_build_object(
    'spedizioniTotali', b.spedizioni_totali,
    'fatturatoMese',    b.fatturato_mese,
    'consegnateMese',   b.consegnate_mese,
    'consegnateTotali', b.consegnate_totali,
    'inTransito',       b.in_transito,
    'inGiacenza',       b.in_giacenza,
    'codDaRimettere',   b.cod_da_rimettere,
    'clientiTotali',    (select count(*) from public.clienti where master_id = p_master),
    'sottomaster',      (select count(*) from public.masters where parent_master_id = p_master),
    'topCorriere',      (select json_build_object('nome', nome, 'n', n) from (
                           select c.nome_contratto as nome, sum(pc.n)::bigint as n
                           from per_corriere pc join public.corrieri c on c.id = pc.corriere_id
                           group by c.nome_contratto order by n desc, nome limit 1) tc),
    'topCliente',       (select json_build_object('nome', nome, 'n', n) from (
                           select cl.ragione_sociale as nome, sum(pc.n)::bigint as n
                           from per_cliente pc join public.clienti cl on cl.id = pc.cliente_id
                           group by cl.ragione_sociale order by n desc, nome limit 1) tcl)
  ) from base b;
$function$;
revoke all on function public.dashboard_kpi_master(uuid) from public, anon, authenticated;
grant execute on function public.dashboard_kpi_master(uuid) to service_role;

drop function if exists public.dashboard_statistiche_master_r(uuid);
drop function if exists public.dashboard_contatori_master_r(uuid);
drop function if exists public.dashboard_kpi_master_r(uuid);

-- ============================================================================================
-- RIPRISTINO (solo se serve). Rimette le tre funzioni di prima e stacca il trigger. Le tabelle del
-- registro restano (non danno fastidio a nessuno); si tolgono a parte, dopo, se si decide di rinunciare.
-- Le tre funzioni sono il testo esatto di produzione (impronta md5 di pg_get_functiondef controllata il
-- 21/11: identica), col punto e virgola in fondo che pg_get_functiondef non mette.
-- ============================================================================================
/*
CREATE OR REPLACE FUNCTION public.dashboard_statistiche_master(p_master uuid)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with recursive rete as (
    select p_master as id
    union all
    select m.id from masters m join rete r on m.parent_master_id = r.id
  ),
  gambe as (select public.fn_ledger_nascosti(p_master) as ids)
  select json_build_object(
    'mensili', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
        select to_char(date_trunc('month', created_at), 'Mon YY') as mese,
               count(*) as totale,
               coalesce(sum(costo_totale),0) as importo
        from spedizioni
        where master_id in (select id from rete) and created_at >= date_trunc('month', now()) - interval '12 months'
          and stato <> 'annullata'
          and not coalesce(cliente_id = any((select ids from gambe)::uuid[]), false)
        group by date_trunc('month', created_at)
        order by date_trunc('month', created_at)
      ) t
    ),
    'stati30', (
      select coalesce(json_object_agg(stato, n), '{}'::json) from (
        select stato, count(*) n from spedizioni
        where master_id in (select id from rete) and created_at >= now() - interval '30 days'
          and not coalesce(cliente_id = any((select ids from gambe)::uuid[]), false)
        group by stato
      ) s
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_contatori_master(p_master uuid)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with recursive rete as (
    select p_master as id
    union all
    select m.id from masters m join rete r on m.parent_master_id = r.id
  ),
  gambe as (select public.fn_ledger_nascosti(p_master) as ids),
  sped as not materialized (
    select created_at, stato from spedizioni
     where master_id in (select id from rete)
       and not coalesce(cliente_id = any((select ids from gambe)::uuid[]), false)
  )
  select json_build_object(
    'totClienti',    (select count(*) from clienti where master_id = p_master),
    'spedizioniMese',(select count(*) from sped where created_at >= date_trunc('month', now()) and stato <> 'annullata'),
    'spediteOggi',   (select count(*) from sped where created_at >= date_trunc('day', now()) and stato in ('spedita','in_transito','in_consegna','consegnata','in_giacenza','non_consegnato','reso_mittente')),
    'daSpedire',     (select count(*) from sped where created_at >= now() - interval '30 days' and stato = 'in_lavorazione'),
    'inLavorazione', (select count(*) from sped where created_at >= now() - interval '30 days' and stato in ('in_lavorazione','spedita'))
  );
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_kpi_master(p_master uuid)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with recursive rete as (
    select p_master as id
    union all
    select m.id from masters m join rete r on m.parent_master_id = r.id
  ),
  gambe as (select public.fn_ledger_nascosti(p_master) as ids),
  mese as (select date_trunc('month', now()) as inizio),
  sped as not materialized (
    select created_at, stato, costo_totale, contrassegno, stato_contrassegno, corriere_id, cliente_id
      from spedizioni
     where master_id = any (array(select id from rete))
       and not coalesce(cliente_id = any((select ids from gambe)::uuid[]), false)
  ),
  base as (
    select
      count(*) filter (where stato <> 'annullata') as spedizioni_totali,
      coalesce(sum(costo_totale) filter (where stato <> 'annullata' and created_at >= (select inizio from mese)), 0) as fatturato_mese,
      count(*) filter (where stato = 'consegnata' and created_at >= (select inizio from mese)) as consegnate_mese,
      count(*) filter (where stato = 'consegnata') as consegnate_totali,
      count(*) filter (where stato in ('spedita','in_transito','in_consegna')) as in_transito,
      count(*) filter (where stato = 'in_giacenza') as in_giacenza,
      coalesce(sum(contrassegno) filter (
        where contrassegno > 0
          and stato = 'consegnata'
          and coalesce(stato_contrassegno, '') not in ('pagato', 'annullato')
      ), 0) as cod_da_rimettere
    from sped
  ),
  per_corriere as (
    select corriere_id, count(*) as n from sped
    where stato <> 'annullata'
    group by corriere_id
  ),
  per_cliente as (
    select cliente_id, count(*) as n from sped
    where cliente_id is not null and stato <> 'annullata'
    group by cliente_id
  )
  select json_build_object(
    'spedizioniTotali', b.spedizioni_totali,
    'fatturatoMese',    b.fatturato_mese,
    'consegnateMese',   b.consegnate_mese,
    'consegnateTotali', b.consegnate_totali,
    'inTransito',       b.in_transito,
    'inGiacenza',       b.in_giacenza,
    'codDaRimettere',   b.cod_da_rimettere,
    'clientiTotali',    (select count(*) from clienti where master_id = p_master),
    'sottomaster',      (select count(*) from masters where parent_master_id = p_master),
    'topCorriere',      (select json_build_object('nome', nome, 'n', n) from (
                           select c.nome_contratto as nome, sum(pc.n)::bigint as n
                           from per_corriere pc join corrieri c on c.id = pc.corriere_id
                           group by c.nome_contratto order by n desc, nome limit 1) tc),
    'topCliente',       (select json_build_object('nome', nome, 'n', n) from (
                           select cl.ragione_sociale as nome, sum(pc.n)::bigint as n
                           from per_cliente pc join clienti cl on cl.id = pc.cliente_id
                           group by cl.ragione_sociale order by n desc, nome limit 1) tcl)
  ) from base b;
$function$;

-- Solo il client di servizio: le chiamano soltanto /api/dashboard e /api/moovy, con quello. Prima del
-- 21/11 erano aperte anche ad anon e authenticated (fermate solo da fn_ledger_nascosti, che a loro e'
-- negata): il ripristino non riapre la porta.
grant execute on function public.dashboard_statistiche_master(uuid) to service_role;
grant execute on function public.dashboard_contatori_master(uuid) to service_role;
grant execute on function public.dashboard_kpi_master(uuid) to service_role;
drop trigger if exists trg_riepilogo_spedizioni on public.spedizioni;
drop trigger if exists trg_riepilogo_spedizioni_mod on public.spedizioni;
*/
