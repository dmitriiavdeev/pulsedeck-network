using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Win32;
using System.Globalization;
using System.Runtime.InteropServices;

[assembly: AssemblyTitle("PulseDeck")]
[assembly: AssemblyProduct("PulseDeck")]
[assembly: AssemblyCompany("dmitriiavdeev")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]
class Setup {
    const string AppId = "io.github.dmitriiavdeev.pulsedeck";
    const string AppName = "PulseDeck";
    const string AppDirectory = "PulseDeck";
    const string ShortcutDirectory = "";
    const string ExecutableName = "PulseDeck.exe";
    const string AppOrigin = "https://github.com/dmitriiavdeev/pulsedeck-network";
    const string Marker = ".pulsedeck-desktop";
    static string TestKey { get { return @"Software\" + AppDirectory + @"\InstallerQA\" + Path.GetFileName(Path.GetDirectoryName(Target)); } }
    static string UninstallKey { get { return Test ? TestKey + @"\Uninstall" : @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + AppDirectory; } }
    static string RunKey { get { return Test ? TestKey + @"\Run" : @"Software\Microsoft\Windows\CurrentVersion\Run"; } }
    static string Target = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", AppDirectory);
    static bool Test, Busy, Done;
    static Window Window;
    static Button Primary, Close;
    static TextBlock Heading, Description, Status;
    static string Version = "1.0.0";
    static Mutex Instance;
    static string Language = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ru" ? "ru" : "en";
    static Dictionary<string, Dictionary<string, string>> Words;
    [StructLayout(LayoutKind.Sequential)] struct PropertyKey { public Guid Format; public uint Id; }
    [StructLayout(LayoutKind.Explicit, Size = 24)] struct PropertyValue { [FieldOffset(0)] public ushort Type; [FieldOffset(8)] public IntPtr Pointer; }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore {
        void GetCount(out uint count); void GetAt(uint index, out PropertyKey key);
        void GetValue(ref PropertyKey key, out PropertyValue value); void SetValue(ref PropertyKey key, ref PropertyValue value); void Commit();
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHGetPropertyStoreFromParsingName(string path, IntPtr bindContext, uint flags, ref Guid iid, out IPropertyStore store);
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropertyValue value);
    static void SetShortcutIdentity(string path) {
        Guid iid = typeof(IPropertyStore).GUID; IPropertyStore store;
        SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 2, ref iid, out store);
        var key = new PropertyKey { Format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), Id = 5 };
        var value = new PropertyValue { Type = 31, Pointer = Marshal.StringToCoTaskMemUni(AppId) };
        try {
            store.SetValue(ref key, ref value); store.Commit();
            PropertyValue check; store.GetValue(ref key, out check);
            try { if (Marshal.PtrToStringUni(check.Pointer) != AppId) throw new Exception("Shortcut identity verification failed."); }
            finally { PropVariantClear(ref check); }
        } finally { PropVariantClear(ref value); Marshal.FinalReleaseComObject(store); }
    }
    static string T(string key) { return Words[Language][key]; }
    static string TranslateError(string message) { string value; return Language == "en" && Words != null && Words["errors"].TryGetValue(message, out value) ? value : message; }
    static void Labels() {
        Element<TextBlock>("BrandTitle").Text = T("brandTitle"); Element<TextBlock>("BrandSubtitle").Text = T("brandSubtitle");
        Element<TextBlock>("MiniStatus").Text = T("miniStatus"); Element<TextBlock>("Step").Text = T("step");
        Element<TextBlock>("InstallNote").Text = T("note"); Element<TextBlock>("Version").Text = T("version") + Version + " · github.com";
        Element<CheckBox>("Autostart").Content = T("autostart"); Element<CheckBox>("Shortcut").Content = T("shortcut");
        bool update = File.Exists(Path.Combine(Target, Marker));
        Heading.Text = T(Done ? (Removing ? "doneRemove" : "done") : Removing ? "removingTitle" : update ? "update" : "welcome");
        Description.Text = T(Done ? (Removing ? "doneRemoveDescription" : "doneDescription") : Removing ? "removeDescription" : update ? "updateDescription" : "installDescription");
        Primary.Content = T(Done ? (Removing ? "close" : "open") : Removing ? "remove" : "install");
    }
#if UNINSTALL
    const bool Removing = true;
#else
    const bool Removing = false;
#endif
    static T Element<T>(string name) where T : class { return Window.FindName(name) as T; }
    static Stream Resource(string name) { return Assembly.GetExecutingAssembly().GetManifestResourceStream(name); }
    static string Executable { get { return Path.Combine(Target, ExecutableName); } }
    static string DesktopShortcut { get {
        string desktop = Test ? Path.Combine(Path.GetDirectoryName(Target), "Desktop") : Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        string primary = Path.Combine(desktop, AppName + ".lnk");
        string alternate = Path.Combine(desktop, AppName, AppName + ".lnk");
        if (ShortcutPointsTo(alternate, Executable)) return alternate;
        if (!File.Exists(primary) || ShortcutPointsTo(primary, Executable)) return primary;
        if (!File.Exists(alternate)) return alternate;
        throw new Exception("Ярлыки PulseDeck уже заняты другими установками.");
    } }
    static string StartShortcut { get { return Path.Combine(Test ? Path.Combine(Path.GetDirectoryName(Target), "StartMenu") : Environment.GetFolderPath(Environment.SpecialFolder.Programs), ShortcutDirectory, AppName + ".lnk"); } }
    [STAThread]
    static int Main(string[] args) {
        try {
            using (var reader = new StreamReader(Resource("translations.json"))) Words = new JavaScriptSerializer().Deserialize<Dictionary<string, Dictionary<string, string>>>(reader.ReadToEnd());
            bool first;
            Instance = new Mutex(true, @"Local\" + AppId + "-Setup-" + System.Security.Principal.WindowsIdentity.GetCurrent().User.Value, out first);
            if (!first) throw new Exception("Установщик PulseDeck уже открыт.");
            if (args.Length == 2 && (args[0] == "--test-install" || args[0] == "--test-install-autostart" || args[0] == "--test-uninstall")) {
                Test = true;
                Target = Path.GetFullPath(args[1]);
                string parent = Path.GetDirectoryName(Target);
                if (!File.Exists(Path.Combine(parent, ".pulsedeck-qa")) || Path.GetFileName(Target) != AppDirectory)
                    throw new Exception("Test destination requires .pulsedeck-qa in its parent and the configured application directory name.");
                if (args[0] == "--test-uninstall") Remove(); else Install(args[0] == "--test-install-autostart", true);
                File.WriteAllText(Path.Combine(parent, args[0] + ".passed"), "OK");
                return 0;
            }
            if (Removing && args.Length == 0) {
                // Run the uninstaller from Temp so its own installed executable can be removed.
                string helper = Path.Combine(Path.GetTempPath(), "PulseDeck-Uninstall-" + Guid.NewGuid().ToString("N") + ".exe");
                File.Copy(Assembly.GetExecutingAssembly().Location, helper);
                // Release the installer mutex before the helper starts.
                Instance.ReleaseMutex(); Instance.Dispose();
                Process.Start(new ProcessStartInfo(helper, "--remove") { UseShellExecute = false, WorkingDirectory = Path.GetTempPath() });
                return 0;
            }
            if (!Environment.Is64BitOperatingSystem || Environment.OSVersion.Version.Major < 10)
                throw new Exception("Для PulseDeck нужна 64-разрядная Windows 10 или Windows 11.");
            using (var stream = Resource("installer.xaml")) Window = (Window)XamlReader.Load(stream);
            var bitmap = new BitmapImage();
            bitmap.BeginInit(); bitmap.StreamSource = Resource("icon.png"); bitmap.CacheOption = BitmapCacheOption.OnLoad; bitmap.EndInit();
            bitmap.Freeze(); Window.Icon = bitmap; Element<Image>("BrandIcon").Source = bitmap;
            Primary = Element<Button>("Primary"); Close = Element<Button>("Close");
            Heading = Element<TextBlock>("Heading"); Description = Element<TextBlock>("Description"); Status = Element<TextBlock>("Status");
            Window.Title = AppName;
            Element<TextBlock>("BrandName").Text = AppName;
            Element<TextBlock>("BrandName").FontSize = AppName.Length > 16 ? 15 : 20;
            if (Removing) {
                Element<StackPanel>("Options").Visibility = Visibility.Collapsed;
            } else if (File.Exists(Path.Combine(Target, Marker))) {
                using (var key = Registry.CurrentUser.OpenSubKey(RunKey))
                    Element<CheckBox>("Autostart").IsChecked = key != null && key.GetValue(AppId) != null;
                Element<CheckBox>("Shortcut").IsChecked = File.Exists(DesktopShortcut);
            }
            if (args.Length > 0 && args[0] == "--preview-en") Language = "en";
            if (args.Length > 0 && args[0] == "--preview-ru") Language = "ru";
            Element<ComboBox>("Language").SelectedIndex = Language == "ru" ? 1 : 0;
            Element<ComboBox>("Language").SelectionChanged += delegate { Language = Element<ComboBox>("Language").SelectedIndex == 1 ? "ru" : "en"; Labels(); };
            Labels();
            Window.MouseLeftButtonDown += delegate(object sender, MouseButtonEventArgs e) {
                if (e.OriginalSource is TextBlock || e.OriginalSource is Border || e.OriginalSource is Grid) Window.DragMove();
            };
            Close.Click += delegate { Window.Close(); };
            Window.Closing += delegate(object sender, System.ComponentModel.CancelEventArgs e) { if (Busy) e.Cancel = true; };
            Primary.Click += OnPrimary;
            if (args.Length == 2 && (args[0] == "--preview" || args[0] == "--preview-en" || args[0] == "--preview-ru")) {
                var content = (FrameworkElement)Window.Content;
                content.Measure(new Size(820, 510)); content.Arrange(new Rect(0, 0, 820, 510)); content.UpdateLayout();
                var image = new RenderTargetBitmap(820, 510, 96, 96, PixelFormats.Pbgra32); image.Render(content);
                var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(image));
                using (var stream = File.Create(Path.GetFullPath(args[1]))) encoder.Save(stream);
                return 0;
            }
            new Application().Run(Window);
            return 0;
        } catch (Exception error) {
            if (Test) File.WriteAllText(Path.Combine(Path.GetDirectoryName(Target), "test-error.txt"), error.ToString());
            else MessageBox.Show(TranslateError(error.Message), "PulseDeck", MessageBoxButton.OK, MessageBoxImage.Information);
            return 1;
        }
    }
    static async void OnPrimary(object sender, RoutedEventArgs e) {
        if (Done) {
            if (!Removing) Process.Start(new ProcessStartInfo(Executable, "--language=" + Language) { UseShellExecute = false, WorkingDirectory = Target });
            Window.Close(); return;
        }
        bool autostart = Element<CheckBox>("Autostart").IsChecked == true;
        bool shortcut = Element<CheckBox>("Shortcut").IsChecked == true;
        Busy = true; Primary.IsEnabled = false; Close.IsEnabled = false;
        Element<ComboBox>("Language").IsEnabled = false;
        Element<StackPanel>("Options").Visibility = Visibility.Collapsed;
        Element<StackPanel>("ProgressPanel").Visibility = Visibility.Visible;
        Heading.Text = T(Removing ? "workingRemove" : "working"); Description.Text = T("workingDescription");
        try {
            await Task.Run(() => { if (Removing) Remove(); else Install(autostart, shortcut); });
            Done = true;
            Labels();
            Report(100, Removing ? "До встречи!" : "Установка завершена");
        } catch (Exception error) {
            Heading.Text = T("failed"); Description.Text = TranslateError(error.Message); Primary.Content = T("retry");
            Report(0, "Закройте открытое приложение и повторите попытку.");
        } finally { Busy = false; Primary.IsEnabled = true; Close.IsEnabled = true; Element<ComboBox>("Language").IsEnabled = true; }
    }
    static void Report(int progress, string status) {
        if (Test || Window == null) return;
        Window.Dispatcher.Invoke(() => { Element<ProgressBar>("Progress").Value = progress; Status.Text = TranslateError(status); });
    }
    static void ValidateTree(string path) {
        string resolved = Path.GetFullPath(path);
        string parent = Path.GetDirectoryName(Path.GetFullPath(Target));
        if (Path.GetDirectoryName(resolved) != parent ||
            !(resolved == Path.GetFullPath(Target) || Path.GetFileName(resolved).StartsWith(AppDirectory + ".install-") || Path.GetFileName(resolved).StartsWith(AppDirectory + ".previous-")))
            throw new Exception("Недопустимый путь установки.");
        // Refuse junctions/symlinks in the path or contents before any recursive operation.
        for (var dir = new DirectoryInfo(resolved); dir != null; dir = dir.Parent)
            if (dir.Exists && (dir.Attributes & FileAttributes.ReparsePoint) != 0) throw new Exception("Папка установки не должна быть ссылкой.");
        if (Directory.Exists(resolved)) CheckChildren(resolved);
    }
    static void CheckChildren(string dir) {
        foreach (var file in Directory.GetFileSystemEntries(dir)) {
            var attrs = File.GetAttributes(file);
            if ((attrs & FileAttributes.ReparsePoint) != 0) throw new Exception("Папка приложения содержит ссылку. Установка остановлена.");
            if ((attrs & FileAttributes.Directory) != 0) CheckChildren(file);
        }
    }
    static void DeleteTree(string path) {
        ValidateTree(path);
        for (int attempt = 0; Directory.Exists(path); attempt++) {
            try { Directory.Delete(path, true); return; }
            catch (IOException) { if (attempt >= 30) throw; Thread.Sleep(250); }
            catch (UnauthorizedAccessException) { if (attempt >= 30) throw; Thread.Sleep(250); }
        }
    }
    static void MoveTree(string from, string to) { ValidateTree(from); ValidateTree(to); Directory.Move(from, to); }
    static void StopApplication() {
        if (Test || !File.Exists(Executable)) return;
        Report(3, "Завершаем работу предыдущей версии…");
        var info = new ProcessStartInfo(Executable, "--quit-for-update") { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Target };
        using (var process = Process.Start(info)) if (!process.WaitForExit(15000))
            throw new Exception("Не удалось закрыть PulseDeck. Сохраните работу и повторите установку.");
        // Wait for the original instance to release files, without terminating any process.
        for (int i = 0; i < 40; i++) {
            bool running = false;
            foreach (var process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(ExecutableName))) {
                using (process) {
                    try { if (String.Equals(process.MainModule.FileName, Executable, StringComparison.OrdinalIgnoreCase)) running = true; }
                    catch { }
                }
            }
            if (!running) return;
            Thread.Sleep(250);
        }
        throw new Exception("PulseDeck ещё завершает работу. Повторите попытку немного позже.");
    }
    static void Install(bool autostart, bool shortcut) {
        ValidateTree(Target);
        if (Directory.Exists(Target) && !File.Exists(Path.Combine(Target, Marker)))
            throw new Exception("Папка PulseDeck уже занята. Чтобы сохранить её содержимое, установка остановлена.");
        string stage = Target + ".install-" + Guid.NewGuid().ToString("N");
        string backup = Target + ".previous-" + Guid.NewGuid().ToString("N");
        bool swapped = false;
        try {
            Directory.CreateDirectory(stage);
            Dictionary<string, string> hashes;
            using (var reader = new StreamReader(Resource("payload.json")))
                hashes = new JavaScriptSerializer().Deserialize<Dictionary<string, string>>(reader.ReadToEnd());
            using (var input = Resource("payload.zip")) {
                if (input == null) throw new Exception("В установщике отсутствуют файлы приложения.");
                using (var zip = new ZipArchive(input, ZipArchiveMode.Read)) {
                    int count = 0;
                    var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var entry in zip.Entries) {
                        string name = entry.FullName.Replace('\\', '/');
                        if (name.EndsWith("/") && entry.Length == 0) continue;
                        if (name.Contains(":") || name.StartsWith("/") || !seen.Add(name) || !hashes.ContainsKey(name))
                            throw new Exception("Неверный состав установщика.");
                        string output = Path.GetFullPath(Path.Combine(stage, name.Replace('/', Path.DirectorySeparatorChar)));
                        if (!output.StartsWith(Path.GetFullPath(stage) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                            throw new Exception("Неверный путь в установщике.");
                        Directory.CreateDirectory(Path.GetDirectoryName(output));
                        using (var source = entry.Open()) using (var file = File.Create(output)) source.CopyTo(file);
                        string actual;
                        using (var sha = SHA256.Create()) using (var file = File.OpenRead(output))
                            actual = BitConverter.ToString(sha.ComputeHash(file)).Replace("-", "").ToLowerInvariant();
                        if (actual != hashes[name]) throw new Exception("Установщик повреждён. Скачайте его снова со страницы проекта.");
                        Report(5 + (int)(75.0 * ++count / hashes.Count), "Подготавливаем файлы приложения…");
                    }
                    if (seen.Count != hashes.Count || !seen.Contains(ExecutableName) || !seen.Contains("Uninstall.exe"))
                        throw new Exception("Установщик содержит не все файлы приложения.");
                }
            }
            File.WriteAllText(Path.Combine(stage, Marker), Version);
            StopApplication();
            if (Directory.Exists(Target)) MoveTree(Target, backup);
            MoveTree(stage, Target); swapped = true;
            Report(90, "Создаём ярлыки и сохраняем настройки…");
            Register(autostart, shortcut);
            if (Test) {
                using (var key = Registry.CurrentUser.OpenSubKey(RunKey))
                    if ((string)key.GetValue(AppId) != (autostart ? "\"" + Executable + "\" --background" : null)) throw new Exception("Autostart registration failed");
                using (var key = Registry.CurrentUser.OpenSubKey(UninstallKey))
                    if ((string)key.GetValue("InstallLocation") != Target) throw new Exception("Uninstall registration failed");
                if (!File.Exists(DesktopShortcut) || !File.Exists(StartShortcut)) throw new Exception("Shortcut creation failed");
            }
            // An old version that cannot be cleaned up does not invalidate the installed version.
            try { DeleteTree(backup); } catch { }
        } catch {
            if (swapped) DeleteTree(Target);
            if (Directory.Exists(backup)) MoveTree(backup, Target);
            throw;
        } finally { if (Directory.Exists(stage)) DeleteTree(stage); }
    }
    static void Shortcut(string path) {
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        Type type = Type.GetTypeFromProgID("WScript.Shell");
        object shell = Activator.CreateInstance(type);
        object link = type.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { path });
        Type linkType = link.GetType();
        foreach (var pair in new Dictionary<string, object> {
            { "TargetPath", Executable }, { "WorkingDirectory", Target }, { "IconLocation", Executable + ",0" }, { "Description", AppName }
        }) linkType.InvokeMember(pair.Key, BindingFlags.SetProperty, null, link, new object[] { pair.Value });
        linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
        System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link);
        System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);
        SetShortcutIdentity(path);
    }
    static void Register(bool autostart, bool shortcut) {
        Shortcut(StartShortcut);
        if (shortcut) Shortcut(DesktopShortcut); else DeleteShortcut(DesktopShortcut);
        using (var key = Registry.CurrentUser.CreateSubKey(RunKey)) {
            if (autostart) key.SetValue(AppId, "\"" + Executable + "\" --background");
            else key.DeleteValue(AppId, false);
        }
        using (var key = Registry.CurrentUser.CreateSubKey(UninstallKey)) {
            key.SetValue("DisplayName", AppName); key.SetValue("DisplayVersion", Version);
            key.SetValue("Publisher", "dmitriiavdeev"); key.SetValue("InstallLocation", Target);
            key.SetValue("DisplayIcon", Executable + ",0");
            key.SetValue("UninstallString", "\"" + Path.Combine(Target, "Uninstall.exe") + "\"");
            key.SetValue("URLInfoAbout", AppOrigin);
            key.SetValue("NoModify", 1, RegistryValueKind.DWord); key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
    }
    static void DeleteShortcut(string path) {
        if (ShortcutPointsTo(path, Executable)) File.Delete(path);
    }
    static bool ShortcutPointsTo(string path, string executable) {
        if (!File.Exists(path)) return false;
        Type type = Type.GetTypeFromProgID("WScript.Shell");
        object shell = Activator.CreateInstance(type);
        object link = type.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { path });
        string destination = Convert.ToString(link.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, link, null));
        System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link);
        System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);
        return String.Equals(destination, executable, StringComparison.OrdinalIgnoreCase);
    }
    static void Remove() {
        ValidateTree(Target);
        if (!File.Exists(Path.Combine(Target, Marker))) throw new Exception("Установленное приложение не найдено.");
        StopApplication();
        Report(35, "Удаляем файлы приложения…");
        DeleteTree(Target);
        DeleteShortcut(DesktopShortcut); DeleteShortcut(StartShortcut);
        using (var key = Registry.CurrentUser.OpenSubKey(RunKey, true)) if (key != null) key.DeleteValue(AppId, false);
        Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);
        if (Test) Registry.CurrentUser.DeleteSubKeyTree(TestKey, false);
        Report(100, "Приложение удалено");
    }
}
