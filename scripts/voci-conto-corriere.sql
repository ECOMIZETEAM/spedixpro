-- VOCI DEL CONTO CON IL CORRIERE, sui contratti PROPRI (Lorenzo, 22/10/2026).
--
-- Il conto di un contratto proprio registra quanto costa il corriere, spedizione per spedizione, e
-- poteva solo scendere: GTS su BRT EXPRESS ITA era a −23.929,91 € il 22/10 (3.188 righe dal 30/07), e
-- le fatture che GTS paga a BRT non c'erano da nessuna parte. "Se ha un debito di 30.000 e paga la
-- fattura di 30.000 come fa a scalarli? altrimenti arriva a 400.000 di debito ma non e' cosi'."
--
-- Quattro voci, scritte SOLO dal master proprietario del contratto (il master sopra il conto proprio
-- non lo vede): pagamento fattura, contrassegni compensati, nota di credito (positive) e costo extra in
-- fattura (negativa: i supplementi che il corriere mette e la piattaforma non conosce). Una voce
-- sbagliata si annulla con la riga opposta: lo storico resta.
--
-- Un pagamento non e' legato a una spedizione, quindi la riga dice A QUALE CONTRATTO appartiene con
-- movimenti.corriere_id (vuota per tutte le righe che esistono gia': nessun percorso di oggi cambia).
-- Tipo 'conto_corriere': i report del guadagno non lo contano (e' un pagamento, non un costo o un ricavo),
-- i controlli della sentinella sul conto proprio si', come ogni riga di quel conto.

alter table public.movimenti add column if not exists corriere_id uuid;
comment on column public.movimenti.corriere_id is
  'Contratto della riga quando non c''e'' una spedizione (voci del conto con il corriere sui contratti propri). Nessuna FK di proposito: un contratto cancellato non deve togliere lo storico.';

create or replace function public.registra_voce_conto_corriere(
  p_master uuid, p_corriere_id uuid, p_voce text, p_importo numeric, p_nota text default null, p_created_by uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_corr record; v_padre uuid; v_nonno uuid; v_segno int; v_desc text; v_saldo numeric; v_id uuid;
begin
  if p_voce not in ('pagamento_fattura', 'cod_compensati', 'nota_credito', 'costo_extra') then
    raise exception 'Voce non valida' using errcode = '22023';
  end if;
  if p_importo is null or p_importo <= 0 or p_importo > 1000000 then
    raise exception 'Importo non valido' using errcode = '22023';
  end if;
  select id, nome_contratto, master_id, coalesce(proprio, false) proprio into v_corr from corrieri where id = p_corriere_id;
  if v_corr.id is null or v_corr.master_id is distinct from p_master or not v_corr.proprio then
    raise exception 'Il contratto non e'' tuo' using errcode = '42501';
  end if;
  -- Il conto proprio c'e' solo con la regola di fn_conto_di: un padre che a sua volta ha un padre. Il vertice
  -- (MULTIEXPRESS) ha i contratti sul conto unico, e li' questa voce non avrebbe un conto dove stare.
  select parent_master_id into v_padre from masters where id = p_master;
  select parent_master_id into v_nonno from masters where id = v_padre;
  if v_padre is null or v_nonno is null then
    raise exception 'Questo master non ha il conto dei contratti propri' using errcode = '22023';
  end if;

  v_segno := case when p_voce = 'costo_extra' then -1 else 1 end;
  v_desc := case p_voce
              when 'pagamento_fattura' then 'Pagamento fattura'
              when 'cod_compensati' then 'Contrassegni compensati'
              when 'nota_credito' then 'Nota di credito'
              else 'Costo extra in fattura' end
            || ' · ' || btrim(v_corr.nome_contratto)
            || coalesce(' · ' || nullif(left(btrim(coalesce(p_nota, '')), 200), ''), '');

  update masters set credito_proprio = round((coalesce(credito_proprio, 0) + v_segno * p_importo)::numeric, 2)
   where id = p_master returning credito_proprio into v_saldo;
  insert into movimenti (master_id, cliente_id, master_target_id, tipo, descrizione, riferimento, importo, saldo_dopo, spedizione_id, created_by, corriere_id)
  values (p_master, null, p_master, 'conto_corriere', v_desc, 'VOCE-' || p_voce, round((v_segno * p_importo)::numeric, 2), v_saldo, null, p_created_by, p_corriere_id)
  returning id into v_id;
  -- trg_conto_movimento mette il conto da fn_conto_di, che senza spedizione dice 'rete': questa riga sta sul
  -- conto del contratto, come il saldo che ha appena mosso.
  update movimenti set conto = 'proprio' where id = v_id;
  return v_id;
end;
$$;

create or replace function public.storna_voce_conto_corriere(p_master uuid, p_movimento uuid, p_created_by uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_m record; v_saldo numeric; v_id uuid;
begin
  -- La riga si blocca: due annulli insieme della stessa voce passano uno alla volta, e il secondo trova il primo.
  select * into v_m from movimenti where id = p_movimento for update;
  if v_m.id is null or v_m.master_target_id is distinct from p_master or v_m.tipo <> 'conto_corriere'
     or coalesce(v_m.riferimento, '') not like 'VOCE-%' then
    raise exception 'Voce non trovata' using errcode = '22023';
  end if;
  if exists (select 1 from movimenti where riferimento = 'STORNOVOCE-' || p_movimento) then
    raise exception 'Voce gia'' annullata' using errcode = '22023';
  end if;
  update masters set credito_proprio = round((coalesce(credito_proprio, 0) - v_m.importo)::numeric, 2)
   where id = p_master returning credito_proprio into v_saldo;
  insert into movimenti (master_id, cliente_id, master_target_id, tipo, descrizione, riferimento, importo, saldo_dopo, spedizione_id, created_by, corriere_id)
  values (p_master, null, p_master, 'conto_corriere', 'Annullata: ' || v_m.descrizione, 'STORNOVOCE-' || p_movimento, -v_m.importo, v_saldo, null, p_created_by, v_m.corriere_id)
  returning id into v_id;
  update movimenti set conto = 'proprio' where id = v_id;
  return v_id;
end;
$$;

revoke all on function public.registra_voce_conto_corriere(uuid, uuid, text, numeric, text, uuid) from public, anon, authenticated;
revoke all on function public.storna_voce_conto_corriere(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.registra_voce_conto_corriere(uuid, uuid, text, numeric, text, uuid) to service_role;
grant execute on function public.storna_voce_conto_corriere(uuid, uuid, uuid) to service_role;

-- LE SEZIONI DEI CONTRATTI PROPRI LEGGONO ANCHE LE VOCI: il contratto di una riga e' quello della sua
-- spedizione, oppure (se non ne ha) quello scritto sulla riga. Per le righe di oggi corriere_id e' vuota:
-- il risultato non cambia.
create or replace function public.movimenti_sezioni_proprio_v1(p_master uuid)
returns table(chiave text, n bigint, somma numeric)
language sql
stable
set search_path = public
as $$
  select lower(btrim(coalesce(c.nome_contratto, ''))), count(*)::bigint, coalesce(sum(m.importo), 0)::numeric
    from movimenti m
    left join spedizioni s on s.id = m.spedizione_id
    left join corrieri c on c.id = coalesce(s.corriere_id, m.corriere_id)
   where m.master_target_id = p_master and m.conto = 'proprio' and m.tipo <> 'commissione'
   group by 1
$$;

create or replace function public.movimenti_sezione_v1(
  p_master uuid,
  p_sezione text,                       -- 'rete' | 'commissioni' | 'ledger' | 'proprio' | 'altri'
  p_ledger uuid default null,           -- solo 'ledger'
  p_nome text default null,             -- solo 'proprio': nome contratto gia' trim + minuscolo
  p_cerca text default null,
  p_corriere_nome text default null,    -- filtro corriere (sezioni rete/ledger)
  p_corriere_ids uuid[] default null,   -- filtro gruppo di E&A (sezione rete)
  p_offset integer default 0,
  p_limit integer default 25
) returns table(
  id uuid, created_at timestamptz, tipo text, descrizione text, riferimento text,
  importo numeric, saldo numeric, spedizione_id uuid, corriere text, totale bigint, somma numeric
)
language plpgsql
stable
set search_path = public
as $$
#variable_conflict use_column
declare
  v_cerca text := nullif(btrim(coalesce(p_cerca, '')), '');
  v_corr text := nullif(btrim(coalesce(p_corriere_nome, '')), '');
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_tot bigint;
  v_somma numeric;
begin
  if p_sezione in ('proprio', 'altri') then
    return query
    with sez as (
      select m.id as mid, m.created_at as mcreated, m.tipo as mtipo, m.descrizione as mdescr,
             m.riferimento as mrif, m.importo as mimp, m.spedizione_id as msped, c.nome_contratto as mcorr,
             sum(m.importo) over (order by m.created_at, m.id rows between unbounded preceding and current row) as mprog
        from movimenti m
        left join spedizioni s on s.id = m.spedizione_id
        -- il contratto della spedizione, oppure quello scritto sulla riga (voci del conto con il corriere)
        left join corrieri c on c.id = coalesce(s.corriere_id, m.corriere_id)
       where m.master_target_id = p_master
         and m.conto = 'proprio'
         and m.tipo <> 'commissione'
         and (
           (p_sezione = 'proprio' and lower(btrim(c.nome_contratto)) = p_nome)
           or (p_sezione = 'altri' and not exists (
                 select 1 from corrieri cp
                  where cp.master_id = p_master and cp.proprio
                    and lower(btrim(cp.nome_contratto)) = lower(btrim(c.nome_contratto))))
         )
    ), f as (
      select * from sez
       where v_cerca is null or sez.mdescr ilike '%' || v_cerca || '%' or sez.mrif ilike '%' || v_cerca || '%'
    )
    select f.mid, f.mcreated, f.mtipo, f.mdescr, f.mrif, f.mimp, round(f.mprog, 2), f.msped, f.mcorr,
           count(*) over ()::bigint, coalesce(sum(f.mimp) over (), 0)::numeric
      from f
     order by f.mcreated desc, f.mid desc
    offset v_off limit v_lim;
    return;
  end if;

  if p_sezione = 'ledger' then
    if p_ledger is null then return; end if;
    select count(*), coalesce(sum(m.importo), 0) into v_tot, v_somma
      from movimenti m
     where m.cliente_id = p_ledger
       and (v_cerca is null or m.descrizione ilike '%' || v_cerca || '%' or m.riferimento ilike '%' || v_cerca || '%')
       and (v_corr is null or exists (select 1 from spedizioni s join corrieri c on c.id = s.corriere_id
                                       where s.id = m.spedizione_id and c.nome_contratto = v_corr));
    return query
    select m.id, m.created_at, m.tipo, m.descrizione, m.riferimento, m.importo, m.saldo_dopo, m.spedizione_id,
           (select c.nome_contratto from spedizioni s join corrieri c on c.id = s.corriere_id where s.id = m.spedizione_id),
           v_tot, v_somma
      from movimenti m
     where m.cliente_id = p_ledger
       and (v_cerca is null or m.descrizione ilike '%' || v_cerca || '%' or m.riferimento ilike '%' || v_cerca || '%')
       and (v_corr is null or exists (select 1 from spedizioni s join corrieri c on c.id = s.corriere_id
                                       where s.id = m.spedizione_id and c.nome_contratto = v_corr))
     order by m.created_at desc, m.id desc
    offset v_off limit v_lim;
    return;
  end if;

  if p_sezione not in ('rete', 'commissioni') then return; end if;
  select count(*), coalesce(sum(m.importo), 0) into v_tot, v_somma
    from movimenti m
   where m.master_target_id = p_master
     and ((p_sezione = 'rete' and m.conto = 'rete' and m.tipo <> 'commissione')
          or (p_sezione = 'commissioni' and m.tipo = 'commissione'))
     and (v_cerca is null or m.descrizione ilike '%' || v_cerca || '%' or m.riferimento ilike '%' || v_cerca || '%')
     and (v_corr is null or exists (select 1 from spedizioni s join corrieri c on c.id = s.corriere_id
                                     where s.id = m.spedizione_id and c.nome_contratto = v_corr))
     and (p_corriere_ids is null or exists (select 1 from spedizioni s
                                             where s.id = m.spedizione_id and s.corriere_id = any(p_corriere_ids)));
  return query
  select m.id, m.created_at, m.tipo, m.descrizione, m.riferimento, m.importo, m.saldo_dopo, m.spedizione_id,
         (select c.nome_contratto from spedizioni s join corrieri c on c.id = s.corriere_id where s.id = m.spedizione_id),
         v_tot, v_somma
    from movimenti m
   where m.master_target_id = p_master
     and ((p_sezione = 'rete' and m.conto = 'rete' and m.tipo <> 'commissione')
          or (p_sezione = 'commissioni' and m.tipo = 'commissione'))
     and (v_cerca is null or m.descrizione ilike '%' || v_cerca || '%' or m.riferimento ilike '%' || v_cerca || '%')
     and (v_corr is null or exists (select 1 from spedizioni s join corrieri c on c.id = s.corriere_id
                                     where s.id = m.spedizione_id and c.nome_contratto = v_corr))
     and (p_corriere_ids is null or exists (select 1 from spedizioni s
                                             where s.id = m.spedizione_id and s.corriere_id = any(p_corriere_ids)))
   order by m.created_at desc, m.id desc
  offset v_off limit v_lim;
end;
$$;
