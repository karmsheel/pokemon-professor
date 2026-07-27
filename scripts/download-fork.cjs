#!/usr/bin/env node
/**
 * Download the prebuilt headless mGBA fork executable from the GitHub fork's
 * "fork-build" release (produced by .github/workflows/build-fork.yml).
 *
 * Usage: node scripts/download-fork.cjs [destDir]
 *   destDir defaults to vendor/mgba/build
 *
 * Requires the `gh` CLI authenticated (gh auth login) and network access.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const FORK = "karmsheel/mgba";
const RELEASE = "fork-build";
const ASSET = "mGBA.exe";

function gh(...args) {
  return execFileSync("gh", args, { encoding: "utf8" }).trim();
}

function main() {
  const destDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, "..", "vendor", "mgba", "build");
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, ASSET);

  console.log(`[download-fork] resolving latest '${RELEASE}' release on ${FORK}...`);
  // gh returns release tag; error if missing.
  const tag = gh("release", "view", RELEASE, "--repo", FORK, "--json", "tagName", "-q", ".tagName");
  console.log(`[download-fork] release ${tag} -> downloading ${ASSET}`);
  execFileSync(
    "gh",
    ["release", "download", RELEASE, "--repo", FORK, "--pattern", ASSET, "--dir", destDir, "--clobber"],
    { stdio: "inherit" }
  );

  if (!fs.existsSync(dest)) {
    console.error(`[download-fork] ERROR: ${ASSET} not found after download`);
    process.exit(1);
  }
  console.log(`[download-fork] OK -> ${dest} (${fs.statSync(dest).size} bytes)`);
}

try {
  main();
} catch (e) {
  console.error(`[download-fork] FAILED: ${e.message || e}`);
  console.error("Ensure a 'fork-build' release exists (run CI) and `gh` is authenticated.");
  process.exit(1);
}
