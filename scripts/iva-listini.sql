-- IVA DEI LISTINI VENDUTI (Lorenzo, 20/11/2026).
--
-- Un master vende i listini IVA inclusa o IVA esclusa: per tutto il listino, oppure corriere per
-- corriere. Ecomize Solution vende a Ecomize LL IVA inclusa, e fino ad oggi ogni report metteva il 22%
-- SOPRA a tutto: 4,00 € venduti IVA inclusa uscivano 4,88 €.
--
-- I MOVIMENTI NON CAMBIANO. Il credito scala sempre il prezzo del listino. La scelta la leggono solo
-- i report e la proforma, per dividere imponibile e IVA: IVA esclusa → 4,00 + 0,88 da incassare a
-- parte; IVA inclusa → 3,28 + 0,72 gia' dentro i 4,00.
--
-- IL PASSATO NON SI RISCRIVE. Ogni scelta e' una riga nuova con la data da cui vale (inizio del mese
-- o inizio di oggi, ora di Roma), mai una modifica: il report di un mese chiuso esce sempre uguale.
-- Per la stessa ragione si tiene la storia di QUALE listino aveva un cliente o un sotto-master: prima
-- di oggi il database sapeva solo quello attuale, e un cambio di listino avrebbe cambiato anche i
-- report dei mesi passati.
--
-- LA REGOLA STA QUI, IN UN POSTO SOLO: fn_iva_vendita. La chiamano i report (via
-- iva_vendite_spedizioni) e il Report Fatture (fatture_importi_periodo_v2). Nessun file la riscrive.
--
-- Tutto e' nuovo e si aggiunge: nessuna tabella esistente cambia colonne. Gli unici oggetti che
-- toccano tabelle di oggi sono quattro trigger AFTER su clienti e masters, che scrivono solo nella
-- tabella nuova e solo quando cambia il listino assegnato.

begin;
-- La fotografia dei listini assegnati e i trigger devono vedere lo stesso istante: un cambio di listino
-- scritto fra le due cose andrebbe perso per sempre. Si fermano le scritture su clienti e masters per
-- il tempo dello script (pochi istanti); se qualcuno le tiene occupate oltre 5 secondi lo script si
-- ferma senza fare niente e si rilancia.
set local lock_timeout = '5s';
lock table public.clienti, public.masters in share row exclusive mode;

-- ── 1. Le scelte IVA: una riga per scelta, mai modificata ──────────────────────────────────────
create table if not exists public.listini_iva (
  id bigint generated always as identity primary key,
  master_id uuid not null,
  listino_id uuid not null,
  -- null = tutto il listino; valorizzato = solo quel contratto del master
  corriere_id uuid,
  -- sul listino: true/false. Sul contratto: true/false, oppure null = "come il listino"
  iva_inclusa boolean,
  dal timestamptz not null,
  creato_il timestamptz not null default clock_timestamp(),
  creato_da uuid,
  constraint listini_iva_listino_dice_qualcosa check (corriere_id is not null or iva_inclusa is not null),
  constraint listini_iva_dal_non_futuro check (dal <= creato_il)
);
-- Niente chiave esterna sul listino, di proposito: se il listino viene cancellato, i report dei mesi
-- in cui era in uso devono continuare a sapere come era venduto.
create index if not exists listini_iva_ricerca on public.listini_iva (listino_id, corriere_id, creato_il desc, id desc);
create index if not exists listini_iva_master on public.listini_iva (master_id);

alter table public.listini_iva enable row level security;
revoke all on table public.listini_iva from public, anon, authenticated;
grant select, insert on table public.listini_iva to service_role;

create or replace function public.fn_listini_iva_solo_aggiunte() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'Lo storico IVA dei listini non si modifica e non si cancella: si aggiunge una scelta nuova';
end $$;
revoke all on function public.fn_listini_iva_solo_aggiunte() from public, anon, authenticated;
drop trigger if exists trg_listini_iva_solo_aggiunte on public.listini_iva;
create trigger trg_listini_iva_solo_aggiunte before update or delete on public.listini_iva
  for each row execute function public.fn_listini_iva_solo_aggiunte();

-- ── 2. Quale listino aveva un cliente o un sotto-master, e da quando ──────────────────────────
create table if not exists public.listini_assegnazioni (
  id bigint generated always as identity primary key,
  soggetto_tipo text not null check (soggetto_tipo in ('cliente', 'master')),
  soggetto_id uuid not null,
  listino_id uuid,
  dal timestamptz not null default clock_timestamp()
);
create index if not exists listini_assegnazioni_ricerca on public.listini_assegnazioni (soggetto_tipo, soggetto_id, dal desc, id desc);

alter table public.listini_assegnazioni enable row level security;
revoke all on table public.listini_assegnazioni from public, anon, authenticated;
grant select on table public.listini_assegnazioni to service_role;

-- SECURITY DEFINER: il listino di un cliente lo cambia anche la sessione del master (sotto RLS), che
-- non puo' scrivere in questa tabella. La funzione scrive solo qui, e solo la riga del cambio.
create or replace function public.fn_storico_listino_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.listini_assegnazioni (soggetto_tipo, soggetto_id, listino_id)
  values ('cliente', new.id, new.listino_cliente_id);
  return null;
end $$;
create or replace function public.fn_storico_listino_master() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.listini_assegnazioni (soggetto_tipo, soggetto_id, listino_id)
  values ('master', new.id, new.parent_listino_id);
  return null;
end $$;
revoke all on function public.fn_storico_listino_cliente() from public, anon, authenticated;
revoke all on function public.fn_storico_listino_master() from public, anon, authenticated;

-- Prima la fotografia di oggi, valida "da sempre": e' quello che i report hanno sempre usato. Anche
-- "nessun listino" e' una riga: un sotto-master senza listino oggi (prezzato dai suoi listini corrieri,
-- lib/cascata.ts) che ne riceve uno a dicembre non deve trovarselo anche sui giorni di prima.
insert into public.listini_assegnazioni (soggetto_tipo, soggetto_id, listino_id, dal)
select 'cliente', c.id, c.listino_cliente_id, '-infinity'::timestamptz
  from public.clienti c
 where not exists (select 1 from public.listini_assegnazioni a where a.soggetto_tipo = 'cliente' and a.soggetto_id = c.id);
insert into public.listini_assegnazioni (soggetto_tipo, soggetto_id, listino_id, dal)
select 'master', m.id, m.parent_listino_id, '-infinity'::timestamptz
  from public.masters m
 where not exists (select 1 from public.listini_assegnazioni a where a.soggetto_tipo = 'master' and a.soggetto_id = m.id);

-- Chi nasce da oggi ha la sua riga dalla nascita, anche senza listino.
drop trigger if exists trg_storico_listino_cliente_ins on public.clienti;
create trigger trg_storico_listino_cliente_ins after insert on public.clienti
  for each row execute function public.fn_storico_listino_cliente();
drop trigger if exists trg_storico_listino_cliente_upd on public.clienti;
create trigger trg_storico_listino_cliente_upd after update of listino_cliente_id on public.clienti
  for each row when (old.listino_cliente_id is distinct from new.listino_cliente_id) execute function public.fn_storico_listino_cliente();
drop trigger if exists trg_storico_listino_master_ins on public.masters;
create trigger trg_storico_listino_master_ins after insert on public.masters
  for each row execute function public.fn_storico_listino_master();
drop trigger if exists trg_storico_listino_master_upd on public.masters;
create trigger trg_storico_listino_master_upd after update of parent_listino_id on public.masters
  for each row when (old.parent_listino_id is distinct from new.parent_listino_id) execute function public.fn_storico_listino_master();

-- ── 3. Le regole ─────────────────────────────────────────────────────────────────────────────

-- Il listino di un soggetto in un istante. Una riga di storia vale anche se dice "nessun listino". Se
-- la storia c'e' ma comincia dopo quell'istante, allora non aveva listino. Solo un soggetto senza
-- nessuna riga (non dovrebbe esistere: c'e' la fotografia e il trigger alla nascita) prende quello di oggi.
create or replace function public.fn_listino_al(p_tipo text, p_soggetto uuid, p_data timestamptz) returns uuid
language plpgsql stable set search_path = public as $$
declare v_trovato boolean := false; v_listino uuid;
begin
  select true, a.listino_id into v_trovato, v_listino
    from public.listini_assegnazioni a
   where a.soggetto_tipo = p_tipo and a.soggetto_id = p_soggetto and a.dal <= p_data
   order by a.dal desc, a.id desc limit 1;
  if v_trovato then return v_listino; end if;
  if exists (select 1 from public.listini_assegnazioni a where a.soggetto_tipo = p_tipo and a.soggetto_id = p_soggetto) then return null; end if;
  if p_tipo = 'cliente' then return (select listino_cliente_id from public.clienti where id = p_soggetto); end if;
  if p_tipo = 'master' then return (select parent_listino_id from public.masters where id = p_soggetto); end if;
  return null;
end $$;

-- IVA inclusa su quel listino, per quel contratto, in quell'istante. Vale l'ultima scelta FATTA fra
-- quelle gia' in vigore in quell'istante: una correzione "da inizio mese" fatta il 25 vince su una
-- scelta "da oggi" fatta il 20. La scelta sul contratto vince su quella del listino; "come il
-- listino" (null) rimanda al listino. Nessuna scelta = IVA esclusa, come i report di sempre.
create or replace function public.fn_iva_inclusa_al(p_listino uuid, p_corriere uuid, p_data timestamptz) returns boolean
language sql stable set search_path = public as $$
  select coalesce(
    (select c.iva_inclusa from public.listini_iva c
      where c.listino_id = p_listino and c.corriere_id = p_corriere and c.dal <= p_data
      order by c.creato_il desc, c.id desc limit 1),
    (select l.iva_inclusa from public.listini_iva l
      where l.listino_id = p_listino and l.corriere_id is null and l.dal <= p_data
      order by l.creato_il desc, l.id desc limit 1),
    false)
$$;

-- IL MOVIMENTO DI UNA SPEDIZIONE, VENDUTO DA p_venditore A UN CLIENTE O A UN SOTTO-MASTER, ERA IVA
-- INCLUSA? Si guarda come era venduta la SPEDIZIONE il giorno in cui e' nata: rettifiche, giacenze,
-- resi e rimborsi seguono il suo corriere (decisione di Lorenzo, 20/11/2026), anche se arrivano dopo.
-- Gli altri movimenti (servizi aggiunti a mano, magazzino) non sono il listino: IVA esclusa come oggi.
-- Il contratto e' quello DEL VENDITORE: sulle spedizioni della rete e sui pacchi condivisi la riga
-- spedizione porta il contratto di un altro master, e si cerca la copia del venditore per nome (stesso
-- confronto di lib/contratto-per-nome.ts: spazi ai bordi tolti, minuscolo). Se il venditore non ha
-- una copia con quel nome, quel contratto non l'ha venduto lui: IVA esclusa.
-- Tutto si legge dalle SCELTE, non da listini_clienti: un listino cancellato dopo (si puo', quando
-- nessuno lo usa piu') non deve cambiare i report dei mesi in cui era in uso.
create or replace function public.fn_iva_vendita(
  p_venditore uuid, p_tipo_soggetto text, p_soggetto uuid, p_spedizione uuid, p_tipo_movimento text default 'spedizione'
) returns boolean
language plpgsql stable set search_path = public as $$
declare v_corr uuid; v_data timestamptz; v_corr_master uuid; v_nome text; v_listino uuid; v_mio uuid;
begin
  if p_venditore is null or p_soggetto is null or p_spedizione is null then return false; end if;
  if coalesce(p_tipo_movimento, '') not in ('spedizione', 'rettifica', 'giacenza', 'reso', 'rimborso') then return false; end if;
  -- Via veloce: chi non ha mai toccato l'interruttore vende tutto IVA esclusa.
  if not exists (select 1 from public.listini_iva where master_id = p_venditore) then return false; end if;
  select s.corriere_id, s.created_at into v_corr, v_data from public.spedizioni s where s.id = p_spedizione;
  if v_corr is null or v_data is null then return false; end if;
  v_listino := public.fn_listino_al(p_tipo_soggetto, p_soggetto, v_data);
  if v_listino is null then return false; end if;
  -- Valgono solo le scelte del venditore sui listini suoi; un listino senza scelte e' IVA esclusa.
  if not exists (select 1 from public.listini_iva where listino_id = v_listino and master_id = p_venditore) then return false; end if;
  select c.master_id, c.nome_contratto into v_corr_master, v_nome from public.corrieri c where c.id = v_corr;
  if v_corr_master = p_venditore then
    v_mio := v_corr;
  else
    -- Due copie con lo stesso nome presso lo stesso master esistono (GTS, 'GLS CASERTA'): vince quella
    -- scelta su quel listino, poi quella che sta nel listino, poi la piu' vecchia.
    select c.id into v_mio from public.corrieri c
     where c.master_id = p_venditore
       and lower(regexp_replace(c.nome_contratto, '^\s+|\s+$', '', 'g')) = lower(regexp_replace(v_nome, '^\s+|\s+$', '', 'g'))
     order by exists (select 1 from public.listini_iva li where li.listino_id = v_listino and li.corriere_id = c.id) desc,
              exists (select 1 from public.listini_clienti_corrieri lc where lc.listino_id = v_listino and lc.corriere_id = c.id) desc,
              c.created_at, c.id
     limit 1;
    if v_mio is null then return false; end if;
  end if;
  return public.fn_iva_inclusa_al(v_listino, v_mio, v_data);
end $$;

-- Per i report: tante righe in una chiamata. p_righe = [{"i":0,"t":"cliente","s":"<id>","p":"<spedizione>","m":"spedizione"}, ...]
create or replace function public.iva_vendite_spedizioni(p_venditore uuid, p_righe jsonb)
returns table(i int, iva_inclusa boolean)
language sql stable set search_path = public as $$
  select (e->>'i')::int,
         public.fn_iva_vendita(p_venditore, e->>'t', nullif(e->>'s', '')::uuid, nullif(e->>'p', '')::uuid, coalesce(e->>'m', 'spedizione'))
    from jsonb_array_elements(coalesce(p_righe, '[]'::jsonb)) e
$$;

-- Report Fatture: come la v1, divisa anche per IVA inclusa / esclusa. Chi non usa l'interruttore non
-- paga niente in piu': la colonna e' false senza guardare le spedizioni.
create or replace function public.fatture_importi_periodo_v2(p_master uuid, p_dal timestamptz, p_al timestamptz)
returns table(cliente_id uuid, tipo text, con_spedizione boolean, iva_inclusa boolean, n bigint, importo numeric)
language sql stable set search_path = public as $$
  with usa as (select exists (select 1 from public.listini_iva where master_id = p_master) as si)
  select m.cliente_id, m.tipo, (m.spedizione_id is not null),
         case when (select si from usa) and m.spedizione_id is not null
              then public.fn_iva_vendita(p_master, 'cliente', m.cliente_id, m.spedizione_id, m.tipo)
              else false end,
         count(*), sum(m.importo)
    from public.movimenti m
   where m.master_id = p_master
     and m.cliente_id is not null
     and m.master_target_id is null
     and m.created_at >= p_dal
     and m.created_at <= p_al
   group by 1, 2, 3, 4
   -- Ordine fisso: la rotta legge a pagine da 1.000 (oltre, il database tronca in silenzio).
   order by 1, 2, 3, 4
$$;

-- ── 4. Scrivere una scelta ───────────────────────────────────────────────────────────────────
-- La data di partenza la calcola il database, sul giorno di Roma: 'mese' = dal primo del mese,
-- 'oggi' = dall'inizio di oggi. La rotta controlla prima chi e' (staff del master del listino).
create or replace function public.listini_iva_imposta(
  p_master uuid, p_listino uuid, p_corriere uuid, p_iva_inclusa boolean, p_da text, p_utente uuid
) returns timestamptz
language plpgsql set search_path = public as $$
declare v_dal timestamptz;
begin
  if not exists (select 1 from public.listini_clienti where id = p_listino and master_id = p_master) then
    raise exception 'Listino non trovato';
  end if;
  if p_corriere is null and p_iva_inclusa is null then raise exception 'Scelta non valida'; end if;
  if p_corriere is not null and not exists (select 1 from public.corrieri where id = p_corriere and master_id = p_master) then
    raise exception 'Contratto non trovato';
  end if;
  v_dal := case p_da
    when 'mese' then date_trunc('month', now() at time zone 'Europe/Rome') at time zone 'Europe/Rome'
    when 'oggi' then date_trunc('day', now() at time zone 'Europe/Rome') at time zone 'Europe/Rome'
  end;
  if v_dal is null then raise exception 'Data di partenza non valida'; end if;
  insert into public.listini_iva (master_id, listino_id, corriere_id, iva_inclusa, dal, creato_da)
  values (p_master, p_listino, p_corriere, p_iva_inclusa, v_dal, p_utente);
  return v_dal;
end $$;

-- Duplicare un listino porta con se' anche come era venduto (se no la copia nasce IVA esclusa in
-- silenzio): le scelte in vigore oggi sul listino di partenza, valide da sempre sulla copia.
create or replace function public.listini_iva_copia(p_master uuid, p_da_listino uuid, p_a_listino uuid, p_utente uuid)
returns int
language plpgsql set search_path = public as $$
declare v_n int := 0;
begin
  if not exists (select 1 from public.listini_clienti where id = p_da_listino and master_id = p_master)
     or not exists (select 1 from public.listini_clienti where id = p_a_listino and master_id = p_master) then
    raise exception 'Listino non trovato';
  end if;
  insert into public.listini_iva (master_id, listino_id, corriere_id, iva_inclusa, dal, creato_da)
  select p_master, p_a_listino, u.corriere_id, u.iva_inclusa, '-infinity'::timestamptz, p_utente
    from (select distinct on (corriere_id) corriere_id, iva_inclusa
            from public.listini_iva
           where listino_id = p_da_listino and dal <= now()
           order by corriere_id, creato_il desc, id desc) u
   where u.corriere_id is null or u.iva_inclusa is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.fn_listino_al(text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.fn_iva_inclusa_al(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.fn_iva_vendita(uuid, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.iva_vendite_spedizioni(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fatture_importi_periodo_v2(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.listini_iva_imposta(uuid, uuid, uuid, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public.listini_iva_copia(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_listino_al(text, uuid, timestamptz) to service_role;
grant execute on function public.fn_iva_inclusa_al(uuid, uuid, timestamptz) to service_role;
grant execute on function public.fn_iva_vendita(uuid, text, uuid, uuid, text) to service_role;
grant execute on function public.iva_vendite_spedizioni(uuid, jsonb) to service_role;
grant execute on function public.fatture_importi_periodo_v2(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.listini_iva_imposta(uuid, uuid, uuid, boolean, text, uuid) to service_role;
grant execute on function public.listini_iva_copia(uuid, uuid, uuid, uuid) to service_role;

commit;

-- Dopo: advisors di sicurezza (obiettivo zero errori) e, in sola lettura,
--   select soggetto_tipo, count(*) from listini_assegnazioni group by 1;   -- clienti e sotto-master fotografati
--   select count(*) from listini_iva;                                       -- 0 finche' nessuno sceglie
