// president's Windows notification-area helper (decided by 20261112vzn8, option `count`).
//
// `preside tray install` compiles this file on the user's machine with the C# compiler that
// comes with Windows (.NET Framework 4, csc.exe /target:winexe), so no binary is downloaded
// and nothing runs from node_modules. That compiler only knows C# 5: no string
// interpolation, no `?.`, no `=>` members.
//
// The helper:
// - runs the hub (`node <repo>\src\server\main.ts`) as a hidden child, restarts it after a
//   crash with a growing delay, and writes its output to hub.log (capped) next to the exe;
// - shows in the notification area how many cards are in the Queue (GET /api/queue-count,
//   polled every few seconds), or that the hub isn't running;
// - has the menu every option of the card shares: Open president, Restart hub, Start with
//   Windows, Quit;
// - stops the hub cleanly on Quit and when the session ends: it closes the hub's stdin, which
//   the hub (PRESIDENT_STOP_ON_STDIN_END=1) takes as "shut down", and kills the process tree
//   with taskkill /T only if the hub hasn't stopped after a grace period. If the helper
//   itself dies, the pipe closes too and the hub stops on its own.
//
// Command line (used by `preside tray`): no argument runs the tray; --autostart on|off,
// --quit (stops a running helper and waits for it), --status, --self-test (the CI smoke test:
// starts the hub on a free port, reads the count, kills it to see it come back, stops it).

using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace President.Tray
{
    static class Program
    {
        const string MutexName = @"Local\president-tray";
        const string QuitEventName = @"Local\president-tray-quit";

        [DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();

        [STAThread]
        static int Main(string[] args)
        {
            string dir = Path.GetDirectoryName(Application.ExecutablePath);
            string command = args.Length > 0 ? args[0] : "";
            try
            {
                if (command == "--autostart" && args.Length == 2 && (args[1] == "on" || args[1] == "off"))
                {
                    Autostart.Set(args[1] == "on");
                    Out("autostart: " + (Autostart.IsOn() ? "on" : "off"));
                    return 0;
                }
                if (command == "--quit") return QuitRunning();
                if (command == "--status")
                {
                    Out("running: " + (IsRunning() ? "yes" : "no"));
                    Out("autostart: " + (Autostart.IsOn() ? "on" : "off"));
                    return 0;
                }
                if (command == "--self-test") return SelfTest.Run(dir);
                if (command != "")
                {
                    Out("unknown argument: " + command);
                    return 2;
                }
            }
            catch (Exception e)
            {
                Out("error: " + e.Message);
                return 1;
            }
            return RunTray(dir);
        }

        static int RunTray(string dir)
        {
            bool createdNew;
            using (Mutex mutex = new Mutex(true, MutexName, out createdNew))
            {
                // One helper per session: a second start (a logon after a manual start) leaves.
                if (!createdNew) return 0;
                HubLog log = new HubLog(Path.Combine(dir, "hub.log"));
                Config config;
                try
                {
                    config = Config.Load(dir);
                }
                catch (Exception e)
                {
                    log.Write("tray: " + e.Message);
                    MessageBox.Show(
                        "president's tray helper can't start: " + e.Message + "\n\nRun `preside tray install` again.",
                        "president", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 1;
                }
                try { SetProcessDPIAware(); } catch (Exception) { }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (EventWaitHandle quit = new EventWaitHandle(false, EventResetMode.AutoReset, QuitEventName))
                using (TrayApp app = new TrayApp(config, log))
                {
                    ThreadPool.RegisterWaitForSingleObject(quit, delegate { app.QuitFromAnywhere(); }, null, -1, true);
                    Application.Run(app);
                }
                mutex.ReleaseMutex();
                return 0;
            }
        }

        static bool IsRunning()
        {
            try
            {
                using (Mutex.OpenExisting(MutexName)) return true;
            }
            catch (WaitHandleCannotBeOpenedException)
            {
                return false;
            }
        }

        /// Asks the running helper to quit and waits until it has (its hub stopped too).
        static int QuitRunning()
        {
            Mutex mutex;
            try
            {
                mutex = Mutex.OpenExisting(MutexName);
            }
            catch (WaitHandleCannotBeOpenedException)
            {
                Out("not running");
                return 0;
            }
            using (mutex)
            {
                using (EventWaitHandle quit = new EventWaitHandle(false, EventResetMode.AutoReset, QuitEventName))
                    quit.Set();
                try
                {
                    if (!mutex.WaitOne(60000))
                    {
                        Out("still running after 60 seconds");
                        return 1;
                    }
                    mutex.ReleaseMutex();
                }
                catch (AbandonedMutexException)
                {
                    // It ended without releasing it: gone all the same.
                }
            }
            Out("stopped");
            return 0;
        }

        /// stdout, for `preside tray` (it reads it through a pipe: a GUI program has no console).
        public static void Out(string line)
        {
            try
            {
                Console.Out.WriteLine(line);
                Console.Out.Flush();
            }
            catch (Exception) { }
        }
    }

    /// tray.config next to the exe, written by `preside tray install`: key=value lines.
    class Config
    {
        public string Node;
        public string Repo;
        public int Port = 4747;

        public string HubScript
        {
            get { return Path.Combine(Repo, "src", "server", "main.ts"); }
        }

        public static Config Load(string dir)
        {
            string path = Path.Combine(dir, "tray.config");
            if (!File.Exists(path)) throw new Exception(path + " is missing");
            Config config = new Config();
            foreach (string raw in File.ReadAllLines(path, Encoding.UTF8))
            {
                string line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#")) continue;
                int eq = line.IndexOf('=');
                if (eq < 0) continue;
                string key = line.Substring(0, eq).Trim();
                string value = line.Substring(eq + 1).Trim();
                if (key == "node") config.Node = value;
                else if (key == "repo") config.Repo = value;
                else if (key == "port") config.Port = int.Parse(value);
            }
            if (string.IsNullOrEmpty(config.Node)) throw new Exception(path + " has no node= line");
            if (string.IsNullOrEmpty(config.Repo)) throw new Exception(path + " has no repo= line");
            return config;
        }
    }

    /// The hub's output and the helper's own events. Capped: past 1 MB the file becomes
    /// hub.log.1 (replacing the one before) and a new one starts, so both stay under 2 MB.
    class HubLog
    {
        const long MaxBytes = 1024 * 1024;
        readonly string path;
        readonly object gate = new object();
        static readonly Encoding Utf8 = new UTF8Encoding(false);

        public HubLog(string path)
        {
            this.path = path;
        }

        public void Write(string line)
        {
            lock (gate)
            {
                try
                {
                    FileInfo file = new FileInfo(path);
                    if (file.Exists && file.Length > MaxBytes)
                    {
                        string old = path + ".1";
                        if (File.Exists(old)) File.Delete(old);
                        File.Move(path, old);
                    }
                    File.AppendAllText(path, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + line + "\r\n", Utf8);
                }
                catch (Exception)
                {
                    // A log that can't be written must not stop the hub.
                }
            }
        }
    }

    enum HubState { Starting, Running, Waiting, Stopped }

    /// Runs the hub and starts it again when it exits on its own, waiting 1, 2, 4... up to 60
    /// seconds between tries (back to 1 once it ran for a minute). Its own thread, so the menu
    /// never waits for it.
    class Supervisor
    {
        const int Restart = 1;
        const int Stop = 2;
        const int ForcedKillWaitMs = 10000;

        readonly Config config;
        readonly int port;
        readonly HubLog log;
        readonly AutoResetEvent wake = new AutoResetEvent(false);
        Thread thread;
        int request;
        volatile int graceMs = 10000;
        volatile int childPid;
        volatile bool lastStopClean;
        volatile HubState state = HubState.Starting;

        public event EventHandler Changed;

        public Supervisor(Config config, int port, HubLog log)
        {
            this.config = config;
            this.port = port;
            this.log = log;
        }

        public HubState State { get { return state; } }
        public int ChildPid { get { return childPid; } }
        /// Whether the last stop was the hub shutting down by itself when its stdin closed.
        public bool LastStopClean { get { return lastStopClean; } }

        public void Start()
        {
            thread = new Thread(Loop);
            thread.IsBackground = true;
            thread.Name = "president hub";
            thread.Start();
        }

        public void RequestRestart()
        {
            Interlocked.CompareExchange(ref request, Restart, 0);
            wake.Set();
        }

        /// Stops the hub (waiting up to `grace` ms for it to stop by itself) and the loop.
        public bool StopAndWait(int grace, int timeoutMs)
        {
            graceMs = grace;
            Interlocked.Exchange(ref request, Stop);
            wake.Set();
            return thread == null || thread.Join(timeoutMs);
        }

        void SetState(HubState value)
        {
            state = value;
            EventHandler handler = Changed;
            if (handler != null) handler(this, EventArgs.Empty);
        }

        void Loop()
        {
            int failures = 0;
            while (Thread.VolatileRead(ref request) != Stop)
            {
                Interlocked.CompareExchange(ref request, 0, Restart);
                SetState(HubState.Starting);
                DateTime started = DateTime.UtcNow;
                ManualResetEvent exited = new ManualResetEvent(false);
                Process child = Launch(exited);
                if (child != null)
                {
                    SetState(HubState.Running);
                    int which;
                    // A wake left over from a request already handled is not a new one.
                    do which = WaitHandle.WaitAny(new WaitHandle[] { exited, wake });
                    while (which == 1 && Thread.VolatileRead(ref request) == 0);
                    if (which == 1)
                    {
                        StopChild(child, exited);
                        child.Dispose();
                        if (Thread.VolatileRead(ref request) == Stop) break;
                        log.Write("tray: hub restarted from the menu");
                        failures = 0;
                        continue;
                    }
                    int code = -1;
                    try { code = child.ExitCode; } catch (Exception) { }
                    child.Dispose();
                    childPid = 0;
                    log.Write("tray: the hub exited (code " + code + ")");
                    if (DateTime.UtcNow - started > TimeSpan.FromMinutes(1)) failures = 0;
                }
                failures++;
                int delay = Math.Min(60, 1 << Math.Min(failures - 1, 6));
                log.Write("tray: starting it again in " + delay + " s");
                SetState(HubState.Waiting);
                if (wake.WaitOne(delay * 1000))
                {
                    if (Thread.VolatileRead(ref request) == Stop) break;
                    failures = 0;
                }
            }
            childPid = 0;
            SetState(HubState.Stopped);
        }

        Process Launch(ManualResetEvent exited)
        {
            ProcessStartInfo info = new ProcessStartInfo(config.Node, Quote(config.HubScript));
            info.WorkingDirectory = config.Repo;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardInput = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.StandardOutputEncoding = Encoding.UTF8;
            info.StandardErrorEncoding = Encoding.UTF8;
            info.EnvironmentVariables["PRESIDENT_PORT"] = port.ToString();
            info.EnvironmentVariables["PRESIDENT_STOP_ON_STDIN_END"] = "1";
            Process child = new Process();
            child.StartInfo = info;
            child.EnableRaisingEvents = true;
            child.Exited += delegate { exited.Set(); };
            child.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) log.Write("hub: " + e.Data); };
            child.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) log.Write("hub: " + e.Data); };
            try
            {
                child.Start();
            }
            catch (Exception e)
            {
                log.Write("tray: can't start " + config.Node + ": " + e.Message + " (run `preside tray install` again)");
                child.Dispose();
                return null;
            }
            childPid = child.Id;
            log.Write("tray: hub started (pid " + child.Id + ", port " + port + ")");
            child.BeginOutputReadLine();
            child.BeginErrorReadLine();
            return child;
        }

        void StopChild(Process child, ManualResetEvent exited)
        {
            try
            {
                child.StandardInput.Close();
            }
            catch (Exception) { }
            bool clean = exited.WaitOne(graceMs);
            if (!clean)
            {
                log.Write("tray: the hub didn't stop within " + (graceMs / 1000) + " s; ending it");
                KillTree(child);
                exited.WaitOne(ForcedKillWaitMs);
            }
            lastStopClean = clean;
            childPid = 0;
            log.Write("tray: hub stopped");
        }

        /// taskkill /T: the hub with everything it started (git, a card's chat).
        static void KillTree(Process child)
        {
            try
            {
                ProcessStartInfo info = new ProcessStartInfo("taskkill", "/pid " + child.Id + " /t /f");
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                using (Process taskkill = Process.Start(info)) taskkill.WaitForExit(ForcedKillWaitMs);
            }
            catch (Exception)
            {
                try { child.Kill(); } catch (Exception) { }
            }
        }

        static string Quote(string arg)
        {
            return "\"" + arg + "\"";
        }
    }

    /// The hub's HTTP API, as the helper reads it.
    static class Hub
    {
        /// -1: the hub doesn't answer; -2: it answers but gave no count (an older hub).
        public const int Unreachable = -1;
        public const int NoCount = -2;

        public static bool Healthy(int port)
        {
            int status;
            Get(port, "/api/health", out status);
            return status == 200;
        }

        public static int QueueCount(int port)
        {
            int status;
            string body = Get(port, "/api/queue-count", out status);
            if (status == 0) return Unreachable;
            if (status != 200 || body == null) return NoCount;
            Match match = Regex.Match(body, "\"count\"\\s*:\\s*(\\d+)");
            return match.Success ? int.Parse(match.Groups[1].Value) : NoCount;
        }

        static string Get(int port, string path, out int status)
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + path);
            // A system proxy must never see a request meant for this machine.
            request.Proxy = null;
            request.Timeout = 2000;
            request.ReadWriteTimeout = 2000;
            request.KeepAlive = false;
            try
            {
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                {
                    status = (int)response.StatusCode;
                    return reader.ReadToEnd();
                }
            }
            catch (WebException e)
            {
                HttpWebResponse response = e.Response as HttpWebResponse;
                status = response != null ? (int)response.StatusCode : 0;
                if (response != null) response.Close();
                return null;
            }
            catch (Exception)
            {
                status = 0;
                return null;
            }
        }
    }

    /// HKCU\...\Run, the per-user autostart Windows itself documents. Task Manager's Startup
    /// apps can turn it off (StartupApproved\Run, odd first byte = disabled); "Start with
    /// Windows" counts that as off, and turning it on clears it.
    static class Autostart
    {
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        const string ApprovedKey = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
        const string ValueName = "president";

        static string Command
        {
            get { return "\"" + Application.ExecutablePath + "\""; }
        }

        public static bool IsOn()
        {
            using (RegistryKey run = Registry.CurrentUser.OpenSubKey(RunKey))
            {
                string value = run == null ? null : run.GetValue(ValueName) as string;
                if (value == null || !string.Equals(value, Command, StringComparison.OrdinalIgnoreCase)) return false;
            }
            using (RegistryKey approved = Registry.CurrentUser.OpenSubKey(ApprovedKey))
            {
                byte[] flags = approved == null ? null : approved.GetValue(ValueName) as byte[];
                return flags == null || flags.Length == 0 || (flags[0] & 1) == 0;
            }
        }

        public static void Set(bool on)
        {
            using (RegistryKey run = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (on) run.SetValue(ValueName, Command);
                else run.DeleteValue(ValueName, false);
            }
            using (RegistryKey approved = Registry.CurrentUser.OpenSubKey(ApprovedKey, true))
            {
                if (approved != null) approved.DeleteValue(ValueName, false);
            }
        }
    }

    /// The icons, drawn at the size Windows asks for: the favicon's rounded square (#3d5a80)
    /// with its check mark when nothing is waiting, the number on an orange badge when cards
    /// are (9+ above nine), grey with a bar when the hub isn't running.
    static class Icons
    {
        static readonly Color Accent = Color.FromArgb(0x3d, 0x5a, 0x80);
        static readonly Color Down = Color.FromArgb(0x8a, 0x8f, 0x98);
        static readonly Color Badge = Color.FromArgb(0xd9, 0x48, 0x0f);

        [DllImport("user32.dll")]
        static extern bool DestroyIcon(IntPtr handle);

        public static string BadgeText(int count)
        {
            if (count <= 0) return null;
            return count > 9 ? "9+" : count.ToString();
        }

        /// `count`: cards waiting, or Hub.Unreachable for the hub-down icon.
        public static Icon Make(int count)
        {
            int size = SystemInformation.SmallIconSize.Width;
            if (size < 16) size = 16;
            float s = size / 32f;
            bool down = count == Hub.Unreachable;
            string badge = BadgeText(count);
            using (Bitmap bitmap = new Bitmap(size, size, PixelFormat.Format32bppArgb))
            {
                using (Graphics g = Graphics.FromImage(bitmap))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.Clear(Color.Transparent);
                    using (GraphicsPath square = Rounded(new RectangleF(0, 0, size, size), 7 * s))
                    using (Brush fill = new SolidBrush(down ? Down : Accent))
                        g.FillPath(fill, square);
                    using (Pen pen = new Pen(Color.White, 3 * s))
                    {
                        pen.StartCap = LineCap.Round;
                        pen.EndCap = LineCap.Round;
                        pen.LineJoin = LineJoin.Round;
                        if (down) g.DrawLine(pen, 9 * s, 16 * s, 23 * s, 16 * s);
                        else if (badge == null)
                            g.DrawLines(pen, new PointF[] { new PointF(9 * s, 17 * s), new PointF(14 * s, 22 * s), new PointF(23 * s, 10 * s) });
                    }
                    if (badge != null) DrawBadge(g, size, badge);
                }
                IntPtr handle = bitmap.GetHicon();
                try
                {
                    using (Icon borrowed = Icon.FromHandle(handle)) return (Icon)borrowed.Clone();
                }
                finally
                {
                    DestroyIcon(handle);
                }
            }
        }

        static void DrawBadge(Graphics g, int size, string text)
        {
            // Big enough to read at 16 px: most of the icon's height, wider for "9+".
            float h = size * 0.72f;
            float w = text.Length > 1 ? size : h;
            RectangleF box = new RectangleF(size - w, size - h, w, h);
            using (GraphicsPath pill = Rounded(box, h / 2))
            {
                using (Brush fill = new SolidBrush(Badge)) g.FillPath(fill, pill);
                using (Pen edge = new Pen(Color.White, Math.Max(1f, size / 16f))) g.DrawPath(edge, pill);
            }
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            float fontPx = text.Length > 1 ? h * 0.7f : h * 0.82f;
            using (Font font = new Font("Segoe UI", fontPx, FontStyle.Bold, GraphicsUnit.Pixel))
            using (StringFormat format = new StringFormat(StringFormat.GenericTypographic))
            {
                format.Alignment = StringAlignment.Center;
                format.LineAlignment = StringAlignment.Center;
                g.DrawString(text, font, Brushes.White, box, format);
            }
        }

        static GraphicsPath Rounded(RectangleF r, float radius)
        {
            float d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
            GraphicsPath path = new GraphicsPath();
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        /// What the tooltip says (at most 63 characters, Windows' limit).
        public static string Tooltip(int count, HubState state)
        {
            if (count == Hub.Unreachable)
            {
                if (state == HubState.Running || state == HubState.Starting) return "president: starting the hub";
                if (state == HubState.Waiting) return "president: hub not running (restarting)";
                return "president: hub not running";
            }
            if (count == Hub.NoCount) return "president: running";
            if (count == 0) return "president: nothing waiting";
            return "president: " + count + (count == 1 ? " card waiting" : " cards waiting");
        }
    }

    class TrayApp : ApplicationContext
    {
        const int PollMs = 3000;

        readonly Config config;
        readonly HubLog log;
        readonly Supervisor supervisor;
        readonly NotifyIcon icon = new NotifyIcon();
        readonly Control invoker = new Control();
        readonly ToolStripMenuItem autostartItem;
        readonly AutoResetEvent pollNow = new AutoResetEvent(false);
        int shownCount = int.MinValue;
        string shownText;
        Icon shownIcon;
        bool quitting;

        public TrayApp(Config config, HubLog log)
        {
            this.config = config;
            this.log = log;
            IntPtr forceHandle = invoker.Handle; // BeginInvoke needs the handle made on this thread.
            supervisor = new Supervisor(config, config.Port, log);

            ContextMenuStrip menu = new ContextMenuStrip();
            ToolStripMenuItem open = new ToolStripMenuItem("Open president", null, delegate { OpenHub(); });
            open.Font = new Font(open.Font, FontStyle.Bold);
            menu.Items.Add(open);
            menu.Items.Add(new ToolStripMenuItem("Restart hub", null, delegate { supervisor.RequestRestart(); pollNow.Set(); }));
            menu.Items.Add(new ToolStripSeparator());
            autostartItem = new ToolStripMenuItem("Start with Windows", null, delegate { ToggleAutostart(); });
            menu.Items.Add(autostartItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("Quit", null, delegate { Quit(); }));
            menu.Opening += delegate { autostartItem.Checked = SafeIsAutostart(); };

            icon.ContextMenuStrip = menu;
            icon.DoubleClick += delegate { OpenHub(); };
            Show(Hub.Unreachable);
            icon.Visible = true;

            supervisor.Changed += delegate { pollNow.Set(); };
            SystemEvents.SessionEnded += OnSessionEnded;
            supervisor.Start();
            Thread poller = new Thread(Poll);
            poller.IsBackground = true;
            poller.Name = "president count";
            poller.Start();
        }

        void Poll()
        {
            while (true)
            {
                int count = Hub.QueueCount(config.Port);
                try
                {
                    invoker.BeginInvoke(new MethodInvoker(delegate { Show(count); }));
                }
                catch (Exception)
                {
                    return; // The window is gone: quitting.
                }
                pollNow.WaitOne(PollMs);
            }
        }

        void Show(int count)
        {
            if (quitting) return;
            string text = Icons.Tooltip(count, supervisor.State);
            if (text != shownText) icon.Text = shownText = text;
            int iconCount = count == Hub.NoCount ? 0 : count;
            if (iconCount == shownCount) return;
            Icon next = Icons.Make(iconCount);
            icon.Icon = next;
            if (shownIcon != null) shownIcon.Dispose();
            shownIcon = next;
            shownCount = iconCount;
        }

        void OpenHub()
        {
            try
            {
                Process.Start(new ProcessStartInfo("http://127.0.0.1:" + config.Port + "/") { UseShellExecute = true });
            }
            catch (Exception e)
            {
                log.Write("tray: can't open the browser: " + e.Message);
            }
        }

        static bool SafeIsAutostart()
        {
            try { return Autostart.IsOn(); } catch (Exception) { return false; }
        }

        void ToggleAutostart()
        {
            try
            {
                Autostart.Set(!SafeIsAutostart());
            }
            catch (Exception e)
            {
                log.Write("tray: can't change Start with Windows: " + e.Message);
            }
            autostartItem.Checked = SafeIsAutostart();
        }

        /// `preside tray uninstall` and `preside tray install` (via --quit) end up here.
        public void QuitFromAnywhere()
        {
            try
            {
                invoker.BeginInvoke(new MethodInvoker(Quit));
            }
            catch (Exception) { }
        }

        void Quit()
        {
            if (quitting) return;
            quitting = true;
            icon.Visible = false;
            log.Write("tray: quit");
            ThreadPool.QueueUserWorkItem(delegate
            {
                supervisor.StopAndWait(10000, 30000);
                try { invoker.BeginInvoke(new MethodInvoker(ExitThread)); } catch (Exception) { }
            });
        }

        void OnSessionEnded(object sender, SessionEndedEventArgs e)
        {
            // Windows waits only a few seconds at logoff and shutdown, so a shorter grace.
            quitting = true;
            log.Write("tray: session ending");
            supervisor.StopAndWait(4000, 8000);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                SystemEvents.SessionEnded -= OnSessionEnded;
                icon.Visible = false;
                icon.Dispose();
                if (shownIcon != null) shownIcon.Dispose();
                invoker.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    /// --self-test, for CI: no window, no tray icon. Exit code 0 when every step passed.
    static class SelfTest
    {
        public static int Run(string dir)
        {
            Config config = Config.Load(dir);
            HubLog log = new HubLog(Path.Combine(dir, "self-test.log"));
            int port = FreePort();
            Step("hub on port " + port + ", node " + config.Node);
            Supervisor supervisor = new Supervisor(config, port, log);
            supervisor.Start();
            try
            {
                if (!WaitUntil(delegate { return Hub.Healthy(port); }, 60000)) return Fail("the hub never answered /api/health");
                Step("health ok");
                int count = Hub.QueueCount(port);
                if (count < 0) return Fail("no count from /api/queue-count");
                Program.Out("count=" + count);
                Step("tooltip: " + Icons.Tooltip(count, supervisor.State));
                foreach (int n in new int[] { 0, 1, 9, 10, 250, Hub.Unreachable })
                    using (Icon drawn = Icons.Make(n)) { }
                if (Icons.BadgeText(12) != "9+" || Icons.BadgeText(3) != "3" || Icons.BadgeText(0) != null) return Fail("badge text");
                Step("icons drawn");

                int pid = supervisor.ChildPid;
                using (Process hub = Process.GetProcessById(pid)) hub.Kill();
                Step("killed the hub (pid " + pid + ")");
                if (!WaitUntil(delegate { return supervisor.ChildPid != 0 && supervisor.ChildPid != pid && Hub.Healthy(port); }, 60000))
                    return Fail("the hub didn't come back after it was killed");
                Step("restarted (pid " + supervisor.ChildPid + ")");

                int before = supervisor.ChildPid;
                supervisor.RequestRestart();
                if (!WaitUntil(delegate { return supervisor.ChildPid != 0 && supervisor.ChildPid != before && Hub.Healthy(port); }, 60000))
                    return Fail("Restart hub didn't bring up a new hub");
                if (!supervisor.LastStopClean) return Fail("on Restart hub, the hub didn't stop by itself when its stdin closed");
                Step("Restart hub ok");

                int last = supervisor.ChildPid;
                if (!supervisor.StopAndWait(10000, 30000)) return Fail("the supervisor didn't stop");
                if (!supervisor.LastStopClean) return Fail("the hub didn't stop by itself when its stdin closed");
                if (Hub.Healthy(port)) return Fail("the hub still answers after it stopped");
                if (Alive(last)) return Fail("the hub's process is still running");
                Step("stopped cleanly");
                Program.Out("self-test: ok");
                return 0;
            }
            finally
            {
                supervisor.StopAndWait(2000, 15000);
            }
        }

        static bool Alive(int pid)
        {
            try
            {
                using (Process p = Process.GetProcessById(pid)) return !p.HasExited;
            }
            catch (ArgumentException)
            {
                return false;
            }
        }

        static int FreePort()
        {
            TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            listener.Stop();
            return port;
        }

        delegate bool Check();

        static bool WaitUntil(Check check, int timeoutMs)
        {
            Stopwatch watch = Stopwatch.StartNew();
            while (watch.ElapsedMilliseconds < timeoutMs)
            {
                if (check()) return true;
                Thread.Sleep(250);
            }
            return false;
        }

        static void Step(string text)
        {
            Program.Out("self-test: " + text);
        }

        static int Fail(string text)
        {
            Program.Out("self-test: FAILED: " + text);
            return 1;
        }
    }
}
