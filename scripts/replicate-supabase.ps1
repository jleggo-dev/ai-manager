<#
.SYNOPSIS
  Full logical replica of a Supabase Postgres database to another Supabase project.

.DESCRIPTION
  Follows Supabase's backup/restore guide:
  https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore

  Dumps roles, schema, and data from SOURCE, then restores into TARGET.
  Uses pg_dump/psql (PostgreSQL 17+ recommended).

  NOT included automatically (configure manually after restore):
  - Storage object files (run scripts/sync-supabase-storage.mjs)
  - Google OAuth client / redirect URLs in Auth settings
  - Edge functions, custom domains, Vercel env vars
  - Realtime publication toggles (re-enable per table in dashboard)
  - pgsodium root key if you use column encryption (see Supabase docs)

.PARAMETER SourceDatabaseUrl
  Source direct or session connection string, e.g.
  postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres

.PARAMETER TargetDatabaseUrl
  Empty/new project connection string (same format).

.PARAMETER OutputDir
  Folder for roles.sql, schema.sql, data.sql (default: backups/replica-YYYYMMDD-HHmmss).

.PARAMETER RestoreOnly
  Skip dump; restore from existing SQL files in OutputDir.

.PARAMETER DumpOnly
  Dump only; do not restore.

.EXAMPLE
  $env:SOURCE_DATABASE_URL = "postgresql://postgres.xxxx:YOUR_PASSWORD@db.xxxx.supabase.co:5432/postgres"
  $env:TARGET_DATABASE_URL = "postgresql://postgres.yyyy:YOUR_PASSWORD@db.yyyy.supabase.co:5432/postgres"
  .\scripts\replicate-supabase.ps1

  Get connection strings: Supabase Dashboard -> Project -> Connect -> Session pooler (or Direct).
  Reset DB password under Database -> Settings if needed.
#>

param(
  [string] $SourceDatabaseUrl = $env:SOURCE_DATABASE_URL,
  [string] $TargetDatabaseUrl = $env:TARGET_DATABASE_URL,
  [string] $OutputDir = "",
  [switch] $RestoreOnly,
  [switch] $DumpOnly
)

$ErrorActionPreference = "Stop"

function Import-ReplicaEnvFile {
  $path = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "backend\.env.replica"
  if (-not (Test-Path $path)) { return }
  $vars = @{}
  foreach ($line in Get-Content $path) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#")) { continue }
    $eq = $t.IndexOf("=")
    if ($eq -lt 1) { continue }
    $k = $t.Substring(0, $eq).Trim()
    $v = $t.Substring($eq + 1).Trim()
    $vars[$k] = $v
  }
  if ($vars["SOURCE_DB_PASSWORD"] -or $vars["TARGET_DB_PASSWORD"] -or $vars["SUPABASE_DB_PASSWORD"]) {
    $srcPw = $vars["SOURCE_DB_PASSWORD"]
    if (-not $srcPw) { $srcPw = $vars["SUPABASE_DB_PASSWORD"] }
    $tgtPw = $vars["TARGET_DB_PASSWORD"]
    if (-not $tgtPw) { $tgtPw = $vars["SUPABASE_DB_PASSWORD"] }
    if ($vars["SOURCE_DATABASE_URL"] -and $srcPw) {
      $vars["SOURCE_DATABASE_URL"] = $vars["SOURCE_DATABASE_URL"].Replace("SOURCE_DB_PASSWORD", [uri]::EscapeDataString($srcPw)).Replace("SUPABASE_DB_PASSWORD", [uri]::EscapeDataString($srcPw))
    }
    if ($vars["TARGET_DATABASE_URL"] -and $tgtPw) {
      $vars["TARGET_DATABASE_URL"] = $vars["TARGET_DATABASE_URL"].Replace("TARGET_DB_PASSWORD", [uri]::EscapeDataString($tgtPw)).Replace("SUPABASE_DB_PASSWORD", [uri]::EscapeDataString($tgtPw))
    }
  }
  if (-not $SourceDatabaseUrl -and $vars["SOURCE_DATABASE_URL"]) { $script:SourceDatabaseUrl = $vars["SOURCE_DATABASE_URL"] }
  if (-not $TargetDatabaseUrl -and $vars["TARGET_DATABASE_URL"]) { $script:TargetDatabaseUrl = $vars["TARGET_DATABASE_URL"] }
}

Import-ReplicaEnvFile

function Find-PgBin {
  param([string] $Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "C:\Program Files\PostgreSQL\17\bin\$Name.exe",
    "C:\Program Files\PostgreSQL\16\bin\$Name.exe",
    "C:\Program Files\PostgreSQL\15\bin\$Name.exe"
  )
  foreach ($p in $candidates) {
    if (Test-Path $p) { return $p }
  }
  throw "Could not find $Name. Install PostgreSQL client tools and add bin to PATH."
}

function Assert-ConnectionString {
  param([string] $Url, [string] $Label)
  if (-not $Url -or $Url.Trim() -eq "") {
    throw "$Label is required. Set -$Label or `$env:${Label.Replace('-', '_').ToUpper()}"
  }
  if ($Url -notmatch "^postgresql://") {
    throw "$Label must be a postgresql:// connection string (from Supabase Connect panel)."
  }
}

function Mask-Url {
  param([string] $Url)
  return $Url -replace ":(//[^:@/]+:)([^@]+)(@)", ':$1****$3'
}

$pgDump = Find-PgBin "pg_dump"
$pgDumpAll = Find-PgBin "pg_dumpall"
$psql = Find-PgBin "psql"

Write-Host ""
Write-Host "  Supabase full database replica"
Write-Host "  pg_dump: $pgDump"
Write-Host ""

if (-not $RestoreOnly) {
  Assert-ConnectionString $SourceDatabaseUrl "SourceDatabaseUrl"
}

if (-not $DumpOnly) {
  Assert-ConnectionString $TargetDatabaseUrl "TargetDatabaseUrl"
}

if ($SourceDatabaseUrl -eq $TargetDatabaseUrl) {
  throw "Source and target connection strings must differ."
}

if (-not $OutputDir -or $OutputDir.Trim() -eq "") {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $OutputDir = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "backups\replica-$stamp"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$rolesFile = Join-Path $OutputDir "roles.sql"
$schemaFile = Join-Path $OutputDir "schema.sql"
$dataFile = Join-Path $OutputDir "data.sql"

if (-not $RestoreOnly) {
  Write-Host "  [1/2] Dumping source..."
  Write-Host "        From: $(Mask-Url $SourceDatabaseUrl)"
  Write-Host "        To:   $OutputDir"
  Write-Host ""

  Write-Host "        roles.sql (skipped - Supabase pooler; platform roles are managed)"
  "-- Skipped on Supabase cross-project replica" | Set-Content -Path $rolesFile -Encoding utf8

  Write-Host "        schema.sql ..."
  & $pgDump @(
    "--dbname=$SourceDatabaseUrl",
    "--schema-only",
    "--schema=public",
    "--no-owner",
    "--no-privileges",
    "--clean",
    "--if-exists",
    "--file=$schemaFile"
  )
  if ($LASTEXITCODE -ne 0) { throw "pg_dump schema failed (exit $LASTEXITCODE)" }

  Write-Host "        data.sql ..."
  & $pgDump @(
    "--dbname=$SourceDatabaseUrl",
    "--data-only",
    "--schema=public",
    "--file=$dataFile"
  )
  if ($LASTEXITCODE -ne 0) { throw "pg_dump data failed (exit $LASTEXITCODE)" }

  Write-Host ""
  Write-Host "  Dump complete."
  Write-Host "    $rolesFile"
  Write-Host "    $schemaFile"
  Write-Host "    $dataFile"
  Write-Host ""
}

if ($DumpOnly) {
  Write-Host "  DumpOnly set - skipping restore."
  Write-Host ""
  exit 0
}

Write-Host "  [2/2] Restoring to target..."
Write-Host "        Into: $(Mask-Url $TargetDatabaseUrl)"
Write-Host ""
Write-Host "  Before restore, on the NEW Supabase project:"
Write-Host "    - Enable the same Postgres extensions as source (Database -> Extensions)"
Write-Host "    - Enable Database Webhooks if source used them"
Write-Host ""

foreach ($f in @($rolesFile, $schemaFile, $dataFile)) {
  if (-not (Test-Path $f)) { throw "Missing dump file: $f (run without -RestoreOnly first)" }
}

Write-Host "        Applying schema.sql (errors on pre-drop statements are normal on a fresh DB)..."
# ON_ERROR_STOP=0 so harmless DROP IF EXISTS failures on a fresh target are ignored
& $psql @(
  "--variable=ON_ERROR_STOP=0",
  "--file=$schemaFile",
  "--dbname=$TargetDatabaseUrl"
)
# psql exits 3 on "command error" when ON_ERROR_STOP=0; treat any exit > 3 as fatal
if ($LASTEXITCODE -gt 3) { throw "psql schema restore failed (exit $LASTEXITCODE)" }

Write-Host "        Applying data.sql ..."
& $psql @(
  "--single-transaction",
  "--variable=ON_ERROR_STOP=1",
  "--command=SET session_replication_role = replica;",
  "--file=$dataFile",
  "--dbname=$TargetDatabaseUrl"
)
if ($LASTEXITCODE -ne 0) { throw "psql data restore failed (exit $LASTEXITCODE)" }

Write-Host ""
Write-Host "  Restore complete."
Write-Host ""
Write-Host "  Next steps:"
Write-Host "    1. Sync storage files:  node scripts/sync-supabase-storage.mjs"
Write-Host "    2. Update backend/.env with new AI_MANAGER_SUPABASE_* keys"
Write-Host "    3. Reconfigure Google OAuth redirect URLs for the new project"
Write-Host "    4. Re-enable Realtime publications if used (Database -> Publications)"
Write-Host "    5. Spot-check row counts in Table Editor vs source"
Write-Host ""
