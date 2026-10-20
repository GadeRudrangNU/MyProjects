using System.Net.Http.Json;
using NBomber.CSharp;
using ShipSafe.Core;

var baseUrl = new Uri(args.FirstOrDefault() ?? "http://localhost:5080/");
var duration = TimeSpan.FromSeconds(args.Length > 1 ? int.Parse(args[1]) : 15);
const string flagKey = "load-test";

using var admin = new HttpClient { BaseAddress = baseUrl };
admin.DefaultRequestHeaders.Add("X-Admin-Key", "dev-admin-key");
admin.DefaultRequestHeaders.Add("X-Actor", "load-test");

using var sdk = new HttpClient { BaseAddress = baseUrl };
sdk.DefaultRequestHeaders.Add("X-Sdk-Key", "dev-sdk-key");

await admin.DeleteAsync($"api/flags/{flagKey}");
(await admin.PostAsJsonAsync("api/flags", new
{
    key = flagKey,
    enabled = true,
    rolloutPercent = 50,
    guard = new GuardSettings { Enabled = false }
}, ShipSafeJson.Options)).EnsureSuccessStatusCode();

var batch = new MetricBatch([new MetricReport(flagKey, true, 50, 1), new MetricReport(flagKey, false, 50, 1)]);

NBomber.Contracts.ScenarioProps Build(string name, int rate, Func<Task<HttpResponseMessage>> call) =>
    Scenario.Create(name, async _ =>
    {
        using var response = await call();
        return response.IsSuccessStatusCode ? Response.Ok() : Response.Fail(statusCode: ((int)response.StatusCode).ToString());
    })
    .WithWarmUpDuration(TimeSpan.FromSeconds(3))
    .WithLoadSimulations(Simulation.Inject(rate, TimeSpan.FromSeconds(1), duration));

var result = NBomberRunner
    .RegisterScenarios(
        Build("sdk_snapshot_fetch", 500, () => sdk.GetAsync("sdk/flags")),
        Build("sdk_metric_report", 500, () => sdk.PostAsJsonAsync("sdk/events", batch, ShipSafeJson.Options)),
        Build("admin_flag_list", 100, () => admin.GetAsync("api/flags")),
        Build("admin_flag_metrics", 100, () => admin.GetAsync($"api/flags/{flagKey}/metrics")))
    .WithReportFolder(Path.Combine(AppContext.BaseDirectory, "reports"))
    .WithReportFormats(NBomber.Contracts.Stats.ReportFormat.Txt, NBomber.Contracts.Stats.ReportFormat.Md)
    .Run();

await admin.DeleteAsync($"api/flags/{flagKey}");

var failed = result.ScenarioStats.Sum(s => s.Fail.Request.Count);
Console.WriteLine(failed == 0 ? "No failed requests" : $"{failed} failed requests");
return failed == 0 ? 0 : 1;
