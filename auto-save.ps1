# auto-save.ps1
# Salva automaticamente le modifiche su GitHub ogni 5 secondi
# Lancialo UNA VOLTA all'inizio della sessione di lavoro e lascialo aperto

Write-Host "Auto-save attivo - salva ogni 5 secondi. Lascia questa finestra aperta." -ForegroundColor Green
Write-Host "Per fermarlo, chiudi questa finestra o premi Ctrl+C" -ForegroundColor Yellow
Write-Host ""

while ($true) {
    $status = git status --porcelain

    if ($status) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Modifiche rilevate, salvo..." -ForegroundColor Cyan

        git add .
        git commit -m "auto-save $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-Null

        # Prova a fare pull prima di pushare, per evitare conflitti
        git pull origin main --no-edit 2>&1 | Out-Null

        $pushResult = git push origin main 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Salvato su GitHub con successo" -ForegroundColor Green
        } else {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Errore push: $pushResult" -ForegroundColor Red
        }
    }

    Start-Sleep -Seconds 5
}
