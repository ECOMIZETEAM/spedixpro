// Il marchio che il guscio dell'app degli store aggiunge allo user agent (appendUserAgent in capacitor.config.json del
// progetto moovexpress-app): se lo si cambia là, va cambiato qui. File a parte, senza React, perché lo leggono anche i
// layout sul server (la luce di «Auto» nell'app, app/components/grafica/server.ts): lib/app-nativa.ts usa un hook e
// non si può importare in un componente server.
export const MARCHIO_APP = 'MoovExpressApp/'
