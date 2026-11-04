import { readFile, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  CHUNK_SIZE,
  digest,
  validateManifest,
} = require("../app/update-core.cjs");
export async function buildUpdate(
  directory,
  output,
  version,
  gitSha,
  payloadHashes,
) {
  const name = `PulseDeck-update-${version}-x64`;
  const pack = await open(join(output, name + ".pdu"), "w");
  const manifest = {
    schema: 1,
    version,
    platform: "win32-x64",
    gitSha,
    chunkSize: CHUNK_SIZE,
    pack: { size: 0, sha256: "" },
    chunks: {},
    files: [],
  };
  const packHash = createHash("sha256");
  try {
    for (const path of Object.keys(payloadHashes).sort()) {
      const content = await readFile(join(directory, path));
      const chunks = [];
      for (let offset = 0; offset < content.length; offset += CHUNK_SIZE) {
        const raw = content.subarray(offset, offset + CHUNK_SIZE),
          hash = digest(raw);
        chunks.push(hash);
        if (manifest.chunks[hash]) continue;
        const packed = gzipSync(raw, { level: 9 });
        manifest.chunks[hash] = {
          offset: manifest.pack.size,
          size: packed.length,
          rawSize: raw.length,
        };
        await pack.writeFile(packed);
        packHash.update(packed);
        manifest.pack.size += packed.length;
      }
      manifest.files.push({
        path,
        size: content.length,
        sha256: digest(content),
        chunks,
      });
    }
  } finally {
    await pack.close();
  }
  manifest.pack.sha256 = packHash.digest("hex");
  validateManifest(manifest, version);
  await writeFile(
    join(output, name + ".json"),
    JSON.stringify(manifest) + "\n",
  );
  return {
    manifest: name + ".json",
    pack: name + ".pdu",
    bytes: manifest.pack.size,
  };
}
