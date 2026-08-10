import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  OFFICIAL_REPOSITORY,
  MAC_PACKAGE_MAX_BYTES,
  WINDOWS_PACKAGE_MAX_BYTES,
  macPackageNameForVersion,
  packageNameForVersion,
  prepareCiCandidate,
  publicReleaseAssets,
  publicAssetSizeIsValid,
  preparePublicRelease,
  verifyCiCandidate,
  verifyPublicRelease,
  verifyPublishedRelease,
  windowsFileVersionForVersion,
} from "../scripts/public-release.mjs";

process.env.QUOTAPIN_TEST_SKIP_PE_IDENTITY = "1";
const VERSION = "1.0.1";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const TAG = `v${VERSION}`;
const RUN = "24680";
const PACKAGE = packageNameForVersion(VERSION);
const MAC_PACKAGE = macPackageNameForVersion(VERSION);
const PUBLIC_ASSETS = [PACKAGE, MAC_PACKAGE];
const CANDIDATES = [...PUBLIC_ASSETS, "QuotaPin-release.json", "QuotaPin.spdx.json"];

test("semantic release versions map to exact numeric Windows file versions", () => {
  assert.equal(windowsFileVersionForVersion("1.1.0"), "1.1.0.0");
  assert.equal(windowsFileVersionForVersion("1.1.0-beta.7"), "1.1.0.7");
  assert.equal(windowsFileVersionForVersion("1.1.0-alpha.3"), "1.1.0.3");
  assert.throws(() => windowsFileVersionForVersion("1.1.0-preview.1"), /cannot be represented/i);
});

test("public package size policy keeps platform-specific anomaly ceilings", () => {
  assert.equal(WINDOWS_PACKAGE_MAX_BYTES, 160 * 1024 * 1024);
  assert.equal(MAC_PACKAGE_MAX_BYTES, 128 * 1024 * 1024);
  assert.equal(publicAssetSizeIsValid(PACKAGE, WINDOWS_PACKAGE_MAX_BYTES, VERSION), true);
  assert.equal(publicAssetSizeIsValid(PACKAGE, WINDOWS_PACKAGE_MAX_BYTES + 1, VERSION), false);
  assert.equal(publicAssetSizeIsValid(MAC_PACKAGE, 96 * 1024 * 1024, VERSION), true);
  assert.equal(publicAssetSizeIsValid(MAC_PACKAGE, MAC_PACKAGE_MAX_BYTES + 1, VERSION), false);
  assert.equal(publicAssetSizeIsValid("unexpected.zip", 1, VERSION), false);
});

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotapin-public-release-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "dist");
  const output = path.join(root, "public");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(root, "VERSION"), VERSION);
  fs.writeFileSync(path.join(source, PACKAGE), "windows-package-fixture");
  fs.writeFileSync(path.join(source, MAC_PACKAGE), "universal-macos-package-fixture");
  const packageHash = sha256(path.join(source, PACKAGE));
  const macPackageHash = sha256(path.join(source, MAC_PACKAGE));
  const sbom = {
    spdxVersion: "SPDX-2.3",
    name: `QuotaPin-${VERSION}`,
  };
  fs.writeFileSync(path.join(source, "QuotaPin.spdx.json"), `${JSON.stringify(sbom)}\n`);
  const manifest = {
    schemaVersion: "quotapin-release/v1",
    product: "QuotaPin",
    version: VERSION,
    source: { repository: OFFICIAL_REPOSITORY, commit: COMMIT, tag: TAG, dirty: false },
    build: { context: "github-release-workflow", workflowRunId: RUN },
    trust: {
      immutableGitHubReleaseRequired: true,
      exactAssetDigestRequired: true,
      userConfirmationRequired: true,
    },
    artifacts: [
      { name: PACKAGE, bytes: fs.statSync(path.join(source, PACKAGE)).size, sha256: packageHash },
      { name: MAC_PACKAGE, bytes: fs.statSync(path.join(source, MAC_PACKAGE)).size, sha256: macPackageHash },
    ],
    sbom: { name: "QuotaPin.spdx.json", sha256: sha256(path.join(source, "QuotaPin.spdx.json")) },
  };
  fs.writeFileSync(path.join(source, "QuotaPin-release.json"), `${JSON.stringify(manifest)}\n`);
  return { root, source, output };
}

function options(paths) {
  return {
    root: paths.root,
    source: paths.source,
    output: paths.output,
    directory: paths.output,
    repository: OFFICIAL_REPOSITORY,
    commit: COMMIT,
    tag: TAG,
    workflowRunId: RUN,
  };
}

test("cross-platform release preparation keeps internal evidence out of the public asset list", (t) => {
  const paths = fixture(t);
  const prepared = preparePublicRelease(options(paths));
  assert.deepEqual(fs.readdirSync(paths.output).sort(), [...CANDIDATES].sort());
  assert.equal(prepared.asset, PACKAGE);
  assert.deepEqual(publicReleaseAssets(VERSION), PUBLIC_ASSETS);
  const verified = verifyPublicRelease(options(paths));
  assert.equal(verified.sha256, prepared.sha256);
});

test("cross-platform release verification rejects an extra candidate or a tampered package", (t) => {
  const paths = fixture(t);
  preparePublicRelease(options(paths));
  fs.writeFileSync(path.join(paths.output, "internal.zip"), "forbidden");
  assert.throws(() => verifyPublicRelease(options(paths)), /differs from policy/i);
  fs.rmSync(path.join(paths.output, "internal.zip"));
  fs.appendFileSync(path.join(paths.output, PACKAGE), "tampered");
  assert.throws(() => verifyPublicRelease(options(paths)), /cross-platform public installers/i);
});

test("branch CI candidates are verified without pretending to be release provenance", (t) => {
  const paths = fixture(t);
  const manifestPath = path.join(paths.source, "QuotaPin-release.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.build.context = "github-ci-workflow";
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  const prepared = prepareCiCandidate(options(paths));
  assert.equal(prepared.asset, PACKAGE);
  assert.equal(verifyCiCandidate(options(paths)).sha256, prepared.sha256);
  assert.throws(() => verifyPublicRelease(options(paths)), /workflow provenance/i);
});

test("published release readback accepts only the two platform packages and GitHub's exact digests", (t) => {
  const paths = fixture(t);
  preparePublicRelease(options(paths));
  const published = path.join(paths.root, "published");
  fs.mkdirSync(published);
  fs.copyFileSync(path.join(paths.output, PACKAGE), path.join(published, PACKAGE));
  fs.copyFileSync(path.join(paths.output, MAC_PACKAGE), path.join(published, MAC_PACKAGE));
  const digests = Object.fromEntries(PUBLIC_ASSETS.map((asset) => [asset, `sha256:${sha256(path.join(published, asset))}`]));
  const result = verifyPublishedRelease({ ...options(paths), directory: published, digests });
  assert.equal(result.sha256, digests[PACKAGE].slice("sha256:".length));
  assert.deepEqual(result.assets.map(({ asset }) => asset), PUBLIC_ASSETS);
  fs.writeFileSync(path.join(published, "notes.txt"), "no extra assets");
  assert.throws(() => verifyPublishedRelease({ ...options(paths), directory: published, digests }), /differs from policy/i);
});
