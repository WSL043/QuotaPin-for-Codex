import fs from "node:fs";

const [filePath, commit] = process.argv.slice(2);
if (!filePath || !/^[0-9a-f]{40}$/.test(commit ?? "")) {
  throw new Error("Usage: node scripts/stamp-build-origin.mjs <bundle> <40-char-commit>");
}
const token = "__QUOTAPIN_BUILD_COMMIT__";
const source = fs.readFileSync(filePath, "utf8");
const count = source.split(token).length - 1;
if (count !== 1) throw new Error(`Expected exactly one build commit token; found ${count}`);
fs.writeFileSync(filePath, source.replace(token, commit), "utf8");
