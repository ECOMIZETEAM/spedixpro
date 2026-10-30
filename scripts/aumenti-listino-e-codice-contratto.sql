-- CODICE CONTRATTO + AUMENTI IN PERCENTUALE DEI LISTINI (richiesta di Lorenzo, 30/10/2026)
--
-- 1) CODICE CONTRATTO. Due contratti possono avere lo stesso nome: al 30/10 GTS EXPRESS ha tre "GLS CASERTA"
--    (uno comprato da MULTIEXPRESS, due suoi) e VTS EXPRESS due "Express Partenopeo". Col solo nome non si
--    puo' dire quale si intende. Ogni riga di `corrieri` (la copia di OGNI master) prende un codice breve,
--    tipo CT-7K3Q9X, che nasce con lei e non cambia mai.
--    NON e' `contratto_id`: quello e' l'id della riga di chi possiede il contratto all'origine (per il
--    SDA EXPRESS L di Ecomize LL, la riga di LOGIXIA). Mostrato a un master gli darebbe un riferimento a una
--    riga di un altro, e a due master confrontandoli direbbe che comprano lo stesso contratto. Il codice
--    nuovo e' solo un'etichetta della propria copia: non dice da chi la si compra e non apre niente.
--    Si vede ai master (pagine servite con la chiave di servizio, solo per le righe del master), non ai
--    clienti: per questo NON si aggiunge al grant SELECT per colonna di `authenticated` (la RLS
--    corrieri_leggi fa leggere al cliente i contratti del suo master). Le letture di `authenticated` che non
--    nominano la colonna non cambiano.
--    Il trigger la riscrive SEMPRE all'inserimento: una copia fatta ricopiando una riga intera non eredita
--    il codice dell'originale (il vincolo unico la rifiuterebbe e la copia del contratto fallirebbe).
--
-- 2) AUMENTI IN PERCENTUALE. Un master alza del X% un suo contratto su piu' listini cliente in un colpo
--    solo (esempio: Ecomize LL, SDA EXPRESS L, +5% su tutti i listini dei clienti). Decisioni di Lorenzo:
--    si scelgono i LISTINI (non i clienti); solo i prezzi per peso e zona (contrassegno, assicurazione,
--    giacenze e resi non si toccano); arrotondamento al centesimo (7,455 -> 7,46); solo aumenti.
--    Ogni aumento resta registrato riga per riga col prezzo prima e dopo, e si puo' ANNULLARE: si rimette
--    il prezzo esatto di prima (non un -5%: 7,10 +5% -5% fa 7,09), ma solo dove nessuno l'ha cambiato dopo.
--    L'editor del listino cancella e reinserisce le fasce a ogni salvataggio (id nuovi): l'annullo le
--    ritrova per listino, contratto, zona, tipo e peso, e col prezzo lasciato dall'aumento.
--    Le funzioni le chiama solo il server (chiave di servizio), dopo aver controllato l'utente; dentro
--    ricontrollano comunque che contratto e listini siano del master.
--
-- Si incolla tutto nel SQL Editor di Supabase. In fondo, le letture di controllo.

begin;

-- Aggiungere la colonna chiede `corrieri` tutta per se' fino al commit. Se una lettura lunga la sta usando,
-- invece di restare in coda (e far mettere in coda dietro di se' ogni richiesta che tocca i contratti,
-- creazione spedizioni compresa) lo script si ferma dopo 5 secondi senza aver cambiato niente: si riprova.
set local lock_timeout = '5s';

-- ── 1. CODICE CONTRATTO ─────────────────────────────────────────────────────────────────────────────────
create or replace function public.genera_codice_contratto()
returns text
language plpgsql
volatile
set search_path = public
as $f$
declare
  -- niente 0/O, 1/I/L: si legge e si detta al telefono senza equivoci
  alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := 'CT-';
    for i in 1..6 loop
      c := c || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1);
    end loop;
    exit when not exists (select 1 from public.corrieri where codice = c);
  end loop;
  return c;
end
$f$;

alter table public.corrieri add column if not exists codice text;
-- L'indice prima del riempimento: ogni codice nuovo si controlla sull'indice, non scorrendo la tabella
-- (i NULL non collidono fra loro).
create unique index if not exists uniq_corrieri_codice on public.corrieri (codice);

-- Le righe di oggi: si riempiono senza toccare updated_at (nessun contratto e' stato modificato davvero).
alter table public.corrieri disable trigger trg_corrieri_updated;
update public.corrieri set codice = public.genera_codice_contratto() where codice is null;
alter table public.corrieri enable trigger trg_corrieri_updated;

alter table public.corrieri alter column codice set not null;

-- DEFINER: deve leggere i codici esistenti, e `authenticated` (che inserisce contratti dal portale) quella
-- colonna non la legge. Un trigger scatta anche senza il permesso EXECUTE di chi scrive (come fn_audit).
create or replace function public.fn_corrieri_codice()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  if TG_OP = 'INSERT' then
    NEW.codice := public.genera_codice_contratto();
  elsif NEW.codice is distinct from OLD.codice then
    NEW.codice := OLD.codice;
  end if;
  return NEW;
end
$f$;

drop trigger if exists trg_corrieri_codice on public.corrieri;
create trigger trg_corrieri_codice
  before insert or update of codice on public.corrieri
  for each row execute function public.fn_corrieri_codice();

revoke all on function public.genera_codice_contratto() from public, anon, authenticated;
revoke all on function public.fn_corrieri_codice() from public, anon, authenticated;
grant execute on function public.genera_codice_contratto() to service_role;

-- ── 2. REGISTRO DEGLI AUMENTI ───────────────────────────────────────────────────────────────────────────
-- Storico: niente cancellazioni a cascata, niente vincoli verso listini e fasce (un listino cancellato
-- domani non deve portarsi via il registro di cosa gli e' stato fatto).
create table if not exists public.aumenti_listino (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null,
  corriere_id uuid not null,
  nome_contratto text not null,
  codice_contratto text,
  percentuale numeric(5,2) not null check (percentuale > 0 and percentuale <= 100),
  listini integer not null default 0,
  fasce integer not null default 0,
  -- lo stesso clic arrivato due volte (doppio clic, rete che ripete) non aumenta due volte
  richiesta_id uuid not null unique,
  creato_da uuid,
  creato_il timestamptz not null default now(),
  annullato_il timestamptz,
  annullato_da uuid,
  fasce_ripristinate integer,
  fasce_lasciate integer
);
create index if not exists idx_aumenti_listino_master on public.aumenti_listino (master_id, creato_il desc);

create table if not exists public.aumenti_listino_righe (
  id bigint generated always as identity primary key,
  aumento_id uuid not null references public.aumenti_listino (id),
  listino_id uuid not null,
  fascia_id uuid not null,
  corriere_id uuid not null,
  zona_id uuid,
  tipo text,
  peso_min numeric,
  peso_max numeric,
  prezzo_prima numeric(8,2) not null,
  prezzo_dopo numeric(8,2) not null
);
create index if not exists idx_aumenti_listino_righe_aumento on public.aumenti_listino_righe (aumento_id);

-- Solo il server (chiave di servizio): nessuna policy, nessun permesso agli utenti.
alter table public.aumenti_listino enable row level security;
alter table public.aumenti_listino_righe enable row level security;
revoke all on table public.aumenti_listino from public, anon, authenticated;
revoke all on table public.aumenti_listino_righe from public, anon, authenticated;
grant select, insert, update on table public.aumenti_listino to service_role;
grant select, insert on table public.aumenti_listino_righe to service_role;

-- ── 3. APPLICA ──────────────────────────────────────────────────────────────────────────────────────────
-- Tutto o niente: se una riga non si scrive, non resta un listino aumentato a meta'.
create or replace function public.applica_aumento_listino(
  p_master uuid, p_corriere uuid, p_listini uuid[], p_perc numeric, p_utente uuid, p_richiesta uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_id uuid;
  v_nome text;
  v_codice text;
  v_estranei integer;
  v_fasce integer;
  v_listini integer;
  v_perc numeric := round(p_perc, 2);
begin
  if v_perc is null or v_perc <= 0 or v_perc > 100 then
    raise exception 'Percentuale non valida: %', p_perc using errcode = '22023';
  end if;
  if p_listini is null or cardinality(p_listini) = 0 then
    raise exception 'Nessun listino scelto' using errcode = '22023';
  end if;
  select nome_contratto, codice into v_nome, v_codice from corrieri where id = p_corriere and master_id = p_master;
  if not found then
    raise exception 'Il contratto non e'' di questo master' using errcode = '42501';
  end if;
  select count(*) into v_estranei
    from unnest(p_listini) u(id)
   where not exists (select 1 from listini_clienti l where l.id = u.id and l.master_id = p_master);
  if v_estranei > 0 then
    raise exception '% listini non sono di questo master', v_estranei using errcode = '42501';
  end if;

  -- Aumenti e annulli dello stesso contratto dello stesso master, uno alla volta. E l'ora si prende DOPO
  -- essere entrati: e' quella che decide chi e' "l'ultimo" all'annullo, e deve seguire l'ordine in cui si
  -- scrive davvero (con now(), l'ora d'inizio, due aumenti contemporanei potevano risultare invertiti e un
  -- +X% restare nei listini per sempre).
  perform pg_advisory_xact_lock(hashtextextended('aumento_listino:' || p_master || ':' || p_corriere, 0));

  insert into aumenti_listino (master_id, corriere_id, nome_contratto, codice_contratto, percentuale, richiesta_id, creato_da, creato_il)
  values (p_master, p_corriere, v_nome, v_codice, v_perc, p_richiesta, p_utente, clock_timestamp())
  returning id into v_id;

  -- round() su numeric arrotonda il mezzo centesimo per eccesso: 7,10 x 1,05 = 7,455 -> 7,46.
  -- Le righe a 0 restano a 0 (e non si registrano): un aumento in % su zero non e' un aumento.
  with vecchie as (
    select f.id, f.prezzo
      from listini_clienti_fasce f
     where f.listino_id = any (p_listini) and f.corriere_id = p_corriere and f.prezzo > 0
       for update
  ), aggiornate as (
    update listini_clienti_fasce f
       set prezzo = round(v.prezzo * (1 + v_perc / 100), 2)
      from vecchie v
     where f.id = v.id
    returning f.id, f.listino_id, f.corriere_id, f.zona_id, f.tipo, f.peso_min, f.peso_max, v.prezzo as prima, f.prezzo as dopo
  )
  insert into aumenti_listino_righe (aumento_id, listino_id, fascia_id, corriere_id, zona_id, tipo, peso_min, peso_max, prezzo_prima, prezzo_dopo)
  select v_id, listino_id, id, corriere_id, zona_id, tipo, peso_min, peso_max, prima, dopo from aggiornate;
  get diagnostics v_fasce = row_count;

  if v_fasce = 0 then
    raise exception 'Nei listini scelti questo contratto non ha prezzi da aumentare' using errcode = '22023';
  end if;
  select count(distinct listino_id) into v_listini from aumenti_listino_righe where aumento_id = v_id;
  update aumenti_listino set listini = v_listini, fasce = v_fasce where id = v_id;

  return jsonb_build_object('id', v_id, 'listini', v_listini, 'fasce', v_fasce, 'percentuale', v_perc);
end
$f$;

-- ── 4. ANNULLA ──────────────────────────────────────────────────────────────────────────────────────────
-- Rimette il prezzo di prima solo dove c'e' ancora il prezzo lasciato dall'aumento. Se dopo il master ha
-- cambiato quella cella (dall'editor, o con un altro aumento), la sua scelta resta e la riga si conta fra
-- le "lasciate": l'annullo non cancella il lavoro fatto dopo.
create or replace function public.annulla_aumento_listino(p_aumento uuid, p_master uuid, p_utente uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_annullato timestamptz;
  v_creato timestamptz;
  v_corriere uuid;
  v_dopo timestamptz;
  v_rip integer;
  v_tot integer;
begin
  select corriere_id into v_corriere from aumenti_listino where id = p_aumento and master_id = p_master;
  if not found then
    raise exception 'Aumento non trovato' using errcode = '42501';
  end if;
  -- In fila con gli aumenti dello stesso contratto (vedi applica_aumento_listino).
  perform pg_advisory_xact_lock(hashtextextended('aumento_listino:' || p_master || ':' || v_corriere, 0));
  select annullato_il, creato_il into v_annullato, v_creato
    from aumenti_listino where id = p_aumento and master_id = p_master for update;
  if v_annullato is not null then
    raise exception 'Questo aumento e'' gia'' stato annullato' using errcode = '22023';
  end if;
  -- Si annulla dall'ultimo all'indietro. Con +5% e poi +2,5% sugli stessi listini, annullare il primo non
  -- troverebbe nessuna cella al suo prezzo (le ha cambiate tutte il secondo): non rimetterebbe niente ma
  -- risulterebbe annullato, e annullando poi il secondo il +5% resterebbe nei listini per sempre.
  select min(b.creato_il) into v_dopo
    from aumenti_listino b
   where b.master_id = p_master and b.corriere_id = v_corriere and b.annullato_il is null
     and b.creato_il > v_creato and b.id <> p_aumento
     and exists (select 1 from aumenti_listino_righe rb
                  where rb.aumento_id = b.id
                    and rb.listino_id in (select ra.listino_id from aumenti_listino_righe ra where ra.aumento_id = p_aumento));
  if v_dopo is not null then
    raise exception 'Prima va annullato l''aumento successivo dello stesso contratto (del %)',
      to_char(v_dopo at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI') using errcode = '22023';
  end if;

  with ripristinate as (
    update listini_clienti_fasce f
       set prezzo = r.prezzo_prima
      from aumenti_listino_righe r
     where r.aumento_id = p_aumento
       and f.listino_id = r.listino_id
       and f.corriere_id = r.corriere_id
       and f.zona_id is not distinct from r.zona_id
       and f.tipo is not distinct from r.tipo
       and f.peso_min is not distinct from r.peso_min
       and f.peso_max is not distinct from r.peso_max
       and f.prezzo = r.prezzo_dopo
    returning f.id
  )
  select count(*) into v_rip from ripristinate;
  select count(*) into v_tot from aumenti_listino_righe where aumento_id = p_aumento;

  update aumenti_listino
     set annullato_il = now(), annullato_da = p_utente,
         fasce_ripristinate = v_rip, fasce_lasciate = greatest(v_tot - v_rip, 0)
   where id = p_aumento;

  return jsonb_build_object('id', p_aumento, 'ripristinate', v_rip, 'lasciate', greatest(v_tot - v_rip, 0));
end
$f$;

revoke all on function public.applica_aumento_listino(uuid, uuid, uuid[], numeric, uuid, uuid) from public, anon, authenticated;
revoke all on function public.annulla_aumento_listino(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.applica_aumento_listino(uuid, uuid, uuid[], numeric, uuid, uuid) to service_role;
grant execute on function public.annulla_aumento_listino(uuid, uuid, uuid) to service_role;

commit;

-- ── CONTROLLI (dopo il commit) ──────────────────────────────────────────────────────────────────────────
-- Tutti i contratti hanno il codice, e sono tutti diversi:
--   select count(*) totale, count(codice) con_codice, count(distinct codice) diversi from public.corrieri;
-- Il cliente non lo legge (atteso: nessuna riga per 'codice'):
--   select grantee, privilege_type from information_schema.column_privileges
--    where table_name = 'corrieri' and column_name = 'codice' and grantee in ('anon','authenticated');
