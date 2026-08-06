if (-not ('QuotaPin.NativeProcessObserver' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace QuotaPin {
    public sealed class ObservedProcess {
        public int ProcessId;
        public int ParentProcessId;
        public string Path;
        public DateTime CreationTimeUtc;
    }

    public static class NativeProcessObserver {
        private const uint TH32CS_SNAPPROCESS = 0x00000002;
        private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct PROCESSENTRY32 {
            public uint dwSize;
            public uint cntUsage;
            public uint th32ProcessID;
            public IntPtr th32DefaultHeapID;
            public uint th32ModuleID;
            public uint cntThreads;
            public uint th32ParentProcessID;
            public int pcPriClassBase;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct FILETIME { public uint Low; public uint High; }

        [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool Process32FirstW(IntPtr snapshot, ref PROCESSENTRY32 entry);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool Process32NextW(IntPtr snapshot, ref PROCESSENTRY32 entry);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder path, ref uint size);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(IntPtr process, out FILETIME creation, out FILETIME exit, out FILETIME kernel, out FILETIME user);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);

        public static ObservedProcess[] SnapshotChatGpt() {
            var result = new List<ObservedProcess>();
            var snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if (snapshot == new IntPtr(-1)) return result.ToArray();
            try {
                var entry = new PROCESSENTRY32 { dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32)) };
                if (!Process32FirstW(snapshot, ref entry)) return result.ToArray();
                do {
                    if (!string.Equals(entry.szExeFile, "ChatGPT.exe", StringComparison.OrdinalIgnoreCase)) continue;
                    var process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, entry.th32ProcessID);
                    if (process == IntPtr.Zero) continue;
                    try {
                        var path = new StringBuilder(32768);
                        uint size = (uint)path.Capacity;
                        FILETIME creation, exit, kernel, user;
                        if (!QueryFullProcessImageNameW(process, 0, path, ref size) || !GetProcessTimes(process, out creation, out exit, out kernel, out user)) continue;
                        long ticks = ((long)creation.High << 32) | creation.Low;
                        result.Add(new ObservedProcess {
                            ProcessId = unchecked((int)entry.th32ProcessID),
                            ParentProcessId = unchecked((int)entry.th32ParentProcessID),
                            Path = path.ToString(),
                            CreationTimeUtc = DateTime.FromFileTimeUtc(ticks),
                        });
                    }
                    finally { CloseHandle(process); }
                } while (Process32NextW(snapshot, ref entry));
            }
            finally { CloseHandle(snapshot); }
            return result.ToArray();
        }
    }
}
'@
}

function Get-QuotaPinCodexPackageRoot {
    $Package = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue
    if (-not $Package) { return $null }
    [IO.Path]::GetFullPath($Package.InstallLocation).TrimEnd('\')
}

function Get-QuotaPinCodexProcesses([string]$PackageRoot) {
    if (-not $PackageRoot) { return @() }
    $ExpectedPrefix = [IO.Path]::GetFullPath($PackageRoot).TrimEnd('\') + '\'
    @([QuotaPin.NativeProcessObserver]::SnapshotChatGpt() | Where-Object {
        $_.Path -and ([IO.Path]::GetFullPath($_.Path)).StartsWith($ExpectedPrefix, [StringComparison]::OrdinalIgnoreCase)
    })
}

function Get-QuotaPinCodexRootProcesses([string]$PackageRoot) {
    $Official = @(Get-QuotaPinCodexProcesses $PackageRoot)
    $Ids = New-Object 'System.Collections.Generic.HashSet[int]'
    foreach ($Process in $Official) { $null = $Ids.Add([int]$Process.ProcessId) }
    @($Official | Where-Object { -not $Ids.Contains([int]$_.ParentProcessId) })
}

function Get-QuotaPinProcessIdentity($Process) {
    if (-not $Process) { return '' }
    '{0}@{1}' -f ([int]$Process.ProcessId), ([datetime]$Process.CreationTimeUtc).ToFileTimeUtc()
}

function Test-QuotaPinFreshProcess($Process, [int]$MaximumAgeSeconds = 12) {
    if (-not $Process -or -not $Process.CreationTimeUtc) { return $false }
    try {
        $Age = [DateTime]::UtcNow - ([datetime]$Process.CreationTimeUtc)
        return $Age.TotalSeconds -ge -2 -and $Age.TotalSeconds -le $MaximumAgeSeconds
    }
    catch { return $false }
}

function Test-QuotaPinOfficialCodexIdentity(
    [int]$ProcessId,
    [string]$PackageRoot,
    [datetime]$ExpectedCreationTimeUtc = [datetime]::MinValue,
    [double]$MaximumStartDeltaSeconds = 2
) {
    if ($ProcessId -le 0 -or -not $PackageRoot) { return $false }
    $Match = @(Get-QuotaPinCodexRootProcesses $PackageRoot | Where-Object { [int]$_.ProcessId -eq $ProcessId } | Select-Object -First 1)
    if ($Match.Count -ne 1) { return $false }
    if ($ExpectedCreationTimeUtc -eq [datetime]::MinValue) { return $true }
    [Math]::Abs((([datetime]$Match[0].CreationTimeUtc) - $ExpectedCreationTimeUtc).TotalSeconds) -le $MaximumStartDeltaSeconds
}
