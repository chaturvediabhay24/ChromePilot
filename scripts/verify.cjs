const fs = require("node:fs");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const worker = fs.readFileSync("service-worker.js", "utf8");
assert(!manifest.permissions.includes("cookies"));
assert(!manifest.content_scripts, "Page injection should be task-triggered");
assert(!/saveConversationToBackend|conversations\/save|35\.169\.105\.90|new Function\(/.test(worker));
assert(worker.includes('get("aiDataConsent")'));
for (const name of ["evaluate", "get_cookies", "set_cookie", "get_localstorage", "set_localstorage"]) {
  assert(!worker.includes('name: "' + name + '"'));
  assert(!worker.includes('case "' + name + '"'));
}
for (const path of Object.values(manifest.icons)) assert(fs.existsSync(path));
for (const path of ["service-worker.js", "content-script.js", "sidepanel/app.js", "lib/copilot-client.js", "lib/bedrock-client.js", "lib/marked.min.js"]) {
  execFileSync(process.execPath, ["--check", path]);
}
assert(fs.existsSync("privacy.html"));
console.log("Release static checks passed; authenticated browser testing is still required.");
