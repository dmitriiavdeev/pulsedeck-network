import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { root, run, prepare } from "./prepare.mjs";
await prepare();
await mkdir(join(root, "docs/screenshots"), { recursive: true });
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
const file = join(root, "build/Installer-preview.exe");
run(join(framework, "csc.exe"), [
  "/nologo",
  "/target:winexe",
  "/platform:x64",
  "/codepage:65001",
  "/out:" + file,
  "/win32manifest:" + join(root, "installer/app.manifest"),
  ...references.map((f) => "/reference:" + join(framework, f)),
  "/resource:" + join(root, "installer/Installer.xaml") + ",installer.xaml",
  "/resource:" +
    join(root, "installer/translations.json") +
    ",translations.json",
  "/resource:" + join(root, "app/assets/icon.png") + ",icon.png",
  join(root, "installer/Installer.cs"),
]);
for (const language of ["en", "ru"])
  run(file, [
    "--preview-" + language,
    join(root, "docs/screenshots/installer-" + language + ".png"),
  ]);
console.log("Installer previews captured in both languages.");
