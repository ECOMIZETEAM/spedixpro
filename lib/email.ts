import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function inviaCredenzialiCliente({
  email, nomeCliente, masterNome, dominio, password
}: {
  email: string; nomeCliente: string; masterNome: string; dominio: string; password: string
}) {
  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
      to: email,
      subject: `Benvenuto su ${masterNome} — Le tue credenziali di accesso`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e8e8">
          <div style="background:#1a1a1a;padding:24px 32px">
            <div style="font-size:20px;font-weight:800;color:#fff">Spedix<span style="color:#f97316">Pro</span></div>
          </div>
          <div style="padding:32px">
            <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 12px">Benvenuto, ${nomeCliente}!</h2>
            <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 20px">${masterNome} ti ha creato un account sulla piattaforma di gestione spedizioni.</p>
            <div style="background:#f5f5f5;border-radius:8px;padding:20px 24px;margin-bottom:20px">
              <div style="padding:8px 0;border-bottom:1px solid #e8e8e8;font-size:13px;display:flex;justify-content:space-between">
                <span style="color:#999;text-transform:uppercase;font-size:11px;letter-spacing:0.5px">Portale</span>
                <strong style="color:#1a1a1a;font-family:monospace">${dominio}</strong>
              </div>
              <div style="padding:8px 0;border-bottom:1px solid #e8e8e8;font-size:13px;display:flex;justify-content:space-between">
                <span style="color:#999;text-transform:uppercase;font-size:11px;letter-spacing:0.5px">Email</span>
                <strong style="color:#1a1a1a;font-family:monospace">${email}</strong>
              </div>
              <div style="padding:8px 0;font-size:13px;display:flex;justify-content:space-between">
                <span style="color:#999;text-transform:uppercase;font-size:11px;letter-spacing:0.5px">Password</span>
                <strong style="color:#f97316;font-family:monospace;font-size:16px">${password}</strong>
              </div>
            </div>
            <a href="https://${dominio}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px">Accedi al portale →</a>
            <p style="color:#999;font-size:12px;margin-top:20px">⚠️ Cambia la password al primo accesso per sicurezza.</p>
          </div>
        </div>
      `
    })
    return { ok: true }
  } catch (err) {
    console.error('Errore invio email:', err)
    return { ok: false, error: err }
  }
}
