-- ════════════════════════════════════════════════════════════════════════════
-- CONTROLLO GIORNALIERO — parte database
-- Da incollare nell'editor SQL di Supabase. Sola lettura: non modifica nulla.
-- Una riga per controllo. La colonna ESITO dice se guardare o no.
-- ════════════════════════════════════════════════════════════════════════════
with
-- 1. SPEDIZIONI SENZA ADDEBITO AL CLIENTE (ultime 24h)
--    Deve essere 0. Se non lo e', qualcuno ha spedito senza pagare.
senza_addebito as (
  select count(*) n from spedizioni s
  where s.cliente_id is not null and s.costo_totale > 0 and s.stato <> 'annullata'
    and s.created_at >= now() - interval '24 hours'
    and not exists (select 1 from movimenti m where m.spedizione_id = s.id and m.cliente_id is not null)
),
-- 2. SPEDIZIONI CHE NON RISALGONO LA CATENA (ultime 24h)
--    Deve essere 0. Se non lo e', un master non ha addebitato il livello sotto.
senza_catena as (
  select count(*) n from spedizioni s
  where s.created_at >= now() - interval '24 hours'
    and not exists (select 1 from movimenti m where m.spedizione_id = s.id and m.master_target_id is not null)
),
-- 3. SALDI CHE NON QUADRANO
--    Il credito deve sempre essere uguale alla somma dei suoi movimenti.
--    Uno scarto significa una scrittura avvenuta fuori dal registro.
saldi_rotti as (
  select count(*) n from clienti c
  where abs(c.credito - coalesce((select sum(m.importo) from movimenti m where m.cliente_id = c.id), 0)) >= 0.01
),
-- 4. DOPPI ADDEBITI sulla stessa spedizione
--    Impossibile dagli indici unici, ma si controlla lo stesso: se comparisse,
--    vorrebbe dire che un indice e' stato perso.
doppi as (
  select count(*) n from (
    select spedizione_id, cliente_id from movimenti
    where tipo = 'spedizione' and spedizione_id is not null and cliente_id is not null
    group by 1,2 having count(*) > 1
  ) x
),
-- 5. PRENOTAZIONI DI CREDITO APPESE da piu' di 30 minuti
--    Il giro automatico le libera dopo 15 minuti: qui deve essere 0.
prenotazioni as (
  select count(*) n from movimenti
  where riferimento like 'PRE:%' and spedizione_id is null
    and created_at < now() - interval '30 minutes'
),
-- 6. CLIENTI ATTIVI SENZA LISTINO (non possono spedire)
senza_listino as (
  select count(*) n from clienti where coalesce(attivo, true) and listino_cliente_id is null
),
-- 7. SOTTO-MASTER SENZA LISTINO ASSEGNATO (la catena non sa quanto addebitarli)
master_senza_listino as (
  select count(*) n from masters where parent_master_id is not null and parent_listino_id is null
),
-- 8. AGENTI SENZA CLIENTI (entrano e trovano il portale vuoto)
agenti_vuoti as (
  select count(*) n from utenti u where u.ruolo = 'agente'
    and not exists (select 1 from clienti c where c.master_id = u.master_id
                     and c.agente = trim(coalesce(u.nome,'') || ' ' || coalesce(u.cognome,'')))
),
-- 9. CONTRATTI VENDIBILI MA SENZA PREZZI DI VENDITA (invisibili ai clienti)
contratti_a_meta as (
  select count(*) n from corrieri co
  where coalesce(co.attivo, true)
    and not exists (select 1 from listini_clienti_fasce f where f.corriere_id = co.id)
),
-- 10. VENDITE SOTTO COSTO ancora configurate
sotto_costo as (
  select count(*) n from (
    select 1 from masters m
    join listini_clienti_fasce v on v.listino_id = m.parent_listino_id
    join (select lc.master_id, f.corriere_id, f.zona_id, f.tipo, f.peso_max, max(f.prezzo) costo
          from listini_corrieri_fasce f join listini_corrieri lc on lc.id = f.listino_id
          group by 1,2,3,4,5) c
      on c.master_id = m.parent_master_id and c.corriere_id = v.corriere_id
         and c.zona_id = v.zona_id and c.tipo = v.tipo and c.peso_max = v.peso_max
    where v.prezzo > 0 and v.prezzo < c.costo
  ) x
)
select 'spedizioni 24h SENZA addebito cliente' as controllo, (select n from senza_addebito)::text as valore,
       case when (select n from senza_addebito) = 0 then 'ok' else 'GUARDARE SUBITO' end as esito
union all select 'spedizioni 24h che NON risalgono la catena', (select n from senza_catena)::text,
       case when (select n from senza_catena) = 0 then 'ok' else 'GUARDARE SUBITO' end
union all select 'saldi che non quadrano coi movimenti', (select n from saldi_rotti)::text,
       case when (select n from saldi_rotti) <= 1 then 'ok (1 noto: cliente del 23/07)' else 'GUARDARE' end
union all select 'doppi addebiti sulla stessa spedizione', (select n from doppi)::text,
       case when (select n from doppi) = 0 then 'ok' else 'GUARDARE SUBITO' end
union all select 'prenotazioni credito appese da oltre 30 min', (select n from prenotazioni)::text,
       case when (select n from prenotazioni) = 0 then 'ok' else 'GUARDARE' end
union all select 'clienti attivi senza listino', (select n from senza_listino)::text,
       case when (select n from senza_listino) = 0 then 'ok' else 'da assegnare' end
union all select 'sotto-master senza listino assegnato', (select n from master_senza_listino)::text,
       case when (select n from master_senza_listino) = 0 then 'ok' else 'da assegnare' end
union all select 'agenti senza clienti collegati', (select n from agenti_vuoti)::text, 'da assegnare'
union all select 'contratti senza prezzi di vendita', (select n from contratti_a_meta)::text, 'da prezzare'
union all select 'fasce vendute SOTTO COSTO', (select n from sotto_costo)::text,
       case when (select n from sotto_costo) = 0 then 'ok' else 'perdita in corso' end;
