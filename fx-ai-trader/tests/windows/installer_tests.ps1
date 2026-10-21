# Logic tests for scripts/windows/setup_vps.ps1, run with PowerShell 7 (any OS) by
# tests/test_windows_installer.py. They load the installer's functions only
# (FXAI_INSTALLER_LIBRARY=1) and exercise everything that does not need Windows.
param([string]$OutDir)
$ErrorActionPreference = "Stop"
$env:FXAI_INSTALLER_LIBRARY = "1"
$projRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
. (Join-Path $projRoot "scripts/windows/setup_vps.ps1")
$ErrorActionPreference = "Stop"
$script:failures = 0
function Check([bool]$Cond, [string]$Name) {
    if ($Cond) { Write-Host "ok   $Name" } else { Write-Host "FAIL $Name"; $script:failures++ }
}
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("fxai-inst-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null

# ---------------------------------------------------------------- archive checks
Add-Type -AssemblyName System.IO.Compression
function New-TestZip([string]$Path, [string]$Comment, [string[]]$Files) {
    $fs = [IO.File]::Create($Path)
    $z = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
    foreach ($f in $Files) {
        $e = $z.CreateEntry($f)
        $w = New-Object IO.StreamWriter($e.Open())
        $w.Write("x")
        $w.Dispose()
    }
    $z.Dispose()
    $fs.Dispose()
    if ($Comment) {
        # set the zip comment by hand (ZipArchive.Comment does not exist in Windows PowerShell 5.1's .NET)
        $bytes = [IO.File]::ReadAllBytes($Path)
        $c = [Text.Encoding]::ASCII.GetBytes($Comment)
        $bytes[$bytes.Length - 2] = [byte]($c.Length % 256)
        $bytes[$bytes.Length - 1] = [byte][Math]::Floor($c.Length / 256)
        [IO.File]::WriteAllBytes($Path, [byte[]]($bytes + $c))
    }
}
$sha = "f2675984b815f24484dd121d0686a76ccec05a35"
$top = "hello-world-project-$sha"
$good = @("$top/", "$top/fx-ai-trader/fxai/__init__.py", "$top/fx-ai-trader/requirements.txt",
          "$top/fx-ai-trader/mql4/Experts/FXAI_Bridge.mq4", "$top/fx-ai-trader/scripts/windows/setup_vps.ps1")
New-TestZip (Join-Path $tmp "good.zip") $sha $good
Check ((Get-ZipComment (Join-Path $tmp "good.zip")) -eq $sha) "zip comment holds the commit id"
$r = Test-ProjectArchive (Join-Path $tmp "good.zip") $sha
Check ($r.Ok -and $r.Top -eq $top -and $r.Sha -eq $sha) "valid archive accepted"
Check ((Test-ProjectArchive (Join-Path $tmp "good.zip") "")).Ok "valid archive accepted without an expected id"
$r = Test-ProjectArchive (Join-Path $tmp "good.zip") ("0" * 40)
Check ((-not $r.Ok) -and $r.Reason -like "*expected*") "archive of another commit rejected"
New-TestZip (Join-Path $tmp "nocomment.zip") "" $good
Check (-not (Test-ProjectArchive (Join-Path $tmp "nocomment.zip") "").Ok) "archive without commit id rejected"
New-TestZip (Join-Path $tmp "partial.zip") $sha ($good | Select-Object -First 3)
$r = Test-ProjectArchive (Join-Path $tmp "partial.zip") $sha
Check ((-not $r.Ok) -and $r.Reason -like "*missing*") "incomplete archive rejected"
if ($env:FXAI_TEST_GITHUB_ZIP) {
    $r = Test-ProjectArchive $env:FXAI_TEST_GITHUB_ZIP $env:FXAI_TEST_GITHUB_SHA
    Check $r.Ok "real GitHub archive verified against commit $($env:FXAI_TEST_GITHUB_SHA)"
}

# ---------------------------------------------------------------- python versions
$html = '<a href="3.12.9/">3.12.9/</a><a href="3.13.10/">3.13.10/</a><a href="3.13.9/">3.13.9/</a><a href="3.13.2/">3.13.2/</a><a href="3.14.0/">3.14.0/</a>'
$v = @(Get-Python313Versions $html)
Check (($v -join ",") -eq "3.13.10,3.13.9,3.13.2") "python.org listing: 3.13 versions, newest first (numeric order)"

# ---------------------------------------------------------------- symbol suffix detection
function New-SymbolsRaw([string[]]$Names) {
    $out = New-Object System.Collections.Generic.List[byte]
    foreach ($n in $Names) {
        $rec = New-Object byte[] 128
        $b = [Text.Encoding]::ASCII.GetBytes($n)
        [Array]::Copy($b, $rec, $b.Length)
        $desc = [Text.Encoding]::ASCII.GetBytes("Euro vs US Dollar EURUSD rate")
        [Array]::Copy($desc, 0, $rec, 40, $desc.Length)   # description text must not count as a name
        $out.AddRange($rec)
    }
    return , $out.ToArray()
}
$a = @(Find-SymbolAffixes (New-SymbolsRaw @("EURUSD.r", "GBPUSD.r", "USDJPY.r", "XAUUSD.r")))
Check (($a -join ";") -eq "|.r") "suffix .r detected"
$a = @(Find-SymbolAffixes (New-SymbolsRaw @("EURUSD", "GBPUSD", "AUDUSD")))
Check (($a -join ";") -eq "|") "no suffix detected"
$a = @(Find-SymbolAffixes (New-SymbolsRaw @("EURUSD", "GBPUSD", "EURUSDm", "GBPUSDm", "USDJPYm")))
Check (($a -join ";") -eq "|m;|") "several variants: most complete first"
$a = @(Find-SymbolAffixes (New-SymbolsRaw @("#EURUSD", "#GBPUSD")))
Check (($a -join ";") -eq "#|") "prefix detected"
$a = @(Find-SymbolAffixes (New-SymbolsRaw @("EURUSD.x")))
Check ($a.Count -eq 0) "a single pair is not enough evidence"

# ---------------------------------------------------------------- config edits
$example = Get-Content (Join-Path $projRoot "config/config.example.yaml") -Raw
$t = Set-YamlScalar $example "symbols" "suffix" '".r"'
$t = Set-YamlScalar $t "symbols" "prefix" '""'
$t = Set-YamlScalar $t "risk" "commission_per_lot_round_turn" "3.5"
Check ((Get-YamlScalar $t "symbols" "suffix") -eq ".r") "suffix written and read back"
Check ((Get-YamlScalar $t "risk" "commission_per_lot_round_turn") -eq "3.5") "commission written and read back"
Check ((Get-YamlScalar $t "symbols" "prefix") -eq "") "empty prefix read back"
$diff = @(Compare-Object ($example -split "`r?`n") ($t -split "`r?`n"))
Check ($diff.Count -eq 4) "only the suffix and commission lines change ($($diff.Count / 2) lines)"
Check ($t -match 'suffix: "\.r"\s+# broker suffix') "comment kept on the edited line"
Check ($null -eq (Get-YamlScalar $t "" "mode")) "lookup in a missing section returns nothing"
$threw = $false
try { [void](Set-YamlScalar $t "risk" "no_such_key" "1") } catch { $threw = $true }
Check $threw "editing a missing setting fails loudly"
if ($OutDir) { Write-TextFile (Join-Path $OutDir "config.yaml") $t }

# ---------------------------------------------------------------- EA defaults
$ea = Get-Content (Join-Path $projRoot "mql4/Experts/FXAI_Bridge.mq4") -Raw
$ea2 = Set-EaDefaults $ea "" ".r"
Check ($ea2 -match 'input string\s+SymbolSuffix\s*=\s*"\.r";') "EA suffix default set"
Check ($ea2 -match 'input bool\s+EnableTrading\s*=\s*false;') "EA still ships with EnableTrading=false"
Check ($ea2 -match 'input bool\s+AllowLiveAccount\s*=\s*false;') "EA still ships with AllowLiveAccount=false"
$d = @(Compare-Object ($ea -split "`n") ($ea2 -split "`n"))
Check ($d.Count -eq 2) "only the suffix line of the EA changes"
$threw = $false
try { [void](Set-EaDefaults $ea "" 'x"; bool EnableTrading = true; //') } catch { $threw = $true }
Check $threw "suffix with code injection rejected"
Check ((Test-Affix ".r") -and (Test-Affix "") -and (Test-Affix "-ECN") -and -not (Test-Affix "a b") -and -not (Test-Affix '$x')) "affix validation"

# ---------------------------------------------------------------- MetaEditor log
$ok = "C:\...\FXAI_Bridge.mq4 : information: compiling 'FXAI_Bridge.mq4'`r`nResult: 0 error(s), 2 warning(s)"
$r = Get-MetaEditorResult $ok
Check ($r.Errors -eq 0 -and $r.Warnings -eq 2) "compile log: 0 errors, 2 warnings"
$bad = "FXAI_Bridge.mq4(120,5) : error 256: 'x' - undeclared identifier`r`nFXAI_Bridge.mq4(130,1) : error 149: unexpected token`r`n2 error(s), 0 warning(s)"
$r = Get-MetaEditorResult $bad
Check ($r.Errors -eq 2 -and $r.ErrorLines.Count -eq 2) "compile log: errors and their lines"
Check ((Get-MetaEditorResult "").Errors -eq -1) "unreadable log reported as unknown, not as success"

# ---------------------------------------------------------------- update keeps user files
$stage = Join-Path $tmp "stage/fx-ai-trader"
$app = Join-Path $tmp "app/fx-ai-trader"
$bak = Join-Path $tmp "backups/1"
foreach ($f in @("fxai/__init__.py", "fxai/new_module.py", "config/config.example.yaml", "reports/experiments/INDEX.md", "README.md")) {
    $p = Join-Path $stage $f
    New-Item -ItemType Directory -Force -Path (Split-Path $p) | Out-Null
    Set-Content -Path $p -Value "new $f"
}
New-Item -ItemType Directory -Force -Path (Join-Path $tmp "app") | Out-Null
$acts = @(Install-AppTree $stage $app $bak)
Check ((Test-Path (Join-Path $app "fxai/new_module.py")) -and $acts[-1] -eq "new installation") "fresh install copies everything"
# user state + an old module that the new version no longer has
$user = @{ "config/config.yaml" = "suffix: mine"; ".env" = "FXAI_SECRET_KEY=keep"; "data/fxai.sqlite" = "db";
           "reports/validation_status.json" = "{}"; "logs/service.log" = "log"; ".venv/marker" = "venv" }
foreach ($k in $user.Keys) {
    $p = Join-Path $app $k
    New-Item -ItemType Directory -Force -Path (Split-Path $p) | Out-Null
    Set-Content -Path $p -Value $user[$k]
}
Set-Content -Path (Join-Path $app "fxai/old_module.py") -Value "old"
Set-Content -Path (Join-Path $app "config/config.example.yaml") -Value "locally edited example"
Set-Content -Path (Join-Path $stage "fxai/__init__.py") -Value "newer"
$acts = @(Install-AppTree $stage $app $bak)
$kept = $true
foreach ($k in $user.Keys) { if ((Get-Content (Join-Path $app $k) -Raw).Trim() -ne $user[$k]) { $kept = $false } }
Check $kept "update keeps config.yaml, .env, data, logs, .venv and validation_status.json untouched"
Check (-not (Test-Path (Join-Path $app "fxai/old_module.py"))) "update removes code the new version no longer has"
Check (Test-Path (Join-Path $bak "previous-version/fxai/old_module.py")) "previous code kept in the backup"
Check ((Get-Content (Join-Path $app "fxai/__init__.py") -Raw).Trim() -eq "newer") "new code installed"
Check ((Get-Content (Join-Path $bak "config/config.example.yaml") -Raw).Trim() -eq "locally edited example") "changed repo file backed up before overwrite"
Check ((Get-Content (Join-Path $app "config/config.example.yaml") -Raw).Trim() -eq "new config/config.example.yaml") "repo file updated"
$b = Backup-Item (Join-Path $app "config/config.yaml") (Join-Path $tmp "backups/2") $app
Check ($b -and (Get-Content $b -Raw).Trim() -eq "suffix: mine") "settings backup keeps the relative path"

# ---------------------------------------------------------------- running programs
$pyExe = $env:FXAI_TEST_PYTHON
if (-not $pyExe) { $c = Get-Command python3 -ErrorAction SilentlyContinue; if ($c) { $pyExe = $c.Source } }
if ($pyExe) {
    $r = Invoke-Captured $pyExe @("-c", "import sys; print('a b'); print(sys.argv[1]); sys.exit(3)", "x y") ""
    Check ($r.Code -eq 3 -and $r.Out -match "a b" -and $r.Out -match "x y") "programs: exit code, output and arguments with spaces"
    $r = Invoke-Captured $pyExe @("-c", "import sys; sys.stderr.write('warn'); print('ok')") ""
    Check ($r.Code -eq 0 -and $r.Err -match "warn" -and $r.Out.Trim() -eq "ok") "stderr captured separately, not treated as failure"
}

Remove-Item $tmp -Recurse -Force
Write-Host "failures: $script:failures"
exit $script:failures
