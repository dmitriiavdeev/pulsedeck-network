import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  copyFile,
  open,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildUpdate } from "../scripts/build-update.mjs";
const require = createRequire(import.meta.url);
const {
  CHUNK_SIZE,
  digest,
  validateManifest,
  newerVersion,
  planUpdate,
  stageUpdate,
} = require("../app/update-core.cjs");
const root = resolve("test-results");
test("updater checks the release, stages only changed chunks and rejects foreign asset URLs", async () => {
  const f = await fixture();
  const network = require("../app/update-network.cjs");
  const original = network.request;
  const base =
    "https://github.com/dmitriiavdeev/pulsedeck-network/releases/download/v1.2.0/PulseDeck-update-1.2.0-x64";
  const raw = Buffer.from(JSON.stringify(f.manifest));
  const release = {
    tag_name: "v1.2.0",
    draft: false,
    prerelease: false,
    assets: [
      {
        name: "PulseDeck-update-1.2.0-x64.json",
        browser_download_url: base + ".json",
        digest: "sha256:" + digest(raw),
      },
      {
        name: "PulseDeck-update-1.2.0-x64.pdu",
        browser_download_url: base + ".pdu",
        size: f.packed.length,
        digest: "sha256:" + digest(f.packed),
      },
    ],
  };
  let downloaded = 0;
  network.request = async (url, options) => {
    if (
      url ===
      "https://api.github.com/repos/dmitriiavdeev/pulsedeck-network/releases/latest"
    )
      return Buffer.from(JSON.stringify(release));
    if (url === base + ".json") return raw;
    assert.equal(url, base + ".pdu");
    assert.ok(options.range);
    const { start, end } = options.range;
    downloaded += end - start + 1;
    return f.packed.subarray(start, end + 1);
  };
  delete require.cache[require.resolve("../app/updater.cjs")];
  try {
    const { Updater } = require("../app/updater.cjs");
    const updater = new Updater({
      version: "1.1.0",
      directory: f.old,
      profile: join(f.directory, "profile"),
      helper: resolve("app/native/UpdateHelper.exe"),
      enabled: true,
      notify() {},
    });
    assert.equal((await updater.check()).status, "available");
    assert.equal((await updater.download()).status, "ready");
    assert.equal(downloaded, updater.state.downloadBytes);
    assert.ok(downloaded < f.packed.length);
    release.assets[0].browser_download_url = "https://example.com/foreign.json";
    assert.equal((await updater.check()).status, "error");
    assert.equal(updater.state.error, "updateNotAvailable");
  } finally {
    network.request = original;
    delete require.cache[require.resolve("../app/updater.cjs")];
  }
});
async function fixture() {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "update-"));
  const old = join(directory, "installed"),
    next = join(directory, "new"),
    release = join(directory, "release");
  for (const dir of [old, next, release])
    await mkdir(join(dir, "resources"), { recursive: true });
  const exe = Buffer.concat([
    randomBytes(CHUNK_SIZE),
    randomBytes(CHUNK_SIZE),
    randomBytes(512),
  ]);
  const updated = Buffer.from(exe);
  updated[CHUNK_SIZE + 10] ^= 255;
  const files = {
    "PulseDeck.exe": updated,
    "resources/app.asar": Buffer.from("new application source"),
    "resources/unchanged.txt": Buffer.from("stable"),
  };
  await writeFile(join(old, "PulseDeck.exe"), exe);
  await writeFile(join(old, "resources/app.asar"), "old application source");
  await writeFile(join(old, "resources/unchanged.txt"), "stable");
  await writeFile(join(old, "personal.json"), "must be preserved");
  for (const [file, content] of Object.entries(files))
    await writeFile(join(next, file), content);
  await buildUpdate(
    next,
    release,
    "1.2.0",
    "a".repeat(40),
    Object.fromEntries(
      Object.entries(files).map(([file, bytes]) => [file, digest(bytes)]),
    ),
  );
  const manifest = JSON.parse(
    await readFile(join(release, "PulseDeck-update-1.2.0-x64.json"), "utf8"),
  );
  const packed = await readFile(
    join(release, "PulseDeck-update-1.2.0-x64.pdu"),
  );
  return { directory, old, next, release, manifest, packed, files };
}
test("incremental updates download only missing chunks and reconstruct exact files", async () => {
  const f = await fixture();
  const plan = await planUpdate(f.manifest, f.old);
  assert.equal(plan.required.size, 2);
  assert.ok(plan.downloadBytes < f.packed.length * 0.6);
  let bytes = 0;
  const changed = await stageUpdate(
    plan,
    join(f.directory, "stage"),
    async (offset, size) => {
      bytes += size;
      return f.packed.subarray(offset, offset + size);
    },
  );
  assert.equal(bytes, plan.downloadBytes);
  assert.deepEqual(changed.map((f) => f.path).sort(), [
    "PulseDeck.exe",
    "resources/app.asar",
  ]);
  for (const file of changed)
    assert.deepEqual(
      await readFile(join(f.directory, "stage/files", file.path)),
      f.files[file.path],
    );
  assert.equal(
    await readFile(join(f.old, "personal.json"), "utf8"),
    "must be preserved",
  );
  assert.equal((await planUpdate(f.manifest, f.next)).downloadBytes, 0);
});
test("corrupt downloads and changed reusable local chunks stop staging", async () => {
  const f = await fixture();
  const plan = await planUpdate(f.manifest, f.old);
  await assert.rejects(
    stageUpdate(plan, join(f.directory, "bad-download"), async (_, size) =>
      Buffer.alloc(size),
    ),
    /updateIntegrity/,
  );
  const handle = await open(join(f.old, "PulseDeck.exe"), "r+");
  await handle.write(Buffer.from([0, 0, 0, 0]), 0, 4, 0);
  await handle.close();
  await assert.rejects(
    stageUpdate(plan, join(f.directory, "bad-local"), async (offset, size) =>
      f.packed.subarray(offset, offset + size),
    ),
    /updateLocalChanged/,
  );
});
test("update manifests reject traversal, Windows special paths, duplicate files and oversized chunks", async () => {
  const f = await fixture();
  for (const path of [
    "../secret",
    "C:/outside",
    "resources/a:stream",
    "resources/CON.txt",
    "resources/a.",
    "/absolute",
    "resources\\outside",
  ]) {
    const bad = structuredClone(f.manifest);
    bad.files[0].path = path;
    assert.throws(() => validateManifest(bad, "1.2.0"), /updateInvalid/);
  }
  const duplicate = structuredClone(f.manifest);
  duplicate.files.push({
    ...duplicate.files[0],
    path: duplicate.files[0].path.toUpperCase(),
  });
  assert.throws(() => validateManifest(duplicate, "1.2.0"), /updateInvalid/);
  const bomb = structuredClone(f.manifest);
  Object.values(bomb.chunks)[0].rawSize = CHUNK_SIZE + 1;
  assert.throws(() => validateManifest(bomb, "1.2.0"), /updateInvalid/);
  assert.equal(newerVersion("1.10.0", "1.9.0"), true);
  assert.equal(newerVersion("1.1.0", "1.1.0"), false);
  assert.equal(newerVersion("1.0.0", "1.1.0"), false);
  assert.equal(newerVersion("latest", "1.1.0"), false);
});
async function runHelper(stage, plan) {
  await copyFile(
    resolve("app/native/UpdateHelper.exe"),
    join(stage, "UpdateHelper.exe"),
  );
  await writeFile(
    join(stage, "plan.json"),
    JSON.stringify({
      processId: 0,
      restart: false,
      quiet: true,
      language: "en",
      version: "1.2.0",
      ...plan,
    }),
  );
  await promisify(execFile)(join(stage, "UpdateHelper.exe"), [], {
    windowsHide: true,
    timeout: 15000,
  });
  return JSON.parse(await readFile(join(stage, "../result.json"), "utf8"));
}
test(
  "Windows updater applies staged changes and preserves unrelated data",
  { skip: process.platform !== "win32" },
  async () => {
    const f = await fixture(),
      stage = join(f.directory, "stage");
    const plan = await planUpdate(f.manifest, f.old);
    const files = await stageUpdate(plan, stage, async (offset, size) =>
      f.packed.subarray(offset, offset + size),
    );
    assert.equal(
      (await runHelper(stage, { directory: f.old, files })).status,
      "applied",
    );
    for (const [file, content] of Object.entries(f.files))
      assert.deepEqual(await readFile(join(f.old, file)), content);
    assert.equal(
      await readFile(join(f.old, "personal.json"), "utf8"),
      "must be preserved",
    );
  },
);
test(
  "Windows updater rolls back replaced files if a later replacement fails",
  { skip: process.platform !== "win32" },
  async () => {
    const f = await fixture(),
      stage = join(f.directory, "stage");
    const originalExe = await readFile(join(f.old, "PulseDeck.exe"));
    const plan = await planUpdate(f.manifest, f.old);
    const files = await stageUpdate(plan, stage, async (offset, size) =>
      f.packed.subarray(offset, offset + size),
    );
    await mkdir(join(f.old, "blocked"));
    await writeFile(
      join(stage, "files/blocked"),
      "file replacing a directory must fail",
    );
    files.push({
      path: "blocked",
      size: 36,
      sha256: digest(await readFile(join(stage, "files/blocked"))),
    });
    files.at(-1).size = (await readFile(join(stage, "files/blocked"))).length;
    assert.equal(
      (await runHelper(stage, { directory: f.old, files })).status,
      "rolledBack",
    );
    assert.deepEqual(await readFile(join(f.old, "PulseDeck.exe")), originalExe);
    assert.equal(
      await readFile(join(f.old, "resources/app.asar"), "utf8"),
      "old application source",
    );
  },
);
