-- AGEVOLAZIONE ISOLE MAGGIORI — i contratti (26/11/2026). Vedi lib/agevolazione-isole.ts.
--
-- Da lanciare DOPO il rilascio del codice e DOPO scripts/agevolazione-isole-colonne.sql.
--
-- 1) I contratti su cui il fornitore concede l'agevolazione: i servizi Poste di DVA di MULTIEXPRESS (PDBX, i tre
--    "da PuntoPoste" e SDA Extralarge). Verificato coi preventivi DVA del 26/11: dentro Sicilia+Calabria e dentro la
--    Sardegna 5,44 come Milano>Roma, 6,54 da fuori. NON il BRT 2025: DVA lo fa pagare 7,24 anche dentro l'isola.
--    Il trigger trg_corrieri_settings_alle_copie porta l'impostazione a tutte le copie dei master.
--    Da sola non cambia nessun prezzo: serve anche il flag sul listino.
update public.corrieri
   set settings = coalesce(settings, '{}'::jsonb) || '{"agevolazione_isole": true}'::jsonb
 where master_id = 'a8d42a25-3711-4343-a6df-ee2ba9bbf08b' and tipo = 'easyparcel'
   and credenziali->>'vettore' in ('PDBX', 'PDB-P2H', 'PDB-P2TAB', 'PDB-P2UP', 'SDAK3');

-- 2) Il COSTO di MULTIEXPRESS su quei contratti: DVA le spedizioni dentro l'area le fa pagare come l'Italia, e il
--    margine che MULTIEXPRESS vede deve partire dal costo vero.
update public.listini_corrieri lc
   set agevolazione_isole = true
  from public.corrieri c
 where lc.corriere_id = c.id
   and lc.master_id = 'a8d42a25-3711-4343-a6df-ee2ba9bbf08b' and c.master_id = 'a8d42a25-3711-4343-a6df-ee2ba9bbf08b'
   and c.tipo = 'easyparcel' and c.credenziali->>'vettore' in ('PDBX', 'PDB-P2H', 'PDB-P2TAB', 'PDB-P2UP', 'SDAK3');

-- Controllo: quanti contratti la prevedono (MULTIEXPRESS e copie) e quante righe di costo di MULTIEXPRESS l'hanno.
select (select count(*) from public.corrieri where (settings->>'agevolazione_isole')::boolean) as contratti_con_agevolazione,
       (select count(*) from public.listini_corrieri where agevolazione_isole and master_id = 'a8d42a25-3711-4343-a6df-ee2ba9bbf08b') as righe_costo_multi;
