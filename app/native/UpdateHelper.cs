using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

class UpdateFile { public string path; public string sha256; public long size; }
class UpdatePlan { public string directory; public string version; public int processId; public bool restart; public bool quiet; public string language; public UpdateFile[] files; }
class UpdateHelper {
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
    static string Stage = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
    static string Within(string root, string relative) {
        if (String.IsNullOrEmpty(relative) || relative.Length >= 220) throw new Exception("Invalid path");
        string current = Path.GetFullPath(root);
        if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new Exception("Linked directory");
        foreach (string part in relative.Split('/')) {
            if (!Regex.IsMatch(part, @"^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$") || part.EndsWith(".") || Regex.IsMatch(part, @"^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)", RegexOptions.IgnoreCase)) throw new Exception("Invalid path");
            current = Path.Combine(current, part);
            if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new Exception("Linked file");
        }
        return current;
    }
    static string Hash(string file) {
        using (var stream = File.OpenRead(file)) using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }
    static void Result(string status, string version) {
        File.WriteAllText(Path.Combine(Path.GetDirectoryName(Stage), "result.json"), Json.Serialize(new { status = status, version = version }));
    }
    [STAThread]
    static void Main() {
        UpdatePlan plan = null;
        var replaced = new List<string>();
        var backups = new Dictionary<string, string>();
        bool validated = false;
        try {
            plan = Json.Deserialize<UpdatePlan>(File.ReadAllText(Path.Combine(Stage, "plan.json")));
            if (plan == null || plan.files == null || plan.files.Length > 512 || !Regex.IsMatch(plan.version ?? "", @"^\d+\.\d+\.\d+$")) throw new Exception("Invalid plan");
            string directory = Path.GetFullPath(plan.directory);
            if (!File.Exists(Within(directory, "PulseDeck.exe"))) throw new Exception("Installation not found");
            validated = true;
            string files = Path.Combine(Stage, "files");
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var file in plan.files) {
                if (!names.Add(file.path) || !Regex.IsMatch(file.sha256 ?? "", @"^[a-f0-9]{64}$")) throw new Exception("Invalid file");
                string source = Within(files, file.path);
                Within(directory, file.path);
                if (new FileInfo(source).Length != file.size || Hash(source) != file.sha256) throw new Exception("Integrity check failed");
            }
            if (plan.processId > 0) {
                try { using (var process = Process.GetProcessById(plan.processId)) { if (!process.WaitForExit(60000)) throw new Exception("Application is still running"); } }
                catch (ArgumentException) {}
            }
            validated = true;
            string backupDirectory = Path.Combine(Stage, "backup");
            Directory.CreateDirectory(backupDirectory);
            foreach (var file in plan.files) {
                string target = Within(directory, file.path);
                if (File.Exists(target)) {
                    string backup = Path.Combine(backupDirectory, backups.Count.ToString() + ".bak");
                    File.Copy(target, backup, false);
                    backups.Add(target, backup);
                }
            }
            foreach (var file in plan.files) {
                string target = Within(directory, file.path);
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                replaced.Add(target);
                File.Copy(Within(files, file.path), target, true);
                if (Hash(target) != file.sha256) throw new Exception("Installed file verification failed");
            }
            Result("applied", plan.version);
            try {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\PulseDeck", true)) {
                    if (key != null && String.Equals((string)key.GetValue("InstallLocation"), directory, StringComparison.OrdinalIgnoreCase)) key.SetValue("DisplayVersion", plan.version);
                }
            } catch {}
        } catch {
            bool restored = true;
            for (int i = replaced.Count - 1; i >= 0; i--) {
                string target = replaced[i];
                try { if (backups.ContainsKey(target)) File.Copy(backups[target], target, true); else if (File.Exists(target)) File.Delete(target); }
                catch { restored = false; }
            }
            try { Result(restored ? "rolledBack" : "failed", plan == null ? "" : plan.version); } catch {}
            if (plan != null && !plan.quiet) MessageBox.Show(plan.language == "ru" ? (restored ? "Обновление не установлено. Предыдущие файлы сохранены." : "Не удалось завершить обновление. Установите PulseDeck заново. Ваши настройки сохранены.") : (restored ? "The update was not installed. Previous files were preserved." : "The update could not be completed. Reinstall PulseDeck. Your settings are preserved."), "PulseDeck", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            if (!restored) validated = false;
        }
        if (validated && plan != null && plan.restart) {
            try { Process.Start(new ProcessStartInfo { FileName = Within(plan.directory, "PulseDeck.exe"), WorkingDirectory = plan.directory, UseShellExecute = false }); } catch {}
        }
    }
}
