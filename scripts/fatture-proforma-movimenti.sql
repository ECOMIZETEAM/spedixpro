-- UN MOVIMENTO IN UNA PROFORMA SOLA (27/11/2026).
-- M.C LOGISTICA ha creato proforme su periodi gia' coperti e dentro sono tornate le stesse spedizioni: la
-- N.1/2026 di IN PUNTA DI PIEDI CASORIA (01/10-06/11, 334 movimenti, 1.573,19 €) e' finita intera anche nella
-- N.3, nella N.5 e nella N.7; la spedizione NN669272475 stava in quattro proforme. La proforma prendeva tutti
-- i movimenti del periodo e non scriveva da nessuna parte quali aveva usato.
--
-- Qui si scrive. La chiave e' il movimento: lo stesso movimento non puo' stare in due proforme, e lo garantisce
-- il database, non la pagina. Cancellare una proforma libera i suoi movimenti (on delete cascade): e' il caso
-- in cui il master la rifa'.

create table if not exists public.fatture_proforma_movimenti (
  movimento_id uuid primary key,
  proforma_id uuid not null references public.fatture_proforma(id) on delete cascade,
  master_id uuid not null,
  cliente_id uuid not null,
  -- il giorno del movimento: la proforma cerca i legami del cliente nel suo periodo, non tutti i suoi
  movimento_creato timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_proforma_mov_cliente on public.fatture_proforma_movimenti (cliente_id, movimento_creato);
create index if not exists idx_proforma_mov_proforma on public.fatture_proforma_movimenti (proforma_id);

alter table public.fatture_proforma_movimenti enable row level security;
revoke all on table public.fatture_proforma_movimenti from public, anon, authenticated;
grant all on table public.fatture_proforma_movimenti to service_role;

-- Lega i movimenti a una proforma, tutti o nessuno. Cliente, master e giorno si leggono dal movimento, non
-- arrivano da fuori: un id che non e' un movimento del cliente di quella proforma (gamba del cliente) ferma
-- tutto. Un movimento gia' in un'altra proforma ferma tutto con 23505 (chiave doppia): la rotta lo dice al
-- master e toglie la proforma appena creata.
create or replace function public.fatture_proforma_lega_v1(p_proforma uuid, p_movimenti uuid[])
returns integer
language plpgsql
volatile
set search_path = public
as $$
declare
  v_attesi integer;
  v_legati integer;
begin
  select count(distinct x) into v_attesi from unnest(coalesce(p_movimenti, '{}'::uuid[])) as u(x);
  insert into fatture_proforma_movimenti (movimento_id, proforma_id, master_id, cliente_id, movimento_creato)
  select m.id, p.id, p.master_id, p.cliente_id, m.created_at
    from (select distinct x from unnest(coalesce(p_movimenti, '{}'::uuid[])) as u(x)) u
    join movimenti m on m.id = u.x
    join fatture_proforma p on p.id = p_proforma
   where m.cliente_id = p.cliente_id
     and m.master_id = p.master_id
     and m.master_target_id is null;
  get diagnostics v_legati = row_count;
  if v_legati <> v_attesi then
    raise exception 'movimenti non collegabili alla proforma %: % su %', p_proforma, v_legati, v_attesi;
  end if;
  return v_legati;
end
$$;

revoke all on function public.fatture_proforma_lega_v1(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.fatture_proforma_lega_v1(uuid, uuid[]) to service_role;
