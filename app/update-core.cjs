const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { gunzipSync } = require("node:zlib");
const CHUNK_SIZE = 1024 * 1024;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashPattern = /^[a-f0-9]{64}$/;
function validVersion(value) {
  return (
    typeof value === "string" &&
    /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value)
  );
}
function newerVersion(candidate, current) {
  if (!validVersion(candidate) || !validVersion(current)) return false;
  const a = candidate.split(".").map(Number),
    b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function safeRelative(value) {
  return (
    typeof value === "string" &&
    value.length < 220 &&
    value
      .split("/")
      .every(
        (part) =>
          /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(part) &&
          !part.endsWith(".") &&
          !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
      )
  );
}
function validateManifest(m, version) {
  const invalid = () => {
    throw Error("updateInvalid");
  };
  if (
    !m ||
    m.schema !== 1 ||
    m.version !== version ||
    !validVersion(version) ||
    m.platform !== "win32-x64" ||
    !/^[a-f0-9]{40}$/.test(m.gitSha) ||
    m.chunkSize !== CHUNK_SIZE ||
    !m.pack ||
    !Number.isSafeInteger(m.pack.size) ||
    m.pack.size < 1 ||
    m.pack.size > 2 ** 31 ||
    !hashPattern.test(m.pack.sha256) ||
    !m.chunks ||
    Array.isArray(m.chunks) ||
    !Array.isArray(m.files) ||
    !m.files.length ||
    m.files.length > 512
  )
    invalid();
  const chunks = Object.entries(m.chunks);
  if (!chunks.length || chunks.length > 4096) invalid();
  for (const [hash, c] of chunks) {
    if (
      !hashPattern.test(hash) ||
      !c ||
      !Number.isSafeInteger(c.offset) ||
      c.offset < 0 ||
      !Number.isSafeInteger(c.size) ||
      c.size < 1 ||
      c.size > CHUNK_SIZE + 65536 ||
      c.offset + c.size > m.pack.size ||
      !Number.isSafeInteger(c.rawSize) ||
      c.rawSize < 1 ||
      c.rawSize > CHUNK_SIZE
    )
      invalid();
  }
  const names = new Set();
  let total = 0;
  for (const f of m.files) {
    if (
      !f ||
      !safeRelative(f.path) ||
      names.has(f.path.toLowerCase()) ||
      !hashPattern.test(f.sha256) ||
      !Number.isSafeInteger(f.size) ||
      f.size < 0 ||
      f.size > 2 ** 31 ||
      !Array.isArray(f.chunks) ||
      f.chunks.length !== Math.ceil(f.size / CHUNK_SIZE)
    )
      invalid();
    names.add(f.path.toLowerCase());
    total += f.size;
    f.chunks.forEach((hash, index) => {
      const c = m.chunks[hash];
      if (
        !hashPattern.test(hash) ||
        !c ||
        c.rawSize !== Math.min(CHUNK_SIZE, f.size - index * CHUNK_SIZE)
      )
        invalid();
    });
  }
  if (
    total > 2 ** 31 ||
    !names.has("pulsedeck.exe") ||
    !names.has("resources/app.asar")
  )
    invalid();
  for (const name of names) {
    const parts = name.split("/");
    parts.pop();
    while (parts.length) {
      if (names.has(parts.join("/"))) invalid();
      parts.pop();
    }
  }
  return m;
}
async function safeFile(root, relative) {
  if (!safeRelative(relative)) throw Error("updateInvalid");
  let current = path.resolve(root);
  const rootStat = await fs.lstat(current);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw Error("updateUnsafePath");
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw Error("updateUnsafePath");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return current;
}
async function planUpdate(manifest, directory) {
  const sources = new Map(),
    files = [];
  for (const target of manifest.files) {
    const localPath = await safeFile(directory, target.path);
    let handle,
      actualHash = null;
    try {
      handle = await fs.open(localPath, "r");
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 2 ** 31)
        throw Error("updateUnsafePath");
      const fullHash = createHash("sha256");
      for (let offset = 0; offset < stat.size; offset += CHUNK_SIZE) {
        const buffer = Buffer.alloc(Math.min(CHUNK_SIZE, stat.size - offset));
        const { bytesRead } = await handle.read(
          buffer,
          0,
          buffer.length,
          offset,
        );
        if (bytesRead !== buffer.length) throw Error("updateLocalChanged");
        fullHash.update(buffer);
        const hash = digest(buffer);
        if (manifest.chunks[hash])
          sources.set(hash, { localPath, offset, size: bytesRead });
      }
      actualHash = fullHash.digest("hex");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    } finally {
      await handle?.close();
    }
    files.push({ ...target, changed: actualHash !== target.sha256 });
  }
  const required = new Map();
  for (const file of files.filter((f) => f.changed))
    for (const hash of file.chunks)
      if (!sources.has(hash)) required.set(hash, manifest.chunks[hash]);
  return {
    manifest,
    files,
    sources,
    required,
    downloadBytes: [...required.values()].reduce((sum, c) => sum + c.size, 0),
  };
}
async function stageUpdate(plan, stageRoot, download, progress = () => {}) {
  const chunkDirectory = path.join(stageRoot, "chunks"),
    filesDirectory = path.join(stageRoot, "files");
  await fs.mkdir(chunkDirectory, { recursive: true });
  await fs.mkdir(filesDirectory, { recursive: true });
  let downloaded = 0;
  for (const [hash, chunk] of plan.required) {
    const packed = await download(
      chunk.offset,
      chunk.size,
      plan.manifest.pack.size,
    );
    if (packed.length !== chunk.size) throw Error("updateIntegrity");
    let raw;
    try {
      raw = gunzipSync(packed, { maxOutputLength: chunk.rawSize });
    } catch {
      throw Error("updateIntegrity");
    }
    if (raw.length !== chunk.rawSize || digest(raw) !== hash)
      throw Error("updateIntegrity");
    await fs.writeFile(path.join(chunkDirectory, hash), raw, { flag: "wx" });
    downloaded += packed.length;
    progress(downloaded, plan.downloadBytes);
  }
  const changed = plan.files.filter((file) => file.changed);
  for (const file of changed) {
    const destination = await safeFile(filesDirectory, file.path);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const output = await fs.open(destination, "wx");
    const fullHash = createHash("sha256");
    try {
      for (const hash of file.chunks) {
        const source = plan.sources.get(hash);
        let bytes;
        if (source) {
          const input = await fs.open(source.localPath, "r");
          try {
            bytes = Buffer.alloc(source.size);
            const read = await input.read(
              bytes,
              0,
              bytes.length,
              source.offset,
            );
            if (read.bytesRead !== bytes.length)
              throw Error("updateLocalChanged");
          } finally {
            await input.close();
          }
        } else bytes = await fs.readFile(path.join(chunkDirectory, hash));
        if (digest(bytes) !== hash) throw Error("updateLocalChanged");
        fullHash.update(bytes);
        await output.writeFile(bytes);
      }
    } finally {
      await output.close();
    }
    if (fullHash.digest("hex") !== file.sha256) throw Error("updateIntegrity");
  }
  return changed.map(({ path, sha256, size }) => ({ path, sha256, size }));
}
module.exports = {
  CHUNK_SIZE,
  digest,
  newerVersion,
  safeRelative,
  validateManifest,
  safeFile,
  planUpdate,
  stageUpdate,
};
