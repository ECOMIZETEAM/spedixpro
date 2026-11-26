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
-- Un errore qui NON deve bloccare la scrittura del detentore (tracking, conferma, storno): si registra un
-- avviso nei log di Postgres e la riga del detentore passa lo stesso. Le righe rimaste indietro le mostra la
-- query di controllo in fondo a questo file.
--
-- Da lanciare nel SQL Editor PRIMA di rilasciare il codice dell'annullo per pacco.

create or replace function public.fn_gambe_seguono_detentore()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo  text;
  v_altre uuid[];
  r       record;
begin
  -- Solo la riga del detentore: nessun venditore sopra, contratto vero (non un ponte).
  if new.tracking_number is null or (new.raw_response->>'venditore_spedizione_id') is not null then
    return new;
  end if;
  select c.tipo into v_tipo from corrieri c where c.id = new.corriere_id;
  if v_tipo is null or v_tipo = 'moovexpress' then
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

    if v_altre is null then
      return new;   -- pacco di una riga sola: niente da seguire
    end if;

    -- 1. LDV annullata: si annullano le righe ancora ferme.
    if new.stato = 'annullata' then
      update spedizioni g set
        stato = 'annullata',
        stato_precedente = case when g.stato in ('annullamento_pending', 'annullamento_manuale', 'storno_richiesto')
                                then coalesce(g.stato_precedente, 'in_lavorazione') else g.stato end,
        annullamento_richiesto_at = coalesce(new.annullamento_richiesto_at, g.annullamento_richiesto_at, now()),
        annullamento_da = coalesce(g.annullamento_da, new.annullamento_da),
        annullamento_owner_id = null,
        annullamento_errore = null
      where g.id = any(v_altre)
        and g.stato in ('in_lavorazione', 'spedita', 'annullamento_pending', 'annullamento_manuale', 'storno_richiesto');

    -- 2. Il detentore entra in coda: le altre righe ferme mostrano l'annullo in corso.
    elsif new.stato in ('annullamento_manuale', 'storno_richiesto')
          and coalesce(old.stato, '') not in ('annullamento_manuale', 'storno_richiesto', 'annullata') then
      update spedizioni g set
        stato = 'annullamento_manuale',
        stato_precedente = case when g.stato = 'annullamento_pending'
                                then coalesce(g.stato_precedente, 'in_lavorazione') else g.stato end,
        annullamento_richiesto_at = coalesce(new.annullamento_richiesto_at, now()),
        annullamento_da = coalesce(g.annullamento_da, new.annullamento_da),
        annullamento_owner_id = null,
        annullamento_errore = null
      where g.id = any(v_altre)
        and g.stato in ('in_lavorazione', 'spedita', 'annullamento_pending');

    -- 3. Il detentore esce dalla coda senza annullarsi: tornano com'erano le righe messe in coda al punto 2
    --    (owner nullo = in coda per il detentore, non per conto proprio). Una alla volta: se il cliente ha
    --    già rifatto la spedizione per lo stesso ordine, il vincolo uniq_sped_ordine_attivo_v2 rifiuta il
    --    ripristino di quella riga, e quella sola resta in coda col motivo.
    elsif old.stato in ('annullamento_manuale', 'storno_richiesto')
          and new.stato not in ('annullata', 'annullamento_manuale', 'storno_richiesto', 'annullamento_pending') then
      for r in
        select g.id from spedizioni g
        where g.id = any(v_altre) and g.stato = 'annullamento_manuale' and g.annullamento_owner_id is null
      loop
        begin
          update spedizioni g set
            stato = coalesce(g.stato_precedente, 'in_lavorazione'),
            annullamento_richiesto_at = null,
            annullamento_owner_id = null,
            annullamento_errore = new.annullamento_errore
          where g.id = r.id;
        exception when unique_violation then
          update spedizioni g set
            annullamento_errore = 'Il detentore non ha annullato la spedizione, ma non si può rimettere attiva: per lo stesso ordine ne esiste già un''altra.'
          where g.id = r.id;
        end;
      end loop;
    end if;

  exception when others then
    raise warning '[gambe-seguono-detentore] % (%): %', new.numero, new.id, sqlerrm;
  end;

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

-- CONTROLLO (sola lettura): pacchi a più righe col detentore annullato e un livello sotto ancora fermo.
-- Deve tornare vuoto. Leggero: parte dalle annullate recenti (indice su stato) e legge per tracking.
--
-- with det as (
--   select s.id, s.tracking_number from spedizioni s join corrieri c on c.id = s.corriere_id
--   where s.stato = 'annullata' and s.created_at > now() - interval '60 days'
--     and c.tipo <> 'moovexpress' and (s.raw_response->>'venditore_spedizione_id') is null
-- )
-- select g.numero, g.stato, det.tracking_number
-- from det join spedizioni g on g.tracking_number = det.tracking_number and g.id <> det.id
-- where (g.raw_response->>'venditore_spedizione_id') is not null
--   and g.stato in ('in_lavorazione', 'spedita', 'annullamento_pending', 'annullamento_manuale', 'storno_richiesto');
