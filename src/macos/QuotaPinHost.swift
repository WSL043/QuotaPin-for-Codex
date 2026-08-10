import CryptoKit
import Darwin
import Foundation

private let productVersion = "__QUOTAPIN_VERSION__"
private let buildCommit = "__QUOTAPIN_COMMIT__"
private let expectedRuntimeSHA256 = "__QUOTAPIN_RUNTIME_SHA256__"
private let expectedBundleIdentifier = "com.openai.codex"
private let expectedTeamIdentifier = "2DC432GLL2"
private let runtimeFileName = "QuotaPin.runtime.cjs"
private let agentModeArgument = "--quotapin-agent-runtime"

private struct HostFailure: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}

private struct CommandResult {
  let status: Int32
  let standardOutput: String
  let standardError: String
}

private struct OfficialRuntime {
  let bundlePath: String
  let executablePath: String
  let nodePath: String
  let nodeVersion: String
}

private func standardError(_ text: String) {
  FileHandle.standardError.write(Data((text + "\n").utf8))
}

private func canonicalPath(_ value: String) -> String {
  URL(fileURLWithPath: value).standardizedFileURL.resolvingSymlinksInPath().path
}

private func runCommand(_ executable: String, _ arguments: [String], timeout: TimeInterval = 5) throws -> CommandResult {
  let process = Process()
  let stdout = Pipe()
  let stderr = Pipe()
  let completed = DispatchSemaphore(value: 0)
  process.executableURL = URL(fileURLWithPath: executable)
  process.arguments = arguments
  process.standardOutput = stdout
  process.standardError = stderr
  process.terminationHandler = { _ in completed.signal() }
  try process.run()
  if completed.wait(timeout: .now() + timeout) == .timedOut {
    process.terminate()
    _ = completed.wait(timeout: .now() + 1)
    throw HostFailure("Timed out while validating \(executable)")
  }
  let output = String(data: stdout.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
  let error = String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
  return CommandResult(status: process.terminationStatus, standardOutput: output, standardError: error)
}

private func runtimeURL() throws -> URL {
  let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.resolvingSymlinksInPath()
  let runtime = executable.deletingLastPathComponent().appendingPathComponent(runtimeFileName)
  guard FileManager.default.fileExists(atPath: runtime.path) else {
    throw HostFailure("QuotaPin runtime is missing: \(runtime.path)")
  }
  return runtime
}

private func sha256Hex(_ url: URL) throws -> String {
  let data = try Data(contentsOf: url, options: [.mappedIfSafe])
  return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

@discardableResult
private func verifyRuntimePayload() throws -> URL {
  let runtime = try runtimeURL()
  let actual = try sha256Hex(runtime)
  guard actual == expectedRuntimeSHA256 else {
    throw HostFailure("QuotaPin runtime integrity check failed")
  }
  return runtime
}

private func teamIdentifier(_ path: String) throws -> String {
  let result = try runCommand("/usr/bin/codesign", ["-dv", "--verbose=4", path])
  let details = result.standardOutput + "\n" + result.standardError
  for line in details.split(separator: "\n") {
    if line.hasPrefix("TeamIdentifier=") {
      return String(line.dropFirst("TeamIdentifier=".count)).trimmingCharacters(in: .whitespacesAndNewlines)
    }
  }
  return ""
}

private func verifySignedComponent(_ path: String, label: String) throws {
  let verification = try runCommand("/usr/bin/codesign", ["--verify", "--strict", path])
  guard verification.status == 0 else {
    throw HostFailure("The official Codex \(label) failed strict code-signature validation")
  }
  let team = try teamIdentifier(path)
  guard team == expectedTeamIdentifier else {
    throw HostFailure("Unexpected official Codex \(label) signing team: \(team.isEmpty ? "missing" : team)")
  }
}

private func explicitCodexPath() -> String? {
  if let index = CommandLine.arguments.firstIndex(of: "--codex-app"), index + 1 < CommandLine.arguments.count {
    return CommandLine.arguments[index + 1]
  }
  if let value = ProcessInfo.processInfo.environment["QUOTAPIN_CODEX_APP"], !value.isEmpty {
    return value
  }
  return nil
}

private func defaultCodexBundles() -> [String] {
  let home = FileManager.default.homeDirectoryForCurrentUser.path
  return [
    "/Applications/ChatGPT.app",
    "\(home)/Applications/ChatGPT.app",
    "/Applications/Codex.app",
    "\(home)/Applications/Codex.app",
  ]
}

private func spotlightCodexBundles() -> [String] {
  guard let result = try? runCommand(
    "/usr/bin/mdfind",
    ["kMDItemCFBundleIdentifier == '\(expectedBundleIdentifier)'"],
    timeout: 3
  ), result.status == 0 else { return [] }
  return result.standardOutput.split(separator: "\n").map(String.init)
}

private func codexBundle(at candidate: String) -> (String, Bundle)? {
  guard FileManager.default.fileExists(atPath: candidate) else { return nil }
  let real = canonicalPath(candidate)
  guard let bundle = Bundle(path: real), bundle.bundleIdentifier == expectedBundleIdentifier else { return nil }
  return (real, bundle)
}

private func discoverOfficialRuntime() throws -> OfficialRuntime {
  if let explicit = explicitCodexPath(), FileManager.default.fileExists(atPath: explicit) {
    guard let match = codexBundle(at: explicit) else {
      throw HostFailure("The explicit Codex application is not the official \(expectedBundleIdentifier) bundle: \(explicit)")
    }
    return try validateOfficialRuntime(bundlePath: match.0, bundle: match.1)
  }

  var seen = Set<String>()
  var matches: [(String, Bundle)] = []
  for candidate in defaultCodexBundles() + spotlightCodexBundles() {
    guard let match = codexBundle(at: candidate), seen.insert(match.0).inserted else { continue }
    matches.append(match)
  }
  guard !matches.isEmpty else {
    throw HostFailure("Official Codex was not found. QuotaPin does not download Codex or a substitute runtime.")
  }
  guard matches.count == 1 else {
    throw HostFailure("More than one official Codex application was found; pass --codex-app with the exact path.")
  }

  return try validateOfficialRuntime(bundlePath: matches[0].0, bundle: matches[0].1)
}

private func validateOfficialRuntime(bundlePath: String, bundle: Bundle) throws -> OfficialRuntime {
  guard let executableURL = bundle.executableURL else {
    throw HostFailure("The official Codex main executable was not found")
  }
  let executablePath = canonicalPath(executableURL.path)
  let nodePath = canonicalPath("\(bundlePath)/Contents/Resources/cua_node/bin/node")
  guard FileManager.default.isExecutableFile(atPath: nodePath) else {
    throw HostFailure("The signed Node.js runtime bundled with official Codex was not found. QuotaPin does not download or substitute one.")
  }
  guard executablePath.hasPrefix(bundlePath + "/"), nodePath.hasPrefix(bundlePath + "/") else {
    throw HostFailure("An official Codex runtime component resolves outside the application bundle")
  }

  // Validate the three exact boundaries separately. A deep bundle check can reject
  // an unrelated nested component even when the app, main executable, and runtime
  // QuotaPin actually uses are all valid.
  try verifySignedComponent(bundlePath, label: "application")
  try verifySignedComponent(executablePath, label: "main executable")
  try verifySignedComponent(nodePath, label: "Node.js runtime")

  let versionResult = try runCommand(nodePath, ["--version"])
  guard versionResult.status == 0 else {
    throw HostFailure("The Node.js runtime bundled with official Codex could not start")
  }
  let nodeVersion = versionResult.standardOutput.trimmingCharacters(in: .whitespacesAndNewlines)
  let majorText = nodeVersion.drop(while: { $0 == "v" }).split(separator: ".").first.map(String.init) ?? ""
  guard let major = Int(majorText), major >= 20 else {
    throw HostFailure("The Node.js runtime bundled with official Codex is too old: \(nodeVersion.isEmpty ? "unknown" : nodeVersion)")
  }
  return OfficialRuntime(bundlePath: bundlePath, executablePath: executablePath, nodePath: nodePath, nodeVersion: nodeVersion)
}

private func processField(pid: Int32, field: String) throws -> String {
  let result = try runCommand("/bin/ps", ["-p", String(pid), "-o", "\(field)="])
  guard result.status == 0 else { return "" }
  return result.standardOutput.trimmingCharacters(in: .whitespacesAndNewlines)
}

private func stopRecordedAgent() throws {
  let receiptURL = try runtimeURL().deletingLastPathComponent()
    .appendingPathComponent("logs", isDirectory: true)
    .appendingPathComponent("macos-launch.json")
  guard FileManager.default.fileExists(atPath: receiptURL.path) else { return }
  let object = try JSONSerialization.jsonObject(with: Data(contentsOf: receiptURL))
  guard let receipt = object as? [String: Any],
        let pidNumber = receipt["agentPid"] as? NSNumber,
        let startedAt = receipt["agentStartedAt"] as? String,
        let nodePath = receipt["agentNodePath"] as? String,
        let runtimePath = receipt["agentRuntimePath"] as? String else {
    throw HostFailure("The recorded Agent identity is incomplete; refusing to signal a process")
  }
  let pid = pidNumber.int32Value
  guard pid > 0 else { return }
  let actualStart = try processField(pid: pid, field: "lstart")
  if actualStart.isEmpty { return }
  let command = try processField(pid: pid, field: "command")
  guard actualStart == startedAt,
        command.hasPrefix("\(nodePath) \(runtimePath) "),
        command.contains(" \(agentModeArgument)") else {
    throw HostFailure("The recorded Agent PID no longer matches its exact runtime identity; refusing to signal it")
  }
  guard kill(pid, SIGTERM) == 0 || errno == ESRCH else {
    throw HostFailure("QuotaPin could not stop its recorded Agent")
  }
  let deadline = Date().addingTimeInterval(5)
  while Date() < deadline {
    if kill(pid, 0) != 0 && errno == ESRCH { return }
    usleep(100_000)
  }
  throw HostFailure("QuotaPin Agent did not exit after SIGTERM; installation was preserved")
}

private func execRuntime(_ runtimeURL: URL, official: OfficialRuntime) throws -> Never {
  setenv("QUOTAPIN_CODEX_APP", official.bundlePath, 1)
  setenv("QUOTAPIN_OFFICIAL_NODE", official.nodePath, 1)
  setenv("QUOTAPIN_RUNTIME_SCRIPT", runtimeURL.path, 1)
  var values = [official.nodePath, runtimeURL.path]
  values.append(contentsOf: CommandLine.arguments.dropFirst())
  var pointers: [UnsafeMutablePointer<CChar>?] = values.map { strdup($0) }
  pointers.append(nil)
  defer { pointers.compactMap { $0 }.forEach { free($0) } }
  let result = official.nodePath.withCString { executable in
    pointers.withUnsafeMutableBufferPointer { buffer in
      execv(executable, buffer.baseAddress)
    }
  }
  throw HostFailure("Could not execute the verified Codex runtime (errno \(result == -1 ? errno : result))")
}

private func main() throws {
  if CommandLine.arguments.contains("--launcher-version")
      || (CommandLine.arguments.contains(agentModeArgument) && CommandLine.arguments.contains("--agent-version")) {
    print(productVersion)
    return
  }
  if CommandLine.arguments.contains("--build-origin") {
    let value: [String: Any] = [
      "schemaVersion": "quotapin-origin/v1",
      "product": "QuotaPin macOS Host",
      "version": productVersion,
      "repository": "https://github.com/WSL043/QuotaPin-for-Codex",
      "commit": buildCommit,
    ]
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8) ?? "{}")
    return
  }
  if CommandLine.arguments.contains("--wrapper-self-test") {
    _ = try verifyRuntimePayload()
    print("{\"ok\":true,\"runtimeVerified\":true,\"downloadsRuntime\":false,\"version\":\"\(productVersion)\"}")
    return
  }
  if CommandLine.arguments.dropFirst().first == "stop-agent" {
    try stopRecordedAgent()
    return
  }
  let runtime = try verifyRuntimePayload()
  let official = try discoverOfficialRuntime()
  if CommandLine.arguments.contains("--runtime-preflight") {
    print("{\"ok\":true,\"bundle\":\"\(official.bundlePath)\",\"nodeVersion\":\"\(official.nodeVersion)\",\"downloadsRuntime\":false}")
    return
  }
  try execRuntime(runtime, official: official)
}

do {
  try main()
} catch {
  standardError((error as? HostFailure)?.description ?? error.localizedDescription)
  exit(1)
}
