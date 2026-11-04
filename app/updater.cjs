const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { request, REPOSITORY } = require("./update-network.cjs");
const {
  digest,
  newerVersion,
  validateManifest,
  planUpdate,
  stageUpdate,
} = require("./update-core.cjs");
class Updater {
  constructor({ version, directory, profile, helper, enabled, notify }) {
    Object.assign(this, {
      version,
      directory,
      profile,
      helper,
      enabled,
      notify,
    });
    this.state = { status: enabled ? "idle" : "development" };
  }
  set(value) {
    this.state = { ...this.state, ...value };
    this.notify();
  }
  async restoreResult() {
    const file = path.join(this.profile, "updates/result.json");
    try {
      const result = JSON.parse(await fs.readFile(file, "utf8"));
      if (result.status === "rolledBack" || result.status === "failed")
        this.set({
          status: "error",
          error:
            result.status === "rolledBack"
              ? "updateRolledBack"
              : "updateInstallFailed",
        });
      else if (result.status === "applied" && result.version === this.version)
        this.set({ status: "installed" });
      await fs.unlink(file);
    } catch {}
  }
  async check() {
    if (
      !this.enabled ||
      ["checking", "downloading", "applying"].includes(this.state.status)
    )
      return this.state;
    this.set({ status: "checking", error: "", downloaded: 0 });
    try {
      const release = JSON.parse(
        (
          await request(
            `https://api.github.com/repos/${REPOSITORY}/releases/latest`,
          )
        ).toString("utf8"),
      );
      const version = String(release.tag_name || "").replace(/^v/, "");
      if (!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(version))
        throw Error("updateInvalid");
      if (release.draft || release.prerelease) throw Error("updateInvalid");
      if (!newerVersion(version, this.version)) {
        this.set({ status: "latest" });
        return this.state;
      }
      const base = `PulseDeck-update-${version}-x64`;
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const index = assets.find((a) => a.name === base + ".json"),
        pack = assets.find((a) => a.name === base + ".pdu");
      const prefix = `https://github.com/${REPOSITORY}/releases/download/v${version}/`;
      if (
        !index ||
        !pack ||
        index.browser_download_url !== prefix + base + ".json" ||
        pack.browser_download_url !== prefix + base + ".pdu"
      )
        throw Error("updateNotAvailable");
      const raw = await request(index.browser_download_url);
      if (index.digest && index.digest !== "sha256:" + digest(raw))
        throw Error("updateIntegrity");
      const manifest = validateManifest(
        JSON.parse(raw.toString("utf8")),
        version,
      );
      if (
        manifest.pack.size !== pack.size ||
        (pack.digest && pack.digest !== "sha256:" + manifest.pack.sha256)
      )
        throw Error("updateInvalid");
      this.plan = await planUpdate(manifest, this.directory);
      this.packUrl = pack.browser_download_url;
      this.set({
        status: "available",
        version,
        downloadBytes: this.plan.downloadBytes,
      });
    } catch (error) {
      this.set({
        status: "error",
        error: /^update[A-Z]/.test(error.message)
          ? error.message
          : "updateNetwork",
      });
    }
    return this.state;
  }
  async download() {
    if (!this.enabled || this.state.status !== "available" || !this.plan)
      return this.state;
    this.set({ status: "downloading", downloaded: 0, error: "" });
    try {
      this.stage = path.join(this.profile, "updates", randomUUID());
      const files = await stageUpdate(
        this.plan,
        this.stage,
        (offset, size, total) =>
          request(this.packUrl, {
            range: { start: offset, end: offset + size - 1, total },
            maxBytes: size,
          }),
        (downloaded) => this.set({ downloaded }),
      );
      this.installPlan = {
        directory: this.directory,
        files,
        version: this.plan.manifest.version,
        processId: process.pid,
        restart: true,
        language: "en",
        quiet: false,
      };
      await fs.copyFile(this.helper, path.join(this.stage, "UpdateHelper.exe"));
      this.set({ status: "ready" });
    } catch (error) {
      this.set({
        status: "error",
        error: /^update[A-Z]/.test(error.message)
          ? error.message
          : "updateDownloadFailed",
      });
    }
    return this.state;
  }
  async apply(language) {
    if (!this.enabled || this.state.status !== "ready" || !this.installPlan)
      return false;
    this.set({ status: "applying" });
    try {
      this.installPlan.language = language;
      await fs.writeFile(
        path.join(this.stage, "plan.json"),
        JSON.stringify(this.installPlan),
      );
      const child = spawn(path.join(this.stage, "UpdateHelper.exe"), [], {
        cwd: this.stage,
        detached: true,
        windowsHide: true,
        stdio: "ignore",
      });
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", () => reject(Error("updateInstallFailed")));
      });
      child.unref();
      this.set({ status: "applying" });
      return true;
    } catch {
      this.set({ status: "error", error: "updateInstallFailed" });
      return false;
    }
  }
}
module.exports = { Updater };
