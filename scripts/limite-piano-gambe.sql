-- ═══════════════════════════════════════════════════════════════════════════
-- LIMITE DEL PIANO: UN PACCO CONTA UNA VOLTA SOLA PER OGNI MASTER
--
-- Il contatore (scripts/limite-piano.sql) aggiunge 1 per ogni riga di `spedizioni`. Ma un pacco
-- che passa da un contratto condiviso ha piu' righe — una "gamba" per ogni master che lo rivende,
-- tutte con lo stesso tracking — e quando quelle gambe stanno nella stessa rete, il master in cima
-- se lo ritrovava contato due o tre volte.
--
-- Successo davvero: a novembre 2026 MULTIEXPRESS risultava a 232.602 spedizioni su 250.000, e
-- stava per essere chiuso fuori dal portale; i pacchi veri erano circa 119.750. Es. 282343J096790:
-- una riga di spedizioni 2000 (il cliente vero), una di Wave sul conto "MULTIEXPRESS (ingrosso)",
-- una di LOGIXIA sul conto "Wave ship (ingrosso)" — tre righe, tutte sotto MULTIEXPRESS. Il doppio
-- c'era gia' da ottobre (219.223 contate, ~132.400 vere): la "crescita" che ha fatto nascere i
-- piani da 200K e 250K era in gran parte questo.
--
-- La regola: un pacco conta una volta per ogni master. Una gamba si riconosce dal cliente: e' il
-- conto ingrosso (corrieri_condivisi.cliente_ledger_id) del master che compra. Per un master X la
-- gamba e' un doppione solo se SIA il master della gamba SIA il compratore stanno nella rete di X:
-- allora X ha gia' contato il pacco dove e' nato. Se ne sta dentro solo uno dei due, per X quella
-- gamba e' traffico che rivende, e conta (Wave continua a vedere i pacchi che vende a MULTIEXPRESS,
-- LOGIXIA quelli che vende a Wave).
--
-- Per non contare le spedizioni a ogni creazione, le gambe hanno un loro contatore per
-- (master della gamba, compratore, mese), tenuto dallo STESSO trigger del contatore principale.
-- Il contatore principale non cambia: si sottrae dove si legge, in fn_usato_rete.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- Se qualcuno sta scrivendo spedizioni non si resta in coda a bloccare tutti: si rinuncia e si riprova.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.contatori_gambe (
  master_id     uuid not null references public.masters(id) on delete cascade,  -- chi ha la gamba (vende)
  acquirente_id uuid not null references public.masters(id) on delete cascade,  -- chi la compra
  mese          text not null,                                                   -- 'YYYY-MM' UTC, come il contatore principale
  n             integer not null default 0,
  primary key (master_id, acquirente_id, mese)
);

alter table public.contatori_gambe enable row level security;
revoke all on public.contatori_gambe from public, anon, authenticated;
-- Nessuna policy: come contatori_spedizioni, si legge solo dal server.

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
  acq_vecchio    uuid;
  acq_nuovo      uuid;
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

  -- Il caso di gran lunga piu' frequente: il tracking sposta lo stato fra due stati che contano
  -- entrambi. Nessun conteggio cambia, e non si va a cercare il compratore a ogni aggiornamento.
  if tg_op = 'UPDATE' and vecchia_valida = nuova_valida
     and mese_vecchio = mese_nuovo
     and old.master_id is not distinct from new.master_id
     and old.cliente_id is not distinct from new.cliente_id then
    return null;
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

  -- GAMBE: la riga e' sul conto ingrosso di un altro master → e' la gamba di un pacco che quel
  -- master ha gia' contato dove e' nato. La condivisione resta anche quando e' revocata (lo storico
  -- non si cancella), quindi il compratore si ritrova anche per le gambe vecchie.
  if vecchia_valida and old.cliente_id is not null then
    select cc.master_id into acq_vecchio from public.corrieri_condivisi cc
     where cc.cliente_ledger_id = old.cliente_id order by cc.created_at limit 1;
  end if;
  if nuova_valida and new.cliente_id is not null then
    select cc.master_id into acq_nuovo from public.corrieri_condivisi cc
     where cc.cliente_ledger_id = new.cliente_id order by cc.created_at limit 1;
  end if;

  if acq_vecchio is not null and (not nuova_valida
      or acq_nuovo is distinct from acq_vecchio
      or mese_vecchio is distinct from mese_nuovo
      or old.master_id is distinct from new.master_id) then
    update public.contatori_gambe set n = greatest(0, n - 1)
     where master_id = old.master_id and acquirente_id = acq_vecchio and mese = mese_vecchio;
  end if;

  if acq_nuovo is not null and (not vecchia_valida
      or acq_vecchio is distinct from acq_nuovo
      or mese_vecchio is distinct from mese_nuovo
      or old.master_id is distinct from new.master_id) then
    insert into public.contatori_gambe (master_id, acquirente_id, mese, n)
    values (new.master_id, acq_nuovo, mese_nuovo, 1)
    on conflict (master_id, acquirente_id, mese) do update set n = contatori_gambe.n + excluded.n;
  end if;

  return null;
end $$;

-- Il trigger ascolta anche cliente_id: una riga che passa su (o via da) un conto ingrosso cambia
-- il conto delle gambe. Ricrearlo prende il lucchetto su spedizioni fino alla fine: e' quello che
-- rende esatto il riallineamento qui sotto (nessuna gamba nasce fra la conta e l'accensione).
create or replace trigger trg_conta_spedizione
after insert or delete or update of stato, master_id, created_at, cliente_id on public.spedizioni
for each row execute function public.fn_conta_spedizione();

-- ── Allineamento: il contatore delle gambe parte dai dati veri di ogni mese ──
insert into public.contatori_gambe (master_id, acquirente_id, mese, n)
select s.master_id, cc.master_id, to_char(s.created_at at time zone 'UTC', 'YYYY-MM'), count(*)
  from public.spedizioni s
  join (select distinct on (cliente_ledger_id) cliente_ledger_id, master_id
          from public.corrieri_condivisi
         where cliente_ledger_id is not null
         order by cliente_ledger_id, created_at) cc on cc.cliente_ledger_id = s.cliente_id
 where s.stato is distinct from 'annullata' and s.master_id is not null
 group by 1, 2, 3
on conflict (master_id, acquirente_id, mese) do update set n = excluded.n;

-- ═══════════════════════════════════════════════════════════════════════════
-- QUANTO HA USATO LA RETE DI UN MASTER IN UN MESE: le spedizioni sue e di tutta la sua rete,
-- meno le gambe che la sua rete ha venduto a se stessa. Una funzione sola, letta sia dal blocco
-- (fn_limiti_catena) sia dalla pagina Abbonamento: due conti separati prima o poi divergono.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_usato_rete(p_master uuid, p_mese text)
returns bigint
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
  select greatest(0,
      coalesce((select sum(k.n) from public.contatori_spedizioni k
                 where k.mese = p_mese and k.master_id in (select id from sotto)), 0)
    - coalesce((select sum(g.n) from public.contatori_gambe g
                 where g.mese = p_mese
                   and g.master_id in (select id from sotto)
                   and g.acquirente_id in (select id from sotto)), 0)
  )::bigint;
$$;

create or replace function public.fn_limiti_catena(p_master uuid, p_mese text)
returns table(master_id uuid, nome text, limite integer, usato bigint, livello integer, congelato boolean, scaduto_dal timestamp with time zone)
language sql
stable
security definer
set search_path = public
as $$
  with recursive catena as (
    select m.id, m.nome, m.parent_master_id, m.abbonamento_limite, m.pagamento_scaduto_dal, 0 as liv
      from public.masters m where m.id = p_master
    union all
    select p.id, p.nome, p.parent_master_id, p.abbonamento_limite, p.pagamento_scaduto_dal, c.liv + 1
      from catena c join public.masters p on p.id = c.parent_master_id
     where c.liv < 20
  )
  select c.id, c.nome, c.abbonamento_limite, public.fn_usato_rete(c.id, p_mese), c.liv,
         (c.pagamento_scaduto_dal is not null and c.pagamento_scaduto_dal < now() - interval '3 days'),
         c.pagamento_scaduto_dal
    from catena c
   where c.parent_master_id is not null      -- il root e' la piattaforma: nessun limite
   order by c.liv;
$$;

revoke all on function public.fn_usato_rete(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_limiti_catena(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_conta_spedizione() from public, anon, authenticated;
grant execute on function public.fn_usato_rete(uuid, text) to service_role;
grant execute on function public.fn_limiti_catena(uuid, text) to service_role;

commit;
