import { Resvg } from "@resvg/resvg-js";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
export const root = fileURLToPath(new URL("..", import.meta.url));
export function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0)
    throw Error(result.stdout + result.stderr + (result.error || ""));
  return result.stdout.trim();
}
export async function prepare() {
  const assets = join(root, "app/assets");
  await mkdir(join(assets, "sounds"), { recursive: true });
  await mkdir(join(root, "build"), { recursive: true });
  const svg = await readFile(join(assets, "icon.svg"));
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const images = sizes.map((size) =>
    new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng(),
  );
  let offset = 6 + 16 * sizes.length;
  const header = Buffer.alloc(offset);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  images.forEach((image, i) => {
    const p = 6 + 16 * i;
    header[p] = header[p + 1] = sizes[i] === 256 ? 0 : sizes[i];
    header.writeUInt16LE(1, p + 4);
    header.writeUInt16LE(32, p + 6);
    header.writeUInt32LE(image.length, p + 8);
    header.writeUInt32LE(offset, p + 12);
    offset += image.length;
  });
  await writeFile(join(assets, "icon.ico"), Buffer.concat([header, ...images]));
  await writeFile(
    join(assets, "icon.png"),
    new Resvg(svg, { fitTo: { mode: "width", value: 512 } }).render().asPng(),
  );
  await copyFile(join(root, "LICENSE"), join(root, "app/LICENSE"));
  const scores = [
    [72, 76, 79, 84],
    [84, 79, 88, 84],
    [69, 76, 81, 83, 88],
    [67, 74, 79, 74, 86],
    [79, 79, 86, 86],
    [60, 64, 67, 72, 76],
    [88, 84, 79, 76, 72],
    [72, 79, 76, 84, 91],
    [65, 72, 77, 81],
    [81, 88, 85, 93],
    [67, 72, 76, 67, 72, 79],
    [84, 72, 84, 72, 91],
    [76, 83, 88, 79, 86, 91],
    [72, 74, 76, 79, 76, 84],
    [83, 78, 85, 90],
    [76, 79, 84, 84],
    [81, 81, 77, 81, 84],
    [60, 67, 72, 76, 79, 84],
    [69, 73, 76, 81, 85],
    [72, 76, 79, 84, 79, 88, 84],
  ];
  for (let k = 0; k < scores.length; k++) {
    const sampleRate = 44100,
      spacing = 0.18 + (k % 4) * 0.035,
      tail = 0.7;
    const samples = new Float64Array(
      Math.ceil((scores[k].length * spacing + tail) * sampleRate),
    );
    for (let n = 0; n < scores[k].length; n++) {
      const frequency = 440 * 2 ** ((scores[k][n] - 69) / 12),
        start = Math.round(n * spacing * sampleRate),
        duration = 0.55 + (k % 3) * 0.12;
      for (
        let i = 0;
        i < Math.min(duration * sampleRate, samples.length - start);
        i++
      ) {
        const time = i / sampleRate,
          envelope =
            Math.min(1, time / 0.012) *
            Math.exp(-time * (6 + (k % 3))) *
            Math.min(1, (duration - time) / 0.05);
        const overtone =
          k % 4 === 0
            ? 0.18 * Math.sin(2 * Math.PI * frequency * 2 * time)
            : k % 4 === 1
              ? 0.24 * Math.sin(2 * Math.PI * frequency * 3 * time)
              : k % 4 === 2
                ? 0.14 * Math.sin(2 * Math.PI * frequency * 1.005 * time)
                : 0.2 * Math.sin(2 * Math.PI * frequency * 4 * time);
        samples[start + i] +=
          (Math.sin(2 * Math.PI * frequency * time) + overtone) * envelope;
      }
    }
    const peak = samples.reduce((p, value) => Math.max(p, Math.abs(value)), 0);
    const data = Buffer.alloc(samples.length * 2);
    samples.forEach((value, i) =>
      data.writeInt16LE(Math.round((value / peak) * 28000), i * 2),
    );
    const wav = Buffer.alloc(44);
    wav.write("RIFF");
    wav.writeUInt32LE(36 + data.length, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(data.length, 40);
    await writeFile(
      join(assets, "sounds", String(k + 1).padStart(2, "0") + ".wav"),
      Buffer.concat([wav, data]),
    );
  }
  const framework = join(
    process.env.WINDIR || "C:/Windows",
    "Microsoft.NET/Framework64/v4.0.30319",
  );
  run(join(framework, "csc.exe"), [
    "/nologo",
    "/target:exe",
    "/platform:anycpu",
    "/optimize+",
    "/codepage:65001",
    "/out:" + resolve(root, "app/native/PingProbe.exe"),
    "/reference:" + join(framework, "System.Web.Extensions.dll"),
    join(root, "app/native/PingProbe.cs"),
  ]);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await prepare();
  console.log("Icons, 20 alert sounds and ICMP helper are ready.");
}
