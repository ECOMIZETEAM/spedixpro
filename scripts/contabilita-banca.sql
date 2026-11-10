-- CONTABILITA' CON L'ESTRATTO CONTO (Lorenzo, 10/11/2026). In prova solo per Ecomize Solution, poi a tutti.
--
-- Il master ricarica un cliente e scrive chi ha fatto il bonifico; quando carica l'estratto conto il
-- portale abbina ogni bonifico alla sua ricarica. Sul conto di Ecomize, a ottobre, solo 339 bonifici
-- su 830 si riconoscevano dal nome: SALVATORE PELLE paga "ricarica conto Giulia Arioldi", e un altro
-- cliente fa un bonifico solo per tutte le ricariche del giorno. Per questo ogni cliente ha un elenco
-- di pagatori (anche due conti), con l'IBAN quando lo si conosce dall'estratto.
--
-- Passo 1: chi paga e come. Applicato il 10/11/2026 con l'ok di Lorenzo.

-- Come ha pagato la ricarica: in banca si cercano solo i bonifici. I contrassegni compensati
-- (Ecomize LL, "Accredito credito a scalare cod blood") e i contanti non arriveranno mai sul conto e
-- non devono risultare "non pagati". Null = ricarica fatta prima che il campo esistesse.
alter table public.ricariche_check
  add column if not exists metodo text check (metodo in ('bonifico', 'cod_compensati', 'contanti', 'altro')),
  add column if not exists mittente text check (mittente is null or char_length(mittente) <= 140);

create table if not exists public.pagatori_bonifico (
  id uuid primary key default gen_random_uuid(),
  -- chi riceve i soldi: il master che ha ricaricato
  master_id uuid not null references public.masters(id) on delete cascade,
  -- chi viene ricaricato: un cliente (clienti.id) o un sotto-master (masters.id); niente FK perche'
  -- le tabelle sono due, il controllo lo fa la rotta
  target_tipo text not null check (target_tipo in ('cliente', 'master')),
  target_id uuid not null,
  -- il nome come compare sull'estratto conto
  nome text not null check (char_length(btrim(nome)) between 1 and 140),
  iban text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'),
  -- da dove e' arrivato: scritto a mano, dalla finestra di ricarica, abbinando un bonifico dell'estratto
  origine text not null default 'manuale' check (origine in ('manuale', 'ricarica', 'estratto')),
  ultimo_uso timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- Lo stesso nome con lo stesso IBAN una volta sola per cliente
create unique index if not exists pagatori_bonifico_unico
  on public.pagatori_bonifico (master_id, target_tipo, target_id, upper(btrim(nome)), coalesce(iban, ''));
create index if not exists pagatori_bonifico_target on public.pagatori_bonifico (master_id, target_tipo, target_id);
create index if not exists pagatori_bonifico_iban on public.pagatori_bonifico (master_id, iban) where iban is not null;

alter table public.pagatori_bonifico enable row level security;
-- revocare "da public" non basta: anon e authenticated hanno i loro grant di default
revoke all on table public.pagatori_bonifico from public;
revoke all on table public.pagatori_bonifico from anon;
revoke all on table public.pagatori_bonifico from authenticated;
grant select, insert, update, delete on table public.pagatori_bonifico to service_role;

-- Passo 2: l'estratto conto e gli abbinamenti (lib/contabilita-estratti).

-- Un estratto caricato: il file della banca, il periodo, i saldi letti e verificati movimento per movimento.
create table if not exists public.estratti_conto (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.masters(id) on delete cascade,
  banca text not null check (banca in ('finom')),
  conto_iban text,
  intestatario text,
  dal date not null,
  al date not null check (al >= dal),
  saldo_iniziale numeric(14,2) not null,
  saldo_finale numeric(14,2) not null,
  n_righe integer not null,
  nome_file text,
  caricato_da uuid,
  caricato_il timestamptz not null default now()
);
create index if not exists estratti_conto_master on public.estratti_conto (master_id, al desc);

-- I movimenti. Due estratti che si sovrappongono non li contano due volte: la chiave (data, importo,
-- saldo dopo, nome) e' unica per master. Un'entrata puo' avere il cliente che l'ha pagata: messo da solo
-- ('auto', pagatore gia' noto) o dal master ('confermato'); 'escluso' = non e' un cliente.
-- Applicato il 10/11/2026 (prove con Lorenzo).
create table if not exists public.estratti_righe (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.masters(id) on delete cascade,
  estratto_id uuid not null references public.estratti_conto(id) on delete cascade,
  data date not null,
  nome text not null default '',
  causale text not null default '',
  iban text,
  importo numeric(14,2) not null,
  saldo numeric(14,2) not null,
  chiave text not null,
  target_tipo text check (target_tipo in ('cliente', 'master')),
  target_id uuid,
  -- 'libero' = scollegato a mano: resta fra i "di chi e'?" finche' il master non sceglie
  assegnato text check (assegnato in ('auto', 'confermato', 'escluso', 'libero')),
  created_at timestamptz not null default now(),
  check ((target_id is null) = (target_tipo is null))
);
create unique index if not exists estratti_righe_chiave on public.estratti_righe (master_id, chiave);
create index if not exists estratti_righe_data on public.estratti_righe (master_id, data);
create index if not exists estratti_righe_target on public.estratti_righe (master_id, target_tipo, target_id) where target_id is not null;

-- Quale bonifico paga quale ricarica. Una ricarica si abbina una volta sola; un bonifico puo' pagarne
-- piu' d'una (LA MARCA SERVICES: un bonifico per le ricariche del giorno). Si ricorda se l'abbinamento ha
-- segnato lui "effettuato"/"arrivato" nel Check Ricariche, per toglierli se si scollega.
create table if not exists public.abbinamenti_bonifici (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.masters(id) on delete cascade,
  riga_id uuid not null references public.estratti_righe(id) on delete cascade,
  ricarica_id uuid not null references public.ricariche_check(id) on delete cascade,
  modo text not null check (modo in ('auto', 'confermato')),
  segnato_effettuato boolean not null default false,
  segnato_arrivato boolean not null default false,
  creato_da uuid,
  creato_il timestamptz not null default now()
);
create unique index if not exists abbinamenti_bonifici_ricarica on public.abbinamenti_bonifici (ricarica_id);
create index if not exists abbinamenti_bonifici_riga on public.abbinamenti_bonifici (riga_id);

-- La voce scelta dal master per le uscite verso una controparte (nome come lo normalizza norma()).
create table if not exists public.uscite_voci (
  master_id uuid not null references public.masters(id) on delete cascade,
  controparte text not null,
  voce text not null check (char_length(btrim(voce)) between 1 and 60),
  aggiornato_il timestamptz not null default now(),
  primary key (master_id, controparte)
);

alter table public.estratti_conto enable row level security;
alter table public.estratti_righe enable row level security;
alter table public.abbinamenti_bonifici enable row level security;
alter table public.uscite_voci enable row level security;
revoke all on table public.estratti_conto, public.estratti_righe, public.abbinamenti_bonifici, public.uscite_voci from public;
revoke all on table public.estratti_conto, public.estratti_righe, public.abbinamenti_bonifici, public.uscite_voci from anon;
revoke all on table public.estratti_conto, public.estratti_righe, public.abbinamenti_bonifici, public.uscite_voci from authenticated;
grant select, insert, update, delete on table public.estratti_conto, public.estratti_righe, public.abbinamenti_bonifici, public.uscite_voci to service_role;

-- Passo 3: IL GIRO AI SOTTO-MASTER (Lorenzo, 10/11/2026). Sul conto di Ecomize Solution arrivano anche i
-- bonifici dei clienti dei suoi sotto-master Ecomize LL e Dg Express. Ecomize LL ricarica il suo cliente (NS
-- CONSULTING, 2.000 €), i soldi arrivano a Ecomize Solution, che deve ricaricare Ecomize LL degli stessi
-- 2.000 €. Fino al 10/11 lo faceva a mano (ottobre: 10 ricariche "Accredito credito a scalare", 36.663 €,
-- contro 34.583 € ricaricati da Ecomize LL ai suoi clienti); Dg Express non e' mai stata ricaricata e
-- risultava a -44.645 € senza un pagamento. Da qui decide Ecomize Solution, con un pulsante: il portale le
-- dice quali ricariche dei clienti del sotto-master sono pagate da un bonifico sul suo conto, e quelle si
-- girano una volta sola.

-- Quali sotto-master pagano sul conto di chi, e da quale giorno dei bonifici si gira dal portale. Quelli
-- prima li ha gia' girati a mano (Lorenzo: "oggi chiudiamo il tutto, da domani partiamo"): riproporli
-- darebbe il credito due volte.
create table if not exists public.conti_condivisi (
  master_id uuid not null references public.masters(id),
  sotto_master_id uuid not null references public.masters(id),
  giro_dal date not null,
  creato_il timestamptz not null default now(),
  primary key (master_id, sotto_master_id),
  check (master_id <> sotto_master_id)
);

-- 'giro' = la ricarica al sotto-master pagata dai bonifici dei suoi clienti: non si aspetta un bonifico suo.
alter table public.ricariche_check drop constraint if exists ricariche_check_metodo_check;
alter table public.ricariche_check add constraint ricariche_check_metodo_check
  check (metodo in ('bonifico', 'cod_compensati', 'contanti', 'altro', 'giro'));

-- Un giro: una ricarica al sotto-master per un gruppo di ricariche dei suoi clienti pagate in banca.
-- Niente cancellazioni a cascata: e' storia di soldi. Annullato = rettifica opposta, la riga resta.
create table if not exists public.giri_bonifici (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.masters(id),
  sotto_master_id uuid not null references public.masters(id),
  importo numeric(14,2) not null check (importo > 0),
  n_ricariche integer not null check (n_ricariche > 0),
  bonifici_dal date not null,
  bonifici_al date not null,
  ricarica_check_id uuid references public.ricariche_check(id),
  creato_da uuid,
  creato_il timestamptz not null default now(),
  annullato_il timestamptz,
  annullato_da uuid
);
create index if not exists giri_bonifici_master on public.giri_bonifici (master_id, creato_il desc);

-- Le ricariche dei clienti girate, col bonifico che le ha pagate. Una ricarica sta in un giro attivo solo:
-- lo garantisce l'indice, anche con due clic insieme.
create table if not exists public.giri_bonifici_ricariche (
  giro_id uuid not null references public.giri_bonifici(id),
  ricarica_id uuid not null references public.ricariche_check(id),
  riga_id uuid not null references public.estratti_righe(id),
  importo numeric(14,2) not null,
  attivo boolean not null default true,
  primary key (giro_id, ricarica_id)
);
create unique index if not exists giri_bonifici_ricarica_attiva on public.giri_bonifici_ricariche (ricarica_id) where attivo;
create index if not exists giri_bonifici_ricariche_riga on public.giri_bonifici_ricariche (riga_id) where attivo;

alter table public.conti_condivisi enable row level security;
alter table public.giri_bonifici enable row level security;
alter table public.giri_bonifici_ricariche enable row level security;
revoke all on table public.conti_condivisi, public.giri_bonifici, public.giri_bonifici_ricariche from public;
revoke all on table public.conti_condivisi, public.giri_bonifici, public.giri_bonifici_ricariche from anon;
revoke all on table public.conti_condivisi, public.giri_bonifici, public.giri_bonifici_ricariche from authenticated;
grant select, insert, update, delete on table public.conti_condivisi, public.giri_bonifici, public.giri_bonifici_ricariche to service_role;

-- Una ricarica girata resta abbinata al suo bonifico: scollegarla lascerebbe al sotto-master un credito
-- senza piu' i soldi dietro. Prima si annulla il giro.
create or replace function public.fn_abbinamento_girato() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.giri_bonifici_ricariche g where g.ricarica_id = old.ricarica_id and g.attivo) then
    raise exception 'Questa ricarica è già stata girata al sotto-master: prima annulla il giro' using errcode = 'P0001';
  end if;
  return old;
end $$;
drop trigger if exists trg_abbinamento_girato on public.abbinamenti_bonifici;
create trigger trg_abbinamento_girato before delete on public.abbinamenti_bonifici
  for each row execute function public.fn_abbinamento_girato();

-- IL GIRO: controlla, segna e ricarica in una transazione sola. Si girano solo ricariche del sotto-master
-- pagate da un bonifico del conto del master, dal giorno di conti_condivisi in poi, mai girate. La ricarica
-- passa da registra_movimento_master, la stessa della ricarica a mano (conto rete, saldo, movimento), e nel
-- Check Ricariche del master nasce gia' arrivata con metodo 'giro': i soldi sono quei bonifici.
create or replace function public.gira_bonifici_sotto_master(p_master uuid, p_sotto uuid, p_ricariche uuid[], p_creato_da uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_dal_min date; v_ids uuid[]; v_n integer; v_tot numeric; v_dal date; v_al date;
  v_giro uuid; v_check uuid; v_nome text; v_saldo numeric;
begin
  select giro_dal into v_dal_min from public.conti_condivisi where master_id = p_master and sotto_master_id = p_sotto;
  if v_dal_min is null then
    raise exception 'Questo sotto-master non paga sul tuo conto' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_ricariche, '{}')) x;
  if cardinality(v_ids) = 0 then
    raise exception 'Nessuna ricarica da girare' using errcode = 'P0001';
  end if;
  -- Due clic insieme non fanno due ricariche: un giro alla volta per sotto-master.
  perform pg_advisory_xact_lock(hashtextextended('giro_bonifici:' || p_sotto::text, 0));
  select count(*), round(sum(rc.importo), 2), min(er.data), max(er.data) into v_n, v_tot, v_dal, v_al
    from public.ricariche_check rc
    join public.abbinamenti_bonifici a on a.ricarica_id = rc.id and a.master_id = p_master
    join public.estratti_righe er on er.id = a.riga_id and er.master_id = p_master
   where rc.id = any(v_ids) and rc.master_id = p_sotto and er.data >= v_dal_min
     and not exists (select 1 from public.giri_bonifici_ricariche g where g.ricarica_id = rc.id and g.attivo);
  if v_n <> cardinality(v_ids) then
    raise exception 'Alcune ricariche non si possono più girare (già girate, scollegate o con il bonifico prima del %): ricarica la pagina',
      to_char(v_dal_min, 'DD/MM/YYYY') using errcode = 'P0001';
  end if;
  insert into public.giri_bonifici (master_id, sotto_master_id, importo, n_ricariche, bonifici_dal, bonifici_al, creato_da)
  values (p_master, p_sotto, v_tot, v_n, v_dal, v_al, p_creato_da) returning id into v_giro;
  insert into public.giri_bonifici_ricariche (giro_id, ricarica_id, riga_id, importo)
  select v_giro, rc.id, a.riga_id, rc.importo
    from public.ricariche_check rc join public.abbinamenti_bonifici a on a.ricarica_id = rc.id
   where rc.id = any(v_ids);
  v_saldo := public.registra_movimento_master(p_master, p_sotto, 'ricarica',
    format('Bonifici dei tuoi clienti arrivati dal %s al %s (%s ricariche)', to_char(v_dal, 'DD/MM/YYYY'), to_char(v_al, 'DD/MM/YYYY'), v_n),
    v_tot, 'giro ' || v_giro::text, null, p_creato_da);
  select nome into v_nome from public.masters where id = p_sotto;
  insert into public.ricariche_check (master_id, target_tipo, target_id, target_nome, importo, created_by,
    bonifico_effettuato_il, bonifico_arrivato_il, metodo, note)
  values (p_master, 'master', p_sotto, v_nome, v_tot, p_creato_da, now(), now(), 'giro',
    format('Giro di %s ricariche dei suoi clienti, bonifici dal %s al %s', v_n, to_char(v_dal, 'DD/MM/YYYY'), to_char(v_al, 'DD/MM/YYYY')))
  returning id into v_check;
  update public.giri_bonifici set ricarica_check_id = v_check where id = v_giro;
  return jsonb_build_object('giro', v_giro, 'importo', v_tot, 'ricariche', v_n, 'saldo', v_saldo, 'dal', v_dal, 'al', v_al);
end $$;

-- ANNULLARE UN GIRO: la rettifica opposta sul sotto-master, il giro resta segnato annullato, le ricariche
-- tornano girabili (e scollegabili). Lo storico non si cancella.
create or replace function public.annulla_giro_bonifici(p_master uuid, p_giro uuid, p_annullato_da uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g record; v_saldo numeric;
begin
  select * into g from public.giri_bonifici where id = p_giro and master_id = p_master for update;
  if not found then
    raise exception 'Giro non trovato' using errcode = 'P0001';
  end if;
  if g.annullato_il is not null then
    raise exception 'Questo giro è già stato annullato' using errcode = 'P0001';
  end if;
  v_saldo := public.registra_movimento_master(p_master, g.sotto_master_id, 'rettifica',
    format('Annullata la ricarica del %s per i bonifici dei tuoi clienti dal %s al %s',
      to_char(g.creato_il at time zone 'Europe/Rome', 'DD/MM/YYYY'), to_char(g.bonifici_dal, 'DD/MM/YYYY'), to_char(g.bonifici_al, 'DD/MM/YYYY')),
    -g.importo, 'giro ' || p_giro::text || ' annullato', null, p_annullato_da);
  update public.giri_bonifici set annullato_il = now(), annullato_da = p_annullato_da where id = p_giro;
  update public.giri_bonifici_ricariche set attivo = false where giro_id = p_giro;
  update public.ricariche_check
     set note = left(coalesce(note || ' · ', '') || 'giro annullato il ' || to_char(now() at time zone 'Europe/Rome', 'DD/MM/YYYY'), 500)
   where id = g.ricarica_check_id;
  return jsonb_build_object('importo', g.importo, 'saldo', v_saldo);
end $$;

revoke all on function public.gira_bonifici_sotto_master(uuid, uuid, uuid[], uuid) from public, anon, authenticated;
revoke all on function public.annulla_giro_bonifici(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.fn_abbinamento_girato() from public, anon, authenticated;
grant execute on function public.gira_bonifici_sotto_master(uuid, uuid, uuid[], uuid) to service_role;
grant execute on function public.annulla_giro_bonifici(uuid, uuid, uuid) to service_role;

-- Ecomize Solution: Ecomize LL e Dg Express pagano sul suo conto; fino al 10/11 girato a mano.
insert into public.conti_condivisi (master_id, sotto_master_id, giro_dal) values
  ('75b08143-26c8-4903-8091-cd03fbd635ed', '0bfa96db-0564-4d90-8f22-989db001f8ad', '2026-11-11'),
  ('75b08143-26c8-4903-8091-cd03fbd635ed', '394a68a7-c36b-4369-849b-31e0df8b206a', '2026-11-11')
on conflict (master_id, sotto_master_id) do nothing;
