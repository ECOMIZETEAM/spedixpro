-- ═══════════════════════════════════════════════════════════════════════════
-- LIMITE DEL PIANO: contatore mensile + verifica della catena
--
-- Il limite del piano non e' mai stato controllato: `abbonamento_limite` veniva solo mostrato.
-- Per controllarlo a ogni spedizione serviva contare le spedizioni del mese di TUTTO il
-- sotto-albero del master — con 500k spedizioni/mese come obiettivo e' una conta impossibile da
-- fare a ogni creazione (era gia' la query piu' costosa del database quando la faceva la sola
-- pagina abbonamento).
--
-- Quindi: un contatore per (master, mese), tenuto aggiornato da un TRIGGER. Il trigger e' la
-- scelta importante — la spedizione nasce oggi da due rotte, ma domani da una terza, e un
-- contatore aggiornato "a mano" nelle rotte si disallinea al primo che se ne dimentica. Cosi'
-- invece e' il database a garantirlo, comprese le annullate che devono tornare indietro.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.contatori_spedizioni (
  master_id uuid not null references public.masters(id) on delete cascade,
  mese      text not null,                       -- 'YYYY-MM' (UTC, come il resto dei conteggi)
  n         integer not null default 0,
  primary key (master_id, mese)
);

alter table public.contatori_spedizioni enable row level security;
revoke all on public.contatori_spedizioni from anon, authenticated;
-- Nessuna policy: la tabella si legge solo dal server (service_role, che salta l'RLS). Il numero
-- arriva all'utente gia' filtrato dalle rotte, che sanno cosa puo' vedere e cosa no.

create or replace function public.fn_conta_spedizione()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  vecchia_valida boolean := false;
  nuova_valida   boolean := false;
  mese_vecchio   text;
  mese_nuovo     text;
begin
  -- "Vale" = conta nel piano. Le annullate no, esattamente come nel conteggio storico.
  if (tg_op = 'UPDATE' or tg_op = 'DELETE') then
    vecchia_valida := old.stato is distinct from 'annullata';
    mese_vecchio   := to_char(old.created_at at time zone 'UTC', 'YYYY-MM');
  end if;
  if (tg_op = 'UPDATE' or tg_op = 'INSERT') then
    nuova_valida := new.stato is distinct from 'annullata';
    mese_nuovo   := to_char(new.created_at at time zone 'UTC', 'YYYY-MM');
  end if;

  if vecchia_valida and (not nuova_valida
      or mese_vecchio is distinct from mese_nuovo
      or old.master_id is distinct from new.master_id) then
    update public.contatori_spedizioni set n = greatest(0, n - 1)
     where master_id = old.master_id and mese = mese_vecchio;
  end if;

  if nuova_valida and (not vecchia_valida
      or mese_vecchio is distinct from mese_nuovo
      or old.master_id is distinct from new.master_id) then
    insert into public.contatori_spedizioni (master_id, mese, n)
    values (new.master_id, mese_nuovo, 1)
    on conflict (master_id, mese) do update set n = contatori_spedizioni.n + excluded.n;
  end if;

  return null;
end $$;

drop trigger if exists trg_conta_spedizione on public.spedizioni;
create trigger trg_conta_spedizione
after insert or delete or update of stato, master_id, created_at on public.spedizioni
for each row execute function public.fn_conta_spedizione();

-- ── Allineamento iniziale: il contatore parte dai dati veri di ogni mese gia' passato ──
insert into public.contatori_spedizioni (master_id, mese, n)
select s.master_id, to_char(s.created_at at time zone 'UTC', 'YYYY-MM'), count(*)
from public.spedizioni s
where s.master_id is not null and s.stato is distinct from 'annullata'
group by 1, 2
on conflict (master_id, mese) do update set n = excluded.n;

-- ═══════════════════════════════════════════════════════════════════════════
-- LA CATENA. Per una spedizione di X si controllano X e TUTTI I MASTER SOPRA, ognuno col
-- proprio limite e col traffico di TUTTA la sua rete (e' quello che ciascuno vede in dashboard:
-- vendo io, ma le spedizioni della mia rete consumano il mio piano).
--
-- Il blocco scende e non sale mai: se X sfonda, si fermano X e chi sta sotto di lui — chi sta
-- sopra ha il suo piano, lo paga, e continua a spedire.
-- Il master principale non ha limite: e' la piattaforma.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_limiti_catena(p_master uuid, p_mese text)
returns table(master_id uuid, nome text, limite integer, usato bigint, livello integer)
language sql
stable
security definer
set search_path = public
as $$
  with recursive catena as (
    select m.id, m.nome, m.parent_master_id, m.abbonamento_limite, 0 as liv
      from public.masters m where m.id = p_master
    union all
    select p.id, p.nome, p.parent_master_id, p.abbonamento_limite, c.liv + 1
      from catena c join public.masters p on p.id = c.parent_master_id
     where c.liv < 20                         -- paracadute contro una gerarchia ad anello
  ),
  sotto as (
    select c.id as radice, c.id as nodo, 0 as liv from catena c
    union all
    select s.radice, f.id, s.liv + 1
      from sotto s join public.masters f on f.parent_master_id = s.nodo
     where s.liv < 20
  )
  select c.id, c.nome, c.abbonamento_limite, coalesce(u.usato, 0), c.liv
    from catena c
    left join lateral (
      select sum(k.n) as usato
        from sotto s
        join public.contatori_spedizioni k on k.master_id = s.nodo and k.mese = p_mese
       where s.radice = c.id
    ) u on true
   where c.parent_master_id is not null      -- il root e' la piattaforma: nessun limite
   order by c.liv;
$$;

revoke all on function public.fn_limiti_catena(uuid, text) from anon, authenticated;
revoke all on function public.fn_conta_spedizione() from anon, authenticated;
