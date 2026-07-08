// Banner di conferma che sopravvive a un reload / cambio pagina.
// Uso: dopo un salvataggio riuscito -> setFlash('✓ ...') e poi window.location.reload()
// Il FlashBanner montato nel layout lo mostra in alto alla pagina successiva.
const KEY = 'flash_success'

export function setFlash(msg: string) {
  try { sessionStorage.setItem(KEY, msg) } catch {}
}

export function popFlash(): string | null {
  try {
    const v = sessionStorage.getItem(KEY)
    if (v) sessionStorage.removeItem(KEY)
    return v
  } catch { return null }
}
