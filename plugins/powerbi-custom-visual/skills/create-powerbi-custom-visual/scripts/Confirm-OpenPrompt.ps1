# Confirms Power BI Desktop's routine "Potential security risk - this file uses multiple data sources" prompt,
# which blocks every unattended open of a .pbip project. Nothing else is answered: sign-in, credential,
# privacy-level and unencrypted-connection prompts need a person and are left alone.
# Run it in the background next to unattended Desktop work:  Start-Process powershell -ArgumentList "-File Confirm-OpenPrompt.ps1"
# Why it looks like this: the dialog body is an embedded Internet Explorer control, so its OK button is not in the
# UI Automation tree. UIA finds the window; the HTML document behind it presses the button.
$log = Join-Path $env:TEMP "confirm-open-prompt.log"
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class Ie {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumChildWindows(IntPtr h, EnumProc f, IntPtr p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterWindowMessageW(string s);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr wp, IntPtr lp, uint flags, uint timeout, out IntPtr res);
  [DllImport("oleacc.dll", PreserveSig = false)] [return: MarshalAs(UnmanagedType.Interface)]
  static extern object ObjectFromLresult(IntPtr lResult, ref Guid riid, IntPtr wParam);
  delegate bool EnumProc(IntPtr h, IntPtr p);
  public static List<IntPtr> Panes(IntPtr root) {
    var res = new List<IntPtr>();
    EnumChildWindows(root, (h, p) => { var c = new StringBuilder(300); GetClassNameW(h, c, 300);
      if (c.ToString() == "Internet Explorer_Server") res.Add(h); return true; }, IntPtr.Zero);
    return res;
  }
  public static object Document(IntPtr pane) {
    uint msg = RegisterWindowMessageW("WM_HTML_GETOBJECT");
    IntPtr res; SendMessageTimeout(pane, msg, IntPtr.Zero, IntPtr.Zero, 2, 5000, out res);
    if (res == IntPtr.Zero) return null;
    var iid = new Guid("332C4425-26CB-11D0-B483-00C04FD90119");
    return ObjectFromLresult(res, ref iid, IntPtr.Zero);
  }
}
"@
# Prompts that need a person are never answered. Desktop in another language? Add its sign-in titles here.
$NEEDS_HUMAN = 'Sign in|Enter your credentials|Ignore Privacy Levels|Privacy levels|encrypted connection|Encryption Support'
while ($true) {
  Start-Sleep -Seconds 8
  foreach ($p in @(Get-Process PBIDesktop -ErrorAction SilentlyContinue)) {
    if ($p.MainWindowHandle -eq 0) { continue }
    try {
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
      $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Potential security risk')
      $dlg = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    } catch { continue }
    if (-not $dlg) { continue }
    $h = [IntPtr]$dlg.Current.NativeWindowHandle
    foreach ($pane in [Ie]::Panes($h)) {
      $doc = $null; try { $doc = [Ie]::Document($pane) } catch { }
      if (-not $doc) { continue }
      $text = ''; try { $text = ($doc.body.innerText -replace '\s+', ' ').Trim() } catch { }
      if (-not $text -or $text -match $NEEDS_HUMAN) { continue }
      if ($text -notmatch 'multiple data sources') { continue }
      foreach ($e in $doc.all) {
        $role = ''; $label = ''
        try { $role = $e.getAttribute('role'); $label = ($e.innerText -replace '\s+', ' ').Trim() } catch { continue }
        if ($role -eq 'button' -and $label -eq 'OK') {
          try { $e.click(); "$(Get-Date -Format 'HH:mm:ss') confirmed the open prompt for pid $($p.Id)" | Out-File -Append -Encoding utf8 $log } catch { }
          break
        }
      }
    }
  }
}
