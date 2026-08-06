using System;

namespace QuotaPin.Tray
{
    internal static class UpdaterTest
    {
        private static void Require(bool condition, string message)
        {
            if (!condition) throw new Exception(message);
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
            const string releases = @"[
              {
                ""tag_name"": ""v0.3.0-alpha.24"", ""draft"": false, ""prerelease"": true, ""html_url"": ""https://github.com/WSL043/QuotaPin-for-Codex/releases/tag/v0.3.0-alpha.24"",
                ""assets"": [
                  { ""name"": ""QuotaPin-Setup.exe"", ""browser_download_url"": ""https://github.com/WSL043/QuotaPin-for-Codex/releases/download/v0.3.0-alpha.24/QuotaPin-Setup.exe"" },
                  { ""name"": ""QuotaPin-Setup.exe.sha256"", ""browser_download_url"": ""https://github.com/WSL043/QuotaPin-for-Codex/releases/download/v0.3.0-alpha.24/QuotaPin-Setup.exe.sha256"" },
                  { ""name"": ""QuotaPin-release.json"", ""browser_download_url"": ""https://github.com/WSL043/QuotaPin-for-Codex/releases/download/v0.3.0-alpha.24/QuotaPin-release.json"" },
                  { ""name"": ""QuotaPin-release.json.sha256"", ""browser_download_url"": ""https://github.com/WSL043/QuotaPin-for-Codex/releases/download/v0.3.0-alpha.24/QuotaPin-release.json.sha256"" }
                ]
              },
              {
                ""tag_name"": ""v0.3.0"", ""draft"": false, ""prerelease"": false, ""html_url"": ""https://github.com/WSL043/QuotaPin-for-Codex/releases/tag/v0.3.0"",
                ""assets"": [
                  { ""name"": ""QuotaPin-Setup.exe"", ""browser_download_url"": ""https://github.com/WSL043/QuotaPin-for-Codex/releases/download/v0.3.0/QuotaPin-Setup.exe"" },
                  { ""name"": ""QuotaPin-Setup.exe.sha256"", ""browser_download_url"": ""https://github.com/WSL043/QuotaPin-for-Codex/releases/download/v0.3.0/QuotaPin-Setup.exe.sha256"" },
                  { ""name"": ""QuotaPin-release.json"", ""browser_download_url"": ""https://github.com/WSL043/QuotaPin-for-Codex/releases/download/v0.3.0/QuotaPin-release.json"" },
                  { ""name"": ""QuotaPin-release.json.sha256"", ""browser_download_url"": ""https://github.com/WSL043/QuotaPin-for-Codex/releases/download/v0.3.0/QuotaPin-release.json.sha256"" }
                ]
              }
            ]";

            var alpha = UpdateService.SelectRelease(releases, "0.3.0-alpha.23");
            Require(alpha != null && alpha.Version == "0.3.0", "alpha channel must accept the newer stable release");
            var stable = UpdateService.SelectRelease(releases, "0.2.9");
            Require(stable != null && stable.Version == "0.3.0", "stable channel must ignore prereleases");

            const string incompleteRelease = @"[{
              ""tag_name"": ""v0.4.0"", ""draft"": false, ""prerelease"": false, ""html_url"": ""https://github.com/WSL043/QuotaPin-for-Codex/releases/tag/v0.4.0"",
              ""assets"": [
                { ""name"": ""QuotaPin-Setup.exe"", ""browser_download_url"": ""https://github.com/WSL043/QuotaPin-for-Codex/releases/download/v0.4.0/QuotaPin-Setup.exe"" },
                { ""name"": ""QuotaPin-Setup.exe.sha256"", ""browser_download_url"": ""https://github.com/WSL043/QuotaPin-for-Codex/releases/download/v0.4.0/QuotaPin-Setup.exe.sha256"" }
              ]
            }]";
            Require(UpdateService.SelectRelease(incompleteRelease, "0.3.0") == null, "a release without the trusted manifest pair must be rejected");

            const string unsafeRelease = @"[{
              ""tag_name"": ""v9.0.0"", ""draft"": false, ""prerelease"": false,
              ""assets"": [
                { ""name"": ""QuotaPin-Setup.exe"", ""browser_download_url"": ""https://example.com/QuotaPin-Setup.exe"" },
                { ""name"": ""QuotaPin-Setup.exe.sha256"", ""browser_download_url"": ""https://example.com/QuotaPin-Setup.exe.sha256"" }
              ]
            }]";
            Require(UpdateService.SelectRelease(unsafeRelease, "0.3.0") == null, "non-release download hosts must be rejected");
            Console.WriteLine("Updater selection and trust-boundary tests: OK");
        }
    }
}
