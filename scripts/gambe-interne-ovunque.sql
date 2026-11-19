-- ═══════════════════════════════════════════════════════════════════════════
-- GAMBE INTERNE: UN PACCO SI CONTA E SI MOSTRA UNA VOLTA SOLA, DAPPERTUTTO
--
-- Un pacco che passa da un contratto condiviso ha una riga di `spedizioni` per ogni master che lo
-- rivende ("gamba"), tutte con lo stesso tracking. Una gamba si riconosce dal cliente: e' il conto
-- ingrosso (corrieri_condivisi.cliente_ledger_id) del master che compra.
--
-- LA REGOLA, una sola: per chi guarda la rete di un master, una gamba e' un doppione quando il
-- master che l'ha COMPRATA sta in quella rete — il pacco e' gia' li', dove e' nato. Se il compratore
-- sta fuori, la gamba e' traffico che la rete rivende, e si vede.
--
-- Il 19/11/2026 la home di MULTIEXPRESS diceva 233.977 spedizioni a novembre (pacchi veri ~120.000),
-- 1.474.587 € di volume del mese (~621.000 € erano gambe), 864.341 € di contrassegni da rimettere
-- (~497.000 € contati due o tre volte) e come primo cliente "Wave ship (ingrosso)" con 99.191
-- spedizioni: il conto con cui Wave compra da LOGIXIA, non un cliente.
--
-- Prima esistevano due regole: il contatore del piano (scripts/limite-piano-gambe.sql) e, nelle
-- pagine, "non vedo le gambe di chi mi vende" (catena dei fornitori, solo condivisioni attive). La
-- seconda lasciava doppi i pacchi venduti fra due master della stessa rete (GTS a spedizioni 2000,
-- SEMPLICE SPEDIRE ad Atlantik, Velox a SEMPLICE SPEDIRE) e, con le condivisioni revocate, avrebbe
-- fatto ricomparire le gambe vecchie. Risalire la catena sbaglia anche quando un fornitore e' il
-- padre: a SPEDIZIONI EXPRESS avrebbe nascosto le sue stesse vendite a Velox. Ora la regola sta
-- qui, e le pagine la chiedono al database (lib/gambe-visibilita.ts).
-- ═══════════════════════════════════════════════════════════════════════════

-- I conti ingrosso dei compratori che stanno nella rete data. Anche le condivisioni revocate: le
-- gambe nate prima della revoca restano doppioni.
create or replace function public.fn_ledger_interni(p_rete uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct cc.cliente_ledger_id), '{}'::uuid[])
    from public.corrieri_condivisi cc
   where cc.cliente_ledger_id is not null
     and cc.master_id = any(p_rete);
$$;

-- Gli stessi, per la rete di un master (lui e tutto quello che ha sotto).
create or replace function public.fn_ledger_nascosti(p_master uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with recursive sotto as (
    select p_master as id, 0 as liv
    union all
    select f.id, s.liv + 1
      from sotto s join public.masters f on f.parent_master_id = s.id
     where s.liv < 20                         -- paracadute contro una gerarchia ad anello
  )
  select public.fn_ledger_interni(array(select id from sotto));
$$;

revoke all on function public.fn_ledger_interni(uuid[]) from public, anon, authenticated;
revoke all on function public.fn_ledger_nascosti(uuid) from public, anon, authenticated;
grant execute on function public.fn_ledger_interni(uuid[]) to service_role;
grant execute on function public.fn_ledger_nascosti(uuid) to service_role;

-- ── HOME DEL MASTER ──────────────────────────────────────────────────────────
-- `not coalesce(cliente_id = any(...), false)`: un `<> all(...)` scarterebbe anche le righe senza
-- cliente (le spedizioni del master stesso), perche' su un cliente nullo non da' vero.
create or replace function public.dashboard_contatori_master(p_master uuid)
returns json
language sql
stable
set search_path to 'public'
as $function$
  with recursive rete as (
    select p_master as id
    union all
    select m.id from masters m join rete r on m.parent_master_id = r.id
  ),
  gambe as (select public.fn_ledger_nascosti(p_master) as ids),
  -- not materialized: ogni conteggio resta la sua lettura sull'indice, come prima. Materializzata,
  -- la rete di MULTIEXPRESS (centinaia di migliaia di righe) finirebbe copiata in memoria.
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

create or replace function public.dashboard_kpi_master(p_master uuid)
returns json
language sql
stable
set search_path to 'public'
as $function$
  with recursive rete as (
    select p_master as id
    union all
    select m.id from masters m join rete r on m.parent_master_id = r.id
  ),
  gambe as (select public.fn_ledger_nascosti(p_master) as ids),
  mese as (select date_trunc('month', now()) as inizio),
  -- Solo le colonne che servono, e not materialized: tre letture come prima (vedi sopra).
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

create or replace function public.dashboard_statistiche_master(p_master uuid)
returns json
language sql
stable
set search_path to 'public'
as $function$
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

-- ── WIDGET DESTINAZIONI ──────────────────────────────────────────────────────
-- Vista cliente (p_cliente_ids): le sue spedizioni, nessuna gamba. Vista rete (p_master_ids): via le
-- gambe interne a quella rete.
create or replace function public.fn_destinazioni(p_master_ids uuid[] default null::uuid[], p_cliente_ids uuid[] default null::uuid[], p_giorni integer default 30)
returns table(tipo text, chiave text, n bigint)
language sql
stable security definer
set search_path to 'public'
as $function$
  WITH s AS (
    SELECT dest_provincia, dest_paese
    FROM public.spedizioni
    WHERE created_at >= now() - make_interval(days => p_giorni)
      AND cancellata_il IS NULL
      AND (
        (p_cliente_ids IS NOT NULL AND cliente_id = ANY(p_cliente_ids))
        OR (p_cliente_ids IS NULL AND p_master_ids IS NOT NULL AND master_id = ANY(p_master_ids)
            AND NOT coalesce(cliente_id = ANY((SELECT public.fn_ledger_interni(p_master_ids))::uuid[]), false))
      )
  )
  SELECT 'provincia'::text, upper(trim(dest_provincia)), count(*)::bigint
    FROM s
    WHERE dest_provincia IS NOT NULL AND length(trim(dest_provincia)) = 2
      AND (dest_paese IS NULL OR trim(dest_paese) = '' OR upper(trim(dest_paese)) = 'IT')
    GROUP BY upper(trim(dest_provincia))
  UNION ALL
  SELECT 'paese'::text, upper(trim(dest_paese)), count(*)::bigint
    FROM s
    WHERE dest_paese IS NOT NULL AND trim(dest_paese) <> ''
    GROUP BY upper(trim(dest_paese));
$function$;

-- ── STATISTICHE → CORRIERI ───────────────────────────────────────────────────
create or replace function public.stat_corrieri_v2(p_sub uuid[], p_master uuid, p_dal timestamp with time zone, p_al timestamp with time zone, p_contratti text[] default null::text[])
returns table(corriere text, spedizioni bigint, costo numeric, peso numeric, consegnate bigint, resi bigint, transito_sum numeric, transito_n bigint, assic numeric, cod numeric, serv numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
  with sped as (
    select s.id, s.stato, coalesce(s.peso_reale,0) peso, coalesce(s.contrassegno,0) cod,
      coalesce(s.assicurazione,0) assic, s.servizi_accessori, coalesce(s.costo_spedizione,0) costo_sped,
      coalesce(co.proprio,false) proprio, coalesce(co.nome_contratto,'—') corriere,
      case when s.stato='consegnata' and s.updated_at is not null and s.created_at is not null
        then extract(epoch from (s.updated_at - s.created_at))/86400.0 end giorni
    from spedizioni s left join corrieri co on co.id=s.corriere_id
    where s.master_id = any(p_sub) and s.created_at >= p_dal and s.created_at <= p_al and s.stato <> 'annullata'
      and (p_contratti is null or trim(coalesce(co.nome_contratto,'')) = any(p_contratti))
      and not coalesce(s.cliente_id = any((select public.fn_ledger_interni(p_sub))::uuid[]), false)
  ),
  cm as (
    select m.spedizione_id, -sum(m.importo) costo
    from movimenti m where m.master_target_id=p_master and m.cliente_id is null
      and m.tipo in ('spedizione','rettifica','reso','giacenza','rimborso')
      and m.spedizione_id in (select id from sped)
    group by m.spedizione_id
  )
  select s.corriere, count(*)::bigint,
    coalesce(sum(case when s.proprio then s.costo_sped else coalesce(cm.costo, s.costo_sped) end),0)::numeric,
    coalesce(sum(s.peso),0)::numeric,
    count(*) filter (where s.stato='consegnata')::bigint,
    count(*) filter (where s.stato='reso_mittente')::bigint,
    coalesce(sum(s.giorni) filter (where s.giorni>0 and s.giorni<60),0)::numeric,
    count(*) filter (where s.giorni>0 and s.giorni<60)::bigint,
    coalesce(sum(s.assic),0)::numeric, coalesce(sum(s.cod),0)::numeric,
    coalesce(sum((select coalesce(sum((x->>'importo')::numeric),0) from jsonb_array_elements(case when jsonb_typeof(s.servizi_accessori)='array' then s.servizi_accessori else '[]'::jsonb end) x)),0)::numeric
  from sped s left join cm on cm.spedizione_id=s.id
  group by s.corriere;
$function$;

-- ── STATISTICHE → CONTRASSEGNI ───────────────────────────────────────────────
create or replace function public.contrassegni_dettaglio_v2(p_sub uuid[], p_dal timestamp with time zone, p_al timestamp with time zone, p_contratti text[] default null::text[])
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare res jsonb;
begin
  execute format($q$
    with sp as (
      select coalesce(s.contrassegno,0) imp, (s.stato_contrassegno='pagato') pagato,
        coalesce(cl.ragione_sociale,'—') cli, coalesce(co.nome_contratto,'—') corr
      from spedizioni s
      left join clienti cl on cl.id = s.cliente_id
      left join corrieri co on co.id = s.corriere_id
      where s.master_id = any(%1$L::uuid[]) and s.contrassegno > 0
        and s.created_at >= %2$L::timestamptz and s.created_at <= %3$L::timestamptz
        and coalesce(s.stato,'') <> 'annullata' and coalesce(s.stato_contrassegno,'') <> 'annullato'
        and (%4$L::text[] is null or trim(coalesce(co.nome_contratto,'')) = any(%4$L::text[]))
        and not coalesce(s.cliente_id = any(%5$L::uuid[]), false)
    ),
    aperto as (
      select coalesce(s.contrassegno,0) imp, (s.stato='consegnata') consegnata,
        coalesce(cl.ragione_sociale,'—') cli, s.numero,
        floor(extract(epoch from (now()-s.created_at))/86400)::int giorni
      from spedizioni s
      left join clienti cl on cl.id = s.cliente_id
      left join corrieri co on co.id = s.corriere_id
      where s.master_id = any(%1$L::uuid[]) and s.contrassegno > 0
        and coalesce(s.stato,'') <> 'annullata' and coalesce(s.stato_contrassegno,'') <> 'annullato'
        and coalesce(s.stato_contrassegno,'') <> 'pagato'
        and (%4$L::text[] is null or trim(coalesce(co.nome_contratto,'')) = any(%4$L::text[]))
        and not coalesce(s.cliente_id = any(%5$L::uuid[]), false)
    )
    select jsonb_build_object(
      'kpi', jsonb_build_object(
        'totale', (select round(coalesce(sum(imp),0)::numeric,2) from sp),
        'rimesso', (select round(coalesce(sum(imp) filter (where pagato),0)::numeric,2) from sp),
        'inAttesa', (select round(coalesce(sum(imp) filter (where not pagato),0)::numeric,2) from sp),
        'esposizione', (select round(coalesce(sum(imp) filter (where consegnata),0)::numeric,2) from aperto)
      ),
      'perCorriere', coalesce((select jsonb_agg(jsonb_build_object('corriere',corr,'importo',round(tot::numeric,2)) order by tot desc)
        from (select corr, sum(imp) tot from sp group by corr) z),'[]'::jsonb),
      'aging', jsonb_build_array(
        jsonb_build_object('fascia','0-7','importo',(select round(coalesce(sum(imp) filter (where giorni<=7),0)::numeric,2) from aperto)),
        jsonb_build_object('fascia','8-15','importo',(select round(coalesce(sum(imp) filter (where giorni>7 and giorni<=15),0)::numeric,2) from aperto)),
        jsonb_build_object('fascia','16-30','importo',(select round(coalesce(sum(imp) filter (where giorni>15 and giorni<=30),0)::numeric,2) from aperto)),
        jsonb_build_object('fascia','30+','importo',(select round(coalesce(sum(imp) filter (where giorni>30),0)::numeric,2) from aperto))
      ),
      'perCliente', coalesce((select jsonb_agg(jsonb_build_object('nome',cli,'num',num,'totale',round(tot::numeric,2),'attesa',round(att::numeric,2)) order by tot desc)
        from (select cli, count(*) num, sum(imp) tot, sum(imp) filter (where not pagato) att from sp group by cli order by sum(imp) desc limit 50) z),'[]'::jsonb),
      'vecchi', coalesce((select jsonb_agg(jsonb_build_object('ldv',numero,'cliente',cli,'importo',round(imp::numeric,2),'giorni',giorni) order by giorni desc)
        from (select numero, cli, imp, giorni from aperto order by giorni desc limit 100) z),'[]'::jsonb)
    )
  $q$, p_sub, p_dal, p_al, p_contratti, public.fn_ledger_interni(p_sub)) into res;
  return res;
end;
$function$;
