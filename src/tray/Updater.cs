using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace QuotaPin.Tray
{
    internal sealed class ReleaseInfo
    {
        internal string Version;
        internal string SetupUrl;
        internal string ChecksumUrl;
        internal string ManifestUrl;
        internal string ManifestChecksumUrl;
        internal string PageUrl;
    }

    internal sealed class DownloadedUpdate
    {
        internal ReleaseInfo Release;
        internal string SetupPath;
        internal string PublisherCertificateSha256;
    }

    internal static class UpdateService
    {
        private const string RepositoryUrl = "https://github.com/WSL043/QuotaPin-for-Codex";
        private const string ReleasesApi = "https://api.github.com/repos/WSL043/QuotaPin-for-Codex/releases?per_page=20";
        private const string ReleaseDownloadPrefix = RepositoryUrl + "/releases/download/";
        private const int NetworkTimeoutMilliseconds = 20000;
        private const long ApiDocumentLimit = 2L * 1024L * 1024L;
        private const long ChecksumDocumentLimit = 4096L;
        private const long ManifestDocumentLimit = 256L * 1024L;
        private const long SetupFileLimit = 128L * 1024L * 1024L;

        // TRUSTED_CERTIFICATE_SHA256_BEGIN
        // Add the lowercase SHA-256 fingerprint of each approved official Authenticode
        // leaf certificate here. An empty list intentionally disables unattended updates.
        private static readonly string[] TrustedPublisherCertificateSha256 = new string[0];
        // TRUSTED_CERTIFICATE_SHA256_END

        private static readonly Guid WinTrustActionGenericVerifyV2 = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");

        internal static ReleaseInfo FindAvailable(string currentVersion)
        {
            ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;
            var payload = DownloadTextBounded(ReleasesApi, currentVersion, ApiDocumentLimit);
            return SelectRelease(payload, currentVersion);
        }

        internal static ReleaseInfo SelectRelease(string payload, string currentVersion)
        {
            if (payload == null || Encoding.UTF8.GetByteCount(payload) > ApiDocumentLimit)
                throw new InvalidDataException("GitHub returned an oversized release document.");
            var serializer = new JavaScriptSerializer { MaxJsonLength = (int)ApiDocumentLimit };
            var releases = serializer.DeserializeObject(payload) as object[];
            if (releases == null) throw new InvalidDataException("GitHub returned an unexpected release document.");
            var current = SemanticVersion.Parse(currentVersion);
            var allowPrerelease = !string.IsNullOrEmpty(current.PreRelease);
            ReleaseInfo selected = null;
            SemanticVersion selectedVersion = null;
            foreach (var item in releases)
            {
                var release = item as Dictionary<string, object>;
                if (release == null || BooleanValue(release, "draft")) continue;
                if (BooleanValue(release, "prerelease") && !allowPrerelease) continue;
                var rawTag = StringValue(release, "tag_name");
                if (!rawTag.StartsWith("v", StringComparison.Ordinal) || rawTag.Length < 2) continue;
                var tag = rawTag.Substring(1);
                SemanticVersion version;
                try { version = SemanticVersion.Parse(tag); }
                catch { continue; }
                if (version.CompareTo(current) <= 0 || (selectedVersion != null && version.CompareTo(selectedVersion) <= 0)) continue;

                var expectedPage = RepositoryUrl + "/releases/tag/" + rawTag;
                var pageUrl = StringValue(release, "html_url");
                if (!string.Equals(pageUrl, expectedPage, StringComparison.Ordinal)) continue;
                var expectedAssetPrefix = ReleaseDownloadPrefix + rawTag + "/";
                string setupUrl = null;
                string checksumUrl = null;
                string manifestUrl = null;
                string manifestChecksumUrl = null;
                var setupCount = 0;
                var checksumCount = 0;
                var manifestCount = 0;
                var manifestChecksumCount = 0;
                var assets = release.ContainsKey("assets") ? release["assets"] as object[] : null;
                if (assets == null) continue;
                foreach (var assetItem in assets)
                {
                    var asset = assetItem as Dictionary<string, object>;
                    if (asset == null) continue;
                    var name = StringValue(asset, "name");
                    var url = StringValue(asset, "browser_download_url");
                    if (string.Equals(name, "QuotaPin-Setup.exe", StringComparison.Ordinal))
                    {
                        setupCount++;
                        if (string.Equals(url, expectedAssetPrefix + name, StringComparison.Ordinal)) setupUrl = url;
                    }
                    else if (string.Equals(name, "QuotaPin-Setup.exe.sha256", StringComparison.Ordinal))
                    {
                        checksumCount++;
                        if (string.Equals(url, expectedAssetPrefix + name, StringComparison.Ordinal)) checksumUrl = url;
                    }
                    else if (string.Equals(name, "QuotaPin-release.json", StringComparison.Ordinal))
                    {
                        manifestCount++;
                        if (string.Equals(url, expectedAssetPrefix + name, StringComparison.Ordinal)) manifestUrl = url;
                    }
                    else if (string.Equals(name, "QuotaPin-release.json.sha256", StringComparison.Ordinal))
                    {
                        manifestChecksumCount++;
                        if (string.Equals(url, expectedAssetPrefix + name, StringComparison.Ordinal)) manifestChecksumUrl = url;
                    }
                }
                if (setupCount != 1 || checksumCount != 1 || manifestCount != 1 || manifestChecksumCount != 1 ||
                    setupUrl == null || checksumUrl == null || manifestUrl == null || manifestChecksumUrl == null) continue;
                selectedVersion = version;
                selected = new ReleaseInfo
                {
                    Version = tag,
                    SetupUrl = setupUrl,
                    ChecksumUrl = checksumUrl,
                    ManifestUrl = manifestUrl,
                    ManifestChecksumUrl = manifestChecksumUrl,
                    PageUrl = pageUrl,
                };
            }
            return selected;
        }

        internal static DownloadedUpdate DownloadAndVerify(ReleaseInfo release, string currentVersion)
        {
            if (release == null) throw new ArgumentNullException("release");
            ValidateReleaseInfo(release, currentVersion);
            var updateRoot = Path.Combine(Path.GetTempPath(), "QuotaPin", "updates");
            Directory.CreateDirectory(updateRoot);
            var versionRoot = Path.GetFullPath(Path.Combine(updateRoot, SafeFileName(release.Version)));
            if (!versionRoot.StartsWith(Path.GetFullPath(updateRoot) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Unsafe update directory.");
            if (Directory.Exists(versionRoot)) Directory.Delete(versionRoot, true);
            Directory.CreateDirectory(versionRoot);
            var setupPath = Path.Combine(versionRoot, "QuotaPin-Setup.exe");
            var checksumPath = setupPath + ".sha256";
            var manifestPath = Path.Combine(versionRoot, "QuotaPin-release.json");
            var manifestChecksumPath = manifestPath + ".sha256";
            try
            {
                DownloadFileBounded(release.ChecksumUrl, checksumPath, currentVersion, ChecksumDocumentLimit);
                DownloadFileBounded(release.ManifestChecksumUrl, manifestChecksumPath, currentVersion, ChecksumDocumentLimit);
                DownloadFileBounded(release.ManifestUrl, manifestPath, currentVersion, ManifestDocumentLimit);
                DownloadFileBounded(release.SetupUrl, setupPath, currentVersion, SetupFileLimit);

                var expectedSetup = ReadStrictChecksum(checksumPath, "QuotaPin-Setup.exe");
                var actualSetup = ComputeSha256(setupPath);
                if (!string.Equals(expectedSetup, actualSetup, StringComparison.Ordinal))
                    throw new InvalidDataException("The downloaded installer failed checksum verification.");
                var expectedManifest = ReadStrictChecksum(manifestChecksumPath, "QuotaPin-release.json");
                var actualManifest = ComputeSha256(manifestPath);
                if (!string.Equals(expectedManifest, actualManifest, StringComparison.Ordinal))
                    throw new InvalidDataException("The downloaded release manifest failed checksum verification.");

                VerifySetupIdentity(setupPath, release.Version);
                var signerHash = VerifyOfficialAuthenticode(setupPath);
                VerifyReleaseManifest(manifestPath, release, actualSetup, new FileInfo(setupPath).Length, signerHash);
                return new DownloadedUpdate
                {
                    Release = release,
                    SetupPath = setupPath,
                    PublisherCertificateSha256 = signerHash,
                };
            }
            catch
            {
                TryDeleteDirectory(versionRoot);
                throw;
            }
        }

        internal static void CleanupOldDownloads()
        {
            try
            {
                var root = Path.Combine(Path.GetTempPath(), "QuotaPin", "updates");
                if (!Directory.Exists(root)) return;
                foreach (var directory in Directory.GetDirectories(root))
                {
                    try
                    {
                        if (Directory.GetLastWriteTimeUtc(directory) < DateTime.UtcNow.AddDays(-7)) Directory.Delete(directory, true);
                    }
                    catch { }
                }
            }
            catch { }
        }

        private static void ValidateReleaseInfo(ReleaseInfo release, string currentVersion)
        {
            var version = SemanticVersion.Parse(release.Version);
            var current = SemanticVersion.Parse(currentVersion);
            if (version.CompareTo(current) <= 0) throw new InvalidDataException("The release version is not newer than the installed version.");
            var rawTag = "v" + release.Version;
            var expectedPrefix = ReleaseDownloadPrefix + rawTag + "/";
            if (!string.Equals(release.SetupUrl, expectedPrefix + "QuotaPin-Setup.exe", StringComparison.Ordinal) ||
                !string.Equals(release.ChecksumUrl, expectedPrefix + "QuotaPin-Setup.exe.sha256", StringComparison.Ordinal) ||
                !string.Equals(release.ManifestUrl, expectedPrefix + "QuotaPin-release.json", StringComparison.Ordinal) ||
                !string.Equals(release.ManifestChecksumUrl, expectedPrefix + "QuotaPin-release.json.sha256", StringComparison.Ordinal) ||
                !string.Equals(release.PageUrl, RepositoryUrl + "/releases/tag/" + rawTag, StringComparison.Ordinal))
                throw new SecurityException("The update release does not use the official versioned asset paths.");
        }

        private static string DownloadTextBounded(string url, string currentVersion, long maximumBytes)
        {
            using (var response = OpenResponse(url, currentVersion))
            using (var input = response.GetResponseStream())
            using (var output = new MemoryStream())
            {
                CopyBounded(input, output, maximumBytes);
                return new UTF8Encoding(false, true).GetString(output.ToArray());
            }
        }

        private static void DownloadFileBounded(string url, string destination, string currentVersion, long maximumBytes)
        {
            var partial = destination + ".partial";
            TryDeleteFile(partial);
            try
            {
                using (var response = OpenResponse(url, currentVersion))
                using (var input = response.GetResponseStream())
                using (var output = new FileStream(partial, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    CopyBounded(input, output, maximumBytes);
                File.Move(partial, destination);
            }
            finally
            {
                TryDeleteFile(partial);
            }
        }

        private static HttpWebResponse OpenResponse(string url, string currentVersion)
        {
            Uri uri;
            if (!Uri.TryCreate(url, UriKind.Absolute, out uri) || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
                throw new SecurityException("QuotaPin updates require HTTPS.");
            var request = (HttpWebRequest)WebRequest.Create(uri);
            request.Method = "GET";
            request.UserAgent = "QuotaPin/" + currentVersion;
            request.Accept = "application/vnd.github+json";
            request.Headers["X-GitHub-Api-Version"] = "2022-11-28";
            request.Timeout = NetworkTimeoutMilliseconds;
            request.ReadWriteTimeout = NetworkTimeoutMilliseconds;
            request.AllowAutoRedirect = true;
            request.MaximumAutomaticRedirections = 5;
            request.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            var response = (HttpWebResponse)request.GetResponse();
            if ((int)response.StatusCode < 200 || (int)response.StatusCode >= 300)
            {
                response.Dispose();
                throw new WebException("The update server returned HTTP " + (int)response.StatusCode + ".");
            }
            if (!IsApprovedDownloadHost(response.ResponseUri))
            {
                response.Dispose();
                throw new SecurityException("The update download redirected outside approved GitHub hosts.");
            }
            return response;
        }

        private static bool IsApprovedDownloadHost(Uri uri)
        {
            if (uri == null || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)) return false;
            return string.Equals(uri.Host, "api.github.com", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(uri.Host, "objects.githubusercontent.com", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(uri.Host, "release-assets.githubusercontent.com", StringComparison.OrdinalIgnoreCase);
        }

        private static void CopyBounded(Stream input, Stream output, long maximumBytes)
        {
            var buffer = new byte[64 * 1024];
            long total = 0;
            while (true)
            {
                var count = input.Read(buffer, 0, buffer.Length);
                if (count <= 0) break;
                total += count;
                if (total > maximumBytes) throw new InvalidDataException("The update download exceeded its size limit.");
                output.Write(buffer, 0, count);
            }
        }

        private static string ReadStrictChecksum(string path, string expectedName)
        {
            var text = File.ReadAllText(path, Encoding.ASCII).Trim();
            var pattern = "\\A([0-9a-fA-F]{64})[ \\t]+\\*?" + Regex.Escape(expectedName) + "\\z";
            var match = Regex.Match(text, pattern, RegexOptions.CultureInvariant);
            if (!match.Success) throw new InvalidDataException("The release checksum document is invalid.");
            return match.Groups[1].Value.ToLowerInvariant();
        }

        private static string ComputeSha256(string path)
        {
            using (var stream = File.OpenRead(path))
            using (var algorithm = SHA256.Create())
                return ToHex(algorithm.ComputeHash(stream));
        }

        private static string VerifyOfficialAuthenticode(string path)
        {
            if (TrustedPublisherCertificateSha256.Length == 0)
                throw new SecurityException("Official update signing is not configured; automatic installation is disabled.");
            if (!VerifyEmbeddedSignature(path))
                throw new SecurityException("The downloaded installer does not have a trusted Authenticode signature.");
            X509Certificate certificate;
            try { certificate = X509Certificate.CreateFromSignedFile(path); }
            catch (Exception error) { throw new SecurityException("The installer signer certificate could not be read.", error); }
            using (var signer = new X509Certificate2(certificate))
            using (var algorithm = SHA256.Create())
            {
                var fingerprint = ToHex(algorithm.ComputeHash(signer.RawData));
                foreach (var trusted in TrustedPublisherCertificateSha256)
                {
                    if (string.Equals(fingerprint, NormalizeFingerprint(trusted), StringComparison.Ordinal)) return fingerprint;
                }
                throw new SecurityException("The installer was not signed by an approved QuotaPin publisher certificate.");
            }
        }

        private static void VerifySetupIdentity(string path, string expectedVersion)
        {
            var productVersion = (FileVersionInfo.GetVersionInfo(path).ProductVersion ?? "").Trim();
            if (!string.Equals(productVersion, expectedVersion, StringComparison.Ordinal))
                throw new SecurityException("The downloaded installer version does not match the release.");
        }

        private static bool VerifyEmbeddedSignature(string path)
        {
            using (var fileInfo = new WinTrustFileInfo(path))
            using (var trustData = new WinTrustData(fileInfo))
            {
                var result = WinVerifyTrust(IntPtr.Zero, WinTrustActionGenericVerifyV2, trustData);
                trustData.CloseState();
                WinVerifyTrust(IntPtr.Zero, WinTrustActionGenericVerifyV2, trustData);
                return result == 0;
            }
        }

        private static void VerifyReleaseManifest(string path, ReleaseInfo release, string setupSha256, long setupBytes, string signerHash)
        {
            var serializer = new JavaScriptSerializer { MaxJsonLength = (int)ManifestDocumentLimit };
            var document = serializer.DeserializeObject(File.ReadAllText(path, Encoding.UTF8)) as Dictionary<string, object>;
            if (document == null || StringValue(document, "schemaVersion") != "quotapin-release/v1" ||
                StringValue(document, "product") != "QuotaPin" || StringValue(document, "version") != release.Version)
                throw new InvalidDataException("The release manifest identity is invalid.");
            var source = DictionaryValue(document, "source");
            if (source == null || StringValue(source, "repository") != RepositoryUrl)
                throw new InvalidDataException("The release manifest source is invalid.");
            var trust = DictionaryValue(document, "trust");
            if (trust == null || !BooleanValue(trust, "autoUpdateEligible") ||
                NormalizeFingerprint(StringValue(trust, "setupCertificateSha256")) != signerHash)
                throw new SecurityException("The release manifest does not authorize automatic installation.");
            var artifacts = document.ContainsKey("artifacts") ? document["artifacts"] as object[] : null;
            if (artifacts == null) throw new InvalidDataException("The release manifest has no artifacts.");
            Dictionary<string, object> setup = null;
            foreach (var item in artifacts)
            {
                var artifact = item as Dictionary<string, object>;
                if (artifact != null && StringValue(artifact, "name") == "QuotaPin-Setup.exe")
                {
                    if (setup != null) throw new InvalidDataException("The release manifest contains duplicate installer entries.");
                    setup = artifact;
                }
            }
            if (setup == null || StringValue(setup, "sha256") != setupSha256 || IntegerValue(setup, "bytes") != setupBytes)
                throw new InvalidDataException("The release manifest installer entry does not match the download.");
        }

        private static Dictionary<string, object> DictionaryValue(Dictionary<string, object> source, string key)
        {
            object value;
            return source.TryGetValue(key, out value) ? value as Dictionary<string, object> : null;
        }

        private static string StringValue(Dictionary<string, object> source, string key)
        {
            object value;
            return source.TryGetValue(key, out value) && value != null ? Convert.ToString(value, CultureInfo.InvariantCulture) : "";
        }

        private static bool BooleanValue(Dictionary<string, object> source, string key)
        {
            object value;
            return source.TryGetValue(key, out value) && value != null && Convert.ToBoolean(value, CultureInfo.InvariantCulture);
        }

        private static long IntegerValue(Dictionary<string, object> source, string key)
        {
            object value;
            long parsed;
            return source.TryGetValue(key, out value) && value != null && Int64.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed) ? parsed : -1;
        }

        private static string SafeFileName(string value)
        {
            var safe = Regex.Replace(value ?? "", "[^0-9A-Za-z._-]+", "-").Trim('-');
            if (safe.Length == 0) throw new InvalidDataException("Unsafe update version.");
            return safe;
        }

        private static string NormalizeFingerprint(string value)
        {
            return Regex.Replace(value ?? "", "[^0-9a-fA-F]", "").ToLowerInvariant();
        }

        private static string ToHex(byte[] value)
        {
            return BitConverter.ToString(value).Replace("-", "").ToLowerInvariant();
        }

        private static void TryDeleteFile(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); }
            catch { }
        }

        private static void TryDeleteDirectory(string path)
        {
            try { if (Directory.Exists(path)) Directory.Delete(path, true); }
            catch { }
        }

        private sealed class SemanticVersion : IComparable<SemanticVersion>
        {
            internal Version Core;
            internal string PreRelease;

            internal static SemanticVersion Parse(string value)
            {
                var match = Regex.Match(value ?? "", "\\A(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?\\z");
                if (!match.Success) throw new FormatException("Invalid semantic version.");
                return new SemanticVersion
                {
                    Core = new Version(
                        Int32.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture),
                        Int32.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture),
                        Int32.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture)),
                    PreRelease = match.Groups[4].Success ? match.Groups[4].Value : "",
                };
            }

            public int CompareTo(SemanticVersion other)
            {
                var core = Core.CompareTo(other.Core);
                if (core != 0) return core;
                if (PreRelease.Length == 0 && other.PreRelease.Length == 0) return 0;
                if (PreRelease.Length == 0) return 1;
                if (other.PreRelease.Length == 0) return -1;
                var left = PreRelease.Split('.');
                var right = other.PreRelease.Split('.');
                for (var index = 0; index < Math.Max(left.Length, right.Length); index++)
                {
                    if (index >= left.Length) return -1;
                    if (index >= right.Length) return 1;
                    int leftNumber;
                    int rightNumber;
                    var leftNumeric = Int32.TryParse(left[index], NumberStyles.None, CultureInfo.InvariantCulture, out leftNumber);
                    var rightNumeric = Int32.TryParse(right[index], NumberStyles.None, CultureInfo.InvariantCulture, out rightNumber);
                    int part;
                    if (leftNumeric && rightNumeric) part = leftNumber.CompareTo(rightNumber);
                    else if (leftNumeric != rightNumeric) part = leftNumeric ? -1 : 1;
                    else part = string.Compare(left[index], right[index], StringComparison.Ordinal);
                    if (part != 0) return part;
                }
                return 0;
            }
        }

        private enum WinTrustDataUiChoice : uint { None = 2 }
        private enum WinTrustDataRevocationChecks : uint { None = 0 }
        private enum WinTrustDataChoice : uint { File = 1 }
        private enum WinTrustDataStateAction : uint { Ignore = 0, Verify = 1, Close = 2 }

        [Flags]
        private enum WinTrustDataProvFlags : uint
        {
            RevocationCheckChainExcludeRoot = 0x00000080,
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private sealed class WinTrustFileInfo : IDisposable
        {
            private uint cbStruct = (uint)Marshal.SizeOf(typeof(WinTrustFileInfo));
            [MarshalAs(UnmanagedType.LPWStr)] private string pcwszFilePath;
            private IntPtr hFile = IntPtr.Zero;
            private IntPtr pgKnownSubject = IntPtr.Zero;

            internal WinTrustFileInfo(string path) { pcwszFilePath = path; }
            public void Dispose() { }
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private sealed class WinTrustData : IDisposable
        {
            private uint cbStruct = (uint)Marshal.SizeOf(typeof(WinTrustData));
            private IntPtr pPolicyCallbackData = IntPtr.Zero;
            private IntPtr pSIPClientData = IntPtr.Zero;
            private WinTrustDataUiChoice dwUIChoice = WinTrustDataUiChoice.None;
            private WinTrustDataRevocationChecks fdwRevocationChecks = WinTrustDataRevocationChecks.None;
            private WinTrustDataChoice dwUnionChoice = WinTrustDataChoice.File;
            private IntPtr pFile;
            private WinTrustDataStateAction dwStateAction = WinTrustDataStateAction.Verify;
            private IntPtr hWVTStateData = IntPtr.Zero;
            private IntPtr pwszURLReference = IntPtr.Zero;
            private WinTrustDataProvFlags dwProvFlags = WinTrustDataProvFlags.RevocationCheckChainExcludeRoot;
            private uint dwUIContext = 0;

            internal WinTrustData(WinTrustFileInfo fileInfo)
            {
                pFile = Marshal.AllocCoTaskMem(Marshal.SizeOf(typeof(WinTrustFileInfo)));
                Marshal.StructureToPtr(fileInfo, pFile, false);
            }

            internal void CloseState() { dwStateAction = WinTrustDataStateAction.Close; }

            public void Dispose()
            {
                if (pFile != IntPtr.Zero)
                {
                    Marshal.DestroyStructure(pFile, typeof(WinTrustFileInfo));
                    Marshal.FreeCoTaskMem(pFile);
                    pFile = IntPtr.Zero;
                }
            }
        }

        [DllImport("wintrust.dll", ExactSpelling = true, SetLastError = false, CharSet = CharSet.Unicode)]
        private static extern uint WinVerifyTrust(IntPtr hwnd, [MarshalAs(UnmanagedType.LPStruct)] Guid actionId, WinTrustData trustData);
    }
}
