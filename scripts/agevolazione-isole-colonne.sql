-- AGEVOLAZIONE ISOLE MAGGIORI — le colonne (26/11/2026). Vedi lib/agevolazione-isole.ts.
--
-- Il flag sta sul LISTINO che si vende (listini_clienti: quello del cliente o quello che un master assegna a un
-- sotto-master) e sulla riga di COSTO del contratto (listini_corrieri), dove la copia del listino al sotto-master
-- lo porta come porta solo_peso_reale. Default false: con le colonne create nessun prezzo cambia.
--
-- Va lanciato PRIMA di rilasciare il codice che le legge (le select le nominano: senza colonne fallirebbero).
-- Due istruzioni indipendenti, ripetibili (if not exists). Le tabelle hanno gia' RLS e i permessi per tabella:
-- le colonne nuove seguono le stesse regole delle altre, niente da concedere o revocare.

alter table public.listini_clienti  add column if not exists agevolazione_isole boolean not null default false;

alter table public.listini_corrieri add column if not exists agevolazione_isole boolean not null default false;
