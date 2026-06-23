param(
  [Parameter(Mandatory = $true)]
  [string[]]$Path
)

$ErrorActionPreference = 'Stop'
$certificatePath = if ($env:WIN_CSC_LINK) { $env:WIN_CSC_LINK } else { $env:CSC_LINK }
$certificatePassword = if ($env:WIN_CSC_KEY_PASSWORD) { $env:WIN_CSC_KEY_PASSWORD } else { $env:CSC_KEY_PASSWORD }

if (-not $certificatePath) {
  Write-Host 'Certificado nao configurado; build permanecera sem assinatura digital.'
  exit 0
}

if (-not (Test-Path -LiteralPath $certificatePath -PathType Leaf)) {
  throw "Certificado nao encontrado: $certificatePath"
}

$signtoolCommand = Get-Command signtool.exe -ErrorAction SilentlyContinue
$signtoolPath = if ($signtoolCommand) { $signtoolCommand.Source } else { $null }

if (-not $signtoolPath) {
  $windowsKitsRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  $signtoolPath = Get-ChildItem -LiteralPath $windowsKitsRoot -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

if (-not $signtoolPath) {
  throw 'signtool.exe nao encontrado. Instale o Windows SDK.'
}

$files = foreach ($itemPath in $Path) {
  $resolved = Resolve-Path -LiteralPath $itemPath -ErrorAction Stop
  if ((Get-Item -LiteralPath $resolved).PSIsContainer) {
    Get-ChildItem -LiteralPath $resolved -Filter *.exe -File -Recurse
  } else {
    Get-Item -LiteralPath $resolved
  }
}

foreach ($file in ($files | Sort-Object FullName -Unique)) {
  $arguments = @(
    'sign',
    '/fd', 'SHA256',
    '/td', 'SHA256',
    '/tr', 'http://timestamp.digicert.com',
    '/f', $certificatePath
  )
  if ($certificatePassword) {
    $arguments += @('/p', $certificatePassword)
  }
  $arguments += $file.FullName

  & $signtoolPath @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao assinar $($file.FullName)."
  }
}

Write-Host "Assinatura concluida em $($files.Count) arquivo(s)."
