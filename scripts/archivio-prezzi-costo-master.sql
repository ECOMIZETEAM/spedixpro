-- ARCHIVIO DEI PREZZI DI COSTO DEI MASTER CANCELLATI — "dopo la partenza si paga sempre", livello master
-- (26/11/2026). Gemello di scripts/archivio-prezzi-clienti.sql, che fa la stessa cosa per i listini cliente.
--
-- Perché esiste. Il costo di un master per un contratto (il suo Listino Corrieri) sta in
-- listini_corrieri_fasce / _supplementi / _corrieri sulla SUA riga del contratto. Quando il padre preme
-- "Disattiva per sotto-master", o il master svuota il listino, o il listino viene eliminato, quelle righe
-- si CANCELLANO. I pacchi già partiti restano: una rettifica, un reso o una giacenza che arrivano dopo
-- non trovano più il costo del master. Allora la rettifica ripiega sul listino del padre o si ferma, e il
-- reso ripiega su quanto il master aveva pagato all'andata (contrassegno compreso).
-- Al 26/11 sono 9 contratti con pacchi e senza un prezzo di costo: il più grosso è "Poste Express M" di
-- Ecomize LL, 4.704 pacchi in 120 giorni, prezzi cancellati il 06/11. E con il distacco di un contratto
-- (Atlantik da Giga Express, il primo) il padre potrà togliere i prezzi di una copia che ha ancora
-- pacchi in giro.
--
-- Come per i clienti: un archivio a parte che nessuna porta di vendita legge. Il database ci copia da
-- solo i prezzi cancellati; li legge solo il calcolo dopo la partenza (lib/prezzi-archivio.ts), e solo
-- quando il contratto non ha più nessuna fascia di costo viva.
--
-- La differenza con i clienti. Un listino cliente prezza tanti contratti, quindi lì l'unità è la coppia
-- (listino, contratto). Il costo di un master invece si legge per CONTRATTO: tutte le fasce della riga,
-- in qualunque listino del master stiano (lib/pricing.ts, calcolaPrezzoCorriereDettaglio). E le fasce
-- stanno sempre sulla riga dello stesso master del listino (26/11: 0 eccezioni su 43 mila, lo garantisce
-- trg_fasce_nel_listino_del_contratto). Quindi qui l'unità è la riga del contratto: si archivia quando
-- un contratto resta senza righe in quella tabella, e la versione nuova prende il posto della vecchia.
--
-- Non si archivia niente se è la riga del contratto stesso a sparire: il database la lascia cancellare
-- solo se non ha né spedizioni né ritiri né distinte (vincoli NO ACTION), quindi non c'è niente da
-- prezzare dopo.
--
-- Si lancia UNA volta nel SQL Editor. Non cambia nessun addebito: crea una tabella e tre trigger sulle
-- cancellazioni. Da quel momento conserva soltanto.

begin;

-- ── 1. L'archivio ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.listini_corrieri_archivio (
  id            bigserial primary key,
  tabella       text        not null check (tabella in ('listini_corrieri_fasce', 'listini_corrieri_supplementi', 'listini_corrieri_corrieri')),
  listino_id    uuid        not null,
  corriere_id   uuid        not null,
  riga          jsonb       not null,
  archiviato_at timestamptz not null default now()
);
-- Nessun vincolo verso listini e contratti, di proposito: se il listino intero viene eliminato, i
-- prezzi dei pacchi partiti con lui devono restare.
create index if not exists listini_corrieri_archivio_contratto
  on public.listini_corrieri_archivio (corriere_id, tabella);

alter table public.listini_corrieri_archivio enable row level security;
revoke all on table public.listini_corrieri_archivio from anon, authenticated, public;
revoke all on sequence public.listini_corrieri_archivio_id_seq from anon, authenticated, public;

-- ── 2. Le cancellazioni finiscono in archivio ───────────────────────────────────────────────────
-- Un trigger per tabella, a livello di ISTRUZIONE con la tabella delle righe cancellate: la propagazione
-- dei listini ai sotto-master cancella migliaia di fasce in un colpo, e qui fa un solo passaggio.
-- SECURITY DEFINER perché l'editor del Listino Corrieri cancella con la sessione di chi salva, che
-- sull'archivio non ha (e non deve avere) nessun permesso.
create or replace function public.fn_archivia_fasce_costo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  with svuotati as (
    select distinct o.corriere_id from cancellate o
     where o.corriere_id is not null
       and exists (select 1 from public.corrieri c where c.id = o.corriere_id)
       and not exists (select 1 from public.listini_corrieri_fasce v where v.corriere_id = o.corriere_id)
  ), via as (
    delete from public.listini_corrieri_archivio a using svuotati s
     where a.tabella = 'listini_corrieri_fasce' and a.corriere_id = s.corriere_id
  )
  insert into public.listini_corrieri_archivio (tabella, listino_id, corriere_id, riga)
  select 'listini_corrieri_fasce', o.listino_id, o.corriere_id, to_jsonb(o)
    from cancellate o join svuotati s on s.corriere_id = o.corriere_id
   where o.listino_id is not null;
  return null;
end $$;

create or replace function public.fn_archivia_supplementi_costo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  with svuotati as (
    select distinct o.corriere_id from cancellate o
     where o.corriere_id is not null
       and exists (select 1 from public.corrieri c where c.id = o.corriere_id)
       and not exists (select 1 from public.listini_corrieri_supplementi v where v.corriere_id = o.corriere_id)
  ), via as (
    delete from public.listini_corrieri_archivio a using svuotati s
     where a.tabella = 'listini_corrieri_supplementi' and a.corriere_id = s.corriere_id
  )
  insert into public.listini_corrieri_archivio (tabella, listino_id, corriere_id, riga)
  select 'listini_corrieri_supplementi', o.listino_id, o.corriere_id, to_jsonb(o)
    from cancellate o join svuotati s on s.corriere_id = o.corriere_id
   where o.listino_id is not null;
  return null;
end $$;

create or replace function public.fn_archivia_agganci_costo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  with svuotati as (
    select distinct o.corriere_id from cancellate o
     where o.corriere_id is not null
       and exists (select 1 from public.corrieri c where c.id = o.corriere_id)
       and not exists (select 1 from public.listini_corrieri_corrieri v where v.corriere_id = o.corriere_id)
  ), via as (
    delete from public.listini_corrieri_archivio a using svuotati s
     where a.tabella = 'listini_corrieri_corrieri' and a.corriere_id = s.corriere_id
  )
  insert into public.listini_corrieri_archivio (tabella, listino_id, corriere_id, riga)
  select 'listini_corrieri_corrieri', o.listino_id, o.corriere_id, to_jsonb(o)
    from cancellate o join svuotati s on s.corriere_id = o.corriere_id
   where o.listino_id is not null;
  return null;
end $$;

revoke all on function public.fn_archivia_fasce_costo()       from public, anon, authenticated;
revoke all on function public.fn_archivia_supplementi_costo() from public, anon, authenticated;
revoke all on function public.fn_archivia_agganci_costo()     from public, anon, authenticated;

drop trigger if exists trg_archivia_fasce_costo on public.listini_corrieri_fasce;
create trigger trg_archivia_fasce_costo after delete on public.listini_corrieri_fasce
  referencing old table as cancellate for each statement execute function public.fn_archivia_fasce_costo();
drop trigger if exists trg_archivia_supplementi_costo on public.listini_corrieri_supplementi;
create trigger trg_archivia_supplementi_costo after delete on public.listini_corrieri_supplementi
  referencing old table as cancellate for each statement execute function public.fn_archivia_supplementi_costo();
drop trigger if exists trg_archivia_agganci_costo on public.listini_corrieri_corrieri;
create trigger trg_archivia_agganci_costo after delete on public.listini_corrieri_corrieri
  referencing old table as cancellate for each statement execute function public.fn_archivia_agganci_costo();

commit;
