-- ARCHIVIO DEI PREZZI CLIENTE CANCELLATI — "dopo la partenza si paga sempre" (25/11/2026).
--
-- Perché esiste. Togliere un contratto da un listino cliente (Rimuovi contratto, salvare con le celle
-- vuote, Disabilita della condivisione, eliminare il listino…) CANCELLA le sue fasce e i suoi
-- supplementi. I pacchi già partiti su quel contratto restano lì: un reso, una giacenza o una rettifica
-- che arriva dopo non trovano più un prezzo, e al cliente usciva 0 € (regola del 18/09, ora tolta).
-- Lorenzo, 25/11: "si paga sempre", anche quando è il master a togliere il contratto.
--
-- Perché un archivio a parte e non un segno "ritirato" nel listino. I prezzi dei listini cliente li
-- leggono 27 punti del codice che OFFRONO e VENDONO; un segno andrebbe filtrato in tutti, e basta
-- dimenticarne uno perché un contratto tolto torni in vendita. Qui il database copia da solo ogni prezzo
-- cancellato in una tabella che nessuna porta di vendita conosce. La leggono solo gli eventi dopo la
-- partenza (lib/prezzi-archivio.ts), e solo quando il listino non prezza più quel contratto.
--
-- Cosa si conserva. Per ogni (listino, contratto) e per ognuna delle tre tabelle, l'ULTIMA versione
-- cancellata per intero: quando una cancellazione lascia la coppia senza righe, quelle righe prendono il
-- posto della versione archiviata prima. Un salvataggio che cancella e riscrive lascia la versione
-- vecchia in archivio e quella nuova nel listino: l'archivio non si usa finché il listino prezza.
-- La riga si salva come jsonb: se domani una tabella del listino prende una colonna in più, la
-- cancellazione non si rompe (un INSERT colonna per colonna fallirebbe, e con lui il DELETE dal portale).
--
-- Si lancia UNA volta nel SQL Editor. Non tocca nessun dato esistente: crea una tabella, tre trigger
-- sulle cancellazioni, una colonna vuota e un trigger in inserimento su spedizioni.

begin;

-- ── 1. L'archivio ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.listini_clienti_archivio (
  id            bigserial primary key,
  tabella       text        not null check (tabella in ('listini_clienti_fasce', 'listini_clienti_supplementi', 'listini_clienti_corrieri')),
  listino_id    uuid        not null,
  corriere_id   uuid        not null,
  riga          jsonb       not null,
  archiviato_at timestamptz not null default now()
);
-- Nessun vincolo verso listini e contratti, di proposito: se il listino intero viene eliminato, i
-- prezzi dei pacchi partiti con lui devono restare.
create index if not exists listini_clienti_archivio_coppia
  on public.listini_clienti_archivio (listino_id, corriere_id, tabella);

alter table public.listini_clienti_archivio enable row level security;
revoke all on table public.listini_clienti_archivio from anon, authenticated, public;
revoke all on sequence public.listini_clienti_archivio_id_seq from anon, authenticated, public;

-- ── 2. Le cancellazioni finiscono in archivio ───────────────────────────────────────────────────
-- Un trigger per tabella, a livello di ISTRUZIONE con la tabella delle righe cancellate: una
-- cancellazione di 300 fasce fa un solo passaggio, non 300. SECURITY DEFINER perché "Rimuovi contratto"
-- cancella con la sessione di chi clicca, che sull'archivio non ha (e non deve avere) nessun permesso.
create or replace function public.fn_archivia_fasce_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  with svuotate as (
    select distinct o.listino_id, o.corriere_id from cancellate o
     where o.listino_id is not null and o.corriere_id is not null
       and not exists (select 1 from public.listini_clienti_fasce v
                        where v.listino_id = o.listino_id and v.corriere_id = o.corriere_id)
  ), via as (
    delete from public.listini_clienti_archivio a using svuotate s
     where a.tabella = 'listini_clienti_fasce' and a.listino_id = s.listino_id and a.corriere_id = s.corriere_id
  )
  insert into public.listini_clienti_archivio (tabella, listino_id, corriere_id, riga)
  select 'listini_clienti_fasce', o.listino_id, o.corriere_id, to_jsonb(o)
    from cancellate o join svuotate s on s.listino_id = o.listino_id and s.corriere_id = o.corriere_id;
  return null;
end $$;

create or replace function public.fn_archivia_supplementi_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  with svuotate as (
    select distinct o.listino_id, o.corriere_id from cancellate o
     where o.listino_id is not null and o.corriere_id is not null
       and not exists (select 1 from public.listini_clienti_supplementi v
                        where v.listino_id = o.listino_id and v.corriere_id = o.corriere_id)
  ), via as (
    delete from public.listini_clienti_archivio a using svuotate s
     where a.tabella = 'listini_clienti_supplementi' and a.listino_id = s.listino_id and a.corriere_id = s.corriere_id
  )
  insert into public.listini_clienti_archivio (tabella, listino_id, corriere_id, riga)
  select 'listini_clienti_supplementi', o.listino_id, o.corriere_id, to_jsonb(o)
    from cancellate o join svuotate s on s.listino_id = o.listino_id and s.corriere_id = o.corriere_id;
  return null;
end $$;

create or replace function public.fn_archivia_agganci_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  with svuotate as (
    select distinct o.listino_id, o.corriere_id from cancellate o
     where o.listino_id is not null and o.corriere_id is not null
       and not exists (select 1 from public.listini_clienti_corrieri v
                        where v.listino_id = o.listino_id and v.corriere_id = o.corriere_id)
  ), via as (
    delete from public.listini_clienti_archivio a using svuotate s
     where a.tabella = 'listini_clienti_corrieri' and a.listino_id = s.listino_id and a.corriere_id = s.corriere_id
  )
  insert into public.listini_clienti_archivio (tabella, listino_id, corriere_id, riga)
  select 'listini_clienti_corrieri', o.listino_id, o.corriere_id, to_jsonb(o)
    from cancellate o join svuotate s on s.listino_id = o.listino_id and s.corriere_id = o.corriere_id;
  return null;
end $$;

revoke all on function public.fn_archivia_fasce_cliente()       from public, anon, authenticated;
revoke all on function public.fn_archivia_supplementi_cliente() from public, anon, authenticated;
revoke all on function public.fn_archivia_agganci_cliente()     from public, anon, authenticated;

drop trigger if exists trg_archivia_fasce_cliente on public.listini_clienti_fasce;
create trigger trg_archivia_fasce_cliente after delete on public.listini_clienti_fasce
  referencing old table as cancellate for each statement execute function public.fn_archivia_fasce_cliente();
drop trigger if exists trg_archivia_supplementi_cliente on public.listini_clienti_supplementi;
create trigger trg_archivia_supplementi_cliente after delete on public.listini_clienti_supplementi
  referencing old table as cancellate for each statement execute function public.fn_archivia_supplementi_cliente();
drop trigger if exists trg_archivia_agganci_cliente on public.listini_clienti_corrieri;
create trigger trg_archivia_agganci_cliente after delete on public.listini_clienti_corrieri
  referencing old table as cancellate for each statement execute function public.fn_archivia_agganci_cliente();

-- ── 3. Il listino con cui è partito il pacco ────────────────────────────────────────────────────
-- Se il master sposta il cliente su un altro listino, i pacchi vecchi devono poter trovare il prezzo
-- con cui sono partiti. La spedizione se lo segna da sola alla nascita: un trigger, così vale da ogni
-- porta (portale, API, import, negozi), anche da una che nascerà domani. Non solleva mai errori: nel
-- peggiore dei casi la colonna resta vuota e si fa come prima.
-- lock_timeout: aggiungere una colonna vuota è istantaneo, ma chiede un attimo la tabella in esclusiva;
-- se una lettura lunga la tiene, meglio rinunciare e rilanciare che mettere in fila le spedizioni.
set local lock_timeout = '3s';
alter table public.spedizioni add column if not exists listino_cliente_id uuid;

create or replace function public.fn_spedizione_listino_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.listino_cliente_id is null and new.cliente_id is not null then
    select c.listino_cliente_id into new.listino_cliente_id from public.clienti c where c.id = new.cliente_id;
  end if;
  return new;
end $$;
revoke all on function public.fn_spedizione_listino_cliente() from public, anon, authenticated;

drop trigger if exists trg_spedizione_listino_cliente on public.spedizioni;
create trigger trg_spedizione_listino_cliente before insert on public.spedizioni
  for each row execute function public.fn_spedizione_listino_cliente();

commit;
