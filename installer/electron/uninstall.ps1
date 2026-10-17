# Desinstallateur d'Apex Slicer (copie dans le dossier d'installation par l'installateur, electron/install.cjs).
# Lance par : « Ajouter ou supprimer des programmes », le raccourci « Desinstaller Apex Slicer » du menu Demarrer, ou a la main.
#   1. confirmation (sans droits eleves) ; 2. copie temporaire de ce script relancee en administrateur (le dossier
#   d'installation ne peut pas etre supprime depuis un script qui s'y trouve) ; 3. fermeture de l'application, suppression
#   des raccourcis, de l'entree du registre et du dossier.
param(
  [string]$InstallDir = $PSScriptRoot,
  [switch]$Confirmed
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$title = 'Apex Slicer'
$regKey = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ApexSlicer'
$startMenuDir = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Apex Slicer'
$desktopLink = Join-Path $env:PUBLIC 'Desktop\Apex Slicer.lnk'

function Quote([string]$s) { '"' + $s + '"' }

if (-not $Confirmed) {
  $answer = [System.Windows.Forms.MessageBox]::Show('Voulez-vous d' + [char]0xE9 + 'sinstaller Apex Slicer ?', $title, 'YesNo', 'Question', 'Button2')
  if ($answer -ne 'Yes') { exit 0 }
  $temp = Join-Path $env:TEMP ("apex-uninstall-" + [guid]::NewGuid().ToString('N') + '.ps1')
  Copy-Item -LiteralPath $PSCommandPath -Destination $temp -Force
  $arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ' + (Quote $temp) + ' -InstallDir ' + (Quote $InstallDir) + ' -Confirmed'
  # Dossier de travail = TEMP : un process eleve herite sinon du dossier d'installation et le verrouille.
  Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Verb RunAs -WorkingDirectory $env:TEMP
  exit 0
}

try {
  # Garde-fou : on ne supprime qu'un dossier qui est bien une installation d'Apex.
  $full = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
  if (-not (Test-Path -LiteralPath (Join-Path $full 'apex-install.json')) -or -not (Test-Path -LiteralPath (Join-Path $full 'Apex Slicer.exe'))) {
    throw "Ce dossier ne contient pas d'installation d'Apex : $full"
  }
  # Set-Location ne change PAS le dossier courant du processus : sans ceci, il reste dans le dossier a supprimer.
  Set-Location -LiteralPath $env:TEMP
  [System.Environment]::CurrentDirectory = $env:TEMP
  $log = Join-Path $env:TEMP 'apex-uninstall.log'
  "[$(Get-Date -Format s)] desinstallation de $full" | Out-File -LiteralPath $log -Encoding utf8

  # Ferme l'application si elle tourne depuis ce dossier.
  Get-Process -Name 'Apex Slicer' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($full, [StringComparison]::OrdinalIgnoreCase) } |
    Stop-Process -Force
  Start-Sleep -Milliseconds 800

  Remove-Item -LiteralPath $desktopLink -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $startMenuDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath ($startMenuDir + '.lnk') -Force -ErrorAction SilentlyContinue  # ancien raccourci simple
  Remove-Item -LiteralPath $regKey -Recurse -Force -ErrorAction SilentlyContinue

  # Le dossier : quelques essais (un antivirus peut encore tenir un fichier).
  # rmdir de cmd.exe d'abord : Remove-Item echoue (« fichier introuvable ») sur un dossier dont le nom finit par un point,
  # comme « HP Inc. » dans resources\profiles, que les API de chemin Windows normalisent.
  for ($i = 0; $i -lt 4 -and (Test-Path -LiteralPath $full); $i++) {
    Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c rmdir /s /q ' + (Quote $full)) -WindowStyle Hidden -Wait
    if (Test-Path -LiteralPath $full) {
      ("essai {0} : dossier encore present" -f ($i + 1)) | Out-File -LiteralPath $log -Append -Encoding utf8
      Start-Sleep -Seconds 1
    }
  }
  if (Test-Path -LiteralPath $full) {
    # Reste verrouille (antivirus, indexation) : suppression differee, une fois ce script termine.
    "reste apres 5 essais : suppression differee" | Out-File -LiteralPath $log -Append -Encoding utf8
    Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c ping -n 6 127.0.0.1 >nul & rmdir /s /q ' + (Quote $full)) -WindowStyle Hidden
  }

  [System.Windows.Forms.MessageBox]::Show('Apex Slicer a ' + [char]0xE9 + 't' + [char]0xE9 + ' d' + [char]0xE9 + 'sinstall' + [char]0xE9 + '.', $title, 'OK', 'Information') | Out-Null
} catch {
  [System.Windows.Forms.MessageBox]::Show('D' + [char]0xE9 + 'sinstallation impossible : ' + $_.Exception.Message, $title, 'OK', 'Error') | Out-Null
}

# Efface cette copie temporaire apres la fin du script.
Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c ping -n 3 127.0.0.1 >nul & del /f /q ' + (Quote $PSCommandPath)) -WindowStyle Hidden
