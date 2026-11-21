-- ESENTE IVA, LA TERZA SCELTA SUI LISTINI (Lorenzo, 21/11/2026: "oltre a IVA inclusa o esclusa anche
-- esente IVA").
--
-- Accanto a «IVA esclusa» e «IVA inclusa» il master puo' dire che i prezzi di un listino, o di un solo
-- contratto, sono ESENTI IVA. Decisioni di Lorenzo (21/11/2026):
--   1. la scelta sta sul listino o sul contratto, come le altre due (scripts/iva-listini.sql);
--   2. i clienti con l'aliquota 0% in anagrafica (139, di 9 master) restano come sono: nessuno scrive
--      «Esente IVA» al posto del master;
--   3. si scrive solo «Esente IVA», senza il motivo dell'esenzione.
--
-- I MOVIMENTI NON CAMBIANO: il credito scala il prezzo del listino come sempre. Nei documenti le righe
-- esenti hanno IVA 0, anche se il cliente ha il 22%, e stanno su una riga loro, «Esente IVA».
--
-- Una colonna nuova sulle scelte: esente = iva_inclusa false + iva_esente true. Le righe di oggi hanno
-- tutte iva_esente false, quindi ogni funzione di oggi da' gli stessi numeri di prima.
--
-- LA REGOLA RESTA IN UN POSTO SOLO: fn_iva_regime_al (listino e contratto in un istante) e
-- fn_iva_vendita_regime (una spedizione venduta da un master). Le funzioni di ieri, che rispondono
-- "IVA inclusa si'/no", diventano una domanda a quelle due: nessuna precedenza scritta due volte.

begin;
-- La colonna nuova e il vincolo prendono la tabella delle scelte per un attimo. Mentre lo script aspetta,
-- aspettano anche i preventivi (le etichette IVA leggono questa tabella): se qualcuno la tiene occupata
-- oltre 2 secondi (un Report Fatture lungo) lo script si ferma senza fare niente e si rilancia.
set local lock_timeout = '2s';

-- ── 1. La scelta «esente» ──────────────────────────────────────────────────────────────────────
-- La tabella non si modifica riga per riga (trigger trg_listini_iva_solo_aggiunte): una colonna con
-- valore fisso non tocca le righe, le trova gia' a false.
alter table public.listini_iva add column if not exists iva_esente boolean not null default false;
alter table public.listini_iva drop constraint if exists listini_iva_esente_coerente;
-- Esente e' una scelta, non "come il listino": iva_inclusa deve essere false.
-- "is false" e non "= false": con iva_inclusa vuota il confronto darebbe NULL, e un vincolo NULL lascia passare.
alter table public.listini_iva add constraint listini_iva_esente_coerente check (not iva_esente or iva_inclusa is false);

-- ── 2. La regola ─────────────────────────────────────────────────────────────────────────────

-- Come e' venduto quel listino, per quel contratto, in quell'istante: 'inclusa', 'esclusa' o 'esente'.
-- La precedenza e' quella di ieri: vale l'ultima scelta FATTA fra quelle gia' in vigore in quell'istante;
-- la scelta sul contratto vince su quella del listino; "come il listino" (iva_inclusa null) rimanda al
-- listino; nessuna scelta = IVA esclusa, come i report di sempre.
create or replace function public.fn_iva_regime_al(p_listino uuid, p_corriere uuid, p_data timestamptz) returns text
language sql stable set search_path = public as $$
  select coalesce(
    (select case when c.iva_inclusa is null then null
                 when c.iva_esente then 'esente'
                 when c.iva_inclusa then 'inclusa'
                 else 'esclusa' end
       from public.listini_iva c
      where c.listino_id = p_listino and c.corriere_id = p_corriere and c.dal <= p_data
      order by c.creato_il desc, c.id desc limit 1),
    (select case when l.iva_esente then 'esente'
                 when l.iva_inclusa then 'inclusa'
                 else 'esclusa' end
       from public.listini_iva l
      where l.listino_id = p_listino and l.corriere_id is null and l.dal <= p_data
      order by l.creato_il desc, l.id desc limit 1),
    'esclusa')
$$;

-- Quella di ieri: "IVA inclusa?" e' una domanda alla regola sopra.
create or replace function public.fn_iva_inclusa_al(p_listino uuid, p_corriere uuid, p_data timestamptz) returns boolean
language sql stable set search_path = public as $$
  select public.fn_iva_regime_al(p_listino, p_corriere, p_data) = 'inclusa'
$$;

-- IL MOVIMENTO DI UNA SPEDIZIONE, VENDUTO DA p_venditore A UN CLIENTE O A UN SOTTO-MASTER: com'era
-- venduto? Tutto come fn_iva_vendita di ieri (scripts/iva-listini.sql), che qui si sposta:
-- - si guarda la SPEDIZIONE il giorno in cui e' nata; rettifiche, giacenze, resi e rimborsi seguono il
--   suo corriere (Lorenzo, 20/11/2026); gli altri movimenti non sono il listino: IVA esclusa;
-- - il contratto e' quello DEL VENDITORE: sui condivisi e sulla rete si cerca la sua copia per nome
--   (spazi ai bordi tolti, minuscolo, come lib/contratto-per-nome.ts); senza copia, IVA esclusa;
-- - si legge dalle SCELTE, non da listini_clienti: un listino cancellato dopo non cambia i mesi passati.
create or replace function public.fn_iva_vendita_regime(
  p_venditore uuid, p_tipo_soggetto text, p_soggetto uuid, p_spedizione uuid, p_tipo_movimento text default 'spedizione'
) returns text
language plpgsql stable set search_path = public as $$
declare v_corr uuid; v_data timestamptz; v_corr_master uuid; v_nome text; v_listino uuid; v_mio uuid;
begin
  if p_venditore is null or p_soggetto is null or p_spedizione is null then return 'esclusa'; end if;
  if coalesce(p_tipo_movimento, '') not in ('spedizione', 'rettifica', 'giacenza', 'reso', 'rimborso') then return 'esclusa'; end if;
  -- Via veloce: chi non ha mai toccato la scelta vende tutto IVA esclusa.
  if not exists (select 1 from public.listini_iva where master_id = p_venditore) then return 'esclusa'; end if;
  select s.corriere_id, s.created_at into v_corr, v_data from public.spedizioni s where s.id = p_spedizione;
  if v_corr is null or v_data is null then return 'esclusa'; end if;
  v_listino := public.fn_listino_al(p_tipo_soggetto, p_soggetto, v_data);
  if v_listino is null then return 'esclusa'; end if;
  -- Valgono solo le scelte del venditore sui listini suoi; un listino senza scelte e' IVA esclusa.
  if not exists (select 1 from public.listini_iva where listino_id = v_listino and master_id = p_venditore) then return 'esclusa'; end if;
  select c.master_id, c.nome_contratto into v_corr_master, v_nome from public.corrieri c where c.id = v_corr;
  if v_corr_master = p_venditore then
    v_mio := v_corr;
  else
    -- Due copie con lo stesso nome presso lo stesso master esistono (GTS, 'GLS CASERTA'): vince quella
    -- scelta su quel listino, poi quella che sta nel listino, poi la piu' vecchia.
    select c.id into v_mio from public.corrieri c
     where c.master_id = p_venditore
       and lower(btrim(c.nome_contratto, E' \t\r\n ')) = lower(btrim(v_nome, E' \t\r\n '))
     order by exists (select 1 from public.listini_iva li where li.listino_id = v_listino and li.corriere_id = c.id) desc,
              exists (select 1 from public.listini_clienti_corrieri lc where lc.listino_id = v_listino and lc.corriere_id = c.id) desc,
              c.created_at, c.id
     limit 1;
    if v_mio is null then return 'esclusa'; end if;
  end if;
  return public.fn_iva_regime_al(v_listino, v_mio, v_data);
end $$;

-- Quella di ieri: la usano iva_vendite_spedizioni e i Report Fatture v2/v3, finche' il codice nuovo non e' online.
create or replace function public.fn_iva_vendita(
  p_venditore uuid, p_tipo_soggetto text, p_soggetto uuid, p_spedizione uuid, p_tipo_movimento text default 'spedizione'
) returns boolean
language sql stable set search_path = public as $$
  select public.fn_iva_vendita_regime(p_venditore, p_tipo_soggetto, p_soggetto, p_spedizione, p_tipo_movimento) = 'inclusa'
$$;

-- Per i report: tante righe in una chiamata. p_righe = [{"i":0,"t":"cliente","s":"<id>","p":"<spedizione>","m":"spedizione"}, ...]
create or replace function public.iva_vendite_regime(p_venditore uuid, p_righe jsonb)
returns table(i int, regime text)
language sql stable set search_path = public as $$
  select (e->>'i')::int,
         public.fn_iva_vendita_regime(p_venditore, e->>'t', nullif(e->>'s', '')::uuid, nullif(e->>'p', '')::uuid, coalesce(e->>'m', 'spedizione'))
    from jsonb_array_elements(coalesce(p_righe, '[]'::jsonb)) e
$$;

-- Report Fatture: come la v3, con 'inclusa' / 'esclusa' / 'esente' al posto di IVA inclusa si'/no.
-- La rotta legge a pagine da 1.000: l'ordine e' fisso.
create or replace function public.fatture_importi_periodo_v4(p_master uuid, p_dal timestamptz, p_al timestamptz)
returns table(cliente_id uuid, tipo text, con_spedizione boolean, regime text, aliquota_compresa numeric, n bigint, importo numeric)
language sql stable set search_path = public as $$
  with usa as (select exists (select 1 from public.listini_iva where master_id = p_master) as si)
  select m.cliente_id, m.tipo, (m.spedizione_id is not null),
         case when (select si from usa) and m.spedizione_id is not null
              then public.fn_iva_vendita_regime(p_master, 'cliente', m.cliente_id, m.spedizione_id, m.tipo)
              else 'esclusa' end,
         c.aliquota,
         count(*), sum(m.importo)
    from public.movimenti m
    left join public.movimenti_iva_compresa c on c.movimento_id = m.id
   where m.master_id = p_master
     and m.cliente_id is not null
     and m.master_target_id is null
     and m.created_at >= p_dal
     and m.created_at <= p_al
   group by 1, 2, 3, 4, 5
   order by 1, 2, 3, 4, 5
$$;

-- ── 3. Scrivere una scelta ───────────────────────────────────────────────────────────────────
-- p_regime: 'inclusa', 'esclusa' o 'esente'; sul contratto anche null = "come il listino". La data di
-- partenza la calcola il database sul giorno di Roma ('mese' = dal primo del mese, 'oggi' = da oggi).
-- La rotta controlla prima chi e' (staff del master del listino).
create or replace function public.listini_iva_imposta_regime(
  p_master uuid, p_listino uuid, p_corriere uuid, p_regime text, p_da text, p_utente uuid
) returns timestamptz
language plpgsql set search_path = public as $$
declare v_dal timestamptz;
begin
  if not exists (select 1 from public.listini_clienti where id = p_listino and master_id = p_master) then
    raise exception 'Listino non trovato';
  end if;
  if p_regime is not null and p_regime not in ('inclusa', 'esclusa', 'esente') then raise exception 'Scelta non valida'; end if;
  if p_corriere is null and p_regime is null then raise exception 'Scelta non valida'; end if;
  if p_corriere is not null and not exists (select 1 from public.corrieri where id = p_corriere and master_id = p_master) then
    raise exception 'Contratto non trovato';
  end if;
  v_dal := case p_da
    when 'mese' then date_trunc('month', now() at time zone 'Europe/Rome') at time zone 'Europe/Rome'
    when 'oggi' then date_trunc('day', now() at time zone 'Europe/Rome') at time zone 'Europe/Rome'
  end;
  if v_dal is null then raise exception 'Data di partenza non valida'; end if;
  insert into public.listini_iva (master_id, listino_id, corriere_id, iva_inclusa, iva_esente, dal, creato_da)
  values (p_master, p_listino, p_corriere,
          case p_regime when 'inclusa' then true when 'esclusa' then false when 'esente' then false end,
          coalesce(p_regime = 'esente', false), v_dal, p_utente);
  return v_dal;
end $$;

-- Quella di ieri (la chiama l'editor gia' aperto nei browser, finche' non si ricarica): passa da quella nuova.
create or replace function public.listini_iva_imposta(
  p_master uuid, p_listino uuid, p_corriere uuid, p_iva_inclusa boolean, p_da text, p_utente uuid
) returns timestamptz
language sql set search_path = public as $$
  select public.listini_iva_imposta_regime(p_master, p_listino, p_corriere,
    case p_iva_inclusa when true then 'inclusa' when false then 'esclusa' end, p_da, p_utente)
$$;

-- Duplicare un listino porta con se' anche come era venduto, esente compreso: le scelte in vigore oggi
-- sul listino di partenza, valide da sempre sulla copia.
create or replace function public.listini_iva_copia(p_master uuid, p_da_listino uuid, p_a_listino uuid, p_utente uuid)
returns int
language plpgsql set search_path = public as $$
declare v_n int := 0;
begin
  if not exists (select 1 from public.listini_clienti where id = p_da_listino and master_id = p_master)
     or not exists (select 1 from public.listini_clienti where id = p_a_listino and master_id = p_master) then
    raise exception 'Listino non trovato';
  end if;
  insert into public.listini_iva (master_id, listino_id, corriere_id, iva_inclusa, iva_esente, dal, creato_da)
  select p_master, p_a_listino, u.corriere_id, u.iva_inclusa, u.iva_esente, '-infinity'::timestamptz, p_utente
    from (select distinct on (corriere_id) corriere_id, iva_inclusa, iva_esente
            from public.listini_iva
           where listino_id = p_da_listino and dal <= now()
           order by corriere_id, creato_il desc, id desc) u
   where u.corriere_id is null or u.iva_inclusa is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Le funzioni nuove nascono eseguibili da tutti: si chiudono come le altre. Le "create or replace" di
-- quelle che c'erano gia' tengono i permessi di ieri; si richiudono lo stesso, non costa niente.
revoke all on function public.fn_iva_regime_al(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.fn_iva_inclusa_al(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.fn_iva_vendita_regime(uuid, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fn_iva_vendita(uuid, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.iva_vendite_regime(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fatture_importi_periodo_v4(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.listini_iva_imposta_regime(uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.listini_iva_imposta(uuid, uuid, uuid, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public.listini_iva_copia(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_iva_regime_al(uuid, uuid, timestamptz) to service_role;
grant execute on function public.fn_iva_vendita_regime(uuid, text, uuid, uuid, text) to service_role;
grant execute on function public.iva_vendite_regime(uuid, jsonb) to service_role;
grant execute on function public.fatture_importi_periodo_v4(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.listini_iva_imposta_regime(uuid, uuid, uuid, text, text, uuid) to service_role;

commit;

-- Dopo: advisors di sicurezza (obiettivo zero errori) e, in sola lettura,
--   select count(*) filter (where iva_esente) as esenti, count(*) from listini_iva;   -- 0 esenti finche' nessuno sceglie
