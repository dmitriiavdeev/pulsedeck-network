using System;
using System.Net.NetworkInformation;
using System.Web.Script.Serialization;
class PingProbe {
    static int Main(string[] args) {
        object result;
        try {
            if (args.Length != 2) return 2;
            int timeout = Math.Max(250, Math.Min(30000, Int32.Parse(args[1])));
            using (var ping = new Ping()) {
                var reply = ping.Send(args[0], timeout);
                result = new { ok = reply.Status == IPStatus.Success, latency = reply.Status == IPStatus.Success ? (long?)reply.RoundtripTime : null, detail = reply.Status.ToString() };
            }
        } catch { result = new { ok = false, latency = (long?)null, detail = "ICMP недоступен или адрес не найден" }; }
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        Console.WriteLine(new JavaScriptSerializer().Serialize(result));
        return 0;
    }
}
