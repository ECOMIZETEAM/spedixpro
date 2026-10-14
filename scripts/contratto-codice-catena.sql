-- ════════════════════════════════════════════════════════════════════════════
-- CONTRATTO: un CODICE proprio e "DA CHI LO COMPRO" (fase 1 — solo dati, nessun lettore)
--
-- Decisione di Lorenzo (14/10/2026): "ogni contratto deve avere un codice identificativo,
-- così anche con due nomi uguali saranno due contratti diversi" e "lascia stare l'albero:
-- MULTI lo vende a GTS che lo rivende a spedizioni 2000. Semplice e lineare".
--
-- Fino a oggi due righe `corrieri` erano "lo stesso contratto" se avevano lo stesso NOME e
-- stavano una sotto l'altra nell'ALBERO dei master. Da lì i guasti: le due 'GLS CASERTA' che
-- GTS ha creato il 03/09 sul SUO account Spedisci risultano copie di quella di MULTI (stesso
-- nome) — nascoste dalla pausa di MULTI, sovrascrivibili dalle sue propagazioni; e un contratto
-- rivenduto tra fratelli (GTS → spedizioni 2000) non ha una fila che arrivi a MULTI, perché
-- 2000 non sta sotto GTS: contrassegni "fuori dalla tua rete", rettifiche "fuori catena".
--
-- Il modello nuovo, su ogni riga:
--   fornitore_corriere_id  la riga da cui questo master COMPRA il contratto (NULL = detentore:
--                          il contratto è suo, sul suo account). Una fila sola, lineare.
--   collegamento_id        se lo compra con un collegamento a codice (corrieri_condivisi), quale:
--                          dice su che conto si paga quel salto (il ledger del collegamento).
--                          NULL = salto d'albero, si paga sul conto verso il padre.
--   contratto_id           il CODICE del contratto: l'id della riga del detentore, uguale su
--                          tutte le copie. Due contratti con lo stesso nome hanno codici diversi.
--
-- FASE 1 (questo script): colonne + riempimento da come stanno le cose oggi + regole che
-- tengono i puntatori giusti. NESSUN codice li legge ancora: soldi, viste e permessi non
-- cambiano di un centesimo. Li leggeranno, uno alla volta e prima in ombra, resi, giacenze,
-- contrassegni e rettifiche (fase 2), poi la creazione (fase 3), per ultimo il flag `proprio`.
--
-- Riempimento — le regole che oggi usa la piattaforma, senza indovinare:
--   1) riga reale con proprio=true                  → detentore (fornitore NULL)
--   2) ponte (tipo 'moovexpress') nato da un collegamento tra il suo master e il venditore
--      scritto nelle credenziali                     → la riga d'origine del venditore
--      (NON basta la chiave nelle credenziali: 4 ponti — Ecomize Solution, Ecomize LL,
--      M&R Sprint, sdl — portano la chiave di MULTI ma nessun collegamento: comprano dal padre)
--   3) tutto il resto                               → la riga del padre con lo stesso nome
--      (verificato il 14/10: ognuna delle 699 copie ne ha esattamente una, della stessa classe)
--   Eccezione decisa coi dati: le 2 'GLS CASERTA' di GTS create il 03/09 (c9eef630, bb5136ad)
--   stanno sul dominio Spedisci di GTS, con utente e codice contratto suoi — non su quello di
--   MULTI. Sono contratti di GTS: detentore. Oggi hanno 0 spedizioni e 0 clienti; il flag
--   `proprio` resta com'è finché non cambia la regola che lo calcola (ultima fase).
--
-- CANCELLAZIONI: nessun vincolo di chiave esterna sui puntatori, di proposito. Se si cancella la
-- riga da cui un'altra compra, quella resta col puntatore a una riga che non c'è più e col codice
-- di prima: il fatto ("lo comprava da lì, e lì non c'è più") resta scritto, e la sentinella lo
-- segnala (fornitore_cancellato). Le alternative erano peggio: con ON DELETE SET NULL la copia
-- diventerebbe in silenzio "detentrice" di un contratto che spedisce sull'account di un altro
-- (oggi, per una copia intermedia cancellata, la piattaforma la SOSPENDE: la sua copia resta
-- proprio=false e la catena dei contratti la nasconde come "tolto"); con RESTRICT si bloccherebbe
-- dal portale una cancellazione che oggi riesce, e quella è una decisione di Lorenzo.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- corrieri è letta da ogni preventivo e ogni spedizione (~10 istruzioni al secondo, ~35 nell'ora di
-- punta). I lucchetti si prendono SUBITO e in ordine, con un'attesa corta: se non arrivano entro un
-- secondo si annulla tutto e si riprova, invece di mettere in fila il portale dietro la migrazione.
-- Una volta presi, la transazione dura una frazione di secondo (801 righe).
set local lock_timeout = '1s';
set local statement_timeout = '15s';
lock table public.corrieri_condivisi in share row exclusive mode;
lock table public.corrieri in access exclusive mode;

alter table public.corrieri
  add column contratto_id uuid,
  add column fornitore_corriere_id uuid,
  add column collegamento_id uuid,
  add constraint corrieri_fornitore_non_se_stesso check (fornitore_corriere_id is distinct from id);

comment on column public.corrieri.contratto_id is
  'Codice del contratto: id della riga del detentore, uguale su tutte le copie. Due contratti con lo stesso nome hanno codici diversi. Lo calcola il database dal fornitore (trg_corrieri_catena_contratto).';
comment on column public.corrieri.fornitore_corriere_id is
  'La riga da cui questo master compra il contratto (NULL = detentore, contratto sul suo account). La fila dei fornitori è la catena del contratto: lineare, non l''albero dei master. Se la riga puntata non esiste più, è stata cancellata: la fila è interrotta.';
comment on column public.corrieri.collegamento_id is
  'Collegamento a codice (corrieri_condivisi) con cui si compra dal fornitore: il salto si paga sul ledger del collegamento. NULL = salto d''albero, conto verso il padre.';

create index corrieri_fornitore_corriere_idx on public.corrieri (fornitore_corriere_id) where fornitore_corriere_id is not null;
create index corrieri_contratto_idx on public.corrieri (contratto_id);
create index corrieri_collegamento_idx on public.corrieri (collegamento_id) where collegamento_id is not null;

-- ── Riempimento ─────────────────────────────────────────────────────────────
-- updated_at non deve dire "modificati tutti oggi": i contratti non sono cambiati.
alter table public.corrieri disable trigger trg_corrieri_updated;

with c as (
  select c.id, c.master_id, c.tipo, c.proprio, c.credenziali, c.created_at, m.parent_master_id par,
         lower(trim(c.nome_contratto)) nn
  from public.corrieri c join public.masters m on m.id = c.master_id
),
ponte_link as (
  select distinct on (c.id) c.id, l.id link_id, o.id origine
  from c
  join public.corrieri_condivisi l
    on l.master_id = c.master_id and l.fornitore_master_id::text = c.credenziali->>'fornitore_master_id'
  join public.corrieri o
    on o.id::text = c.credenziali->>'corriere_origine_id' and o.master_id = l.fornitore_master_id
  where c.tipo = 'moovexpress'
  order by c.id, (l.stato = 'attiva') desc, l.created_at desc
),
padre as (
  select c.id,
         (array_agg(p.id order by ((p.tipo = 'moovexpress') = (c.tipo = 'moovexpress')) desc,
                                  (p.credenziali = c.credenziali) desc, p.created_at))[1] fornitore
  from c join c p on p.master_id = c.par and p.nn = c.nn
  group by c.id
),
calc as (
  select c.id,
    case
      when c.tipo <> 'moovexpress' and c.proprio then null
      when c.id in ('c9eef630-c80a-4ced-8bde-22ca627304f1', 'bb5136ad-ba49-4fe7-85eb-836f7aab443d') then null
      when pl.id is not null then pl.origine
      else pa.fornitore
    end fornitore,
    pl.link_id collegamento
  from c left join ponte_link pl on pl.id = c.id left join padre pa on pa.id = c.id
)
update public.corrieri x set fornitore_corriere_id = calc.fornitore, collegamento_id = calc.collegamento
from calc where calc.id = x.id;

with recursive salita as (
  select id partenza, id riga, fornitore_corriere_id su, 0 salti from public.corrieri
  union all
  select s.partenza, k.id, k.fornitore_corriere_id, s.salti + 1
  from salita s join public.corrieri k on k.id = s.su
  where s.salti < 25
)
update public.corrieri x set contratto_id = d.riga
from (select partenza, riga from salita where su is null) d
where d.partenza = x.id;

alter table public.corrieri enable trigger trg_corrieri_updated;

-- ── Controlli: se una sola regola non torna, non si scrive niente ───────────
do $$
declare
  v_n int;
begin
  select count(*) into v_n from public.corrieri where contratto_id is null;
  if v_n > 0 then raise exception 'catena contratti: % righe senza codice contratto (catena rotta o ciclo)', v_n; end if;

  select count(*) into v_n from public.corrieri c
   where c.fornitore_corriere_id is not null and not exists (select 1 from public.corrieri f where f.id = c.fornitore_corriere_id);
  if v_n > 0 then raise exception 'catena contratti: % puntatori a righe inesistenti', v_n; end if;

  select count(*) into v_n from public.corrieri where tipo = 'moovexpress' and fornitore_corriere_id is null;
  if v_n > 0 then raise exception 'catena contratti: % ponti senza fornitore', v_n; end if;

  -- Oggi "detentore" (proprio) e "nessun fornitore" devono coincidere, tranne le 2 righe di GTS.
  select count(*) into v_n from public.corrieri
   where tipo <> 'moovexpress' and proprio <> (fornitore_corriere_id is null)
     and id not in ('c9eef630-c80a-4ced-8bde-22ca627304f1', 'bb5136ad-ba49-4fe7-85eb-836f7aab443d');
  if v_n > 0 then raise exception 'catena contratti: % righe dove detentore e puntatore non coincidono', v_n; end if;

  select count(*) into v_n from public.corrieri
   where id in ('c9eef630-c80a-4ced-8bde-22ca627304f1', 'bb5136ad-ba49-4fe7-85eb-836f7aab443d')
     and (fornitore_corriere_id is not null or contratto_id <> id);
  if v_n <> 0 then raise exception 'catena contratti: le 2 GLS CASERTA di GTS non risultano contratti suoi'; end if;

  -- Salto d'albero = dal padre; salto a collegamento = tra compratore e venditore del collegamento.
  select count(*) into v_n
    from public.corrieri c join public.masters m on m.id = c.master_id join public.corrieri f on f.id = c.fornitore_corriere_id
   where c.collegamento_id is null and f.master_id is distinct from m.parent_master_id;
  if v_n > 0 then raise exception 'catena contratti: % salti d''albero che non vanno al padre', v_n; end if;

  select count(*) into v_n
    from public.corrieri c join public.corrieri f on f.id = c.fornitore_corriere_id
    left join public.corrieri_condivisi l on l.id = c.collegamento_id
   where c.collegamento_id is not null and (l.id is null or l.master_id <> c.master_id or l.fornitore_master_id <> f.master_id);
  if v_n > 0 then raise exception 'catena contratti: % salti a collegamento incoerenti', v_n; end if;

  -- Una copia reale non compra da un ponte, un ponte senza collegamento compra solo da un ponte,
  -- e una riga reale non ha un collegamento.
  select count(*) into v_n
    from public.corrieri c join public.corrieri f on f.id = c.fornitore_corriere_id
   where (c.tipo <> 'moovexpress' and f.tipo = 'moovexpress')
      or (c.tipo = 'moovexpress' and c.collegamento_id is null and f.tipo <> 'moovexpress');
  select v_n + count(*) into v_n from public.corrieri where tipo <> 'moovexpress' and collegamento_id is not null;
  if v_n > 0 then raise exception 'catena contratti: % righe che comprano da una riga di classe diversa', v_n; end if;

  -- Il codice è quello del fornitore (a parte i detentori, che hanno il proprio).
  select count(*) into v_n
    from public.corrieri c join public.corrieri f on f.id = c.fornitore_corriere_id
   where c.contratto_id <> f.contratto_id;
  select v_n + count(*) into v_n from public.corrieri where fornitore_corriere_id is null and contratto_id <> id;
  if v_n > 0 then raise exception 'catena contratti: % codici contratto incoerenti', v_n; end if;

  -- SDA EXPRESS L: MULTI compra da Wave, Wave da LOGIXIA (detentrice), tutte con lo stesso codice.
  if (select fornitore_corriere_id from public.corrieri where id = '71ed4539-d98d-470e-95af-34253fd9fae9') is distinct from '33be9163-5b40-4ed1-b147-8891181565cf'
     or (select collegamento_id from public.corrieri where id = '71ed4539-d98d-470e-95af-34253fd9fae9') is distinct from '003d3baa-7138-4ded-b907-02b68cef8bfe'
     or (select fornitore_corriere_id from public.corrieri where id = '33be9163-5b40-4ed1-b147-8891181565cf') is distinct from '04fb8429-7b83-4179-b404-0454f5263a7f'
     or (select collegamento_id from public.corrieri where id = '33be9163-5b40-4ed1-b147-8891181565cf') is distinct from '272a3509-8aa3-4f5b-a3d5-8c777ba67cc2'
     or (select contratto_id from public.corrieri where id = '71ed4539-d98d-470e-95af-34253fd9fae9') is distinct from '04fb8429-7b83-4179-b404-0454f5263a7f' then
    raise exception 'catena contratti: la fila di SDA EXPRESS L non è MULTI → Wave → LOGIXIA';
  end if;
end $$;

-- ── Regole che tengono i puntatori giusti da qui in avanti ──────────────────
-- Prima di ogni inserimento, e quando si tocca una colonna che conta per la fila:
--  • dal PORTALE nasce sempre un contratto NUOVO del master, sul suo account (fornitore NULL):
--    il nome uguale a quello di un antenato non lo rende una copia (le 2 'GLS CASERTA' di GTS);
--  • dal PORTALE non si cambiano, con un UPDATE diretto, né i puntatori né `proprio`, `tipo`,
--    `master_id`, `id`. Nessuna pagina lo fa; lo poteva fare solo una richiesta costruita a mano,
--    e su `proprio` costava soldi: la catena si ferma alla prima riga proprio=true, quindi un master
--    che dichiarava "propria" la sua copia smetteva di pagare chi gliela vende (che intanto paga il
--    corriere) finché un ricalcolo globale non lo rimetteva a posto. Il portale si riconosce da
--    current_user: per questo la funzione è SECURITY INVOKER;
--  • il codice di servizio che non passa ancora il puntatore (cascata dei listini, ponti della
--    condivisione) lo ottiene come lo ricava oggi la piattaforma: ponte con collegamento → riga
--    d'origine del venditore; altrimenti la riga del padre con lo stesso nome e della stessa classe,
--    e fra più righe omonime quella con le stesse credenziali (la cascata le copia dalla sorgente:
--    GTS ha 3 'GLS CASERTA', e solo le credenziali dicono quale si sta copiando);
--  • quando la condivisione riscrive le credenziali di un ponte per un collegamento ATTIVO (Assegna su
--    un ponte che c'era già: collegamento revocato e rifatto, oppure una copia che ha ancora le
--    credenziali colate dal padre), il ponte passa a comprare da quel collegamento;
--  • un puntatore scritto apposta dal codice di servizio deve stare in piedi: dal padre senza
--    collegamento, dal venditore col collegamento, senza giri;
--  • il codice contratto non si scrive: si eredita dal fornitore. Se il fornitore non c'è più
--    (cancellato) si tiene quello di prima.
create or replace function public.fn_corrieri_catena_contratto()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_portale boolean := current_user in ('authenticated', 'anon');
  v_par uuid;
  v_link uuid;
  v_origine uuid;
  v_cod uuid;
  v_f record;
  v_l record;
  v_cur uuid;
  v_salti int := 0;
begin
  if tg_op = 'UPDATE' then
    if v_portale then
      if new.fornitore_corriere_id is distinct from old.fornitore_corriere_id
         or new.collegamento_id is distinct from old.collegamento_id
         or new.contratto_id is distinct from old.contratto_id
         or new.proprio is distinct from old.proprio
         or new.tipo is distinct from old.tipo
         or new.master_id is distinct from old.master_id
         or new.id is distinct from old.id then
        raise exception 'Da chi si compra un contratto, se è proprio, il suo tipo e il suo master non si cambiano dal portale.'
          using errcode = '42501';
      end if;
      return new;
    end if;

    -- Ponte a cui la condivisione riscrive le credenziali per un collegamento ATTIVO: compra da lì.
    if new.tipo = 'moovexpress' and pg_trigger_depth() = 1
       and new.credenziali is distinct from old.credenziali
       and new.fornitore_corriere_id is not distinct from old.fornitore_corriere_id
       and new.collegamento_id is not distinct from old.collegamento_id then
      select l.id, o.id into v_link, v_origine
        from public.corrieri_condivisi l
        join public.corrieri o on o.id::text = new.credenziali->>'corriere_origine_id' and o.master_id = l.fornitore_master_id
       where l.master_id = new.master_id
         and l.fornitore_master_id::text = new.credenziali->>'fornitore_master_id'
         and l.stato = 'attiva'
       order by l.created_at desc
       limit 1;
      if v_origine is not null
         and (v_origine is distinct from new.fornitore_corriere_id or v_link is distinct from new.collegamento_id) then
        new.fornitore_corriere_id := v_origine;
        new.collegamento_id := v_link;
      end if;
    end if;

    if (new.fornitore_corriere_id is not distinct from old.fornitore_corriere_id
        and new.collegamento_id is not distinct from old.collegamento_id)
       or pg_trigger_depth() > 1 then
      -- Puntatori invariati (ricalcolo di `proprio`, credenziali, spostamenti) o discesa del codice
      -- lungo la fila: il codice si ricalcola dal fornitore, e non si solleva mai un errore.
      if new.fornitore_corriere_id is null then
        new.contratto_id := new.id;
      else
        select f.contratto_id into v_cod from public.corrieri f where f.id = new.fornitore_corriere_id;
        new.contratto_id := coalesce(v_cod, old.contratto_id);
      end if;
      return new;
    end if;
    -- Puntatore cambiato apposta dal codice di servizio: deve stare in piedi (controlli sotto).
  elsif v_portale then
    if new.tipo = 'moovexpress' then
      raise exception 'Un contratto condiviso nasce solo da un collegamento, non dal portale.'
        using errcode = '42501';
    end if;
    new.fornitore_corriere_id := null;
    new.collegamento_id := null;
    new.contratto_id := new.id;
    return new;
  elsif new.fornitore_corriere_id is null and new.collegamento_id is null then
    -- Codice di servizio che non dice da chi si compra: si ricava come oggi. Valido per costruzione.
    if new.tipo = 'moovexpress' then
      select l.id, o.id into v_link, v_origine
        from public.corrieri_condivisi l
        join public.corrieri o on o.id::text = new.credenziali->>'corriere_origine_id' and o.master_id = l.fornitore_master_id
       where l.master_id = new.master_id
         and l.fornitore_master_id::text = new.credenziali->>'fornitore_master_id'
       order by (l.stato = 'attiva') desc, l.created_at desc
       limit 1;
      if v_origine is not null then
        new.fornitore_corriere_id := v_origine;
        new.collegamento_id := v_link;
      end if;
    end if;
    if new.fornitore_corriere_id is null then
      select parent_master_id into v_par from public.masters where id = new.master_id;
      if v_par is not null then
        select p.id into new.fornitore_corriere_id
          from public.corrieri p
         where p.master_id = v_par
           and lower(trim(p.nome_contratto)) = lower(trim(new.nome_contratto))
           and (p.tipo = 'moovexpress') = (new.tipo = 'moovexpress')
         order by (p.credenziali = new.credenziali) desc, p.created_at
         limit 1;
      end if;
    end if;
    if new.fornitore_corriere_id is null then
      new.contratto_id := new.id;
    else
      select f.contratto_id into v_cod from public.corrieri f where f.id = new.fornitore_corriere_id;
      new.contratto_id := coalesce(v_cod, new.fornitore_corriere_id);
    end if;
    return new;
  end if;

  -- Puntatore scritto apposta dal codice di servizio (inserimento o modifica diretta).
  if new.fornitore_corriere_id is null then
    if new.collegamento_id is not null then
      raise exception 'Un collegamento senza fornitore non ha senso (corriere %).', new.id;
    end if;
    new.contratto_id := new.id;
    return new;
  end if;

  if new.fornitore_corriere_id = new.id then
    raise exception 'Un contratto non si compra da se stesso (corriere %).', new.id;
  end if;

  select id, master_id, tipo, contratto_id into v_f from public.corrieri where id = new.fornitore_corriere_id;
  if not found then
    raise exception 'Fornitore % inesistente (corriere %).', new.fornitore_corriere_id, new.id;
  end if;

  if new.collegamento_id is null then
    select parent_master_id into v_par from public.masters where id = new.master_id;
    if v_f.master_id is distinct from v_par then
      raise exception 'Senza collegamento si compra solo dal padre (corriere %, fornitore %).', new.id, new.fornitore_corriere_id;
    end if;
    if (new.tipo = 'moovexpress') <> (v_f.tipo = 'moovexpress') then
      raise exception 'Una copia d''albero è della stessa classe del contratto del padre (corriere %).', new.id;
    end if;
  else
    select master_id, fornitore_master_id into v_l from public.corrieri_condivisi where id = new.collegamento_id;
    if not found or v_l.master_id <> new.master_id or v_l.fornitore_master_id <> v_f.master_id then
      raise exception 'Il collegamento % non lega questo master al suo fornitore (corriere %).', new.collegamento_id, new.id;
    end if;
    if new.tipo <> 'moovexpress' then
      raise exception 'Con un collegamento si compra solo con un contratto condiviso (corriere %).', new.id;
    end if;
  end if;

  -- Nessun giro: salendo dal fornitore non si deve ritrovare questa riga.
  v_cur := v_f.id;
  while v_cur is not null loop
    v_salti := v_salti + 1;
    if v_cur = new.id or v_salti > 25 then
      raise exception 'La catena dei fornitori farebbe un giro (corriere %).', new.id;
    end if;
    select fornitore_corriere_id into v_cur from public.corrieri where id = v_cur;
  end loop;

  new.contratto_id := coalesce(v_f.contratto_id, v_f.id);
  return new;
end
$$;

-- Quando il codice di una riga cambia (puntatore corretto dal codice di servizio, ponte passato a un
-- collegamento), cambia anche quello di chi compra da lei, giù per tutta la fila. SECURITY DEFINER:
-- gli AFTER girano come l'utente dell'istruzione che li ha accodati, e la discesa deve arrivare anche
-- alle righe di master fuori dalla sua rete (un ponte di un compratore a codice), che il portale non
-- vede e non può scrivere. Il portale non può innescarla: la guardia sopra respinge ogni sua modifica.
create or replace function public.fn_corrieri_catena_propaga()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.contratto_id is distinct from old.contratto_id then
    update public.corrieri set contratto_id = new.contratto_id
     where fornitore_corriere_id = new.id and contratto_id is distinct from new.contratto_id;
  end if;
  return null;
end
$$;

create trigger trg_corrieri_catena_contratto
  before insert or update of fornitore_corriere_id, collegamento_id, contratto_id, proprio, tipo, master_id, id, credenziali
  on public.corrieri
  for each row execute function public.fn_corrieri_catena_contratto();

create trigger trg_corrieri_catena_propaga
  after update of fornitore_corriere_id, collegamento_id, contratto_id, credenziali on public.corrieri
  for each row execute function public.fn_corrieri_catena_propaga();

-- ── Lettura: la fila del contratto a partire da una riga ────────────────────
-- livello 0 = la riga data; ogni livello dice come quel master paga il successivo:
-- 'albero' (conto verso il padre, masters.credito), 'collegamento' (ledger presso il venditore),
-- 'detentore' (fine della fila: il contratto è suo), 'interrotta' (la riga da cui comprava è stata
-- cancellata: la fila non arriva a nessun detentore).
create or replace function public.catena_contratto(p_corriere_id uuid)
returns table (livello int, corriere_id uuid, master_id uuid, tipo text, salto text, collegamento_id uuid, ledger_cliente_id uuid, contratto_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  with recursive fila as (
    select 0 lv, c.id, c.master_id, c.tipo, c.fornitore_corriere_id su, c.collegamento_id, c.contratto_id
      from public.corrieri c where c.id = p_corriere_id
    union all
    select f.lv + 1, k.id, k.master_id, k.tipo, k.fornitore_corriere_id, k.collegamento_id, k.contratto_id
      from fila f join public.corrieri k on k.id = f.su
     where f.lv < 25
  )
  select f.lv, f.id, f.master_id, f.tipo,
         case when f.su is null then 'detentore'
              when not exists (select 1 from public.corrieri x where x.id = f.su) then 'interrotta'
              when f.collegamento_id is not null then 'collegamento'
              else 'albero' end,
         f.collegamento_id, l.cliente_ledger_id, f.contratto_id
    from fila f left join public.corrieri_condivisi l on l.id = f.collegamento_id
   order by f.lv
$$;

-- ── Sentinella: tutto ciò che nella fila non torna (oggetto vuoto = sano) ───
create or replace function public.controllo_catena_contratti()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with recursive salita as (
    select id partenza, id riga, fornitore_corriere_id su, 0 salti from public.corrieri
    union all
    select s.partenza, k.id, k.fornitore_corriere_id, s.salti + 1
      from salita s join public.corrieri k on k.id = s.su where s.salti < 25
  ),
  fine as (select partenza, riga detentore from salita where su is null)
  select jsonb_strip_nulls(jsonb_build_object(
    -- la riga da cui comprava è stata cancellata: la fila non arriva a un detentore
    'fornitore_cancellato', (select jsonb_agg(c.id) from public.corrieri c where c.fornitore_corriere_id is not null
                              and not exists (select 1 from public.corrieri f where f.id = c.fornitore_corriere_id)),
    'collegamento_cancellato', (select jsonb_agg(c.id) from public.corrieri c where c.collegamento_id is not null
                                 and not exists (select 1 from public.corrieri_condivisi l where l.id = c.collegamento_id)),
    'codice_incoerente', (select jsonb_agg(c.id) from public.corrieri c join fine on fine.partenza = c.id where c.contratto_id is distinct from fine.detentore),
    'ponte_detentore', (select jsonb_agg(id) from public.corrieri where tipo = 'moovexpress' and fornitore_corriere_id is null),
    'albero_non_dal_padre', (select jsonb_agg(c.id) from public.corrieri c join public.masters m on m.id = c.master_id
                              join public.corrieri f on f.id = c.fornitore_corriere_id
                             where c.collegamento_id is null and f.master_id is distinct from m.parent_master_id),
    'collegamento_incoerente', (select jsonb_agg(c.id) from public.corrieri c join public.corrieri f on f.id = c.fornitore_corriere_id
                                 join public.corrieri_condivisi l on l.id = c.collegamento_id
                                where l.master_id <> c.master_id or l.fornitore_master_id <> f.master_id),
    -- comprato da un collegamento non più attivo mentre per la stessa coppia ce n'è uno attivo
    'collegamento_non_attivo', (select jsonb_agg(c.id) from public.corrieri c join public.corrieri_condivisi l on l.id = c.collegamento_id
                                 where l.stato <> 'attiva' and exists (select 1 from public.corrieri_condivisi a where a.stato = 'attiva'
                                   and a.master_id = l.master_id and a.fornitore_master_id = l.fornitore_master_id)),
    'classe_diversa', (select jsonb_agg(c.id) from public.corrieri c join public.corrieri f on f.id = c.fornitore_corriere_id
                        where (c.tipo <> 'moovexpress' and f.tipo = 'moovexpress')
                           or (c.tipo = 'moovexpress' and c.collegamento_id is null and f.tipo <> 'moovexpress')),
    'reale_con_collegamento', (select jsonb_agg(id) from public.corrieri where tipo <> 'moovexpress' and collegamento_id is not null),
    -- il flag di oggi e il puntatore non dicono la stessa cosa (escluse le 2 GLS CASERTA di GTS, decise)
    'proprio_diverso_dal_puntatore', (select jsonb_agg(id) from public.corrieri where tipo <> 'moovexpress' and proprio <> (fornitore_corriere_id is null)
                                       and id not in ('c9eef630-c80a-4ced-8bde-22ca627304f1', 'bb5136ad-ba49-4fe7-85eb-836f7aab443d')),
    -- una copia che spedisce su un account diverso da quello di chi gliela vende
    'credenziali_diverse_dal_fornitore', (select jsonb_agg(c.id) from public.corrieri c join public.corrieri f on f.id = c.fornitore_corriere_id
                                           where c.tipo <> 'moovexpress' and c.credenziali is distinct from f.credenziali),
    'nome_diverso_dal_fornitore', (select jsonb_agg(c.id) from public.corrieri c join public.corrieri f on f.id = c.fornitore_corriere_id
                                    where lower(trim(c.nome_contratto)) <> lower(trim(f.nome_contratto))),
    'stesso_contratto_due_volte', (select jsonb_agg(x) from (select master_id, contratto_id, count(*) n from public.corrieri
                                    group by 1, 2 having count(*) > 1) x)
  ))
$$;

revoke all on function public.fn_corrieri_catena_contratto() from public, anon, authenticated;
revoke all on function public.fn_corrieri_catena_propaga() from public, anon, authenticated;
revoke all on function public.catena_contratto(uuid) from public, anon, authenticated;
revoke all on function public.controllo_catena_contratti() from public, anon, authenticated;
grant execute on function public.catena_contratto(uuid) to service_role;
grant execute on function public.controllo_catena_contratti() to service_role;

commit;
