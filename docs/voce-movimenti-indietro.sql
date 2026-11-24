-- TORNARE INDIETRO dalla voce dei movimenti (docs/voce-movimenti.sql).
--
-- Le due funzioni che muovono il credito non sono mai state cambiate: si tolgono solo le versioni con la voce e il
-- controllo che la copia, e le due funzioni del guadagno tornano come erano il 24/11/2026 prima della modifica.
-- La colonna `voce` e il suo controllo restano: toglierli cancellerebbe le voci gia' scritte.
-- Prima va tolto dal codice il campo p_voce (lib/movimenti.ts), altrimenti la scheda cliente non registra piu'.
-- I DROP il connettore Supabase li rifiuta: questa parte si esegue a mano dall'editor SQL di Supabase.

set lock_timeout = '5s';

drop trigger trg_voce_movimento on public.movimenti;
drop function public.fn_voce_movimento();
drop function public.registra_movimento_cliente(uuid, uuid, text, text, numeric, text, uuid, uuid, boolean, text);
drop function public.registra_movimento_master(uuid, uuid, text, text, numeric, text, uuid, uuid, text);

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
      + coalesce((select sum(-mov.importo) from movimenti mov left join spedizioni s on s.id=mov.spedizione_id
        where mov.cliente_id in (select cliente_ledger_id from corrieri_condivisi
                                 where master_id=p_master and stato='attiva' and cliente_ledger_id is not null)
          and mov.tipo = any(array['rettifica','rimborso','reso','giacenza','commissione','accessorio','logistica'])
          and coalesce(s.stato,'')<>'annullata'
          and mov.created_at>=p_dal and mov.created_at<=p_al),0)
    ,2) as costi_adj
$function$;

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
  return query execute format($q$
    with sub as materialized (select id from masters where parent_master_id = %1$L::uuid),
    mm as materialized (
      select m.master_target_id, m.cliente_id, m.importo, m.tipo, m.spedizione_id, m.created_at
      from movimenti m
      where m.master_id = %1$L::uuid and m.spedizione_id is not null and m.tipo = any(%4$L::text[])
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
        and m.spedizione_id is not null and m.tipo = any(%4$L::text[])
        and m.created_at >= %2$L::timestamptz and m.created_at <= %3$L::timestamptz
        and not exists (select 1 from spedizioni sx where sx.id = m.spedizione_id and sx.stato = 'annullata')
    )
    select b, round(sum(r)::numeric,2), round(sum(c)::numeric,2) from contrib group by b
  $q$, p_master, p_dal, p_al, p_tipi, v_fmt);
end;
$function$;
