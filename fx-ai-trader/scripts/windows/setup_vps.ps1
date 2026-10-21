<#
.SYNOPSIS
  fxai one-command installer and updater for a Windows VPS. Demo-only.

.DESCRIPTION
  Paste the one-line command from docs/VPS_QUICKSTART.md into PowerShell on the VPS. The line
  downloads this script from GitHub and runs it. Re-running it is safe: components already
  present are reused, existing settings are kept, and anything that must change is first
  backed up under <InstallDir>\backups\<timestamp>.

  Steps:
    1. Download the requested project version over HTTPS and check that the archive is exactly
       the requested commit. A public repository needs no sign-in. For a private repository,
       sign-in uses GitHub's device login through the official GitHub CLI, and the token stays
       in Windows Credential Manager.
    2. Find 64-bit Python 3.13, or install it from python.org after checking the installer's
       Authenticode signature (Python Software Foundation).
    3. Create the virtual environment and install the pinned packages, skipped if unchanged.
    4. Run the test suite on this machine. -SkipTests skips it.
    5. Create config\config.yaml (mode: demo) and .env (dashboard password hash) if missing.
       The only prompts are: dashboard password, broker symbol suffix (auto-detected from MT4
       when possible) and commission per lot.
    6. Find MT4, install the EA with your suffix as its default, compile it with MetaEditor,
       and check both the compile log and the new .ex4 file.
    7. Register the service and dashboard tasks (start at logon, restart on exit) and start them.
    8. Create desktop shortcuts.
    9. Run `fxai doctor`, then print and save a summary: OK / TODO / WARN / FAIL.

  Trading stays demo-only. New configs use mode: demo; the EA keeps EnableTrading=false and
  AllowLiveAccount=false; no risk setting is changed; the service is not started if the
  config says mode: live.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File setup_vps.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File setup_vps.ps1 -Suffix ".r" -SkipTests
#>
[CmdletBinding()]
param(
    [string]$InstallDir = "C:\fxai",
    [string]$Repo = "hassanxr7/hello-world-project",
    [string]$Ref = "ccr-4ece60e2-b0u54h",          # branch, tag or full commit SHA to install
    [string]$UpdateRef = "ccr-4ece60e2-b0u54h",    # what the "FXAI Update" shortcut installs
    [string]$Source = "",                          # install from a local fx-ai-trader folder instead of GitHub
    [string]$Suffix,
    [string]$Prefix,
    [double]$Commission = -1,
    [switch]$SkipTests,
    [switch]$SkipCompile,
    [switch]$NoStart,
    [switch]$NoShortcuts,
    [switch]$Unattended,
    # accepted for compatibility with the earlier version of this script (now always on)
    [switch]$InstallPython,
    [switch]$RunTests,
    [switch]$RegisterTasks
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # Invoke-WebRequest is many times faster without the progress bar
# Captured here: inside functions $PSBoundParameters only sees the function's own parameters.
$script:AffixGiven = $PSBoundParameters.ContainsKey("Suffix") -or $PSBoundParameters.ContainsKey("Prefix")

# ============================================================================ helpers (pure, testable)
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding $false
$script:Results = New-Object System.Collections.ArrayList
$script:NextSteps = New-Object System.Collections.ArrayList
$script:CorePairs = @("EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD")
# Top-level entries of the app folder that belong to the user: never replaced by an update.
$script:ProtectedTop = @(".venv", ".env", "data", "logs", "backups", "VERSION")
# Folders whose files are updated one by one, keeping files the user added.
$script:MergeTop = @("config", "reports", "models")
# Files inside merge folders that are never overwritten.
$script:NeverOverwrite = @("config/config.yaml", "reports/validation_status.json")

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "== $Text" -ForegroundColor Cyan
}

function Add-Result([string]$Area, [string]$Status, [string]$Detail) {
    [void]$script:Results.Add([pscustomobject]@{ Area = $Area; Status = $Status; Detail = $Detail })
    $color = @{ OK = "Green"; TODO = "Yellow"; WARN = "Yellow"; FAIL = "Red"; SKIP = "DarkGray" }[$Status]
    if (-not $color) { $color = "White" }
    Write-Host ("  [{0,-4}] {1}: {2}" -f $Status, $Area, $Detail) -ForegroundColor $color
}

function Add-NextStep([string]$Title, [string[]]$Lines) {
    [void]$script:NextSteps.Add([pscustomobject]@{ Title = $Title; Lines = $Lines })
}

function Write-TextFile([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, $script:Utf8NoBom)
}

function Get-FullPath([string]$Path) {
    return [IO.Path]::GetFullPath($Path)
}

function Test-Affix([string]$Value) {
    # broker symbol prefix/suffix: a few safe characters only (it is written into MQL and YAML)
    return ($Value -match '^[A-Za-z0-9._#+-]{0,12}$')
}

function Get-ZipComment([string]$Path) {
    # GitHub stores the commit SHA of an archive in the zip comment (end-of-central-directory record).
    $fs = [IO.File]::OpenRead($Path)
    try {
        $len = $fs.Length
        $n = [int][Math]::Min($len, 65557)
        $buf = New-Object byte[] $n
        [void]$fs.Seek($len - $n, [IO.SeekOrigin]::Begin)
        $read = 0
        while ($read -lt $n) {
            $r = $fs.Read($buf, $read, $n - $read)
            if ($r -le 0) { break }
            $read += $r
        }
    } finally { $fs.Dispose() }
    for ($i = $n - 22; $i -ge 0; $i--) {
        if ($buf[$i] -eq 0x50 -and $buf[$i + 1] -eq 0x4b -and $buf[$i + 2] -eq 0x05 -and $buf[$i + 3] -eq 0x06) {
            $clen = [int]$buf[$i + 20] + 256 * [int]$buf[$i + 21]
            if ($i + 22 + $clen -le $n) { return [Text.Encoding]::ASCII.GetString($buf, $i + 22, $clen) }
        }
    }
    return ""
}

function Test-ProjectArchive([string]$Path, [string]$ExpectedSha) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($Path)
    try { $names = @($zip.Entries | ForEach-Object { $_.FullName }) } finally { $zip.Dispose() }
    $top = if ($names.Count -gt 0) { ($names[0] -split '/')[0] } else { "" }
    $need = @("$top/fx-ai-trader/fxai/__init__.py", "$top/fx-ai-trader/requirements.txt",
              "$top/fx-ai-trader/mql4/Experts/FXAI_Bridge.mq4", "$top/fx-ai-trader/scripts/windows/setup_vps.ps1")
    $missing = @($need | Where-Object { $names -notcontains $_ })
    $sha = (Get-ZipComment $Path).Trim()
    $reason = ""
    if ($missing.Count -gt 0) { $reason = "archive is missing " + ($missing -join ", ") }
    elseif ($sha -notmatch '^[0-9a-f]{40}$') { $reason = "archive has no commit id" }
    elseif ($ExpectedSha -and $sha -ne $ExpectedSha) { $reason = "archive is commit $sha, expected $ExpectedSha" }
    return [pscustomobject]@{ Ok = ($reason -eq ""); Top = $top; Sha = $sha; Reason = $reason }
}

function Get-Python313Versions([string]$Html) {
    # versions listed in https://www.python.org/ftp/python/ (newest first)
    $set = @{}
    foreach ($m in [regex]::Matches($Html, 'href="(3\.13\.(\d+))/"')) { $set[$m.Groups[1].Value] = [int]$m.Groups[2].Value }
    return @($set.Keys | Sort-Object { $set[$_] } -Descending)
}

function Find-SymbolAffixes([byte[]]$Bytes) {
    # MT4 history\<server>\symbols.raw holds null-terminated symbol names. Returns "prefix|suffix"
    # combinations seen for at least two of the core pairs, most frequent first.
    $text = [Text.Encoding]::GetEncoding(28591).GetString($Bytes)
    $hits = @{}
    foreach ($p in $script:CorePairs) {
        $rx = '(?<![A-Za-z0-9._#+-])([A-Za-z0-9._#+-]{0,6})' + $p + '([A-Za-z0-9._#+-]{0,8})(?=\x00)'
        foreach ($m in [regex]::Matches($text, $rx)) {
            $key = $m.Groups[1].Value + "|" + $m.Groups[2].Value
            if (-not $hits.ContainsKey($key)) { $hits[$key] = @{} }
            $hits[$key][$p] = $true
        }
    }
    $keys = @($hits.Keys | Where-Object { $hits[$_].Count -ge 2 })
    return @($keys | Sort-Object @{ Expression = { $hits[$_].Count }; Descending = $true }, @{ Expression = { $_ } })
}

function Get-YamlScalar([string]$Text, [string]$Section, [string]$Key) {
    $inSection = $false
    foreach ($line in ($Text -split "`r?`n")) {
        if ($line -match '^([A-Za-z_]\w*):') { $inSection = ($Matches[1] -eq $Section); continue }
        if ($inSection -and $line -match ('^\s+' + [regex]::Escape($Key) + ':\s*(?<v>"[^"]*"|''[^'']*''|[^#\s]*)')) {
            $v = $Matches['v']
            if ($v.Length -ge 2 -and ($v[0] -eq '"' -or $v[0] -eq "'")) { $v = $v.Substring(1, $v.Length - 2) }
            return $v
        }
    }
    return $null
}

function Set-YamlScalar([string]$Text, [string]$Section, [string]$Key, [string]$Value) {
    # Replaces the value of "  key: value  # comment" inside a top-level section, keeping the comment.
    $nl = if ($Text.Contains("`r`n")) { "`r`n" } else { "`n" }
    $lines = $Text -split "`r?`n"
    $inSection = $false
    $done = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if ($line -match '^([A-Za-z_]\w*):') { $inSection = ($Matches[1] -eq $Section); continue }
        if (-not $done -and $inSection -and
            $line -match ('^(?<pre>\s+' + [regex]::Escape($Key) + ':\s*)(?<v>"[^"]*"|''[^'']*''|[^#\s]*)(?<post>.*)$')) {
            $lines[$i] = $Matches['pre'] + $Value + $Matches['post']
            $done = $true
        }
    }
    if (-not $done) { throw "setting $Section.$Key not found in the config file" }
    return ($lines -join $nl)
}

function Set-EaDefaults([string]$Source, [string]$Prefix, [string]$Suffix) {
    # Writes the broker prefix/suffix as the EA's input defaults, so it can be attached unchanged.
    foreach ($pair in @(@("SymbolPrefix", $Prefix), @("SymbolSuffix", $Suffix))) {
        if (-not (Test-Affix $pair[1])) { throw "invalid symbol affix '$($pair[1])'" }
        $rx = '(?m)^(\s*input\s+string\s+' + $pair[0] + '\s*=\s*)"[^"]*"'
        if ([regex]::Matches($Source, $rx).Count -ne 1) { throw "EA input $($pair[0]) not found exactly once" }
        $Source = [regex]::Replace($Source, $rx, ('${1}"' + $pair[1] + '"'))
    }
    return $Source
}

function Get-MetaEditorResult([string]$LogText) {
    $res = [pscustomobject]@{ Errors = -1; Warnings = -1; ErrorLines = @() }
    $e = [regex]::Matches($LogText, '(\d+)\s+error', 'IgnoreCase')
    if ($e.Count -gt 0) { $res.Errors = [int]$e[$e.Count - 1].Groups[1].Value }
    $w = [regex]::Matches($LogText, '(\d+)\s+warning', 'IgnoreCase')
    if ($w.Count -gt 0) { $res.Warnings = [int]$w[$w.Count - 1].Groups[1].Value }
    $res.ErrorLines = @($LogText -split "`r?`n" | Where-Object { $_ -match ':\s*error\s+\d+' } | Select-Object -First 5)
    return $res
}

function Backup-Item([string]$Path, [string]$BackupRoot, [string]$RelativeTo) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $full = Get-FullPath $Path
    $rel = Split-Path $full -Leaf
    if ($RelativeTo) {
        $base = (Get-FullPath $RelativeTo).TrimEnd('\', '/')
        if ($full.StartsWith($base)) { $rel = $full.Substring($base.Length).TrimStart('\', '/') }
    }
    $dest = Join-Path $BackupRoot $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
    Copy-Item -LiteralPath $full -Destination $dest -Recurse -Force
    return $dest
}

function Install-AppTree([string]$Staging, [string]$AppDir, [string]$BackupDir) {
    # Installs or updates the app folder from a staging copy without touching user files.
    $Staging = (Get-FullPath $Staging).TrimEnd('\', '/')
    $actions = New-Object System.Collections.ArrayList
    if (-not (Test-Path -LiteralPath $AppDir)) {
        Copy-Item -LiteralPath $Staging -Destination $AppDir -Recurse
        [void]$actions.Add("new installation")
        return $actions
    }
    $AppDir = (Get-FullPath $AppDir).TrimEnd('\', '/')
    foreach ($item in @(Get-ChildItem -LiteralPath $Staging -Force)) {
        $name = $item.Name
        if ($script:ProtectedTop -contains $name) { continue }
        $target = Join-Path $AppDir $name
        if ($item.PSIsContainer -and ($script:MergeTop -contains $name)) {
            foreach ($f in @(Get-ChildItem -LiteralPath $item.FullName -Recurse -File -Force)) {
                $rel = $f.FullName.Substring($Staging.Length).TrimStart('\', '/')
                if ($script:NeverOverwrite -contains ($rel -replace '\\', '/')) { continue }
                $dest = Join-Path $AppDir $rel
                if (Test-Path -LiteralPath $dest) {
                    if ((Get-FileHash -LiteralPath $dest).Hash -eq (Get-FileHash -LiteralPath $f.FullName).Hash) { continue }
                    [void](Backup-Item $dest $BackupDir $AppDir)
                    [void]$actions.Add("updated $rel (old copy backed up)")
                }
                New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
                Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
            }
            continue
        }
        if (Test-Path -LiteralPath $target) {
            $old = Join-Path (Join-Path $BackupDir "previous-version") $name
            New-Item -ItemType Directory -Force -Path (Split-Path $old -Parent) | Out-Null
            Move-Item -LiteralPath $target -Destination $old
        }
        Copy-Item -LiteralPath $item.FullName -Destination $target -Recurse
    }
    [void]$actions.Add("code updated; previous version kept in $BackupDir")
    return $actions
}

function Invoke-Captured([string]$Exe, [string[]]$Arguments, [string]$WorkDir) {
    # Runs a program, returns exit code, stdout and stderr (no console output, no PS error records).
    $ErrorActionPreference = "Continue"
    $out = [IO.Path]::GetTempFileName()
    $err = [IO.Path]::GetTempFileName()
    try {
        $argLine = ($Arguments | ForEach-Object {
            if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
        $sp = @{ FilePath = $Exe; Wait = $true; PassThru = $true; NoNewWindow = $true
                 RedirectStandardOutput = $out; RedirectStandardError = $err }
        if ($argLine) { $sp.ArgumentList = $argLine }
        if ($WorkDir) { $sp.WorkingDirectory = $WorkDir }
        $p = Start-Process @sp
        return [pscustomobject]@{ Code = $p.ExitCode; Out = [IO.File]::ReadAllText($out); Err = [IO.File]::ReadAllText($err) }
    } finally {
        Remove-Item $out, $err -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-Logged([string]$Exe, [string[]]$Arguments, [string]$Log, [string]$WorkDir) {
    $r = Invoke-Captured $Exe $Arguments $WorkDir
    [IO.File]::AppendAllText($Log, ($r.Out + $r.Err), $script:Utf8NoBom)
    return $r
}

function Get-Tail([string]$Text, [int]$Lines = 15) {
    return (@($Text -split "`r?`n" | Where-Object { $_.Trim() }) | Select-Object -Last $Lines) -join "`n"
}

function Read-Default([string]$Prompt, [string]$Default) {
    if ($Unattended) { return $Default }
    $a = Read-Host "  $Prompt [$Default]"
    if ([string]::IsNullOrWhiteSpace($a)) { return $Default }
    return $a.Trim()
}

function Read-YesNo([string]$Prompt, [bool]$Default) {
    if ($Unattended) { return $Default }
    $d = if ($Default) { "Y/n" } else { "y/N" }
    $a = Read-Host "  $Prompt [$d]"
    if ([string]::IsNullOrWhiteSpace($a)) { return $Default }
    return ($a.Trim().ToLower().StartsWith("y"))
}

# ============================================================================ Windows-side steps
function Get-Download([string]$Url, [string]$OutFile, [hashtable]$Headers) {
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile -Headers $Headers -TimeoutSec 900
        return 200
    } catch {
        $code = 0
        try { $code = [int]$_.Exception.Response.StatusCode } catch { $code = 0 }
        if ($code -eq 0) { throw }
        return $code
    }
}

function Install-GhCli([string]$ToolsDir) {
    $h = @{ "User-Agent" = "fxai-installer" }
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/cli/cli/releases/latest" -Headers $h -TimeoutSec 60
    $asset = @($rel.assets | Where-Object { $_.name -match '^gh_[\d.]+_windows_amd64\.zip$' })[0]
    $sums = @($rel.assets | Where-Object { $_.name -match '_checksums\.txt$' })[0]
    if (-not $asset -or -not $sums) { throw "could not find the GitHub CLI download" }
    New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
    $zip = Join-Path $ToolsDir $asset.name
    $sumFile = Join-Path $ToolsDir $sums.name
    [void](Get-Download $asset.browser_download_url $zip $h)
    [void](Get-Download $sums.browser_download_url $sumFile $h)
    $line = @(Get-Content $sumFile | Where-Object { $_ -match [regex]::Escape($asset.name) })[0]
    $expected = ($line -split '\s+')[0].ToLower()
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if (-not $expected -or $expected -ne $actual) { throw "GitHub CLI download failed its SHA-256 check" }
    $dest = Join-Path $ToolsDir "gh"
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $dest)
    $exe = @(Get-ChildItem $dest -Recurse -Filter gh.exe)[0]
    if (-not $exe) { throw "gh.exe not found in the GitHub CLI download" }
    return $exe.FullName
}

function Get-GitHubToken([string]$ToolsDir) {
    # Private repository: GitHub device sign-in through the official CLI. The token is stored by
    # the CLI in Windows Credential Manager; here it only lives in memory for the download.
    $cmd = Get-Command gh.exe -ErrorAction SilentlyContinue
    $gh = if ($cmd) { $cmd.Source } else { Install-GhCli $ToolsDir }
    $st = Invoke-Captured $gh @("auth", "status", "--hostname", "github.com") ""
    if ($st.Code -ne 0) {
        if ($Unattended) { throw "the repository needs a GitHub sign-in; run the installer without -Unattended" }
        Write-Host "  The repository is private. A browser window opens for GitHub sign-in:" -ForegroundColor Yellow
        Write-Host "  copy the one-time code shown below into it. Your password is never seen by this script." -ForegroundColor Yellow
        & $gh auth login --hostname github.com --git-protocol https --web
        if ($LASTEXITCODE -ne 0) { throw "GitHub sign-in failed or was cancelled" }
    }
    $tok = (Invoke-Captured $gh @("auth", "token", "--hostname", "github.com") "").Out.Trim()
    if (-not $tok) { throw "could not obtain a GitHub token from the GitHub CLI" }
    return $tok
}

function Get-Project([string]$Repo, [string]$Ref, [string]$WorkDir, [string]$ToolsDir) {
    New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
    $h = @{ "User-Agent" = "fxai-installer"; "Accept" = "application/vnd.github+json" }
    $sha = $null
    if ($Ref -match '^[0-9a-f]{40}$') { $sha = $Ref }
    else {
        try { $sha = (Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/commits/$Ref" -Headers $h -TimeoutSec 60).sha }
        catch { $sha = $null }   # rate-limited or private: the archive's own commit id is checked below
    }
    $zip = Join-Path $WorkDir "project.zip"
    $url = if ($sha) { "https://codeload.github.com/$Repo/zip/$sha" } else { "https://codeload.github.com/$Repo/zip/$Ref" }
    $code = Get-Download $url $zip @{ "User-Agent" = "fxai-installer" }
    if ($code -eq 404) {
        $tok = Get-GitHubToken $ToolsDir
        try {
            $auth = @{ "User-Agent" = "fxai-installer"; "Accept" = "application/vnd.github+json"; "Authorization" = "Bearer $tok" }
            if (-not $sha) { $sha = (Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/commits/$Ref" -Headers $auth -TimeoutSec 60).sha }
            $code = Get-Download "https://api.github.com/repos/$Repo/zipball/$sha" $zip $auth
        } finally { $tok = $null; $auth = $null }
    }
    if ($code -ne 200) { throw "download of $Repo@$Ref failed (HTTP $code)" }
    $check = Test-ProjectArchive $zip $sha
    if (-not $check.Ok) { throw "downloaded archive rejected: $($check.Reason)" }
    $staging = Join-Path $WorkDir "staging"
    if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $staging)
    return [pscustomobject]@{ Dir = (Join-Path (Join-Path $staging $check.Top) "fx-ai-trader"); Sha = $check.Sha }
}

function Get-PythonInfo([string]$Exe) {
    if (-not $Exe -or -not (Test-Path -LiteralPath $Exe)) { return $null }
    if ($Exe -like "*\WindowsApps\*") { return $null }   # Microsoft Store stub, not a real interpreter
    $r = Invoke-Captured $Exe @("-c", "import sys,struct;print('%d.%d.%d %d' % (sys.version_info[0],sys.version_info[1],sys.version_info[2],struct.calcsize('P')*8))") ""
    if ($r.Code -ne 0) { return $null }
    $parts = $r.Out.Trim().Split(" ")
    if ($parts.Count -ne 2) { return $null }
    return [pscustomobject]@{ Exe = $Exe; Version = $parts[0]; Bits = [int]$parts[1] }
}

function Find-Python313 {
    $cands = New-Object System.Collections.ArrayList
    foreach ($root in @("HKCU:\Software\Python\PythonCore\3.13", "HKLM:\Software\Python\PythonCore\3.13",
                        "HKLM:\Software\WOW6432Node\Python\PythonCore\3.13")) {
        try {
            $ip = Get-ItemProperty -Path (Join-Path $root "InstallPath") -ErrorAction Stop
            if ($ip.ExecutablePath) { [void]$cands.Add($ip.ExecutablePath) }
            if ($ip.'(default)') { [void]$cands.Add((Join-Path $ip.'(default)' "python.exe")) }
        } catch { }
    }
    if ($env:LOCALAPPDATA) { [void]$cands.Add((Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe")) }
    if ($env:ProgramFiles) { [void]$cands.Add((Join-Path $env:ProgramFiles "Python313\python.exe")) }
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) {
        $r = Invoke-Captured $py.Source @("-3.13", "-c", "import sys;print(sys.executable)") ""
        if ($r.Code -eq 0 -and $r.Out.Trim()) { [void]$cands.Add($r.Out.Trim()) }
    }
    foreach ($c in $cands) {
        $i = Get-PythonInfo $c
        if ($i -and $i.Version -like "3.13.*" -and $i.Bits -eq 64) { return $i }
    }
    return $null
}

function Install-Python313([string]$DownloadDir) {
    $base = "https://www.python.org/ftp/python/"
    $versions = @()
    try { $versions = Get-Python313Versions (Invoke-WebRequest -UseBasicParsing -Uri $base -TimeoutSec 60).Content } catch { $versions = @() }
    if ($versions.Count -eq 0) { throw "cannot list Python versions at $base (no internet access?)" }
    New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null
    foreach ($v in @($versions | Select-Object -First 8)) {
        $exe = Join-Path $DownloadDir "python-$v-amd64.exe"
        $code = Get-Download "$base$v/python-$v-amd64.exe" $exe @{ "User-Agent" = "fxai-installer" }
        if ($code -ne 200) { continue }   # security-only releases have no Windows installer
        $sig = Get-AuthenticodeSignature -FilePath $exe
        if ($sig.Status -ne "Valid" -or $sig.SignerCertificate.Subject -notmatch "Python Software Foundation") {
            Remove-Item $exe -Force
            throw "the Python $v installer failed its signature check ($($sig.Status)) - not installed"
        }
        Write-Host "  installing Python $v for the current user (signature verified, about 1 minute)..."
        $p = Start-Process -FilePath $exe -Wait -PassThru -ArgumentList `
            "/quiet InstallAllUsers=0 PrependPath=0 Include_launcher=0 Include_test=0 Include_doc=0 Include_tcltk=0 Shortcuts=0"
        if ($p.ExitCode -ne 0) { throw "the Python installer exited with code $($p.ExitCode)" }
        return (Find-Python313)
    }
    throw "no Python 3.13 Windows installer found at $base"
}

function Find-Mt4 {
    # MT4 data folders (where MQL4\Experts lives) and the install folder each belongs to.
    $found = New-Object System.Collections.ArrayList
    $termRoot = Join-Path $env:APPDATA "MetaQuotes\Terminal"
    foreach ($d in @(Get-ChildItem $termRoot -Directory -ErrorAction SilentlyContinue)) {
        if (-not (Test-Path (Join-Path $d.FullName "MQL4\Experts"))) { continue }
        $origin = ""
        $of = Join-Path $d.FullName "origin.txt"
        if (Test-Path $of) { $origin = (Get-Content $of -Raw).Trim() }
        [void]$found.Add([pscustomobject]@{ Data = $d.FullName; Install = $origin })
    }
    $installs = New-Object System.Collections.ArrayList
    foreach ($pf in @(${env:ProgramFiles(x86)}, $env:ProgramFiles)) {
        if (-not $pf) { continue }
        foreach ($t in @(Get-ChildItem $pf -Directory -ErrorAction SilentlyContinue)) {
            if (Test-Path (Join-Path $t.FullName "terminal.exe")) { [void]$installs.Add($t.FullName) }
        }
    }
    foreach ($o in $found) { if ($o.Install -and -not ($installs -contains $o.Install)) { [void]$installs.Add($o.Install) } }
    return [pscustomobject]@{ DataDirs = $found; Installs = $installs }
}

function Get-DetectedAffixes($Mt4) {
    $all = @()
    foreach ($d in $Mt4.DataDirs) {
        $raw = @(Get-ChildItem (Join-Path $d.Data "history") -Recurse -Filter symbols.raw -ErrorAction SilentlyContinue |
                 Sort-Object LastWriteTime -Descending)
        if ($raw.Count -eq 0) { continue }
        try {
            # MT4 may have the file open: read with shared access; any problem just means "not detected"
            $fs = [IO.File]::Open($raw[0].FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
            try {
                $buf = New-Object byte[] $fs.Length
                $read = 0
                while ($read -lt $buf.Length) { $n = $fs.Read($buf, $read, $buf.Length - $read); if ($n -le 0) { break }; $read += $n }
            } finally { $fs.Dispose() }
            $all += Find-SymbolAffixes $buf
        } catch { continue }
    }
    return @($all | Select-Object -Unique)
}

function Stop-Fxai {
    foreach ($t in @("fxai-service", "fxai-dashboard")) {
        $task = Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
        if ($task -and $task.State -eq "Running") { Stop-ScheduledTask -TaskName $t }
    }
    Start-Sleep -Seconds 1
    foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue)) {
        if ($p.CommandLine -match '-m fxai (service|dashboard)') { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    }
}

function New-Shortcut([string]$Path, [string]$Target, [string]$Arguments, [string]$WorkDir, [string]$Description) {
    $ws = New-Object -ComObject WScript.Shell
    $s = $ws.CreateShortcut($Path)
    $s.TargetPath = $Target
    $s.Arguments = $Arguments
    if ($WorkDir) { $s.WorkingDirectory = $WorkDir }
    $s.Description = $Description
    $s.Save()
}

# ============================================================================ main
function Invoke-Install {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw "this installer runs on Windows only" }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $ts = (Get-Date).ToString("yyyyMMdd-HHmmss")
    $AppDir = Join-Path $InstallDir "fx-ai-trader"
    $BackupDir = Join-Path $InstallDir "backups\$ts"
    $LogDir = Join-Path $InstallDir "install-logs"
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $log = Join-Path $LogDir "install-$ts.log"
    Write-Host "fxai installer - demo-only setup. Full log: $log" -ForegroundColor Cyan
    Write-Host "Install folder: $AppDir"

    # ---------------------------------------------------------------- 1. project
    Write-Step "1/9 Project files"
    $versionFile = Join-Path $AppDir "VERSION"
    $installed = if (Test-Path $versionFile) { (Get-Content $versionFile | Where-Object { $_ -like "sha=*" }) -replace '^sha=', '' } else { "" }
    if ($Source) {
        $proj = [pscustomobject]@{ Dir = (Get-FullPath $Source); Sha = "local" }
    } else {
        $proj = Get-Project $Repo $Ref (Join-Path $InstallDir "downloads\$ts") (Join-Path $InstallDir "tools")
    }
    if ($installed -and $installed -eq $proj.Sha -and (Test-Path (Join-Path $AppDir "fxai"))) {
        Add-Result "Project" "OK" "already at $($proj.Sha.Substring(0, [Math]::Min(12, $proj.Sha.Length))) - files unchanged"
    } else {
        Stop-Fxai
        $actions = Install-AppTree $proj.Dir $AppDir $BackupDir
        Write-TextFile $versionFile ("ref=$Ref`r`nsha=$($proj.Sha)`r`ninstalled=$ts`r`n")
        $short = $proj.Sha.Substring(0, [Math]::Min(12, $proj.Sha.Length))
        Add-Result "Project" "OK" ("$Repo@$Ref, commit $short verified; " + (@($actions)[-1]))
    }
    # settings from an earlier manual download (e.g. C:\fxai\hello-world-project-...\fx-ai-trader)
    foreach ($rel in @("config\config.yaml", ".env")) {
        $dst = Join-Path $AppDir $rel
        if (Test-Path $dst) { continue }
        $old = @(Get-ChildItem $InstallDir -Directory -Filter "hello-world-project*" -ErrorAction SilentlyContinue |
                 ForEach-Object { Join-Path $_.FullName "fx-ai-trader\$rel" } | Where-Object { Test-Path $_ })
        if ($old.Count -gt 0) { Copy-Item $old[0] $dst; Add-Result "Settings" "OK" "imported $rel from $($old[0])" }
    }
    if (-not $Source) { Remove-Item (Join-Path $InstallDir "downloads\$ts") -Recurse -Force -ErrorAction SilentlyContinue }
    $sp = Join-Path $AppDir "scripts\windows"

    # ---------------------------------------------------------------- 2. python
    Write-Step "2/9 Python 3.13"
    $py = Find-Python313
    if ($py) { Add-Result "Python" "OK" "Python $($py.Version) found at $($py.Exe)" }
    else {
        $py = Install-Python313 (Join-Path $InstallDir "downloads\python")
        if (-not $py) { throw "Python 3.13 was installed but cannot be found" }
        Add-Result "Python" "OK" "Python $($py.Version) installed (signature verified) at $($py.Exe)"
    }

    # ---------------------------------------------------------------- 3. venv + packages
    Write-Step "3/9 Virtual environment and packages"
    $venvPy = Join-Path $AppDir ".venv\Scripts\python.exe"
    $vi = Get-PythonInfo $venvPy
    if ($vi -and $vi.Version -notlike "3.13.*") {
        Move-Item (Join-Path $AppDir ".venv") (Join-Path $BackupDir ".venv-python$($vi.Version)")
        $vi = $null
    }
    if (-not $vi) {
        $r = Invoke-Logged $py.Exe @("-m", "venv", (Join-Path $AppDir ".venv")) $log $AppDir
        if ($r.Code -ne 0) { throw "creating the virtual environment failed: $(Get-Tail $r.Err 5)" }
    }
    $reqFiles = @("requirements.txt")
    if (-not $SkipTests) { $reqFiles += "requirements-dev.txt" }
    $reqHash = ($reqFiles | ForEach-Object { (Get-FileHash (Join-Path $AppDir $_) -Algorithm SHA256).Hash }) -join ","
    $marker = Join-Path $AppDir ".venv\fxai-requirements.sha256"
    $imports = Invoke-Captured $venvPy @("-c", "import fxai.service, fxai.dashboard.app, pandas, fastapi, uvicorn") $AppDir
    if ((Test-Path $marker) -and ((Get-Content $marker -Raw).Trim() -eq $reqHash) -and $imports.Code -eq 0) {
        Add-Result "Packages" "OK" "pinned packages already installed"
    } else {
        Write-Host "  installing pinned packages (a few minutes on first run)..."
        foreach ($f in $reqFiles) {
            $r = Invoke-Logged $venvPy @("-m", "pip", "install", "--disable-pip-version-check", "--no-input", "-r", (Join-Path $AppDir $f)) $log $AppDir
            if ($r.Code -ne 0) { throw "pip install -r $f failed:`n$(Get-Tail ($r.Out + $r.Err) 12)" }
        }
        Write-TextFile $marker $reqHash
        Add-Result "Packages" "OK" "pinned packages installed ($($reqFiles -join ', '))"
    }

    # ---------------------------------------------------------------- 4. tests
    Write-Step "4/9 Test suite on this machine"
    try {
        if ($SkipTests) { Add-Result "Tests" "SKIP" "skipped (-SkipTests)" }
        else {
            Write-Host "  running the tests (1-3 minutes)..."
            $tlog = Join-Path $AppDir "logs\test_output_windows.txt"
            New-Item -ItemType Directory -Force -Path (Split-Path $tlog) | Out-Null
            $r = Invoke-Captured $venvPy @("-m", "pytest", "-q", "-p", "no:cacheprovider") $AppDir
            Write-TextFile $tlog ($r.Out + $r.Err)
            $last = @($r.Out -split "`r?`n" | Where-Object { $_ -match '(passed|failed|error)' }) | Select-Object -Last 1
            if ($r.Code -eq 0) { Add-Result "Tests" "OK" "$last" }
            else { Add-Result "Tests" "FAIL" "$last - send me $tlog" }
        }
    } catch { Add-Result "Tests" "FAIL" $_.Exception.Message }

    # ---------------------------------------------------------------- 5. MT4 detection + config
    Write-Step "5/9 Configuration"
    $mt4 = Find-Mt4
    $detected = @(Get-DetectedAffixes $mt4)
    $cfgPath = Join-Path $AppDir "config\config.yaml"
    $choice = $null
    if ($script:AffixGiven) {
        $choice = "$Prefix|$Suffix"
    } elseif ($detected.Count -eq 1) {
        $choice = $detected[0]
        Write-Host ("  MT4 symbol list: your broker names EURUSD as '{0}EURUSD{1}'" -f ($choice -split '\|')[0], ($choice -split '\|')[1])
    } elseif ($detected.Count -gt 1 -and -not $Unattended) {
        Write-Host "  Your broker lists several symbol variants:"
        for ($i = 0; $i -lt $detected.Count; $i++) {
            Write-Host ("    {0}) {1}EURUSD{2}" -f ($i + 1), ($detected[$i] -split '\|')[0], ($detected[$i] -split '\|')[1])
        }
        $n = Read-Default "Which one does your demo account trade? Number" "1"
        $k = 0
        if ([int]::TryParse($n, [ref]$k) -and $k -ge 1 -and $k -le $detected.Count) { $choice = $detected[$k - 1] }
    }
    if (-not (Test-Path $cfgPath)) {
        if (-not $choice) {
            if ($mt4.DataDirs.Count -eq 0) { Write-Host "  MT4 is not set up yet, so the symbol suffix cannot be detected." }
            $s = Read-Default "Broker symbol suffix, e.g. .r or m (Enter = none / not known yet)" ""
            $choice = "|$s"
        }
        $pre, $suf = $choice -split '\|', 2
        if (-not (Test-Affix $pre) -or -not (Test-Affix $suf)) { throw "invalid symbol prefix/suffix '$pre' / '$suf'" }
        $comm = $Commission
        while ($comm -lt 0 -or $comm -gt 100) {
            $a = Read-Default "Broker commission per standard lot, round turn, in account currency" "7.0"
            $tmp = 0.0
            if ([double]::TryParse($a, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$tmp)) { $comm = $tmp }
            if ($Unattended -and ($comm -lt 0 -or $comm -gt 100)) { $comm = 7.0 }
        }
        $text = Get-Content (Join-Path $AppDir "config\config.example.yaml") -Raw
        $text = Set-YamlScalar $text "symbols" "prefix" ('"' + $pre + '"')
        $text = Set-YamlScalar $text "symbols" "suffix" ('"' + $suf + '"')
        $text = Set-YamlScalar $text "risk" "commission_per_lot_round_turn" ($comm.ToString([Globalization.CultureInfo]::InvariantCulture))
        Write-TextFile $cfgPath $text
        Add-Result "Config" "OK" "created config\config.yaml: mode demo, suffix '$suf', prefix '$pre', commission $comm"
    } else {
        $text = Get-Content $cfgPath -Raw
        $curPre = [string](Get-YamlScalar $text "symbols" "prefix")
        $curSuf = [string](Get-YamlScalar $text "symbols" "suffix")
        if ($choice -and $choice -ne "$curPre|$curSuf") {
            $pre, $suf = $choice -split '\|', 2
            $ask = "config uses prefix '$curPre' / suffix '$curSuf' but MT4 shows '$pre' / '$suf'. Update the config (a backup is kept)?"
            if ($script:AffixGiven -or (Read-YesNo $ask $true)) {
                if (-not (Test-Affix $pre) -or -not (Test-Affix $suf)) { throw "invalid symbol prefix/suffix '$pre' / '$suf'" }
                $b = Backup-Item $cfgPath $BackupDir $AppDir
                $text = Set-YamlScalar (Set-YamlScalar $text "symbols" "prefix" ('"' + $pre + '"')) "symbols" "suffix" ('"' + $suf + '"')
                Write-TextFile $cfgPath $text
                Add-Result "Config" "OK" "symbol prefix/suffix updated to '$pre' / '$suf' (backup: $b)"
            } else { Add-Result "Config" "OK" "existing config kept unchanged" }
        } else { Add-Result "Config" "OK" "existing config kept unchanged (suffix '$curSuf')" }
    }
    $chk = Invoke-Captured $venvPy @("-c", "from fxai.config import load_config;c=load_config('config/config.yaml');print(c.mode+'|'+c.symbols.prefix+'|'+c.symbols.suffix+'|'+str(c.dashboard.port))") $AppDir
    if ($chk.Code -ne 0) { throw "config\config.yaml does not load:`n$(Get-Tail $chk.Err 6)" }
    $mode, $cfgPre, $cfgSuf, $port = $chk.Out.Trim() -split '\|'
    if ($mode -eq "live") {
        Add-Result "Mode" "WARN" "config says mode: live - this installer keeps the system demo-only, so the service will NOT be started"
    } else { Add-Result "Mode" "OK" "mode: $mode (no live trading)" }

    $envPath = Join-Path $AppDir ".env"
    if (Test-Path $envPath) { Add-Result "Dashboard login" "OK" ".env exists - password kept" }
    elseif ($Unattended) { Add-Result "Dashboard login" "FAIL" "no dashboard password yet: run the installer once without -Unattended" }
    else {
        Write-Host "  Choose a dashboard password (12+ characters). Only a hash is stored; typing is hidden."
        $hash = ""
        Push-Location $AppDir   # "python -m fxai" needs the app folder as working directory
        for ($try = 1; $try -le 3 -and -not $hash; $try++) {
            $ErrorActionPreference = "Continue"
            $out = & $venvPy -m fxai hash-password
            $code = $LASTEXITCODE
            $ErrorActionPreference = "Stop"
            if ($code -eq 0 -and "$out".Trim() -match '^\S+$') { $hash = "$out".Trim() }
            else { Write-Host "  The passwords did not match or were too short - try again." -ForegroundColor Yellow }
        }
        Pop-Location
        if (-not $hash) { throw "dashboard password not set" }
        $secretR = Invoke-Captured $venvPy @("-m", "fxai", "gen-secret") $AppDir
        Write-TextFile $envPath ("FXAI_DASHBOARD_PASSWORD_HASH=$hash`r`nFXAI_SECRET_KEY=$($secretR.Out.Trim())`r`n")
        & icacls $envPath /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
        Add-Result "Dashboard login" "OK" ".env written (password hash + session key, readable by $($env:USERNAME) only)"
    }

    # ---------------------------------------------------------------- 6. MT4 + EA
    Write-Step "6/9 MetaTrader 4 and the EA"
    $eaState = "unknown"
    try {
        if ($mt4.DataDirs.Count -eq 0 -and $mt4.Installs.Count -gt 0) {
            $term = Join-Path $mt4.Installs[0] "terminal.exe"
            Write-Host "  MT4 is installed but has never been started - starting it once to create its data folder..."
            Start-Process -FilePath $term
            for ($i = 0; $i -lt 60 -and $mt4.DataDirs.Count -eq 0; $i++) { Start-Sleep -Seconds 2; $mt4 = Find-Mt4 }
        }
        if ($mt4.DataDirs.Count -eq 0) {
            Add-Result "MT4" "TODO" "MT4 not found"
            Add-NextStep "Install MT4 and log in to a demo account" @(
                "1. In Edge on this VPS, open your broker's website and download their MetaTrader 4 (MT4).",
                "2. Install it, start it and log in to your DEMO account.",
                "3. Run the same install command again. It will find MT4, install and compile the EA, and continue.")
            $eaState = "no-mt4"
        } else {
            $eaSrc = Get-Content (Join-Path $AppDir "mql4\Experts\FXAI_Bridge.mq4") -Raw
            $eaText = Set-EaDefaults $eaSrc $cfgPre $cfgSuf
            foreach ($d in $mt4.DataDirs) {
                $dest = Join-Path $d.Data "MQL4\Experts\FXAI_Bridge.mq4"
                if ((Test-Path $dest) -and ((Get-Content $dest -Raw) -ne $eaText)) { [void](Backup-Item $dest (Join-Path $BackupDir "mt4") $d.Data) }
                Write-TextFile $dest $eaText
                Copy-Item (Join-Path $AppDir "mql4\Scripts\FXAI_ExportHistory.mq4") (Join-Path $d.Data "MQL4\Scripts") -Force
                $label = Split-Path $d.Data -Leaf
                Add-Result "EA files" "OK" "FXAI_Bridge.mq4 (defaults: suffix '$cfgSuf', EnableTrading=false) copied to MT4 data folder $label"
                if ($SkipCompile) { Add-Result "EA compile" "SKIP" "skipped (-SkipCompile)"; continue }
                $me = if ($d.Install) { Join-Path $d.Install "metaeditor.exe" } else { "" }
                if (-not $me -or -not (Test-Path $me)) {
                    Add-Result "EA compile" "TODO" "MetaEditor not found for $label"
                    Add-NextStep "Compile the EA in MetaEditor" @(
                        "1. In MT4 press F4 to open MetaEditor.",
                        "2. In its Navigator open Experts > FXAI_Bridge.mq4 and press F7.",
                        "3. The Errors tab must end with '0 error(s)'. If not, send me those lines.",
                        "4. Run the install command again.")
                    continue
                }
                $ex4 = [IO.Path]::ChangeExtension($dest, ".ex4")
                $before = if (Test-Path $ex4) { (Get-Item $ex4).LastWriteTimeUtc } else { [datetime]::MinValue }
                $clog = Join-Path $AppDir "logs\compile_FXAI_Bridge.log"
                New-Item -ItemType Directory -Force -Path (Split-Path $clog) | Out-Null
                Remove-Item $clog -Force -ErrorAction SilentlyContinue
                $p = Start-Process -FilePath $me -ArgumentList ('/compile:"' + $dest + '" /log:"' + $clog + '"') -Wait -PassThru
                $ltext = ""
                if (Test-Path $clog) {
                    $bytes = [IO.File]::ReadAllBytes($clog)
                    $ltext = if ($bytes.Length -gt 1 -and $bytes[1] -eq 0) { [Text.Encoding]::Unicode.GetString($bytes) } else { [Text.Encoding]::UTF8.GetString($bytes) }
                }
                $res = Get-MetaEditorResult $ltext
                $built = (Test-Path $ex4) -and ((Get-Item $ex4).LastWriteTimeUtc -gt $before)
                if ($built -and $res.Errors -eq 0) {
                    Add-Result "EA compile" "OK" "compiled by MetaEditor: 0 errors, $($res.Warnings) warnings; new FXAI_Bridge.ex4 written"
                } elseif ($built -and $res.Errors -lt 0) {
                    Add-Result "EA compile" "OK" "new FXAI_Bridge.ex4 written (compile log not readable: $clog)"
                } else {
                    $why = if ($res.ErrorLines.Count) { $res.ErrorLines -join " | " } else { "no new .ex4 (MetaEditor exit $($p.ExitCode))" }
                    Add-Result "EA compile" "FAIL" "not compiled: $why. Send me $clog"
                    $eaState = "compile-failed"
                }
            }
            # Is the EA attached and running? (it rewrites state.json every second)
            $common = Join-Path $env:APPDATA "MetaQuotes\Terminal\Common\Files\FXAI"
            $state = @(Get-ChildItem $common -Recurse -Filter state.json -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
            if ($state.Count -gt 0 -and ((Get-Date) - $state[0].LastWriteTime).TotalSeconds -lt 120) {
                Add-Result "EA running" "OK" "FXAI_Bridge is attached and writing state (account folder $(Split-Path $state[0].DirectoryName -Leaf))"
                $eaState = "running"
            } elseif ($eaState -ne "compile-failed") {
                Add-Result "EA running" "TODO" "the EA is not attached to a chart yet"
                Add-NextStep "Attach the EA to one chart in MT4 (the only manual step)" @(
                    "1. In MT4 open File > New Chart > EURUSD (any timeframe; H1 is fine).",
                    "2. In the Navigator (Ctrl+N) open Expert Advisors and drag FXAI_Bridge onto that chart.",
                    "3. On the Common tab tick 'Allow live trading'. Leave the Inputs tab as it is:",
                    "   your suffix is already the default, and EnableTrading=false keeps it from trading.",
                    "4. Click OK. The chart's top-left corner must show 'FXAI Bridge ... [ACTIVE]'.",
                    "5. Wait one minute, then double-click 'FXAI Doctor' on the desktop and send me its output.")
                $eaState = "not-attached"
            }
        }
    } catch { Add-Result "MT4/EA" "FAIL" $_.Exception.Message }

    # ---------------------------------------------------------------- 7. tasks
    Write-Step "7/9 Service and dashboard"
    try {
        & (Join-Path $sp "register_tasks.ps1") -InstallDir $AppDir | Out-Null
        Add-Result "Auto-start" "OK" "tasks fxai-service and fxai-dashboard start at logon and restart if they stop"
        if ($NoStart) { Add-Result "Start" "SKIP" "not started (-NoStart)" }
        else {
            Stop-Fxai   # restart so that new code and settings are loaded (the EA keeps protecting positions meanwhile)
            Start-ScheduledTask -TaskName "fxai-dashboard"
            if ($mode -ne "live") { Start-ScheduledTask -TaskName "fxai-service" }
            $ok = $false
            for ($i = 0; $i -lt 40 -and -not $ok; $i++) {
                Start-Sleep -Seconds 1
                try { $ok = ((Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/healthz" -TimeoutSec 3).Content -match '"ok"\s*:\s*true') } catch { $ok = $false }
            }
            if ($ok) { Add-Result "Dashboard" "OK" "running at http://127.0.0.1:$port (on this VPS only)" }
            else { Add-Result "Dashboard" "FAIL" "not answering on http://127.0.0.1:$port - see $AppDir\logs\dashboard.log" }
            if ($mode -eq "live") { Add-Result "Service" "SKIP" "not started because the config says mode: live" }
            elseif ($eaState -eq "running") {
                Start-Sleep -Seconds 8
                $st = Invoke-Captured $venvPy @("-m", "fxai", "status") $AppDir
                $age = $null
                try {
                    $w = ($st.Out | ConvertFrom-Json)._written_at
                    if ($w) { $age = ((Get-Date).ToUniversalTime() - ([datetime]::Parse($w)).ToUniversalTime()).TotalSeconds }
                } catch { $age = $null }
                if ($null -ne $age -and $age -lt 30) { Add-Result "Service" "OK" "running and connected to the EA (status updated $([int]$age) s ago)" }
                else { Add-Result "Service" "WARN" "started but not reporting yet - see $AppDir\logs\service.log" }
            } else { Add-Result "Service" "TODO" "started; it connects automatically once the EA is attached (it retries every 30 s)" }
        }
    } catch { Add-Result "Service/dashboard" "FAIL" $_.Exception.Message }

    # ---------------------------------------------------------------- 8. shortcuts
    Write-Step "8/9 Desktop shortcuts"
    try {
        if ($NoShortcuts) { Add-Result "Shortcuts" "SKIP" "skipped (-NoShortcuts)" }
        else {
            $desk = [Environment]::GetFolderPath("Desktop")
            $ps = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
            Write-TextFile (Join-Path $desk "FXAI Dashboard.url") "[InternetShortcut]`r`nURL=http://127.0.0.1:$port/`r`n"
            New-Shortcut (Join-Path $desk "FXAI Doctor.lnk") $ps `
                "-NoProfile -NoExit -ExecutionPolicy Bypass -Command `"Set-Location '$AppDir'; & '.\.venv\Scripts\python.exe' -m fxai doctor`"" `
                $AppDir "Diagnostics: EA connection, data, limits"
            New-Shortcut (Join-Path $desk "FXAI Emergency Stop.lnk") $ps `
                "-NoProfile -NoExit -ExecutionPolicy Bypass -File `"$sp\estop.ps1`" -InstallDir `"$AppDir`"" `
                $AppDir "Block new entries; optionally close all system positions"
            New-Shortcut (Join-Path $desk "FXAI Restart.lnk") $ps `
                "-NoProfile -ExecutionPolicy Bypass -Command `"Stop-ScheduledTask fxai-service; Stop-ScheduledTask fxai-dashboard; Start-Sleep 2; Start-ScheduledTask fxai-dashboard; Start-ScheduledTask fxai-service`"" `
                $AppDir "Restart the fxai service and dashboard"
            # runs a temporary copy of this installer, so the files it updates are not in use
            $upd = '-NoProfile -NoExit -ExecutionPolicy Bypass -Command "$f = Join-Path $env:TEMP ''fxai-setup.ps1''; ' +
                   "Copy-Item -LiteralPath '$sp\setup_vps.ps1' -Destination `$f -Force; & `$f -InstallDir '$InstallDir' -Ref '$UpdateRef' -UpdateRef '$UpdateRef'" + '"'
            New-Shortcut (Join-Path $desk "FXAI Update.lnk") $ps $upd $AppDir "Download and install the latest version (settings are kept)"
            New-Shortcut (Join-Path $desk "FXAI Logs.lnk") (Join-Path $env:SystemRoot "explorer.exe") "`"$AppDir\logs`"" $AppDir "fxai log files"
            Add-Result "Shortcuts" "OK" "Dashboard, Doctor, Emergency Stop, Restart, Update, Logs on the desktop"
        }
    } catch { Add-Result "Shortcuts" "FAIL" $_.Exception.Message }

    # ---------------------------------------------------------------- 9. diagnostics
    Write-Step "9/9 Diagnostics (fxai doctor)"
    try {
        $doc = Invoke-Captured $venvPy @("-m", "fxai", "doctor", "--json") $AppDir
        $parsed = ConvertFrom-Json $doc.Out
        $checks = @($parsed | ForEach-Object { $_ })   # Windows PowerShell 5.1 returns a JSON array as one object
        $fails = @($checks | Where-Object { $_.status -eq "FAIL" })
        $warns = @($checks | Where-Object { $_.status -eq "WARN" })
        $pass = @($checks | Where-Object { $_.status -eq "PASS" })
        $txt = "$($pass.Count) pass, $($warns.Count) warn, $($fails.Count) fail"
        if ($fails.Count -gt 0) { $txt += " - " + (($fails | ForEach-Object { "$($_.name): $($_.detail)" }) -join " | ") }
        $st = if ($fails.Count -eq 0) { "OK" } elseif ($eaState -ne "running") { "TODO" } else { "FAIL" }
        Add-Result "Doctor" $st $txt
    } catch { Add-Result "Doctor" "WARN" "could not run or read the diagnostics: $($_.Exception.Message)" }
}

function Write-Summary([string]$InstallDir) {
    $lines = New-Object System.Collections.ArrayList
    [void]$lines.Add("fxai installation summary - $((Get-Date).ToString('yyyy-MM-dd HH:mm'))")
    foreach ($r in $script:Results) { [void]$lines.Add(("[{0,-4}] {1}: {2}" -f $r.Status, $r.Area, $r.Detail)) }
    $fail = @($script:Results | Where-Object { $_.Status -eq "FAIL" }).Count
    $todo = @($script:Results | Where-Object { $_.Status -eq "TODO" }).Count
    [void]$lines.Add("")
    if ($fail -gt 0) { [void]$lines.Add("RESULT: $fail problem(s) need attention. Send me this summary.") }
    elseif ($todo -gt 0) { [void]$lines.Add("RESULT: installed. One manual step remains (below).") }
    else { [void]$lines.Add("RESULT: everything installed and verified. Trading stays OFF (demo, EnableTrading=false).") }
    [void]$lines.Add("Keep this Windows session signed in: close the Remote Desktop window instead of signing out,")
    [void]$lines.Add("so that MT4, the service and the dashboard keep running.")
    if ($script:NextSteps.Count -gt 0) {
        $n = $script:NextSteps[0]
        [void]$lines.Add("")
        [void]$lines.Add("NEXT STEP: $($n.Title)")
        foreach ($l in $n.Lines) { [void]$lines.Add("  $l") }
    }
    Write-Host ""
    Write-Host "==================================================================" -ForegroundColor Cyan
    foreach ($l in $lines) {
        $c = "White"
        if ($l.StartsWith("[FAIL") -or $l.Contains("problem(s) need attention")) { $c = "Red" }
        elseif ($l.StartsWith("[TODO") -or $l.StartsWith("NEXT STEP")) { $c = "Yellow" }
        elseif ($l.StartsWith("[OK")) { $c = "Green" }
        Write-Host $l -ForegroundColor $c
    }
    Write-Host "==================================================================" -ForegroundColor Cyan
    try {
        New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
        $file = Join-Path $InstallDir "install-summary.txt"
        [IO.File]::WriteAllText($file, (($lines -join "`r`n") + "`r`n"), $script:Utf8NoBom)
        Write-Host "Saved to $file (it contains no passwords)."
    } catch { }
    return $fail
}

if ($env:FXAI_INSTALLER_LIBRARY -eq "1") { return }   # tests load the functions only

$exitCode = 0
$transcript = $false
try {
    New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "install-logs") | Out-Null
    Start-Transcript -Path (Join-Path $InstallDir ("install-logs\transcript-" + (Get-Date).ToString("yyyyMMdd-HHmmss") + ".txt")) | Out-Null
    $transcript = $true
} catch { $transcript = $false }
try {
    Invoke-Install
} catch {
    Add-Result "Installer" "FAIL" ($_.Exception.Message)
}
$exitCode = if ((Write-Summary $InstallDir) -gt 0) { 1 } else { 0 }
if ($transcript) { try { Stop-Transcript | Out-Null } catch { } }
exit $exitCode
