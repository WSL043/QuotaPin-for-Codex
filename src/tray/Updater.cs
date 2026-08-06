using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Security;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace QuotaPin.Tray
{
    internal sealed class ReleaseInfo
    {
        internal string Version;
        internal string PackageUrl;
        internal string PackageSha256;
        internal string PageUrl;
    }

    internal sealed class DownloadedUpdate
    {
        internal ReleaseInfo Release;
        internal string SetupPath;
    }

    internal static class UpdateService
    {
        private const string RepositoryUrl = "https://github.com/WSL043/QuotaPin-for-Codex";
        private const string ReleasesApi = "https://api.github.com/repos/WSL043/QuotaPin-for-Codex/releases?per_page=20";
        private const string ReleaseDownloadPrefix = RepositoryUrl + "/releases/download/";
        private const int NetworkTimeoutMilliseconds = 20000;
        private const long ApiDocumentLimit = 2L * 1024L * 1024L;
        private const long PackageFileLimit = 160L * 1024L * 1024L;

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
                if (release == null || BooleanValue(release, "draft") || !BooleanValue(release, "immutable")) continue;
                if (BooleanValue(release, "prerelease") && !allowPrerelease) continue;
                var rawTag = StringValue(release, "tag_name");
                if (!rawTag.StartsWith("v", StringComparison.Ordinal) || rawTag.Length < 2) continue;
                var tag = rawTag.Substring(1);
                SemanticVersion version;
                try { version = SemanticVersion.Parse(tag); }
                catch { continue; }
                if (BooleanValue(release, "prerelease") != !string.IsNullOrEmpty(version.PreRelease)) continue;
                if (version.CompareTo(current) <= 0 || (selectedVersion != null && version.CompareTo(selectedVersion) <= 0)) continue;

                var expectedPage = RepositoryUrl + "/releases/tag/" + rawTag;
                var pageUrl = StringValue(release, "html_url");
                if (!string.Equals(pageUrl, expectedPage, StringComparison.Ordinal)) continue;
                var assets = release.ContainsKey("assets") ? release["assets"] as object[] : null;
                if (assets == null || assets.Length != 1) continue;
                var asset = assets[0] as Dictionary<string, object>;
                var packageName = PackageName(tag);
                if (asset == null || StringValue(asset, "name") != packageName) continue;
                var expectedUrl = ReleaseDownloadPrefix + rawTag + "/" + packageName;
                var packageUrl = StringValue(asset, "browser_download_url");
                var digest = StringValue(asset, "digest");
                var size = IntegerValue(asset, "size");
                var digestMatch = Regex.Match(digest, "\\Asha256:([0-9a-f]{64})\\z", RegexOptions.CultureInvariant);
                if (!string.Equals(packageUrl, expectedUrl, StringComparison.Ordinal) || !digestMatch.Success ||
                    size <= 0 || size > PackageFileLimit) continue;
                selectedVersion = version;
                selected = new ReleaseInfo
                {
                    Version = tag,
                    PackageUrl = packageUrl,
                    PackageSha256 = digestMatch.Groups[1].Value,
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
            var packagePath = Path.Combine(versionRoot, PackageName(release.Version));
            try
            {
                DownloadFileBounded(release.PackageUrl, packagePath, currentVersion, PackageFileLimit);
                var actual = ComputeSha256(packagePath);
                if (!string.Equals(actual, release.PackageSha256, StringComparison.Ordinal))
                    throw new InvalidDataException("The downloaded installer failed GitHub digest verification.");
                VerifyPackageIdentity(packagePath, release.Version);
                return new DownloadedUpdate { Release = release, SetupPath = packagePath };
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
                    try { if (Directory.GetLastWriteTimeUtc(directory) < DateTime.UtcNow.AddDays(-7)) Directory.Delete(directory, true); }
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
            var expectedUrl = ReleaseDownloadPrefix + rawTag + "/" + PackageName(release.Version);
            if (!string.Equals(release.PackageUrl, expectedUrl, StringComparison.Ordinal) ||
                !Regex.IsMatch(release.PackageSha256 ?? "", "\\A[0-9a-f]{64}\\z", RegexOptions.CultureInvariant) ||
                !string.Equals(release.PageUrl, RepositoryUrl + "/releases/tag/" + rawTag, StringComparison.Ordinal))
                throw new SecurityException("The update release does not use the official immutable asset identity.");
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
            finally { TryDeleteFile(partial); }
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
            request.Headers["X-GitHub-Api-Version"] = "2026-03-10";
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

        private static string ComputeSha256(string path)
        {
            using (var stream = File.OpenRead(path))
            using (var algorithm = SHA256.Create())
                return ToHex(algorithm.ComputeHash(stream));
        }

        private static void VerifyPackageIdentity(string path, string expectedVersion)
        {
            var info = FileVersionInfo.GetVersionInfo(path);
            var productVersion = (info.ProductVersion ?? "").Trim();
            var description = info.FileDescription ?? "";
            if (!string.Equals(productVersion, expectedVersion, StringComparison.Ordinal) ||
                description.IndexOf(RepositoryUrl, StringComparison.Ordinal) < 0 ||
                !string.Equals(info.OriginalFilename ?? "", PackageName(expectedVersion), StringComparison.Ordinal))
                throw new SecurityException("The downloaded installer identity does not match the release.");
        }

        private static string PackageName(string version)
        {
            SemanticVersion.Parse(version);
            return "QuotaPin-" + version + ".exe";
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
            return source.TryGetValue(key, out value) && value != null &&
                Int64.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed)
                ? parsed : -1;
        }

        private static string SafeFileName(string value)
        {
            var safe = Regex.Replace(value ?? "", "[^0-9A-Za-z._-]+", "-").Trim('-');
            if (safe.Length == 0) throw new InvalidDataException("Unsafe update version.");
            return safe;
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
    }
}
