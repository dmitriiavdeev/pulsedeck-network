import { packager } from "@electron/packager";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { prepare, root, run } from "./prepare.mjs";
import { buildUpdate } from "./build-update.mjs";
await prepare();
const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const gitSha =
  process.env.PULSEDECK_GIT_SHA || run("git", ["rev-parse", "HEAD"]);
if (!/^[a-f0-9]{40}$/.test(gitSha)) throw Error("A full Git SHA is required.");
if (!process.env.PULSEDECK_GIT_SHA && run("git", ["status", "--porcelain"]))
  throw Error("Commit source changes before building a release.");
const build = join(root, "build"),
  release = join(root, "release");
await mkdir(release, { recursive: true });
const sourceHashes = {};
async function hashTree(directory, prefix, output, omit = []) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (omit.includes(item.name)) continue;
    const relative = prefix + item.name,
      full = join(directory, item.name);
    if (item.isDirectory()) await hashTree(full, relative + "/", output, omit);
    else
      output[relative] = createHash("sha256")
        .update(await readFile(full))
        .digest("hex");
  }
}
await hashTree(root, "", sourceHashes, [
  "node_modules",
  ".git",
  "build",
  "release",
  "test-results",
]);
const [appDir] = await packager({
  dir: join(root, "app"),
  out: join(build, "packages", Date.now().toString()),
  name: "PulseDeck",
  executableName: "PulseDeck",
  platform: "win32",
  arch: "x64",
  electronVersion: "44.9.1",
  asar: { unpack: "**/native/*.exe" },
  prune: true,
  icon: join(root, "app/assets/icon.ico"),
  appVersion: metadata.version,
  buildVersion: metadata.version,
  win32metadata: {
    CompanyName: "dmitriiavdeev",
    FileDescription: "PulseDeck Network Tools",
    ProductName: "PulseDeck",
    InternalName: "PulseDeck",
    "requested-execution-level": "asInvoker",
  },
});
const framework = join(
  process.env.WINDIR,
  "Microsoft.NET/Framework64/v4.0.30319",
);
const references = [
  "System.dll",
  "System.Core.dll",
  "System.Xaml.dll",
  "System.Web.Extensions.dll",
  "System.IO.Compression.dll",
  "System.IO.Compression.FileSystem.dll",
  "WPF/PresentationCore.dll",
  "WPF/PresentationFramework.dll",
  "WPF/WindowsBase.dll",
];
let source = await readFile(join(root, "installer/Installer.cs"), "utf8");
source = source
  .replace(
    /AssemblyVersion\("[^"]+"\)/,
    `AssemblyVersion("${metadata.version}.0")`,
  )
  .replace(
    /AssemblyFileVersion\("[^"]+"\)/,
    `AssemblyFileVersion("${metadata.version}.0")`,
  )
  .replace(
    /static string Version = "[^"]+";/,
    `static string Version = "${metadata.version}";`,
  );
await writeFile(join(build, "Installer.generated.cs"), source);
function compile(file, removing) {
  run(join(framework, "csc.exe"), [
    "/nologo",
    "/target:winexe",
    "/platform:x64",
    "/optimize+",
    "/codepage:65001",
    "/out:" + file,
    "/win32icon:" + join(root, "app/assets/icon.ico"),
    "/win32manifest:" + join(root, "installer/app.manifest"),
    ...references.map((f) => "/reference:" + join(framework, f)),
    "/resource:" + join(root, "installer/Installer.xaml") + ",installer.xaml",
    "/resource:" +
      join(root, "installer/translations.json") +
      ",translations.json",
    "/resource:" + join(root, "app/assets/icon.png") + ",icon.png",
    ...(removing
      ? ["/define:UNINSTALL"]
      : [
          "/resource:" + join(build, "payload.zip") + ",payload.zip",
          "/resource:" + join(build, "payload.json") + ",payload.json",
        ]),
    join(build, "Installer.generated.cs"),
  ]);
}
compile(join(appDir, "Uninstall.exe"), true);
const payloadHashes = {};
await hashTree(appDir, "", payloadHashes);
const updatePackage = await buildUpdate(
  appDir,
  release,
  metadata.version,
  gitSha,
  payloadHashes,
);
await writeFile(join(build, "payload.json"), JSON.stringify(payloadHashes));
const psQuote = (value) => "'" + value.replaceAll("'", "''") + "'";
run("powershell.exe", [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  `$ErrorActionPreference='Stop'\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n$payload=${psQuote(join(build, "payload.zip"))}\nif(Test-Path -LiteralPath $payload){Remove-Item -LiteralPath $payload}\n[IO.Compression.ZipFile]::CreateFromDirectory(${psQuote(appDir)},$payload,[IO.Compression.CompressionLevel]::Optimal,$false)`,
]);
const installer = join(release, `PulseDeck-Setup-${metadata.version}-x64.exe`);
compile(installer, false);
const bytes = await readFile(installer),
  sha256 = createHash("sha256").update(bytes).digest("hex");
const manifest = {
  product: "PulseDeck",
  version: metadata.version,
  gitSha,
  sourceArchiveSha256: process.env.PULSEDECK_ARCHIVE_SHA256 || null,
  sourceHashes,
  payloadHashes,
  updatePackage,
  installer: {
    name: installer.split(/[\\/]/).at(-1),
    bytes: bytes.length,
    sha256,
  },
  platform: "win32-x64",
  builtAt: new Date().toISOString(),
};
await writeFile(
  join(release, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
  join(release, "SHA256SUMS.txt"),
  `${sha256}  ${manifest.installer.name}\n`,
);
await writeFile(
  join(build, "packaged.json"),
  JSON.stringify({ appDir, installer }, null, 2),
);
console.log(
  JSON.stringify(
    {
      installer,
      megabytes: Math.round(bytes.length / 1048576),
      sha256,
      gitSha,
    },
    null,
    2,
  ),
);
