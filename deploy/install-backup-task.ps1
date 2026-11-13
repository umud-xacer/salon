# Windows Task Scheduler'ga "Chronix zaxira" vazifasini qo'shadi: har kuni 10:00 da va Windows'ga kirganda
# (3 daqiqadan keyin) deploy/pull-backup.sh ishga tushadi. Noutbuk o'sha payt o'chiq bo'lgan bo'lsa,
# yoqilgach birinchi imkoniyatda bajariladi. Natija jurnali: %USERPROFILE%\ChronixZaxira\zaxira.log
#
# O'rnatish (bir marta, oddiy PowerShell'da — administrator shart emas):
#   powershell -ExecutionPolicy Bypass -File deploy\install-backup-task.ps1
# Olib tashlash:
#   Unregister-ScheduledTask -TaskName "Chronix zaxira" -Confirm:$false

$ErrorActionPreference = "Stop"

$sh = "C:\Program Files\Git\bin\sh.exe"
if (-not (Test-Path $sh)) { throw "Git Bash topilmadi: $sh" }

# Loyiha papkasi shu skript turgan joydan aniqlanadi (papka ko'chirilsa, skriptni qayta ishga tushiring)
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoSh = "/" + $repo.Substring(0, 1).ToLower() + $repo.Substring(2).Replace("\", "/")

$inner = "cd '$repoSh' && mkdir -p ~/ChronixZaxira && { echo; date '+=== %F %T'; sh deploy/pull-backup.sh; echo natija: `$?; } >> ~/ChronixZaxira/zaxira.log 2>&1"
$action = New-ScheduledTaskAction -Execute $sh -Argument "-lc `"$inner`""

$daily = New-ScheduledTaskTrigger -Daily -At "10:00"
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$logon.Delay = "PT3M"

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName "Chronix zaxira" `
    -Description "Chronix server zaxiralarini (baza va rasmlar) har kuni noutbukka ko'chiradi" `
    -Action $action -Trigger $daily, $logon -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Vazifa qo'shildi: 'Chronix zaxira' (har kuni 10:00 va Windows'ga kirganda)."
Write-Host "Hozir sinab ko'rish:  Start-ScheduledTask -TaskName 'Chronix zaxira'"
Write-Host "Jurnal:               $env:USERPROFILE\ChronixZaxira\zaxira.log"
