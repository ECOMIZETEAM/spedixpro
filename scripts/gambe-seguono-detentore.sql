-- I LIVELLI DI UN PACCO VENDUTO FRA RETI SEGUONO IL LIVELLO DEL DETENTORE
--
-- Un pacco su un contratto condiviso (albero-ponte o via codice) ha una riga per livello, tutte con lo
-- stesso tracking: quella del cliente, quelle dei master che rivendono, e in fondo quella del DETENTORE,
-- l'unica con la LDV vera presso il corriere. Ogni riga punta alla riga del suo venditore con
-- raw_response->>'venditore_spedizione_id'; quella del detentore non punta a nessuno.
--
-- Perché sta nel database. L'annullo della LDV avviene sulla riga del detentore, da porte diverse: la
-- conferma della coda manuale («Segna annullato»), l'annullo immediato Spedisci del portale, lo storno DVA
-- confermato, il tracking che scrive 'annullata' dal fornitore. Nessuna di queste toccava le altre righe.
-- Caso vero, 026031010041765 (18/11/2026): Velox annulla la LDV BRT e rimborsa SEMPLICE SPEDIRE; la riga
-- di SEMPLICE, intestata ad Atlantik, resta "spedita" e Atlantik resta addebitata di 5,45 € per otto
-- giorni, finché non la si annulla a mano (26/11). Una regola messa in ogni porta prima o poi ne perde una.
--
-- Cosa fa, solo quando cambia lo stato della riga del DETENTORE di un pacco a più righe:
--   1. diventa 'annullata'        → le altre righe ancora ferme diventano 'annullata'. Il rimborso lo fa la
--                                   coda annulli_da_rimborsare (trg_annullo_da_rimborsare, giro addebiti-code),
--                                   con i suoi controlli: niente rimborso se la riga risulta partita.
--   2. va in coda (annullamento_manuale / storno_richiesto) → le altre righe ferme passano ad
--                                   'annullamento_manuale' SENZA owner: chi le guarda vede «Annullo in corso»,
--                                   ma nella coda del detentore resta una riga sola, la sua.
--   3. esce dalla coda senza annullarsi (pacco partito, ripristino) → le righe messe in coda dal punto 2
--                                   tornano allo stato di prima.
-- Le righe già partite (in viaggio, consegnate, in giacenza, rese) non si toccano mai: se il detentore
-- dice "annullata" e un livello sotto risulta in viaggio, c'è qualcosa da guardare a mano, non da decidere.
--
-- Non rimborsa niente da sé: cambia solo lo stato. I soldi restano a rimborsaAnnulloSpedizione.
-- Un errore qui NON deve bloccare la scrittura del detentore (tracking, conferma, storno): ogni riga si scrive
-- nel suo blocco, e quella che non si scrive finisce in gambe_pacco_anomalie (la conta la sentinella), mentre
-- la riga del detentore e le altre passano lo stesso.
--
-- Ogni riga seguita apre una sotto-transazione: una correzione di massa dal SQL Editor che annulla centinaia di
-- detentori in un solo UPDATE ne aprirebbe centinaia insieme. Le correzioni di massa si fanno a blocchi piccoli.
--
-- Da lanciare nel SQL Editor PRIMA di rilasciare il codice dell'annullo per pacco.

-- Le righe che non si riescono a far seguire finiscono qui: nei log di Postgres non le leggerebbe nessuno.
-- Le conta la sentinella (app/api/controllo/sentinella). Solo il server ci scrive e legge.
create table if not exists public.gambe_pacco_anomalie (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  detentore_id  uuid not null,
  spedizione_id uuid,
  numero        text,
  evento        text not null,
  errore        text not null
);
alter table public.gambe_pacco_anomalie enable row level security;
revoke all on table public.gambe_pacco_anomalie from public;
revoke all on table public.gambe_pacco_anomalie from anon;
revoke all on table public.gambe_pacco_anomalie from authenticated;
revoke all on sequence public.gambe_pacco_anomalie_id_seq from public;
revoke all on sequence public.gambe_pacco_anomalie_id_seq from anon;
revoke all on sequence public.gambe_pacco_anomalie_id_seq from authenticated;

create or replace function public.fn_gambe_seguono_detentore()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo   text;
  v_altre  uuid[];
  v_evento text;
  v_lock   text;
  r        record;
begin
  -- Solo la riga del detentore: nessun venditore sopra, contratto vero (non un ponte).
  if new.tracking_number is null or (new.raw_response->>'venditore_spedizione_id') is not null then
    return new;
  end if;
  select c.tipo into v_tipo from corrieri c where c.id = new.corriere_id;
  if v_tipo is null or v_tipo = 'moovexpress' then
    return new;
  end if;

  if new.stato = 'annullata' then
    v_evento := 'annullata';
  elsif new.stato in ('annullamento_manuale', 'storno_richiesto')
        and coalesce(old.stato, '') not in ('annullamento_manuale', 'storno_richiesto', 'annullata') then
    v_evento := 'in_coda';
  elsif old.stato in ('annullamento_manuale', 'storno_richiesto')
        and new.stato not in ('annullata', 'annullamento_manuale', 'storno_richiesto', 'annullamento_pending') then
    v_evento := 'uscita_dalla_coda';
  else
    return new;
  end if;

  begin
    -- Le altre righe del pacco: stesso tracking E collegate al detentore dai puntatori, anche a più salti.
    -- Il solo tracking non basta: due corrieri diversi possono riusare lo stesso numero.
    with recursive fila(id) as (
      select new.id
      union
      select g.id
      from spedizioni g
      join fila f on (g.raw_response->>'venditore_spedizione_id') = f.id::text
      where g.tracking_number = new.tracking_number
    )
    select array_agg(id) into v_altre from fila where id <> new.id;
  exception when others then
    begin
      insert into gambe_pacco_anomalie (detentore_id, numero, evento, errore) values (new.id, new.numero, v_evento, 'righe del pacco non lette: ' || sqlerrm);
    exception when others then raise warning '[gambe-seguono-detentore] % : %', new.numero, sqlerrm;
    end;
    return new;
  end;

  if v_altre is null then
    return new;   -- pacco di una riga sola: niente da seguire
  end if;

  -- Una riga alla volta, ognuna nel suo blocco: se una non si scrive (un altro trigger, un vincolo), le altre
  -- seguono lo stesso e quella finisce in gambe_pacco_anomalie. La riga del detentore passa comunque.
  for r in select g.id, g.numero, g.stato, g.stato_precedente, g.annullamento_owner_id from spedizioni g where g.id = any(v_altre)
  loop
    begin
      -- Una riga tenuta da un'altra transazione si aspetta al massimo 2 secondi: il giro del tracking puo' scriverla
      -- nello stesso istante, e quella contesa dura millisecondi. Oltre, lock_not_available lo prende il gestore qui
      -- sotto (la riga va fra le anomalie, le altre seguono): un'attesa lunga finita in timeout farebbe fallire la
      -- scrittura del detentore. Il limite vale solo qui: si rimette quello di prima, e se il blocco fallisce
      -- Postgres lo annulla da se' con la sotto-transazione.
      v_lock := current_setting('lock_timeout');
      perform set_config('lock_timeout', '2s', true);
      perform 1 from spedizioni where id = r.id for update;
      perform set_config('lock_timeout', v_lock, true);
      -- 1. LDV annullata: si annullano le righe ancora ferme (il rimborso lo fa la coda annulli_da_rimborsare).
      if v_evento = 'annullata' then
        if r.stato in ('in_lavorazione', 'spedita', 'annullamento_pending', 'annullamento_manuale', 'storno_richiesto') then
          update spedizioni g set
            stato = 'annullata',
            stato_precedente = case when r.stato in ('annullamento_pending', 'annullamento_manuale', 'storno_richiesto')
                                    then coalesce(r.stato_precedente, 'in_lavorazione') else r.stato end,
            annullamento_richiesto_at = coalesce(new.annullamento_richiesto_at, g.annullamento_richiesto_at, now()),
            annullamento_da = coalesce(g.annullamento_da, new.annullamento_da),
            annullamento_owner_id = null,
            annullamento_errore = null
          where g.id = r.id and g.stato = r.stato;
        end if;

      -- 2. Il detentore entra in coda: le altre righe ferme mostrano l'annullo in corso, senza owner.
      elsif v_evento = 'in_coda' then
        if r.stato in ('in_lavorazione', 'spedita', 'annullamento_pending') then
          update spedizioni g set
            stato = 'annullamento_manuale',
            stato_precedente = case when r.stato = 'annullamento_pending'
                                    then coalesce(r.stato_precedente, 'in_lavorazione') else r.stato end,
            annullamento_richiesto_at = coalesce(new.annullamento_richiesto_at, now()),
            annullamento_da = coalesce(g.annullamento_da, new.annullamento_da),
            annullamento_owner_id = null,
            annullamento_errore = null
          where g.id = r.id and g.stato = r.stato;
        end if;

      -- 3. Il detentore esce dalla coda senza annullarsi: tornano com'erano le righe messe in coda al punto 2
      --    (owner nullo = in coda per il detentore, non per conto proprio). Se il cliente ha già rifatto la
      --    spedizione per lo stesso ordine, il vincolo uniq_sped_ordine_attivo_v2 rifiuta il ripristino di
      --    quella riga, che resta in coda col motivo.
      else
        if r.stato = 'annullamento_manuale' and r.annullamento_owner_id is null then
          begin
            update spedizioni g set
              stato = coalesce(r.stato_precedente, 'in_lavorazione'),
              annullamento_richiesto_at = null,
              annullamento_owner_id = null,
              annullamento_errore = new.annullamento_errore
            where g.id = r.id and g.stato = r.stato;
          exception when unique_violation then
            update spedizioni g set
              annullamento_errore = 'Il detentore non ha annullato la spedizione, ma non si può rimettere attiva: per lo stesso ordine ne esiste già un''altra.'
            where g.id = r.id and g.stato = r.stato;
            insert into gambe_pacco_anomalie (detentore_id, spedizione_id, numero, evento, errore)
              values (new.id, r.id, r.numero, v_evento, 'ripristino rifiutato: stesso ordine già rispedito');
          end;
        end if;
      end if;
    exception when others then
      begin
        insert into gambe_pacco_anomalie (detentore_id, spedizione_id, numero, evento, errore)
          values (new.id, r.id, r.numero, v_evento, sqlerrm);
      exception when others then raise warning '[gambe-seguono-detentore] % / % : %', new.numero, r.numero, sqlerrm;
      end;
    end;
  end loop;

  return new;
end;
$$;

revoke all on function public.fn_gambe_seguono_detentore() from public;
revoke all on function public.fn_gambe_seguono_detentore() from anon;
revoke all on function public.fn_gambe_seguono_detentore() from authenticated;

drop trigger if exists trg_gambe_seguono_detentore on public.spedizioni;
create trigger trg_gambe_seguono_detentore
  after update of stato on public.spedizioni
  for each row
  when (old.stato is distinct from new.stato and (
        new.stato in ('annullata', 'annullamento_manuale', 'storno_richiesto')
        or old.stato in ('annullamento_manuale', 'storno_richiesto')))
  execute function public.fn_gambe_seguono_detentore();

-- CONTROLLO DI OGNI MATTINA (Sentinella, app/api/controllo/sentinella): l'annullo dei pacchi fra reti si rompe
-- senza errori visibili, quindi si contano gli effetti. Sola lettura, solo service_role. Le annullate si leggono
-- dall'indice (stato, updated_at) negli ultimi 3 giorni: una riga annullata non la tocca piu' il tracking, salvo
-- la sorveglianza SDA EXPRESS L, che le rilegge per 30 giorni (poche migliaia di righe).
create or replace function public.controllo_annulli_pacco()
 returns table(area text, controllo text, valore numeric, atteso text, allarme boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $$
  with ann as (
    select s.id, s.tracking_number, (s.raw_response->>'venditore_spedizione_id') as vend, c.tipo
    from spedizioni s join corrieri c on c.id = s.corriere_id
    where s.stato = 'annullata' and s.updated_at > now() - interval '3 days' and s.tracking_number is not null
  ),
  ferme_sotto as (
    select coalesce(sum(x.n), 0) n
    from ann d
    cross join lateral (
      select count(*) n from spedizioni g
      where g.tracking_number = d.tracking_number and g.id <> d.id
        and (g.raw_response->>'venditore_spedizione_id') is not null
        and g.stato in ('in_lavorazione', 'spedita', 'annullamento_pending', 'annullamento_manuale', 'storno_richiesto')
    ) x
    where d.vend is null and d.tipo <> 'moovexpress'
  ),
  -- LATERAL ... LIMIT 1: si parte dalle poche annullate recenti e si cerca per tracking. Con un join normale il
  -- planner sceglieva di scorrere tutte le spedizioni attive (spedita / in lavorazione) leggendone il JSON.
  sopra_annullate as (
    select count(*) n
    from ann a
    cross join lateral (
      select 1 from spedizioni d join corrieri cd on cd.id = d.corriere_id
      where d.tracking_number = a.tracking_number and d.id <> a.id
        and (d.raw_response->>'venditore_spedizione_id') is null and cd.tipo <> 'moovexpress'
        and d.stato in ('in_lavorazione', 'spedita', 'annullamento_pending')
      limit 1
    ) x
    where a.vend is not null
  ),
  senza_detentore as (
    select count(*) n
    from spedizioni s join corrieri c on c.id = s.corriere_id
    where s.stato = 'annullamento_manuale' and s.annullamento_owner_id is null and c.tipo <> 'moovexpress'
  ),
  ponti_orfani as (
    select count(*) n
    from spedizioni s join corrieri c on c.id = s.corriere_id
    where s.stato = 'annullamento_manuale' and s.annullamento_owner_id is null and c.tipo = 'moovexpress'
      and not exists (
        select 1 from spedizioni d join corrieri cd on cd.id = d.corriere_id
        where d.tracking_number = s.tracking_number and d.id <> s.id and cd.tipo <> 'moovexpress'
          and (d.raw_response->>'venditore_spedizione_id') is null
          and d.stato in ('annullamento_manuale', 'storno_richiesto'))
  ),
  fermi as (
    select count(*) n from spedizioni s where s.stato = 'annullamento_pending' and s.annullamento_richiesto_at is null
  ),
  anomalie as (
    select count(*) n from gambe_pacco_anomalie where at > now() - interval '48 hours'
  )
  select 'annulli dei pacchi fra reti', 'righe che non hanno seguito il detentore (ultime 48 ore)', n, '0', n > 0 from anomalie
  union all
  select 'annulli dei pacchi fra reti', 'righe ancora ferme sotto un detentore annullato (ultimi 3 giorni)', n, '0', n > 0 from ferme_sotto
  union all
  select 'annulli dei pacchi fra reti', 'righe annullate sopra un detentore ancora attivo (ultimi 3 giorni)', n, '0', n > 0 from sopra_annullate
  union all
  select 'annulli dei pacchi fra reti', 'annulli in coda manuale senza detentore (non li vede nessuno)', n, '0', n > 0 from senza_detentore
  union all
  select 'annulli dei pacchi fra reti', 'righe-ponte in «annullo in corso» con il detentore non in coda', n, '0', n > 0 from ponti_orfani
  union all
  select 'annulli dei pacchi fra reti', 'annulli fermi: rifiutati dal corriere e non ripristinabili (stesso ordine rispedito)', n, '0', n > 0 from fermi;
$$;

revoke all on function public.controllo_annulli_pacco() from public, anon, authenticated;
grant execute on function public.controllo_annulli_pacco() to service_role;
