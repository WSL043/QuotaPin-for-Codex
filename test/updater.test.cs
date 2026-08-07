using System;

namespace QuotaPin.Tray
{
    internal static class UpdaterTest
    {
        private const string Digest = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new Exception(message);
        }

        private static string Release(string version, bool prerelease, string url, string digest, long size, string extraAsset)
        {
            var suffix = string.IsNullOrEmpty(extraAsset) ? "" : "," + extraAsset;
            var packageName = "QuotaPin-" + version + ".exe";
            return "{\"tag_name\":\"v" + version + "\",\"draft\":false,\"prerelease\":" +
                (prerelease ? "true" : "false") + ",\"immutable\":true,\"html_url\":\"https://github.com/WSL043/QuotaPin-for-Codex/releases/tag/v" +
                version + "\",\"assets\":[{\"name\":\"" + packageName + "\",\"browser_download_url\":\"" + url +
                "\",\"digest\":\"" + digest + "\",\"size\":" + size + "}" + suffix + "]}";
        }

        public static void Main(string[] args)
        {
            if (args.Length == 2 && args[0] == "--live")
            {
                try
                {
                    var live = UpdateService.FindAvailable(args[1]);
                    Console.WriteLine(live == null ? "No newer release" : "Available: " + live.Version);
                    return;
                }
                catch (Exception error)
                {
                    Console.Error.WriteLine(error.GetType().FullName + ": " + error.Message);
                    Environment.ExitCode = 2;
                    return;
                }
            }

            var alpha = Release(
                "1.0.1-beta.1",
                true,
                "https://github.com/WSL043/QuotaPin-for-Codex/releases/download/v1.0.1-beta.1/QuotaPin-1.0.1-beta.1.exe",
                Digest,
                90000000,
                "");
            var stable = Release(
                "1.0.1",
                false,
                "https://github.com/WSL043/QuotaPin-for-Codex/releases/download/v1.0.1/QuotaPin-1.0.1.exe",
                Digest,
                90000000,
                "");
            var releases = "[" + alpha + "," + stable + "]";
            var alphaSelection = UpdateService.SelectRelease(releases, "1.0.0-beta.1");
            Require(alphaSelection != null && alphaSelection.Version == "1.0.1", "beta channel must accept the newer stable release");
            var stableSelection = UpdateService.SelectRelease(releases, "1.0.0");
            Require(stableSelection != null && stableSelection.Version == "1.0.1", "stable channel must ignore prereleases");
            Require(stableSelection.PackageSha256 == Digest.Substring("sha256:".Length), "the GitHub digest must be retained");

            var macAsset = "{\"name\":\"QuotaPin-macOS-1.0.1.tar.gz\",\"browser_download_url\":\"https://github.com/WSL043/QuotaPin-for-Codex/releases/download/v1.0.1/QuotaPin-macOS-1.0.1.tar.gz\",\"digest\":\"" + Digest + "\",\"size\":42000000}";
            var crossPlatform = Release(
                "1.0.1",
                false,
                "https://github.com/WSL043/QuotaPin-for-Codex/releases/download/v1.0.1/QuotaPin-1.0.1.exe",
                Digest,
                90000000,
                macAsset);
            Require(UpdateService.SelectRelease("[" + crossPlatform + "]", "1.0.0") != null, "the exact two-platform package set must remain installable on Windows");

            var mutable = stable.Replace("\"immutable\":true", "\"immutable\":false");
            Require(UpdateService.SelectRelease("[" + mutable + "]", "1.0.0") == null, "a mutable release must be rejected");

            var extra = Release(
                "1.0.2",
                false,
                "https://github.com/WSL043/QuotaPin-for-Codex/releases/download/v1.0.2/QuotaPin-1.0.2.exe",
                Digest,
                90000000,
                "{\"name\":\"internal.zip\",\"browser_download_url\":\"https://github.com/WSL043/QuotaPin-for-Codex/releases/download/v1.0.2/internal.zip\"}");
            Require(UpdateService.SelectRelease("[" + extra + "]", "1.0.0") == null, "a release with extra public assets must be rejected");

            var unsafeRelease = Release("9.0.0", false, "https://example.com/QuotaPin-9.0.0.exe", Digest, 90000000, "");
            Require(UpdateService.SelectRelease("[" + unsafeRelease + "]", "1.0.0") == null, "non-release download hosts must be rejected");

            var missingDigest = stable.Replace(Digest, "");
            Require(UpdateService.SelectRelease("[" + missingDigest + "]", "1.0.0") == null, "an asset without GitHub's digest must be rejected");
            Console.WriteLine("Updater cross-platform selection and trust-boundary tests: OK");
        }
    }
}
