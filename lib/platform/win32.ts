import os from 'node:os';
import { ps } from './powershell';
import type { ActivitySample, Platform, RawProcess } from './types';
import { webUrl } from './url';

/** Core Audio 기본 출력 장치 볼륨 제어. PowerShell에 내장 명령이 없어 COM을 직접 쓴다. */
const AUDIO_TYPE = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
  int j();
  int GetMasterVolumeLevelScalar(out float level);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int f();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
public static class IllAudio {
  static IAudioEndpointVolume Endpoint() {
    var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
    IMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
    var iid = typeof(IAudioEndpointVolume).GUID;
    object iface;
    Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out iface));
    return (IAudioEndpointVolume)iface;
  }
  public static float Get() { float v; Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out v)); return v; }
  public static void Set(float v) { var ctx = Guid.Empty; Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(v, ref ctx)); }
}
'@
`;

const PERSONALIZE = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';

/** 이름이 프로세스 이름, 파일 설명, 제품명, 창 제목 중 하나와 정확히 일치하는 창만 고른다. 와일드카드는 쓰지 않는다. */
const FIND_WINDOWED = `
$n = $env:ILL_NAME -replace '\\.exe$',''
$procs = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName -ieq $n -or $_.Description -ieq $n -or $_.Product -ieq $n -or $_.MainWindowTitle -ieq $n) })
if ($procs.Count -eq 0) { throw "실행 중인 앱을 찾을 수 없습니다: $($env:ILL_NAME)" }
`;

/**
 * 시작 메뉴에 등록된 앱만 찾아 $app에 담는다. 없으면 throw 한다.
 * Start-Process에 이름을 그대로 넘기면 PATH의 .bat이나 .exe까지 실행되므로 그런 대체 경로를 두지 않는다.
 * 정확히 일치하지 않으면 하나로 좁혀질 때만 고른다. 승인한 이름과 다른 앱이 뜨면 안 된다.
 */
export const FIND_START_APP = `
$n = $env:ILL_NAME
$all = @(Get-StartApps)
$app = $all | Where-Object { $_.Name -ieq $n } | Select-Object -First 1
if (-not $app) {
  $pattern = "*$([WildcardPattern]::Escape($n))*"
  $hits = @($all | Where-Object { $_.Name -like $pattern -or $_.AppID -like $pattern })
  if ($hits.Count -gt 1) {
    $names = ($hits | Select-Object -First 5 -ExpandProperty Name) -join ', '
    throw "여러 앱이 일치해요: $names. 정확한 이름으로 다시 요청해 주세요."
  }
  if ($hits.Count -eq 1) { $app = $hits[0] }
}
if (-not $app) { throw "시작 메뉴에서 찾을 수 없는 앱이에요: $n. 시작 메뉴에 보이는 이름으로 다시 요청해 주세요." }
`;

export const win32Platform: Platform = {
  id: 'win32',
  has: () => true,
  osLabel: () => os.version(),

  async getVolume() {
    const out = await ps(`${AUDIO_TYPE}[math]::Round([IllAudio]::Get() * 100)`);
    return Number(out);
  },

  async setVolume(level) {
    await ps(`${AUDIO_TYPE}[IllAudio]::Set([float]([int]$env:ILL_LEVEL) / 100)`, { LEVEL: String(level) });
  },

  async getDarkMode() {
    const out = await ps(`(Get-ItemProperty -Path '${PERSONALIZE}' -Name AppsUseLightTheme).AppsUseLightTheme`);
    return out.trim() === '0';
  },

  async setDarkMode(enabled) {
    await ps(
      `$v = [int]$env:ILL_LIGHT
Set-ItemProperty -Path '${PERSONALIZE}' -Name AppsUseLightTheme -Value $v -Type DWord
Set-ItemProperty -Path '${PERSONALIZE}' -Name SystemUsesLightTheme -Value $v -Type DWord
Add-Type -Namespace Ill -Name Native -MemberDefinition '[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam, uint flags, uint timeout, out IntPtr result);'
$r = [IntPtr]::Zero
[void][Ill.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [IntPtr]::Zero, 'ImmersiveColorSet', 2, 1000, [ref]$r)`,
      { LIGHT: enabled ? '0' : '1' }
    );
  },

  async lockScreen() {
    await ps(`rundll32.exe user32.dll,LockWorkStation`);
  },

  async sleep() {
    // SetSuspendState는 최대 절전 설정에 따라 동작이 달라지므로 절전을 명시한다.
    await ps(`Add-Type -AssemblyName System.Windows.Forms
[void][System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)`);
  },

  async notify({ title, body }) {
    await ps(
      `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$t = [System.Security.SecurityElement]::Escape($env:ILL_TITLE)
$b = [System.Security.SecurityElement]::Escape($env:ILL_BODY)
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual></toast>")
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)`,
      { TITLE: title, BODY: body ?? '' }
    );
  },

  async say({ text, voice }) {
    await ps(
      `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo }
$pick = $null
if ($env:ILL_VOICE) { $pick = $voices | Where-Object { $_.Name -like "*$([WildcardPattern]::Escape($env:ILL_VOICE))*" } | Select-Object -First 1 }
if (-not $pick -and $env:ILL_TEXT -match '[\\uAC00-\\uD7A3]') { $pick = $voices | Where-Object { $_.Culture.Name -eq 'ko-KR' } | Select-Object -First 1 }
if ($pick) { $s.SelectVoice($pick.Name) }
$s.Speak($env:ILL_TEXT)
$s.Dispose()`,
      { TEXT: text, VOICE: voice ?? '' },
      { timeoutMs: 60000 }
    );
  },

  async listApps() {
    const out = await ps(
      `Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { if ($_.Description) { $_.Description } else { $_.ProcessName } } | Sort-Object -Unique`
    );
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  },

  async openApp(name) {
    await ps(
      `${FIND_START_APP}
Start-Process -FilePath "shell:AppsFolder\\$($app.AppID)"`,
      { NAME: name }
    );
  },

  async focusApp(name) {
    await ps(
      `${FIND_WINDOWED}
$shell = New-Object -ComObject WScript.Shell
if (-not $shell.AppActivate($procs[0].Id)) { throw "앱을 앞으로 가져오지 못했습니다: $($env:ILL_NAME)" }`,
      { NAME: name }
    );
  },

  async quitApp(name) {
    // 강제 종료하지 않고 창 닫기를 요청한다. 저장 안 한 문서가 있으면 앱이 직접 묻는다.
    await ps(
      `${FIND_WINDOWED}
foreach ($p in $procs) { [void]$p.CloseMainWindow() }`,
      { NAME: name }
    );
  },

  async openUrl(url) {
    await ps(`Start-Process -FilePath $env:ILL_URL`, { URL: webUrl(url) });
  },

  // Windows Search 색인 질의는 설정에 따라 결과가 들쭉날쭉하므로 공통 순회를 쓴다.
  searchIndex: async () => null,

  async screenshot(file) {
    await ps(
      `Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type -Namespace Ill -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][Ill.Dpi]::SetProcessDPIAware()
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save($env:ILL_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()`,
      { PATH: file },
      { timeoutMs: 20000 }
    );
  },

  async clipboardRead() {
    return ps(`$t = Get-Clipboard -Raw; if ($null -ne $t) { $t }`, {}, { maxBufferKb: 4096 });
  },

  async clipboardWrite(text) {
    await ps(`Set-Clipboard -Value $env:ILL_TEXT`, { TEXT: text });
  },

  async trash(path) {
    await ps(
      `Add-Type -AssemblyName Microsoft.VisualBasic
if (Test-Path -LiteralPath $env:ILL_PATH -PathType Container) {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:ILL_PATH, 'OnlyErrorDialogs', 'SendToRecycleBin')
} else {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:ILL_PATH, 'OnlyErrorDialogs', 'SendToRecycleBin')
}`,
      { PATH: path }
    );
  },

  async sampleActivity(): Promise<ActivitySample> {
    const out = await ps(
      `$rx = [long]0; $tx = [long]0
[System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | Where-Object { $_.OperationalStatus -eq 'Up' -and $_.NetworkInterfaceType -ne 'Loopback' } | ForEach-Object { $s = $_.GetIPv4Statistics(); $rx += $s.BytesReceived; $tx += $s.BytesSent }
$p = @(Get-Process | Select-Object @{n='i';e={$_.Id}}, @{n='n';e={$_.ProcessName}}, @{n='c';e={$_.CPU}}, @{n='m';e={$_.WorkingSet64}})
@{ p = $p; rx = $rx; tx = $tx } | ConvertTo-Json -Compress -Depth 3`,
      {},
      { maxBufferKb: 8192 }
    );
    const raw = JSON.parse(out) as {
      p: { i: number; n: string; c: number | null; m: number }[];
      rx: number;
      tx: number;
    };
    const processes: RawProcess[] = raw.p
      .filter((x) => x.n !== 'Idle')
      .map((x) => ({ pid: x.i, name: x.n, cpuSec: x.c ?? 0, memMb: x.m / 1048576 }));
    return { processes, rxBytes: raw.rx, txBytes: raw.tx };
  },

  async battery() {
    const out = await ps(
      `$b = Get-CimInstance -ClassName Win32_Battery | Select-Object -First 1
if ($b) { @{ p = $b.EstimatedChargeRemaining; s = $b.BatteryStatus } | ConvertTo-Json -Compress }`
    );
    if (!out) return null;
    const raw = JSON.parse(out) as { p: number; s: number };
    // BatteryStatus 1은 방전 중, 그 외(2 등)는 전원 연결 또는 충전 중이다.
    return { percent: raw.p, charging: raw.s !== 1 };
  },

  // Windows의 os.freemem()은 정확하다.
  memoryUsedBytes: async () => null,
};
