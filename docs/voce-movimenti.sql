-- VOCE DEI MOVIMENTI A MANO (24/11/2026). Perche': docs/voce-movimenti-database.md; le voci: lib/movimento-manuale.ts.
--
-- Chi scrive un movimento a mano dalla scheda cliente o sotto-master ora sceglie che cos'e' (ricarica, pagamento
-- fattura, giacenza, bonus...) e la voce resta sulla riga. Il guadagno la legge: i soldi che passano tra le parti
-- (ricarica, fattura, contrassegni, credito trasferito, storno, altro) non sono guadagno; i costi del master senza
-- spedizione (spedizione fatta fuori dal portale, compenso agente, bonus) lo sono. Lo storico resta senza voce
-- (Lorenzo: «lascerei quello che fino ad oggi hanno scritto e fatto così come è»): i numeri di prima non cambiano.
--
-- Tutto in una transazione: o passa tutto o niente. Il blocco sulla tabella dura un attimo (niente riscrittura delle
-- righe), e se una lettura lunga lo tiene occupato la migrazione si ferma invece di far aspettare le spedizioni.

set lock_timeout = '5s';

-- 1. LA COLONNA ------------------------------------------------------------------------------------------------------
alter table public.movimenti add column voce text;

-- NOT VALID: il controllo vale per ogni riga nuova o modificata senza rileggere tutto il registro, che e' vuoto.
alter table public.movimenti add constraint movimenti_voce_valida check (
  voce is null or voce = any (array['ricarica','fattura','contrassegni','trasferimento','storno','altro',
                                    'giacenza','rettifica','reso','rimborso',
                                    'fuori_portale','compenso_agente','bonus'])
) not valid;

comment on column public.movimenti.voce is
  'Voce scelta da chi ha scritto il movimento a mano (lib/movimento-manuale.ts). Vuota per i movimenti automatici e per quelli scritti prima del 24/11/2026.';

-- 2. LA SCRITTURA ----------------------------------------------------------------------------------------------
-- Le due funzioni che muovono il credito (registra_movimento_cliente e registra_movimento_master) NON si toccano: la
-- logica dei soldi resta in un posto solo. Accanto a ciascuna nasce una versione con lo stesso nome che chiede la voce
-- come campo OBBLIGATORIO: una chiamata senza voce (tutti i movimenti automatici) trova solo la versione di sempre,
-- una con la voce trova solo questa, quindi non c'e' mai da scegliere fra le due. Questa segna la voce per la durata
-- della transazione, chiama la funzione di sempre e il controllo sulla tabella la copia sulla riga appena scritta.
-- SECURITY INVOKER: i controlli su chi puo' scrivere restano quelli della funzione di sempre, col ruolo di chi chiama.

CREATE FUNCTION public.fn_voce_movimento()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  -- La voce arriva solo dalle due funzioni qui sotto, e solo per la loro transazione (set_config locale): ogni altro
  -- movimento la trova vuota e resta come prima.
  if new.voce is null then
    new.voce := nullif(current_setting('moovexpress.voce_movimento', true), '');
  end if;
  return new;
end;
$function$;

revoke all on function public.fn_voce_movimento() from public, anon, authenticated;

CREATE TRIGGER trg_voce_movimento BEFORE INSERT ON public.movimenti FOR EACH ROW EXECUTE FUNCTION fn_voce_movimento();

CREATE FUNCTION public.registra_movimento_cliente(p_master_id uuid, p_cliente_id uuid, p_tipo text, p_descrizione text, p_importo numeric, p_riferimento text, p_spedizione_id uuid, p_created_by uuid, p_richiedi_capienza boolean, p_voce text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
declare v_saldo numeric;
begin
  perform set_config('moovexpress.voce_movimento', coalesce(p_voce, ''), true);
  v_saldo := public.registra_movimento_cliente(p_master_id, p_cliente_id, p_tipo, p_descrizione, p_importo,
                                               p_riferimento, p_spedizione_id, p_created_by, coalesce(p_richiedi_capienza, false));
  perform set_config('moovexpress.voce_movimento', '', true);
  return v_saldo;
end;
$function$;

revoke all on function public.registra_movimento_cliente(uuid, uuid, text, text, numeric, text, uuid, uuid, boolean, text) from public, anon;
grant execute on function public.registra_movimento_cliente(uuid, uuid, text, text, numeric, text, uuid, uuid, boolean, text) to authenticated, service_role;

CREATE FUNCTION public.registra_movimento_master(p_master_owner_id uuid, p_master_target_id uuid, p_tipo text, p_descrizione text, p_importo numeric, p_riferimento text, p_spedizione_id uuid, p_created_by uuid, p_voce text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
declare v_saldo numeric;
begin
  perform set_config('moovexpress.voce_movimento', coalesce(p_voce, ''), true);
  v_saldo := public.registra_movimento_master(p_master_owner_id, p_master_target_id, p_tipo, p_descrizione, p_importo,
                                              p_riferimento, p_spedizione_id, p_created_by);
  perform set_config('moovexpress.voce_movimento', '', true);
  return v_saldo;
end;
$function$;

revoke all on function public.registra_movimento_master(uuid, uuid, text, text, numeric, text, uuid, uuid, text) from public, anon;
grant execute on function public.registra_movimento_master(uuid, uuid, text, text, numeric, text, uuid, uuid, text) to authenticated, service_role;

-- 3. IL GUADAGNO ----------------------------------------------------------------------------------------------------
-- (4) contava sul conto d'acquisto ogni rettifica, anche senza spedizione: i saldi di fattura, i rimborsi di
-- ricarica e gli storni di contrassegni scritti a mano da LOGIXIA a Wave (−51.554,78 a novembre 2026) diventavano
-- costi d'acquisto e il guadagno di Wave risultava a −24.514. Da ora i movimenti con una voce «soldi tra voi» non
-- entrano; quelli senza voce (lo storico) restano contati come prima.

CREATE OR REPLACE FUNCTION public.guadagno_ingrosso_adj_v1(p_master uuid, p_dal timestamp with time zone, p_al timestamp with time zone)
 RETURNS TABLE(ricavi_adj numeric, costi_adj numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- CORREZIONE NODI-CODICE (grafo corrieri_condivisi). Vedi commento in /api/reports/guadagno-totale.
  -- Spedizione d'ingrosso = PIU' righe legate dal tracking_number; costo/ricavo ingrosso su gambe-ledger
  -- con master_target NULL; la guardia "cm null OR pc null => azzera entrambi" cancella quelle righe.
  select
    round(
      -- (1) ricavo-PONTE: vendita sul PROPRIO ledger (gamba cliente=ledger proprio), riga azzerata
      coalesce((select sum(-mov.importo) from movimenti mov join spedizioni s on s.id=mov.spedizione_id
         where mov.master_id=p_master and mov.tipo='spedizione'
           and mov.cliente_id in (select id from clienti where ledger=true and master_id=p_master)
           and coalesce(s.stato,'')<>'annullata' and mov.created_at>=p_dal and mov.created_at<=p_al
           and not exists(select 1 from movimenti x where x.spedizione_id=mov.spedizione_id
                          and x.master_target_id=p_master and x.tipo='spedizione')),0)
      -- (2) ricavo-ACQUIRENTE: addebito al figlio (master_target) o a cliente proprio sulla riga
      --     ORIGINATRICE di una spedizione comprata all'ingrosso (tracking con gamba-acquisto), riga azzerata
      + coalesce((select sum(-mov.importo) from movimenti mov join spedizioni s on s.id=mov.spedizione_id
         where mov.master_id=p_master and mov.tipo='spedizione'
           and (mov.master_target_id is not null
                or (mov.cliente_id is not null and mov.cliente_id not in (select id from clienti where ledger=true)))
           and coalesce(s.stato,'')<>'annullata' and mov.created_at>=p_dal and mov.created_at<=p_al
           and not exists(select 1 from movimenti x where x.spedizione_id=mov.spedizione_id
                          and x.master_target_id=p_master and x.tipo='spedizione')
           and exists(select 1 from spedizioni lb join movimenti mb on mb.spedizione_id=lb.id and mb.tipo='spedizione'
                where lb.tracking_number=s.tracking_number
                  and mb.cliente_id in (select cliente_ledger_id from corrieri_condivisi
                                        where master_id=p_master and stato='attiva' and cliente_ledger_id is not null))),0)
    ,2) as ricavi_adj,
    round(
      -- (3) costo-INGROSSO spedizione: acquisto sul buy-ledger (mai contato dalla RPC: master_target NULL)
      coalesce((select sum(-mov.importo) from movimenti mov join spedizioni s on s.id=mov.spedizione_id
        where mov.cliente_id in (select cliente_ledger_id from corrieri_condivisi
                                 where master_id=p_master and stato='attiva' and cliente_ledger_id is not null)
          and mov.tipo='spedizione' and coalesce(s.stato,'')<>'annullata'
          and mov.created_at>=p_dal and mov.created_at<=p_al),0)
      -- (4) costo-INGROSSO operativo: resi/rettifiche/ecc sul buy-ledger. guadagno_master_serie_v1 conta
      --     gia' il lato VENDITORE (cliente_id not null) ma NON il lato acquirente (master_target NULL) ->
      --     solo-COSTO, niente ricavo simmetrico, nessun doppio conteggio. Esclude annullata.
      --     Esclude i movimenti a mano con una voce «soldi tra voi» (24/11/2026, lib/movimento-manuale): un saldo
      --     di fattura o il rimborso di una ricarica sono soldi spostati tra i due master, non costi d'acquisto.
      + coalesce((select sum(-mov.importo) from movimenti mov left join spedizioni s on s.id=mov.spedizione_id
        where mov.cliente_id in (select cliente_ledger_id from corrieri_condivisi
                                 where master_id=p_master and stato='attiva' and cliente_ledger_id is not null)
          and mov.tipo = any(array['rettifica','rimborso','reso','giacenza','commissione','accessorio','logistica'])
          and coalesce(mov.voce,'') <> all(array['ricarica','fattura','contrassegni','trasferimento','storno','altro'])
          and coalesce(s.stato,'')<>'annullata'
          and mov.created_at>=p_dal and mov.created_at<=p_al),0)
    ,2) as costi_adj
$function$;

-- Il guadagno del master contava solo i movimenti legati a una spedizione. I costi del master scritti a mano senza
-- spedizione (spedizione fatta fuori dal portale, compenso agente, bonus) da ora entrano, dalle due parti: per chi li
-- addebita e per chi li paga. Le voci «soldi tra voi» restano fuori, come sono sempre state.

CREATE OR REPLACE FUNCTION public.guadagno_master_serie_v1(p_master uuid, p_dal timestamp with time zone, p_al timestamp with time zone, p_per_mese boolean, p_tipi text[])
 RETURNS TABLE(bucket text, ricavi numeric, costi numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_fmt text := case when p_per_mese then 'YYYY-MM' else 'YYYY-MM-DD' end;
begin
  -- ANNULLATE = 0 (regola Lorenzo 6/10): una spedizione annullata vale 0 a ogni livello (ognuno riprende
  -- esattamente quello che ha pagato). guadagno_spedizioni_serie_v1 e guadagno_ingrosso_adj_v1 gia' escludono
  -- le annullate; qui MANCAVA -> restavano gli STORNI (rimborso) senza gli addebiti = perdita-fantasma
  -- (-margine per i normali, -prezzo pieno per ponte/acquirente dove il costo sta su un ledger invisibile).
  -- Fix: not exists spedizioni annullata sui 3 ingressi dei movimenti operativi (mm, movsub, ramo-sopra).
  -- COSTI SENZA SPEDIZIONE (24/11/2026): i movimenti a mano con voce fuori_portale, compenso_agente o bonus
  -- (lib/movimento-manuale) entrano anche senza spedizione, in mm e nel ramo-sopra; le altre voci senza spedizione
  -- sono soldi tra le parti e restano fuori come prima.
  return query execute format($q$
    with sub as materialized (select id from masters where parent_master_id = %1$L::uuid),
    mm as materialized (
      select m.master_target_id, m.cliente_id, m.importo, m.tipo, m.spedizione_id, m.created_at
      from movimenti m
      where m.master_id = %1$L::uuid
        and (m.spedizione_id is not null or m.voce = any(array['fuori_portale','compenso_agente','bonus']))
        and m.tipo = any(%4$L::text[])
        and m.created_at >= %2$L::timestamptz and m.created_at <= %3$L::timestamptz
        and not exists (select 1 from spedizioni sx where sx.id = m.spedizione_id and sx.stato = 'annullata')
    ),
    movsub as materialized (
      select m.importo, m.tipo, m.spedizione_id, m.master_target_id, m.created_at, m.conto
      from movimenti m
      where m.master_id in (select id from sub) and m.master_id = m.master_target_id
        and m.spedizione_id is not null and m.tipo = any(%4$L::text[])
        and m.created_at >= %2$L::timestamptz and m.created_at <= %3$L::timestamptz
        and not exists (select 1 from spedizioni sx where sx.id = m.spedizione_id and sx.stato = 'annullata')
    ),
    selfsub as materialized (select distinct spedizione_id, master_target_id, tipo from movsub),
    movsub_ricavo as materialized (
      select ms.importo, ms.created_at from movsub ms
      where coalesce(ms.conto, 'rete') <> 'proprio'
        and coalesce(
              (select true from movimenti x where x.spedizione_id = ms.spedizione_id
                 and x.master_target_id = %1$L::uuid and x.tipo = 'spedizione' limit 1),
              (select true from spedizioni s2 join corrieri c2 on c2.id = s2.corriere_id
                 join corrieri cp on cp.master_id = %1$L::uuid and cp.proprio and cp.nome_contratto = c2.nome_contratto
                 where s2.id = ms.spedizione_id limit 1),
              false)
    ),
    contrib as (
      select to_char(mm.created_at at time zone 'UTC', %5$L) b, -mm.importo r, 0::numeric c
      from mm where mm.cliente_id is not null
      union all
      select to_char(mm.created_at at time zone 'UTC', %5$L),
             case when s.master_id = %1$L::uuid and s.cliente_id is null then -mm.importo else 0 end, -mm.importo
      from mm left join spedizioni s on s.id = mm.spedizione_id
      where mm.cliente_id is null and mm.master_target_id = %1$L::uuid
      union all
      select to_char(mm.created_at at time zone 'UTC', %5$L), -mm.importo, 0::numeric
      from mm join sub on sub.id = mm.master_target_id
      left join selfsub ss on ss.spedizione_id = mm.spedizione_id and ss.master_target_id = mm.master_target_id and ss.tipo = mm.tipo
      where mm.cliente_id is null and mm.tipo <> 'spedizione' and ss.spedizione_id is null
      union all
      select to_char(movsub_ricavo.created_at at time zone 'UTC', %5$L), -movsub_ricavo.importo, 0::numeric
      from movsub_ricavo
      union all
      select to_char(m.created_at at time zone 'UTC', %5$L), 0::numeric, -m.importo
      from movimenti m
      where m.master_target_id = %1$L::uuid and m.master_id <> %1$L::uuid
        and (m.spedizione_id is not null or m.voce = any(array['fuori_portale','compenso_agente','bonus']))
        and m.tipo = any(%4$L::text[])
        and m.created_at >= %2$L::timestamptz and m.created_at <= %3$L::timestamptz
        and not exists (select 1 from spedizioni sx where sx.id = m.spedizione_id and sx.stato = 'annullata')
    )
    select b, round(sum(r)::numeric,2), round(sum(c)::numeric,2) from contrib group by b
  $q$, p_master, p_dal, p_al, p_tipi, v_fmt);
end;
$function$;
