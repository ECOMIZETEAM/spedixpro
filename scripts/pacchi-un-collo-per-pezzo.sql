-- «UN COLLO PER OGNI PEZZO» sul pacco salvato (20/11/2026, decisione di Lorenzo).
--
-- Ogni pezzo degli SKU di questo pacco parte nella sua scatola: negli ordini dei negozi online un
-- ordine di 3 pezzi diventa 3 colli, ognuno con le misure del pacco e il peso dell'articolo
-- (lib/colli-negozio.ts). Caso vero: azienda agricola Purita' Gaetano, cassette di arance da 14,85 kg,
-- che uscivano come un collo solo col peso di tutte (fino a 16 cassette, 237,6 kg, un'etichetta).
--
-- Spenta per difetto: 14 clienti legano pacchi agli SKU e molti mettono piu' articoli nella stessa
-- scatola, per loro non deve cambiare niente.
--
-- ORDINE: questa colonna PRIMA del codice. La pagina Pacchi manda il campo a ogni salvataggio: con il
-- codice nuovo e senza la colonna, salvare un pacco darebbe errore. Senza il codice nuovo la colonna
-- non cambia niente (nessuno la legge). Permessi: la tabella ha gia' RLS e i grant a livello di
-- tabella, la colonna li eredita.

alter table public.pacchi_predefiniti
  add column if not exists un_collo_per_pezzo boolean not null default false;

comment on column public.pacchi_predefiniti.un_collo_per_pezzo is
  'Ogni pezzo degli SKU di questo pacco e'' un collo a se'' negli ordini dei negozi online (lib/colli-negozio.ts).';
