using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("QuotaPin")]
[assembly: AssemblyDescription("QuotaPin notification-area companion | Official source: https://github.com/WSL043/QuotaPin-for-Codex")]
[assembly: AssemblyCompany("QuotaPin contributors")]
[assembly: AssemblyProduct("QuotaPin")]
[assembly: AssemblyCopyright("Copyright 2026 QuotaPin contributors")]
[assembly: AssemblyVersion("1.0.3.0")]
[assembly: AssemblyFileVersion("1.0.3.0")]

namespace QuotaPin.Tray
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            try
            {
                using (var ownership = Registry.CurrentUser.OpenSubKey(@"Software\QuotaPin", false))
                {
                    var owner = Convert.ToString(ownership == null ? null : ownership.GetValue("InstallOwner"), CultureInfo.InvariantCulture);
                    if (string.Equals(owner, "command", StringComparison.OrdinalIgnoreCase)) return;
                }
            }
            catch { }
            bool created;
            using (var mutex = new Mutex(true, @"Local\QuotaPinTray", out created))
            {
                if (!created) return;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new TrayContext());
            }
        }
    }

    internal sealed class TrayContext : ApplicationContext
    {
        private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunValueName = "QuotaPin";
        private const string OfficialProjectUrl = "https://github.com/WSL043/QuotaPin-for-Codex";
        private readonly string installRoot;
        private readonly string powerShellPath;
        private readonly NotifyIcon trayIcon;
        private readonly ToolStripMenuItem statusItem;
        private readonly ToolStripMenuItem startupItem;
        private readonly ToolStripMenuItem updateItem;
        private readonly System.Windows.Forms.Timer stateTimer;
        private readonly HashSet<int> seenCodexRoots = new HashSet<int>();
        private readonly HashSet<int> ignoredCodexRoots = new HashSet<int>();
        private readonly Dictionary<int, AttachAttempt> attachAttempts = new Dictionary<int, AttachAttempt>();
        private readonly string currentVersion;
        private string codexPackageRoot;
        private bool observerReady;
        private DateTime nextPackageRefresh = DateTime.MinValue;
        private DateTime nextUpdateCheck = DateTime.MinValue;
        private Task<ReleaseInfo> updateCheckTask;
        private Task<DownloadedUpdate> updateDownloadTask;
        private ReleaseInfo availableRelease;
        private bool manualUpdateCheck;
        private string notifiedVersion;

        private const uint SnapshotProcesses = 0x00000002;
        private static readonly IntPtr InvalidHandleValue = new IntPtr(-1);

        private sealed class AttachAttempt
        {
            internal int CodexPid;
            internal int Number;
            internal DateTime NextAttemptAt;
            internal DateTime LauncherStartedAt;
            internal Process Launcher;
        }

        private sealed class LifecycleSnapshot
        {
            internal string State;
            internal DateTimeOffset WrittenAt;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        private struct ProcessEntry32
        {
            public uint dwSize;
            public uint cntUsage;
            public uint th32ProcessID;
            public IntPtr th32DefaultHeapID;
            public uint th32ModuleID;
            public uint cntThreads;
            public uint th32ParentProcessID;
            public int pcPriClassBase;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
            public string szExeFile;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern bool Process32First(IntPtr snapshot, ref ProcessEntry32 entry);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry32 entry);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        internal TrayContext()
        {
            installRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            powerShellPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), @"System32\WindowsPowerShell\v1.0\powershell.exe");
            currentVersion = ReadCurrentVersion();
            trayIcon = new NotifyIcon();
            trayIcon.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            trayIcon.Text = "QuotaPin";
            trayIcon.Visible = true;

            var menu = new ContextMenuStrip();
            menu.Opening += delegate { UpdateRuntimeState(); };
            statusItem = new ToolStripMenuItem();
            statusItem.Enabled = false;
            startupItem = new ToolStripMenuItem(UiText("Start with Windows", "开机自动启动", "Windows と一緒に起動"));
            startupItem.CheckOnClick = true;
            startupItem.Checked = IsStartupEnabled();
            startupItem.Click += delegate { SetStartupEnabled(startupItem.Checked); };
            updateItem = new ToolStripMenuItem(UiText("Check for updates", "检查更新", "更新を確認"));
            updateItem.Click += delegate
            {
                if (availableRelease != null) OfferAvailableUpdate();
                else CheckForUpdates(true);
            };
            var uninstall = new ToolStripMenuItem(UiText("Uninstall QuotaPin", "卸载 QuotaPin", "QuotaPin をアンインストール"));
            uninstall.Click += delegate { StartUninstall(); };
            var officialProject = new ToolStripMenuItem(UiText(
                "Official project (free source)",
                "官方项目（免费源码）",
                "公式プロジェクト（無料のソース）"));
            officialProject.Click += delegate { OpenOfficialProject(); };
            var exit = new ToolStripMenuItem(UiText("Exit QuotaPin", "退出 QuotaPin", "QuotaPin を終了"));
            exit.Click += delegate { ExitQuotaPin(); };
            menu.Items.Add(statusItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(startupItem);
            menu.Items.Add(updateItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(officialProject);
            menu.Items.Add(uninstall);
            menu.Items.Add(exit);
            trayIcon.ContextMenuStrip = menu;
            trayIcon.BalloonTipClicked += delegate { if (availableRelease != null) OfferAvailableUpdate(); };

            RefreshCodexPackageRoot();
            ScanCodexProcesses(true);
            TryResumeAgent();
            UpdateService.CleanupOldDownloads();
            nextUpdateCheck = DateTime.UtcNow.AddSeconds(8);
            stateTimer = new System.Windows.Forms.Timer();
            stateTimer.Interval = 1000;
            stateTimer.Tick += delegate
            {
                ScanCodexProcesses(false);
                UpdateRuntimeState();
                PollUpdates();
            };
            stateTimer.Start();
            UpdateRuntimeState();
        }

        private static string UiText(string english, string chinese, string japanese)
        {
            var language = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
            if (string.Equals(language, "zh", StringComparison.OrdinalIgnoreCase)) return chinese;
            if (string.Equals(language, "ja", StringComparison.OrdinalIgnoreCase)) return japanese;
            return english;
        }

        private string ReadCurrentVersion()
        {
            try
            {
                var value = File.ReadAllText(Path.Combine(installRoot, "VERSION")).Trim();
                return value.Length > 0 ? value : "0.0.0";
            }
            catch { return "0.0.0"; }
        }

        private void RefreshCodexPackageRoot()
        {
            nextPackageRefresh = DateTime.UtcNow.AddSeconds(30);
            try
            {
                const string packageKeyPath = @"Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages";
                using (var packages = Registry.CurrentUser.OpenSubKey(packageKeyPath, false))
                {
                    if (packages == null) return;
                    string newest = null;
                    Version newestVersion = null;
                    foreach (var name in packages.GetSubKeyNames())
                    {
                        if (!name.StartsWith("OpenAI.Codex_", StringComparison.OrdinalIgnoreCase)) continue;
                        var versionEnd = name.IndexOf("_x64", "OpenAI.Codex_".Length, StringComparison.OrdinalIgnoreCase);
                        Version packageVersion;
                        if (versionEnd < 0 || !Version.TryParse(name.Substring("OpenAI.Codex_".Length, versionEnd - "OpenAI.Codex_".Length), out packageVersion)) continue;
                        using (var package = packages.OpenSubKey(name, false))
                        {
                            var root = Convert.ToString(package == null ? null : package.GetValue("PackageRootFolder"), CultureInfo.InvariantCulture);
                            if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) continue;
                            if (newest == null || packageVersion > newestVersion)
                            {
                                newest = name;
                                newestVersion = packageVersion;
                                codexPackageRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
                            }
                        }
                    }
                }
            }
            catch (Exception error)
            {
                WriteLog("package root refresh failed: " + error.Message);
            }
        }

        private Dictionary<int, int> GetChatGptProcessTree()
        {
            var result = new Dictionary<int, int>();
            var snapshot = CreateToolhelp32Snapshot(SnapshotProcesses, 0);
            if (snapshot == InvalidHandleValue) return result;
            try
            {
                var entry = new ProcessEntry32();
                entry.dwSize = (uint)Marshal.SizeOf(typeof(ProcessEntry32));
                if (!Process32First(snapshot, ref entry)) return result;
                do
                {
                    if (string.Equals(entry.szExeFile, "ChatGPT.exe", StringComparison.OrdinalIgnoreCase))
                        result[(int)entry.th32ProcessID] = (int)entry.th32ParentProcessID;
                }
                while (Process32Next(snapshot, ref entry));
            }
            finally
            {
                CloseHandle(snapshot);
            }
            return result;
        }

        private bool IsOfficialCodexRoot(int processId)
        {
            try
            {
                using (var process = Process.GetProcessById(processId))
                {
                    var executable = Path.GetFullPath(process.MainModule.FileName);
                    if (!string.IsNullOrEmpty(codexPackageRoot))
                        return executable.StartsWith(codexPackageRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
                    return executable.IndexOf(@"\WindowsApps\OpenAI.Codex_", StringComparison.OrdinalIgnoreCase) >= 0
                        && executable.EndsWith(@"\app\ChatGPT.exe", StringComparison.OrdinalIgnoreCase);
                }
            }
            catch { return false; }
        }

        private void ScanCodexProcesses(bool seedOnly)
        {
            try
            {
                if (DateTime.UtcNow >= nextPackageRefresh) RefreshCodexPackageRoot();
                var processes = GetChatGptProcessTree();
                var roots = new HashSet<int>();
                foreach (var item in processes)
                {
                    if (!processes.ContainsKey(item.Value)) roots.Add(item.Key);
                }
                seenCodexRoots.RemoveWhere(delegate(int processId) { return !roots.Contains(processId); });
                ignoredCodexRoots.RemoveWhere(delegate(int processId) { return !roots.Contains(processId); });
                PollAttachAttempts(roots);
                foreach (var processId in roots)
                {
                    if (seenCodexRoots.Contains(processId) || ignoredCodexRoots.Contains(processId) || attachAttempts.ContainsKey(processId)) continue;
                    if (seedOnly)
                    {
                        ignoredCodexRoots.Add(processId);
                        continue;
                    }
                    if (!IsOfficialCodexRoot(processId)) continue;
                    if (attachAttempts.Count > 0) continue;
                    WriteLog("fresh official root observed pid=" + processId.ToString(CultureInfo.InvariantCulture));
                    var attempt = new AttachAttempt { CodexPid = processId, Number = 1, NextAttemptAt = DateTime.UtcNow };
                    attachAttempts[processId] = attempt;
                    StartAttachAttempt(attempt);
                }
                observerReady = true;
            }
            catch (Exception error)
            {
                observerReady = false;
                WriteLog("process scan failed: " + error.Message);
            }
        }

        private void StartAttachAttempt(AttachAttempt attempt)
        {
            var script = Path.Combine(installRoot, @"src\launch.ps1");
            if (!File.Exists(script))
            {
                CompleteAttachFailure(attempt, "launcher missing");
                return;
            }
            try
            {
                WriteLifecycleState("starting", attempt.CodexPid, 0, 0, attempt.Number, "");
                var arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script
                    + "\" -NoRelaunchPrompt -AutoAttach -VerifiedCodexPid " + attempt.CodexPid.ToString(CultureInfo.InvariantCulture)
                    + " -AttachAttempt " + attempt.Number.ToString(CultureInfo.InvariantCulture);
                var start = new ProcessStartInfo(powerShellPath, arguments);
                start.UseShellExecute = false;
                start.CreateNoWindow = true;
                attempt.Launcher = Process.Start(start);
                attempt.LauncherStartedAt = DateTime.UtcNow;
                if (attempt.Launcher == null) RetryOrCompleteAttachFailure(attempt, "launcher did not start");
            }
            catch (Exception error)
            {
                RetryOrCompleteAttachFailure(attempt, error.GetType().Name);
            }
        }

        private void RetryOrCompleteAttachFailure(AttachAttempt attempt, string reason)
        {
            if (attempt.Number < 3 && IsOfficialCodexRoot(attempt.CodexPid))
            {
                attempt.Number += 1;
                attempt.NextAttemptAt = DateTime.UtcNow.AddSeconds(Math.Pow(2, attempt.Number - 2));
                WriteLog("attach retry scheduled pid=" + attempt.CodexPid.ToString(CultureInfo.InvariantCulture) + " attempt=" + attempt.Number.ToString(CultureInfo.InvariantCulture) + " reason=" + reason);
                return;
            }
            CompleteAttachFailure(attempt, reason);
        }

        private void PollAttachAttempts(HashSet<int> roots)
        {
            foreach (var item in new List<KeyValuePair<int, AttachAttempt>>(attachAttempts))
            {
                var attempt = item.Value;
                if (attempt.Launcher == null)
                {
                    if (DateTime.UtcNow >= attempt.NextAttemptAt) StartAttachAttempt(attempt);
                    continue;
                }
                bool exited;
                try { exited = attempt.Launcher.HasExited; }
                catch { exited = true; }
                if (!exited)
                {
                    if (DateTime.UtcNow - attempt.LauncherStartedAt < TimeSpan.FromSeconds(35)) continue;
                    try { attempt.Launcher.Kill(); }
                    catch { }
                    CompleteAttachFailure(attempt, "launcher timeout");
                    continue;
                }
                int exitCode;
                try { exitCode = attempt.Launcher.ExitCode; }
                catch { exitCode = -1; }
                attempt.Launcher.Dispose();
                attempt.Launcher = null;
                if (exitCode == 0)
                {
                    seenCodexRoots.Add(attempt.CodexPid);
                    AcceptRuntimeCodexRoot();
                    attachAttempts.Remove(attempt.CodexPid);
                    WriteLog("attach accepted pid=" + attempt.CodexPid.ToString(CultureInfo.InvariantCulture) + " attempt=" + attempt.Number.ToString(CultureInfo.InvariantCulture));
                    continue;
                }
                if (attempt.Number < 3 && roots.Contains(attempt.CodexPid) && IsOfficialCodexRoot(attempt.CodexPid))
                {
                    attempt.Number += 1;
                    attempt.NextAttemptAt = DateTime.UtcNow.AddSeconds(Math.Pow(2, attempt.Number - 2));
                    WriteLog("attach retry scheduled pid=" + attempt.CodexPid.ToString(CultureInfo.InvariantCulture) + " attempt=" + attempt.Number.ToString(CultureInfo.InvariantCulture) + " exit=" + exitCode.ToString(CultureInfo.InvariantCulture));
                    continue;
                }
                CompleteAttachFailure(attempt, "launcher exit " + exitCode.ToString(CultureInfo.InvariantCulture));
            }
        }

        private void CompleteAttachFailure(AttachAttempt attempt, string reason)
        {
            if (attempt.Launcher != null)
            {
                attempt.Launcher.Dispose();
                attempt.Launcher = null;
            }
            attachAttempts.Remove(attempt.CodexPid);
            ignoredCodexRoots.Add(attempt.CodexPid);
            WriteLifecycleState("degraded", attempt.CodexPid, 0, 0, attempt.Number, reason);
            WriteLog("attach exhausted pid=" + attempt.CodexPid.ToString(CultureInfo.InvariantCulture) + " attempt=" + attempt.Number.ToString(CultureInfo.InvariantCulture) + " reason=" + reason);
        }

        private void AcceptRuntimeCodexRoot()
        {
            try
            {
                var statePath = Path.Combine(installRoot, "logs", "runtime.json");
                if (!File.Exists(statePath)) return;
                var state = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(statePath)) as Dictionary<string, object>;
                if (state == null || !state.ContainsKey("codexPid")) return;
                var processId = Convert.ToInt32(state["codexPid"], CultureInfo.InvariantCulture);
                if (IsOfficialCodexRoot(processId)) seenCodexRoots.Add(processId);
            }
            catch { }
        }

        private bool IsAgentActive()
        {
            var expected = Path.GetFullPath(Path.Combine(installRoot, "QuotaPin.Agent.exe"));
            foreach (var process in Process.GetProcessesByName("QuotaPin.Agent"))
            {
                try
                {
                    if (string.Equals(Path.GetFullPath(process.MainModule.FileName), expected, StringComparison.OrdinalIgnoreCase)) return true;
                }
                catch { }
                finally { process.Dispose(); }
            }
            return false;
        }

        private string ResolveSignedCodexCommand()
        {
            var helper = Path.Combine(installRoot, "src", "codex-command.ps1");
            var powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
            if (!File.Exists(helper) || !File.Exists(powershell)) return null;
            var escapedHelper = helper.Replace("'", "''");
            var start = new ProcessStartInfo(powershell,
                "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command \"& { . '" + escapedHelper + "'; Get-QuotaPinCodexCommand }\"");
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            using (var process = Process.Start(start))
            {
                if (process == null) return null;
                if (!process.WaitForExit(8000))
                {
                    try { process.Kill(); } catch { }
                    return null;
                }
                if (process.ExitCode != 0) return null;
                var candidate = process.StandardOutput.ReadToEnd().Trim();
                if (!File.Exists(candidate) || !string.Equals(Path.GetExtension(candidate), ".exe", StringComparison.OrdinalIgnoreCase)) return null;
                return candidate;
            }
        }

        private void TryResumeAgent()
        {
            if (IsAgentActive()) return;
            try
            {
                var statePath = Path.Combine(installRoot, "logs", "runtime.json");
                if (!File.Exists(statePath)) return;
                var serializer = new JavaScriptSerializer();
                var state = serializer.DeserializeObject(File.ReadAllText(statePath)) as Dictionary<string, object>;
                if (state == null || !state.ContainsKey("codexPid") || !state.ContainsKey("port") || !state.ContainsKey("writtenAt")) return;
                DateTimeOffset writtenAt;
                if (!DateTimeOffset.TryParse(Convert.ToString(state["writtenAt"], CultureInfo.InvariantCulture), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out writtenAt)) return;
                if (writtenAt > DateTimeOffset.UtcNow.AddMinutes(5)) return;
                var processId = Convert.ToInt32(state["codexPid"], CultureInfo.InvariantCulture);
                var port = Convert.ToInt32(state["port"], CultureInfo.InvariantCulture);
                if (port < 1024 || port > 65535 || !IsOfficialCodexRoot(processId)) return;
                using (var codexProcess = Process.GetProcessById(processId))
                {
                    var startedAt = new DateTimeOffset(codexProcess.StartTime.ToUniversalTime(), TimeSpan.Zero);
                    if (startedAt > writtenAt.AddMinutes(2)) return;
                }

                var request = WebRequest.Create("http://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture) + "/json/list") as HttpWebRequest;
                if (request == null) return;
                request.Timeout = 700;
                request.ReadWriteTimeout = 700;
                request.Proxy = null;
                using (var response = request.GetResponse() as HttpWebResponse)
                {
                    if (response == null || response.StatusCode != HttpStatusCode.OK) return;
                    using (var reader = new StreamReader(response.GetResponseStream()))
                    {
                        var targets = serializer.DeserializeObject(reader.ReadToEnd()) as object[];
                        var mainTargetFound = false;
                        foreach (var targetItem in targets ?? new object[0])
                        {
                            var target = targetItem as Dictionary<string, object>;
                            object targetUrl;
                            if (target != null && target.TryGetValue("url", out targetUrl) && string.Equals(Convert.ToString(targetUrl, CultureInfo.InvariantCulture), "app://-/index.html", StringComparison.Ordinal))
                            {
                                mainTargetFound = true;
                                break;
                            }
                        }
                        if (!mainTargetFound) return;
                    }
                }

                var agent = Path.Combine(installRoot, "QuotaPin.Agent.exe");
                var config = Path.Combine(installRoot, "config.json");
                var log = Path.Combine(installRoot, "logs", "agent.log");
                if (!File.Exists(agent) || !File.Exists(config)) return;
                var codexCommand = ResolveSignedCodexCommand();
                if (string.IsNullOrEmpty(codexCommand))
                {
                    WriteLog("agent resume skipped: signed Codex command unavailable");
                    return;
                }
                var start = new ProcessStartInfo(agent,
                    "--port " + port.ToString(CultureInfo.InvariantCulture) + " --config \"" + config + "\" --log \"" + log + "\"");
                start.UseShellExecute = false;
                start.CreateNoWindow = true;
                start.WorkingDirectory = installRoot;
                start.EnvironmentVariables["QUOTAPIN_CODEX_COMMAND"] = codexCommand;
                var process = Process.Start(start);
                if (process != null)
                {
                    seenCodexRoots.Add(processId);
                    WriteLifecycleState("attached", processId, process.Id, port, 0, "resumed");
                    WriteLog("agent resumed on existing Codex port=" + port.ToString(CultureInfo.InvariantCulture));
                }
            }
            catch (Exception error)
            {
                WriteLog("agent resume skipped: " + error.Message);
            }
        }

        private LifecycleSnapshot ReadLifecycleState()
        {
            try
            {
                var path = Path.Combine(installRoot, "logs", "lifecycle.json");
                if (!File.Exists(path)) return null;
                var value = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(path)) as Dictionary<string, object>;
                if (value == null || !value.ContainsKey("state") || !value.ContainsKey("writtenAt")) return null;
                DateTimeOffset writtenAt;
                if (!DateTimeOffset.TryParse(Convert.ToString(value["writtenAt"], CultureInfo.InvariantCulture), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out writtenAt)) return null;
                return new LifecycleSnapshot { State = Convert.ToString(value["state"], CultureInfo.InvariantCulture), WrittenAt = writtenAt };
            }
            catch { return null; }
        }

        private void WriteLifecycleState(string state, int codexPid, int agentPid, int port, int attempt, string reason)
        {
            try
            {
                var logRoot = Path.Combine(installRoot, "logs");
                Directory.CreateDirectory(logRoot);
                var path = Path.Combine(logRoot, "lifecycle.json");
                var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
                var value = new Dictionary<string, object>();
                value["schema"] = 1;
                value["state"] = state;
                value["writtenAt"] = DateTimeOffset.Now.ToString("o", CultureInfo.InvariantCulture);
                if (codexPid > 0) value["codexPid"] = codexPid;
                if (agentPid > 0) value["agentPid"] = agentPid;
                if (port > 0) value["port"] = port;
                if (attempt > 0) value["attempt"] = attempt;
                if (!string.IsNullOrEmpty(reason)) value["reason"] = reason.Length > 160 ? reason.Substring(0, 160) : reason;
                File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(value));
                if (File.Exists(path))
                {
                    try { File.Replace(temporary, path, null); }
                    catch
                    {
                        File.Copy(temporary, path, true);
                        File.Delete(temporary);
                    }
                }
                else File.Move(temporary, path);
            }
            catch { }
        }

        private void UpdateRuntimeState()
        {
            var active = IsAgentActive();
            var lifecycle = ReadLifecycleState();
            var lifecycleFresh = lifecycle != null && lifecycle.WrittenAt >= DateTimeOffset.UtcNow.AddMinutes(-10) && lifecycle.WrittenAt <= DateTimeOffset.UtcNow.AddMinutes(5);
            if (!observerReady)
            {
                statusItem.Text = UiText("Needs attention", "需要处理", "確認が必要です");
                trayIcon.Text = "QuotaPin - " + UiText("Needs attention", "需要处理", "確認が必要です");
            }
            else if (attachAttempts.Count > 0 || (lifecycleFresh && string.Equals(lifecycle.State, "starting", StringComparison.OrdinalIgnoreCase)))
            {
                statusItem.Text = UiText("Starting in Codex", "正在接入 Codex", "Codex に接続中") + "  ·  " + currentVersion;
                trayIcon.Text = "QuotaPin - " + UiText("Starting", "正在接入", "接続中");
            }
            else if (lifecycleFresh && string.Equals(lifecycle.State, "degraded", StringComparison.OrdinalIgnoreCase))
            {
                statusItem.Text = UiText("Needs attention", "需要处理", "確認が必要です") + "  ·  " + currentVersion;
                trayIcon.Text = "QuotaPin - " + UiText("Degraded", "接入异常", "接続エラー");
            }
            else if (active && lifecycleFresh && string.Equals(lifecycle.State, "quota-ready", StringComparison.OrdinalIgnoreCase))
            {
                statusItem.Text = UiText("Quota ready", "额度已就绪", "残量表示の準備完了") + "  ·  " + currentVersion;
                trayIcon.Text = "QuotaPin - " + UiText("Quota ready", "额度已就绪", "残量準備完了");
            }
            else if (active)
            {
                statusItem.Text = UiText("Attached - waiting for quota", "已接入 - 等待额度", "接続済み - 残量を待機中") + "  ·  " + currentVersion;
                trayIcon.Text = "QuotaPin - " + UiText("Attached", "已接入", "接続済み");
            }
            else if (lifecycleFresh && string.Equals(lifecycle.State, "stopped", StringComparison.OrdinalIgnoreCase))
            {
                statusItem.Text = UiText("Stopped", "已停止", "停止中") + "  ·  " + currentVersion;
                trayIcon.Text = "QuotaPin - " + UiText("Stopped", "已停止", "停止中");
            }
            else
            {
                statusItem.Text = UiText("Ready - waiting for Codex", "已就绪 - 等待 Codex", "準備完了 - Codex を待機中") + "  ·  " + currentVersion;
                trayIcon.Text = "QuotaPin - " + UiText("Ready", "已就绪", "準備完了");
            }
        }

        private void CheckForUpdates(bool manual)
        {
            if (updateCheckTask != null || updateDownloadTask != null) return;
            manualUpdateCheck = manual;
            availableRelease = null;
            updateItem.Enabled = false;
            updateItem.Text = UiText("Checking for updates...", "正在检查更新…", "更新を確認中…");
            updateCheckTask = Task.Factory.StartNew(delegate { return UpdateService.FindAvailable(currentVersion); });
        }

        private void PollUpdates()
        {
            if (updateCheckTask != null && updateCheckTask.IsCompleted)
            {
                var task = updateCheckTask;
                updateCheckTask = null;
                updateItem.Enabled = true;
                nextUpdateCheck = DateTime.UtcNow.AddHours(12);
                if (task.IsFaulted)
                {
                    updateItem.Text = UiText("Check for updates", "检查更新", "更新を確認");
                    WriteLog("update check failed: " + task.Exception.GetBaseException().Message);
                    if (manualUpdateCheck) ShowInformation(UiText(
                        "QuotaPin could not check for updates. Please try again later.",
                        "QuotaPin 暂时无法检查更新，请稍后再试。",
                        "更新を確認できませんでした。しばらくしてから、もう一度お試しください。"));
                }
                else
                {
                    availableRelease = task.Result;
                    if (availableRelease == null)
                    {
                        updateItem.Text = UiText("Check for updates", "检查更新", "更新を確認");
                        if (manualUpdateCheck) ShowInformation(string.Format(CultureInfo.CurrentCulture, UiText(
                            "QuotaPin {0} is up to date.",
                            "QuotaPin {0} 已是最新版本。",
                            "QuotaPin {0} は最新です。"), currentVersion));
                    }
                    else
                    {
                        updateItem.Text = string.Format(CultureInfo.CurrentCulture, UiText(
                            "Update to {0}...",
                            "更新到 {0}…",
                            "{0} に更新…"), availableRelease.Version);
                        if (!manualUpdateCheck && !string.Equals(notifiedVersion, availableRelease.Version, StringComparison.OrdinalIgnoreCase))
                        {
                            notifiedVersion = availableRelease.Version;
                            trayIcon.BalloonTipTitle = "QuotaPin";
                            trayIcon.BalloonTipText = string.Format(CultureInfo.CurrentCulture, UiText(
                                "Version {0} is ready to install.",
                                "版本 {0} 已可安装。",
                                "バージョン {0} をインストールできます。"), availableRelease.Version);
                            trayIcon.ShowBalloonTip(5000);
                        }
                    }
                }
                manualUpdateCheck = false;
            }

            if (updateDownloadTask != null && updateDownloadTask.IsCompleted)
            {
                var task = updateDownloadTask;
                updateDownloadTask = null;
                updateItem.Enabled = true;
                if (task.IsFaulted)
                {
                    WriteLog("update download failed: " + task.Exception.GetBaseException().Message);
                    updateItem.Text = availableRelease == null
                        ? UiText("Check for updates", "检查更新", "更新を確認")
                        : string.Format(CultureInfo.CurrentCulture, UiText("Update to {0}...", "更新到 {0}…", "{0} に更新…"), availableRelease.Version);
                    ShowInformation(UiText(
                        "The update could not be downloaded or verified. Nothing was installed.",
                        "更新下载或校验失败，未安装任何内容。",
                        "更新のダウンロードまたは検証に失敗しました。何もインストールされていません。"));
                }
                else
                {
                    var update = task.Result;
                    WriteLog("verified update " + update.Release.Version);
                    Process.Start(new ProcessStartInfo(update.SetupPath, "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART") { UseShellExecute = true });
                    updateItem.Text = UiText("Installing update...", "正在安装更新…", "更新をインストール中…");
                    updateItem.Enabled = false;
                }
            }

            if (updateCheckTask == null && updateDownloadTask == null && DateTime.UtcNow >= nextUpdateCheck) CheckForUpdates(false);
        }

        private void OfferAvailableUpdate()
        {
            if (availableRelease == null || updateDownloadTask != null) return;
            var message = string.Format(CultureInfo.CurrentCulture, UiText(
                "QuotaPin {0} is available. Download, verify, and install it now? Codex will stay open, but the quota may briefly disappear during the update.",
                "QuotaPin {0} 已可用。现在下载、校验并安装吗？Codex 会保持打开，但更新期间额度显示可能会短暂消失。",
                "QuotaPin {0} を利用できます。今すぐダウンロード、検証、インストールしますか？Codex は開いたままですが、更新中は残量表示が一時的に消える場合があります。"), availableRelease.Version);
            var choice = MessageBox.Show(message, "QuotaPin", MessageBoxButtons.YesNo, MessageBoxIcon.Information, MessageBoxDefaultButton.Button2);
            if (choice != DialogResult.Yes) return;
            updateItem.Enabled = false;
            updateItem.Text = UiText("Downloading update...", "正在下载更新…", "更新をダウンロード中…");
            var release = availableRelease;
            updateDownloadTask = Task.Factory.StartNew(delegate { return UpdateService.DownloadAndVerify(release, currentVersion); });
        }

        private static void ShowInformation(string message)
        {
            MessageBox.Show(message, "QuotaPin", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private void WriteLog(string message)
        {
            try
            {
                var logRoot = Path.Combine(installRoot, "logs");
                Directory.CreateDirectory(logRoot);
                var logPath = Path.Combine(logRoot, "tray.log");
                if (File.Exists(logPath) && new FileInfo(logPath).Length > 512 * 1024)
                {
                    var previous = logPath + ".1";
                    if (File.Exists(previous)) File.Delete(previous);
                    File.Move(logPath, previous);
                }
                File.AppendAllText(logPath, DateTimeOffset.Now.ToString("o", CultureInfo.InvariantCulture) + " " + message + Environment.NewLine);
            }
            catch { }
        }

        private static void OpenOfficialProject()
        {
            try
            {
                Process.Start(new ProcessStartInfo(OfficialProjectUrl) { UseShellExecute = true });
            }
            catch
            {
                ShowInformation(UiText(
                    "Official project: " + OfficialProjectUrl,
                    "官方项目：" + OfficialProjectUrl,
                    "公式プロジェクト: " + OfficialProjectUrl));
            }
        }

        private bool IsStartupEnabled()
        {
            using (var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, false))
            {
                return key != null && key.GetValue(RunValueName) != null;
            }
        }

        private void SetStartupEnabled(bool enabled)
        {
            using (var key = Registry.CurrentUser.CreateSubKey(RunKeyPath))
            {
                if (enabled) key.SetValue(RunValueName, "\"" + Application.ExecutablePath + "\"");
                else key.DeleteValue(RunValueName, false);
            }
        }

        private void StartUninstall()
        {
            var uninstaller = Path.Combine(installRoot, "unins000.exe");
            if (File.Exists(uninstaller))
            {
                Process.Start(new ProcessStartInfo(uninstaller) { UseShellExecute = true });
                return;
            }
            var script = Path.Combine(installRoot, "uninstall.ps1");
            if (File.Exists(script))
            {
                Process.Start(new ProcessStartInfo(powerShellPath, "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"") { UseShellExecute = true });
            }
        }

        private void ExitQuotaPin()
        {
            stateTimer.Stop();
            var stopScript = Path.Combine(installRoot, "stop.ps1");
            var cleanupComplete = true;
            if (File.Exists(stopScript))
            {
                try
                {
                    var stop = Process.Start(new ProcessStartInfo(powerShellPath, "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + stopScript + "\" -TemporaryExit")
                    {
                        UseShellExecute = false,
                        CreateNoWindow = true
                    });
                    cleanupComplete = stop != null && stop.WaitForExit(8000) && stop.ExitCode == 0;
                    if (stop != null) stop.Dispose();
                }
                catch { cleanupComplete = false; }
            }
            if (!cleanupComplete)
            {
                WriteLifecycleState("degraded", 0, 0, 0, 0, "tray exit cleanup failed");
                stateTimer.Start();
                MessageBox.Show(UiText(
                    "QuotaPin could not stop its background process. It is still running; try Exit again or restart Windows.",
                    "QuotaPin 无法停止后台进程，程序仍在运行。请重试退出，或重启 Windows。",
                    "QuotaPin のバックグラウンド処理を停止できませんでした。まだ実行中です。もう一度終了するか、Windows を再起動してください。"),
                    "QuotaPin", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            WriteLifecycleState("stopped", 0, 0, 0, 0, "tray exit");
            trayIcon.Visible = false;
            trayIcon.Dispose();
            ExitThread();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                stateTimer.Dispose();
                trayIcon.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
