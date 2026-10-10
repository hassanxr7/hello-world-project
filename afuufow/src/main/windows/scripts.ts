/**
 * PowerShell snippets used by the Windows platform adapter (Windows PowerShell 5.1, present on every Windows 10/11).
 * Rules:
 *  - parameters are NEVER interpolated into code. They travel as base64 JSON and are decoded inside the script ($P),
 *    so spoken or AI-produced text cannot become a command.
 *  - every script prints a single JSON document (or nothing) on stdout.
 */

export const PS_PRELUDE = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
`;

export function withParams(body: string, params: unknown): string {
  const b64 = Buffer.from(JSON.stringify(params ?? {}), 'utf8').toString('base64');
  return `${PS_PRELUDE}
$P = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | ConvertFrom-Json
${body}`;
}

export const SCRIPTS = {
  listApps: `
$apps = Get-StartApps | Sort-Object Name -Unique | ForEach-Object { [pscustomobject]@{ name = $_.Name; id = $_.AppID } }
ConvertTo-Json -InputObject @($apps) -Compress
`,

  launchApp: `
if ($P.kind -eq 'uwp' -or $P.id -match '!' -or $P.id -notmatch '^[A-Za-z]:\\\\') {
  Start-Process -FilePath 'explorer.exe' -ArgumentList ('shell:AppsFolder\\' + $P.id)
} else {
  Start-Process -FilePath $P.id
}
'{"ok":true}'
`,

  waitForWindow: `
$deadline = (Get-Date).AddMilliseconds([int]$P.timeoutMs)
$needles = @($P.needles | ForEach-Object { $_.ToLowerInvariant() })
$shell = $null
while ((Get-Date) -lt $deadline) {
  $hit = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | Where-Object {
    $t = $_.MainWindowTitle.ToLowerInvariant(); $n = $_.ProcessName.ToLowerInvariant()
    foreach ($x in $needles) { if ($t.Contains($x) -or $n.Contains($x) -or $x.Contains($n)) { return $true } }
    return $false
  } | Select-Object -First 1
  if ($hit) { ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ title = $hit.MainWindowTitle; processName = $hit.ProcessName; pid = $hit.Id }); exit 0 }
  # File Explorer folder windows all belong to one explorer.exe process, so ask the shell for its open folder windows
  try {
    if (-not $shell) { $shell = New-Object -ComObject Shell.Application }
    foreach ($w in $shell.Windows()) {
      $name = ([string]$w.LocationName).ToLowerInvariant()
      if ($name) { foreach ($x in $needles) { if ($name -eq $x -or $name.Contains($x)) { ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ title = [string]$w.LocationName; processName = 'explorer'; pid = 0 }); exit 0 } } }
    }
  } catch { }
  Start-Sleep -Milliseconds 250
}
'null'
`,

  foregroundWindow: `
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$h = [Fg]::GetForegroundWindow()
if ($h -eq [IntPtr]::Zero) { 'null'; exit 0 }
$sb = New-Object System.Text.StringBuilder 512
[void][Fg]::GetWindowText($h, $sb, 512)
$procId = 0; [void][Fg]::GetWindowThreadProcessId($h, [ref]$procId)
$name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ title = $sb.ToString(); processName = $name; pid = [int]$procId })
`,

  openInBrowser: `
$exe = switch ($P.browser) {
  'chrome'  { 'chrome.exe' }
  'edge'    { 'msedge.exe' }
  'firefox' { 'firefox.exe' }
  default   { $null }
}
if ($exe) {
  $key = "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\$exe"
  $key2 = "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\$exe"
  $path = (Get-ItemProperty -Path $key -ErrorAction SilentlyContinue).'(default)'
  if (-not $path) { $path = (Get-ItemProperty -Path $key2 -ErrorAction SilentlyContinue).'(default)' }
  if ($path -and (Test-Path -LiteralPath $path)) { Start-Process -FilePath $path -ArgumentList @($P.url); '{"ok":true,"browser":"specific"}'; exit 0 }
}
'{"ok":false}'
`,

  setVolume: `
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-46C4-9D05-7BC87C7C2C7B")] class MMDeviceEnumeratorComObject { }
public class AfuAudio {
  static IAudioEndpointVolume Vol() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume epv = null;
    var epvid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref epvid, 23, 0, out epv));
    return epv;
  }
  public static float Volume {
    get { float v = -1; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(value, System.Guid.Empty)); }
  }
  public static bool Mute {
    get { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMute(value, System.Guid.Empty)); }
  }
}
"@
if ($null -ne $P.level) { [AfuAudio]::Volume = [Math]::Max(0, [Math]::Min(1, [double]$P.level / 100)) }
if ($null -ne $P.muted) { [AfuAudio]::Mute = [bool]$P.muted }
ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ level = [int][Math]::Round([AfuAudio]::Volume * 100); muted = [AfuAudio]::Mute })
`,

  mediaKey: `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Mk { [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra); }
"@
$vk = switch ($P.key) { 'playpause' { 0xB3 } 'next' { 0xB0 } 'previous' { 0xB1 } 'stop' { 0xB2 } default { 0 } }
if ($vk -eq 0) { throw 'unknown media key' }
[Mk]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)
[Mk]::keybd_event([byte]$vk, 0, 2, [UIntPtr]::Zero)
'{"ok":true}'
`,

  focusWindow: `
Add-Type -AssemblyName Microsoft.VisualBasic
$needles = @($P.needles | ForEach-Object { $_.ToLowerInvariant() })
$hit = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | Where-Object {
  $t = $_.MainWindowTitle.ToLowerInvariant(); $n = $_.ProcessName.ToLowerInvariant()
  foreach ($x in $needles) { if ($t.Contains($x) -or $n.Contains($x)) { return $true } }
  return $false
} | Select-Object -First 1
if (-not $hit) { '{"ok":false}'; exit 0 }
[Microsoft.VisualBasic.Interaction]::AppActivate($hit.Id)
Start-Sleep -Milliseconds 300
'{"ok":true}'
`,

  sendPaste: `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('^v')
'{"ok":true}'
`,

  uiaCommon: `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
`,

  focusedText: `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$el = [System.Windows.Automation.AutomationElement]::FocusedElement
$text = ''
if ($el) {
  $vp = $null
  if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) { $text = $vp.Current.Value }
  if (-not $text) {
    $tp = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp)) { $text = $tp.DocumentRange.GetText(20000) }
  }
}
ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ text = [string]$text })
`,

  windowText: `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Fg2 { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }
"@
$h = [Fg2]::GetForegroundWindow()
$root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
$cond = New-Object System.Windows.Automation.OrCondition(
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)),
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)),
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
$items = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
$sb = New-Object System.Text.StringBuilder
$n = 0
foreach ($it in $items) {
  if ($n++ -gt 400 -or $sb.Length -gt 12000) { break }
  $s = $it.Current.Name
  $vp = $null
  if ($it.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) { if ($vp.Current.Value) { $s = $vp.Current.Value } }
  if ($s) { [void]$sb.AppendLine($s) }
}
ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ text = $sb.ToString() })
`,

  ocr: `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); [void]$t.Wait(-1); $t.Result }
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($P.path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bmp = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { throw 'No OCR language is installed in Windows' }
$res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ text = [string]$res.Text })
`,

  recycle: `
Add-Type -AssemblyName Microsoft.VisualBasic
$item = Get-Item -LiteralPath $P.path -Force
if ($item.PSIsContainer) { throw 'folders are not recycled by Afuufow' }
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($P.path, 'OnlyErrorDialogs', 'SendToRecycleBin')
'{"ok":true}'
`,

  wingetInstall: `
$out = & winget install --id $P.id --exact --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-String
ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ ok = ($LASTEXITCODE -eq 0); output = $out })
`,

  wingetHas: `
$out = & winget list --id $P.id --exact --accept-source-agreements 2>&1 | Out-String
ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ has = ($LASTEXITCODE -eq 0 -and $out -match [regex]::Escape($P.id)) })
`,

  helloVerify: `
$null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); [void]$t.Wait(-1); $t.Result }
$avail = Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])
if ($avail.ToString() -ne 'Available') { ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ available = $false; result = $avail.ToString() }); exit 0 }
$r = Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync([string]$P.message)) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ available = $true; result = $r.ToString() })
`,

  securityLogEvents: `
$start = (Get-Date).AddMilliseconds(-1 * [double]$P.sinceMs)
try {
  $ev = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4801, 4800, 4624; StartTime = $start } -MaxEvents 200 -ErrorAction Stop |
    Where-Object { $_.Id -ne 4624 -or $_.Properties[8].Value -in 2, 7, 10, 11 } |
    ForEach-Object { [pscustomobject]@{ id = $_.Id; at = ([DateTimeOffset]$_.TimeCreated).ToUnixTimeMilliseconds() } }
  ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ available = $true; events = @($ev) })
} catch {
  ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ available = $false; reason = $_.Exception.Message; events = @() })
}
`,

  privacyStatus: `
function St($n) { try { (Get-ItemProperty "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\$n" -ErrorAction Stop).Value } catch { 'unknown' } }
ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ microphone = (St 'microphone'); webcam = (St 'webcam') })
`,

} as const;
