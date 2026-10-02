-- ════════════════════════════════════════════════════════════════════════════
-- CHI È "DETENTORE" DI UN CONTRATTO: la regola non deve farsi ingannare dai ponti
-- (pezzo ① del fix condivisione — NON ancora applicato: esce INSIEME all'esenzione
--  commissione e all'aggancio dell'addebito, vedi CONDIVISIONE-CHECKLIST.md sez. B)
--
-- `corrieri.proprio` è una colonna DERIVATA, ricalcolata da questo trigger a ogni
-- corriere creato/rinominato/cancellato. Decide — via fn_conto_di — se il costo di
-- una spedizione scala il conto PROPRIO del master (credito_proprio, e scatta la
-- commissione MoovExpress) o il conto di RETE (credito, paga il suo fornitore).
--
-- IL GUASTO: la regola diceva "sei detentore se NESSUN antenato nell'albero ha un
-- contratto con lo stesso nome". Ma nella condivisione un master-venditore tiene un
-- PONTE (corriere tipo='moovexpress') con lo STESSO nome del contratto reale che
-- rivende. Quel ponte, pur essendo solo un condotto di rivendita, contava come
-- "antenato con lo stesso nome" e declassava l'OWNER REALE più in basso:
--   MULTIEXPRESS tiene il ponte "Poste Delivery Business Triangolazioni";
--   LOGIXIA, che possiede DAVVERO quel contratto Poste, veniva marcata proprio=false
--   → il suo costo cadeva sul conto di rete invece che sul suo credito_proprio.
-- Allo stesso tempo il ponte stesso poteva risultare proprio=true e, se su un master
-- non-vertice, scalare credito_proprio e pagare la commissione — da rivenditore.
--
-- LA CURA (chirurgica, due filtri sul tipo, confronto nome ESATTO come prima così i
-- contratti normali non si muovono di un bit):
--   1) un PONTE (tipo='moovexpress') non è MAI detentore — è un condotto, non un owner;
--   2) un contratto reale resta detentore anche se un *ponte* antenato ha lo stesso
--      nome: contano solo gli antenati con un contratto REALE (tipo<>'moovexpress').
--
-- VERIFICATO in sola lettura su produzione (02/10/2026), due volte e in modo
-- indipendente: calcolando il nuovo flag per OGNI corriere e confrontandolo con
-- l'attuale cambiano SOLO i due nodi della condivisione — MULTIEXPRESS ponte
-- Triangolazioni true→false, LOGIXIA Triangolazioni false→true — e NESSUN altro
-- contratto (tutti quelli non-condivisione restano identici; anche LOGISTIC ADVENTURE
-- SRL, che ha lo stesso nome ma rivende SOTTO LOGIXIA, resta correttamente false).
-- Rete di sicurezza al rilascio: lo snapshot
-- `select id,proprio from corrieri where tipo is distinct from 'moovexpress'`
-- prima/dopo deve dare diff ZERO, salvo l'unica riga LOGIXIA.
--
-- ATTENZIONE all'ARMING: ridefinire la funzione NON la esegue, ma al PRIMO corriere
-- toccato dopo il deploy il trigger ricalcola TUTTO con la regola nuova e LOGIXIA passa
-- a proprio=true. Da quel momento il costo delle sue Triangolazioni scala credito_proprio
-- e paga la commissione MoovExpress 0,05 — il che è VOLUTO: decisione Lorenzo 02/10, "tutti
-- pagano, ognuno ha la propria rete" (LOGIXIA è un owner come Velox/Quick, nessuna esenzione).
-- Va comunque rilasciato INSIEME al fix dell'addebito-catena condivisione (fine del doppio
-- addebito su crea/v1 + dispatch dal detentore-codice): il flag giusto senza la catena giusta
-- lascerebbe i rivenditori a valle ancora addebitati male.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.fn_ricalcola_corrieri_proprio()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_cnt int;
begin
  with recursive anc as (
    select m.id as master_id, m.parent_master_id as ancestor, 1 as lvl
    from public.masters m where m.parent_master_id is not null
    union all
    select a.master_id, m.parent_master_id, a.lvl + 1
    from anc a join public.masters m on m.id = a.ancestor
    where m.parent_master_id is not null and a.lvl < 25
  ),
  calc as (
    select c.id,
      -- un ponte (moovexpress) non è mai detentore; un contratto reale lo è se nessun
      -- antenato con un contratto REALE (non-ponte) porta lo stesso nome.
      (c.tipo is distinct from 'moovexpress')
      and not exists (
        select 1 from public.corrieri ca
        join anc on anc.master_id = c.master_id and anc.ancestor = ca.master_id
        where ca.nome_contratto = c.nome_contratto
          and ca.tipo is distinct from 'moovexpress'
      ) as proprio_calc
    from public.corrieri c
  )
  update public.corrieri c
     set proprio = calc.proprio_calc
    from calc
   where calc.id = c.id
     and c.proprio is distinct from calc.proprio_calc;
  get diagnostics v_cnt = row_count;
  return v_cnt;
end $function$;

-- Al rilascio coordinato (con ④), DOPO lo snapshot "prima", eseguire UNA volta per
-- applicare la regola ai due nodi condivisione già esistenti:
--   select public.fn_ricalcola_corrieri_proprio();
-- (poi snapshot "dopo" e confronto: atteso solo MULTI ponte→false e LOGIXIA→true.)
