-- =============================================================================
-- Ottimizzazioni performance DB + strumenti load test
-- Già applicate sul progetto Supabase. Qui versionate per riproducibilità.
-- =============================================================================

-- 1) INDICI COMPOSITI per i contatori dashboard (master/cliente + stato + data).
--    Senza questi, i conteggi filtrati per stato leggono l'heap: ~450ms a 300k righe.
--    Con questi: index scan puro, ~5-55ms.
create index if not exists idx_sped_master_stato_created
  on spedizioni (master_id, stato, created_at desc);
create index if not exists idx_sped_cliente_stato_created
  on spedizioni (cliente_id, stato, created_at desc);

-- 2) FUNZIONI CONTATORI DASHBOARD (1 round-trip invece di 5+4 count separati).
--    Usate da app/api/dashboard e app/api/cliente/dashboard.
create or replace function dashboard_contatori_master(p_master uuid)
returns json language sql stable as $$
  select json_build_object(
    'totClienti',    (select count(*) from clienti   where master_id = p_master),
    'spedizioniMese',(select count(*) from spedizioni where master_id = p_master and created_at >= date_trunc('month', now())),
    'spediteOggi',   (select count(*) from spedizioni where master_id = p_master and created_at >= date_trunc('day', now()) and stato = 'spedita'),
    'daSpedire',     (select count(*) from spedizioni where master_id = p_master and created_at >= now() - interval '30 days' and stato = 'in_lavorazione'),
    'inLavorazione', (select count(*) from spedizioni where master_id = p_master and created_at >= now() - interval '30 days' and stato in ('in_lavorazione','spedita'))
  );
$$;

create or replace function dashboard_contatori_cliente(p_cliente uuid)
returns json language sql stable as $$
  select json_build_object(
    'spedizioniMese',(select count(*) from spedizioni where cliente_id = p_cliente and created_at >= date_trunc('month', now())),
    'spediteOggi',   (select count(*) from spedizioni where cliente_id = p_cliente and created_at >= date_trunc('day', now()) and stato = 'spedita'),
    'daSpedire',     (select count(*) from spedizioni where cliente_id = p_cliente and created_at >= now() - interval '30 days' and stato = 'in_lavorazione'),
    'inLavorazione', (select count(*) from spedizioni where cliente_id = p_cliente and created_at >= now() - interval '30 days' and stato in ('in_lavorazione','spedita'))
  );
$$;

-- 2b) FUNZIONI STATISTICHE DASHBOARD (aggregazione mensile + stati 30gg nel DB,
--     invece di scaricare le righe grezze: PostgREST le limita a 1000 → totali falsati).
create or replace function dashboard_statistiche_master(p_master uuid)
returns json language sql stable as $$
  select json_build_object(
    'mensili', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
        select to_char(date_trunc('month', created_at), 'Mon YY') as mese,
               count(*) as totale, coalesce(sum(costo_totale),0) as importo
        from spedizioni
        where master_id = p_master and created_at >= date_trunc('month', now()) - interval '12 months'
        group by date_trunc('month', created_at) order by date_trunc('month', created_at)
      ) t
    ),
    'stati30', (
      select coalesce(json_object_agg(stato, n), '{}'::json) from (
        select stato, count(*) n from spedizioni
        where master_id = p_master and created_at >= now() - interval '30 days' group by stato
      ) s
    )
  );
$$;

create or replace function dashboard_statistiche_cliente(p_cliente uuid)
returns json language sql stable as $$
  select json_build_object(
    'mensili', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
        select to_char(date_trunc('month', created_at), 'Mon YY') as mese,
               count(*) as totale, coalesce(sum(costo_totale),0) as importo
        from spedizioni
        where cliente_id = p_cliente and created_at >= date_trunc('month', now()) - interval '12 months'
        group by date_trunc('month', created_at) order by date_trunc('month', created_at)
      ) t
    ),
    'stati30', (
      select coalesce(json_object_agg(stato, n), '{}'::json) from (
        select stato, count(*) n from spedizioni
        where cliente_id = p_cliente and created_at >= now() - interval '30 days' group by stato
      ) s
    )
  );
$$;

-- 3) SEED / CLEANUP per il load test a volume (righe marcate 'LOADTEST-%').
--    Esempio: select seed_spedizioni_test(50000, '<cliente_id>', '<corriere_id>');
--    Pulizia: select cleanup_spedizioni_test();
create or replace function seed_spedizioni_test(p_n int, p_cliente uuid, p_corriere uuid)
returns int language plpgsql as $$
declare
  v_master uuid;
  v_stati text[] := array['consegnata','consegnata','consegnata','spedita','in_transito','in_lavorazione','in_giacenza'];
begin
  select master_id into v_master from clienti where id = p_cliente;
  if v_master is null then raise exception 'cliente non valido'; end if;
  insert into spedizioni (
    master_id, cliente_id, corriere_id, numero,
    mitt_nome, mitt_indirizzo, mitt_citta, mitt_provincia, mitt_cap,
    dest_nome, dest_indirizzo, dest_citta, dest_cap,
    stato, colli, contrassegno, costo_totale, tracking_number, created_at
  )
  select
    v_master, p_cliente, p_corriere, 'LOADTEST-' || gen_random_uuid(),
    'Mittente Test', 'Via Test 1', 'Milano', 'MI', '20100',
    'Destinatario ' || g, 'Via Dest ' || g, 'Roma', '00100',
    v_stati[1 + floor(random()*array_length(v_stati,1))::int],
    1 + floor(random()*3)::int,
    (floor(random()*2)::int) * round((random()*100)::numeric, 2),
    round((5 + random()*20)::numeric, 2),
    'LT' || lpad(floor(random()*1e9)::bigint::text, 10, '0'),
    now() - (random()*365) * interval '1 day' - (random()*24) * interval '1 hour'
  from generate_series(1, p_n) g;
  return p_n;
end;
$$;

create or replace function cleanup_spedizioni_test()
returns int language plpgsql as $$
declare v_n int;
begin
  delete from spedizioni where numero like 'LOADTEST-%';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
