// Push the signed + notarized release artifacts to Cloudflare R2 — the blob
// store videorc-web fronts (/download/mac + /api/updates) and electron-updater
// reads. Run AFTER `pnpm dist:release`:
//
//   R2_ENDPOINT="https://<account>.r2.cloudflarestorage.com" \
//   R2_BUCKET=videorc-releases \
//   R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//   pnpm release:upload
//
// We never publish an un-notarized dmg (a download Gatekeeper blocks is worse
// than none), and stamp cache headers so version-stamped binaries are immutable
// while latest-mac.yml is always revalidated.
// See "2026-06-30 - Videorc Desktop Distribution Channel Plan" (Slice 2).

import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AwsClient } from "aws4fetch";

const RELEASE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "release");
const IMMUTABLE = "public, max-age=31536000, immutable";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return value;
}

// Returns the content-type + cache-control for an uploadable artifact, or null
// for anything else in release/ (the unpacked .app, blockmaps we ship, etc.).
function metaFor(name) {
  if (name === "latest-mac.yml") {
    return {
      contentType: "text/yaml; charset=utf-8",
      cacheControl: "no-cache, must-revalidate",
    };
  }
  if (name.endsWith(".dmg")) {
    return { contentType: "application/x-apple-diskimage", cacheControl: IMMUTABLE };
  }
  if (name.endsWith(".zip")) {
    return { contentType: "application/zip", cacheControl: IMMUTABLE };
  }
  if (name.endsWith(".blockmap")) {
    return { contentType: "application/octet-stream", cacheControl: IMMUTABLE };
  }
  return null;
}

async function main() {
  const endpoint = requireEnv("R2_ENDPOINT").replace(/\/+$/, "");
  const bucket = requireEnv("R2_BUCKET");
  const client = new AwsClient({
    accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    region: "auto",
    service: "s3",
  });

  let entries;
  try {
    entries = await readdir(RELEASE_DIR);
  } catch {
    console.error("No release/ directory — run `pnpm dist:release` first.");
    process.exit(1);
  }

  const artifacts = entries.filter((name) => metaFor(name) !== null);
  if (artifacts.length === 0) {
    console.error("No artifacts (*.dmg, *.zip, *.blockmap, latest-mac.yml) in release/.");
    process.exit(1);
  }

  for (const name of artifacts) {
    if (name.endsWith(".dmg")) {
      try {
        execFileSync("xcrun", ["stapler", "validate", join(RELEASE_DIR, name)], {
          stdio: "pipe",
        });
      } catch {
        console.error(`Refusing to upload — ${name} is not notarized/stapled.`);
        process.exit(1);
      }
    }
  }

  for (const name of artifacts) {
    const body = await readFile(join(RELEASE_DIR, name));
    const { contentType, cacheControl } = metaFor(name);
    process.stdout.write(`↑ ${name} (${(body.length / 1e6).toFixed(1)} MB) … `);
    const response = await client.fetch(`${endpoint}/${bucket}/${name}`, {
      method: "PUT",
      body,
      headers: { "content-type": contentType, "cache-control": cacheControl },
    });
    if (!response.ok) {
      console.error(`\nFailed (${response.status}): ${await response.text()}`);
      process.exit(1);
    }
    console.log("ok");
  }

  console.log(
    `\nUploaded ${artifacts.length} artifact(s) to ${bucket}. /download/mac + /api/updates are live.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
