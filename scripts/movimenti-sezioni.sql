-- LISTA MOVIMENTI A SEZIONI: un conto, una lista.
--
-- Un master puo' avere piu' conti: quello verso il padre (masters.credito), uno presso ogni master che
-- gli vende un contratto per codice (il ledger "(ingrosso)", clienti.credito), i costi dei suoi
-- contratti propri (masters.credito_proprio) e le commissioni MoovExpress. La lista li mescolava:
-- sotto "Credito · MULTIEXPRESS −0,57" Wave vedeva le sue spedizioni GLS col saldo del conto proprio
-- (−318,74). Qui ogni sezione legge SOLO il suo conto.
--
-- I contratti propri hanno un saldo solo (credito_proprio) per tutti, quindi la sezione di UN contratto
-- non ha un saldo scritto: il progressivo si calcola sui movimenti di quella sezione. L'appartenenza al
-- contratto e' la stessa regola di fn_conto_di (nome del contratto della spedizione, trim + minuscolo):
-- e' quella che ha messo il movimento sul conto proprio, e regge anche le spedizioni dei sotto-master
-- fatte su una COPIA del contratto (la riga corrieri e' la loro, il nome e' lo stesso).
--
-- Sola lettura. SECURITY INVOKER e chiamabile solo dal servizio: la rotta decide il master (quello
-- loggato) e il ledger (solo fra i suoi legami in corrieri_condivisi), mai il client.

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
        left join corrieri c on c.id = s.corriere_id
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

-- Quanto c'e' in ogni contratto proprio: le card delle sezioni. Chiave = nome del contratto della
-- spedizione, trim + minuscolo (la regola di fn_conto_di).
create or replace function public.movimenti_sezioni_proprio_v1(p_master uuid)
returns table(chiave text, n bigint, somma numeric)
language sql
stable
set search_path = public
as $$
  select lower(btrim(coalesce(c.nome_contratto, ''))), count(*)::bigint, coalesce(sum(m.importo), 0)::numeric
    from movimenti m
    left join spedizioni s on s.id = m.spedizione_id
    left join corrieri c on c.id = s.corriere_id
   where m.master_target_id = p_master and m.conto = 'proprio' and m.tipo <> 'commissione'
   group by 1
$$;

revoke all on function public.movimenti_sezione_v1(uuid, text, uuid, text, text, text, uuid[], integer, integer) from public, anon, authenticated;
revoke all on function public.movimenti_sezioni_proprio_v1(uuid) from public, anon, authenticated;
grant execute on function public.movimenti_sezione_v1(uuid, text, uuid, text, text, text, uuid[], integer, integer) to service_role;
grant execute on function public.movimenti_sezioni_proprio_v1(uuid) to service_role;
