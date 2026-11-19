-- IL MOTIVO PER CUI UNA RETTIFICA RICEVUTA NON SCENDE (12/11/2026)
-- «Dal mio network»: quando «Carica» non puo' girare una rettifica a chi sta sotto (listino del cliente o del
-- sotto-master troppo corto, misure mancanti, catena incompleta…) il motivo compariva solo in un messaggio, che il
-- «Carica» dopo sostituiva. Il 12/11 Ecomize Solution non ha mai letto quello di 3UW1UHA334029 (listino della cliente
-- fermo a 5 kg, pacco ripesato 19,85 kg). Ora «Carica» lo scrive sulla riga, e il riquadro «Cosa devi fare» lo
-- rilegge finche' la riga non passa. Si azzera quando la riga viene caricata o assorbita.
-- Non muove soldi e non blocca niente: aggiunge una colonna vuota. La scrive solo il server (chiave di servizio).
-- Chi puo' leggere la riga (il master che l'ha addebitata, chi l'ha ricevuta e chi sta sopra) vede gia' gli stessi
-- clienti e listini dalle rettifiche della rete: la colonna non mostra niente di nuovo a nessuno.

alter table public.rettifiche add column if not exists da_sistemare jsonb;

comment on column public.rettifiche.da_sistemare is
  'Perche'' «Carica» (Dal mio network) non ha potuto girare questa rettifica a chi sta sotto, e cosa sistemare. La scrive app/api/network/rettifiche; si azzera quando la riga viene decisa.';

-- verifica: deve tornare una riga
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'rettifiche' and column_name = 'da_sistemare';
