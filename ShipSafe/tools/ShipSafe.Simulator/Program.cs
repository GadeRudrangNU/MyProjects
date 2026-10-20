using System.Diagnostics;
using System.Net.Http.Json;
using ShipSafe.Core;
using ShipSafe.Sdk;

var baseUrl = new Uri(Option("url", "http://localhost:5080/"));
var sdkKey = Option("sdk-key", "dev-sdk-key");
var adminKey = Option("admin-key", "dev-admin-key");
var rps = int.Parse(Option("rps", "500"));
var healthySeconds = int.Parse(Option("healthy-seconds", "6"));
var badErrorRate = double.Parse(Option("bad-error-rate", "0.30"));
var minSamples = int.Parse(Option("min-samples", "200"));
var mode = Option("mode", "auto");
const string flagKey = "simulated-release";

using var admin = new HttpClient { BaseAddress = baseUrl };
admin.DefaultRequestHeaders.Add("X-Admin-Key", adminKey);
admin.DefaultRequestHeaders.Add("X-Actor", "simulator");

await admin.DeleteAsync($"api/flags/{flagKey}");
var created = await admin.PostAsJsonAsync("api/flags", new
{
    key = flagKey,
    description = "Simulated bad release",
    enabled = true,
    rolloutPercent = 50,
    conditions = Array.Empty<Condition>(),
    guard = new GuardSettings
    {
        Mode = mode == "approval" ? GuardMode.Approval : GuardMode.Auto,
        MinSamples = minSamples,
        Alpha = 0.001,
        MinDifference = 0.05,
        WindowSeconds = 30
    }
}, ShipSafeJson.Options);
created.EnsureSuccessStatusCode();

await using var client = await ShipSafeClient.CreateAsync(new ShipSafeOptions { BaseUrl = baseUrl, SdkKey = sdkKey });
if (!client.IsReady)
{
    Console.Error.WriteLine("Could not reach ShipSafe at " + baseUrl);
    return 2;
}

await Task.Delay(1200);

var badRelease = false;
long firstBadTicks = 0;
var sdkSawOff = new TaskCompletionSource<long>(TaskCreationOptions.RunContinuationsAsynchronously);
client.Updated += snapshot =>
{
    if (firstBadTicks != 0 && snapshot.Flags.FirstOrDefault(f => f.Key == flagKey) is { Enabled: false })
    {
        sdkSawOff.TrySetResult(Stopwatch.GetTimestamp());
    }
};

Console.WriteLine($"Sending {rps} requests per second to flag '{flagKey}' (50% on the new version)");

using var stop = new CancellationTokenSource();
var traffic = Task.Run(async () =>
{
    var random = new Random(42);
    var userCounter = 0L;
    var period = TimeSpan.FromMilliseconds(10);
    var perTick = rps * period.TotalSeconds;
    var carry = 0.0;
    using var timer = new PeriodicTimer(period);
    try
    {
        while (await timer.WaitForNextTickAsync(stop.Token))
        {
            carry += perTick;
            while (carry >= 1)
            {
                carry -= 1;
                var decision = client.Evaluate(flagKey, new UserContext($"user-{userCounter++}"));
                var failureRate = decision.Enabled && badRelease ? badErrorRate : 0.01;
                var failed = random.NextDouble() < failureRate;
                if (failed && decision.Enabled && badRelease)
                {
                    Interlocked.CompareExchange(ref firstBadTicks, Stopwatch.GetTimestamp(), 0);
                }

                client.Track(decision, !failed);
            }
        }
    }
    catch (OperationCanceledException)
    {
    }
});

await Task.Delay(TimeSpan.FromSeconds(healthySeconds));
Console.WriteLine($"Healthy traffic for {healthySeconds}s: no rollback expected");
if (!(await IsEnabledAsync()))
{
    Console.Error.WriteLine("Flag was switched off during healthy traffic, which is a false rollback");
    return 1;
}

Console.WriteLine($"Releasing a bad build: the new version now fails {badErrorRate:P0} of requests");
badRelease = true;

var finished = await Task.WhenAny(sdkSawOff.Task, Task.Delay(TimeSpan.FromSeconds(45)));
stop.Cancel();
await traffic;

if (mode == "approval")
{
    Console.WriteLine("Approval mode: waiting for the proposal is handled in the dashboard");
}

if (finished != sdkSawOff.Task)
{
    var proposals = await admin.GetFromJsonAsync<List<ProposalRow>>("api/proposals?status=pending", ShipSafeJson.Options) ?? [];
    if (mode == "approval" && proposals.Any(p => p.FlagKey == flagKey))
    {
        Console.WriteLine("A rollback proposal is waiting for approval and the flag is still on");
        return 0;
    }

    Console.Error.WriteLine("No rollback within 45 seconds");
    return 1;
}

var seen = Stopwatch.GetElapsedTime(firstBadTicks, sdkSawOff.Task.Result);
var audit = await admin.GetFromJsonAsync<List<AuditRow>>($"api/audit?flagKey={flagKey}", ShipSafeJson.Options) ?? [];
var rollback = audit.First(a => a.Action == "rollback");
var firstBadAt = DateTimeOffset.UtcNow - Stopwatch.GetElapsedTime(firstBadTicks);
var serverDecided = rollback.At - firstBadAt;

Console.WriteLine();
Console.WriteLine("Rollback result");
Console.WriteLine($"  First bad request to flag switched off by ShipSafe: {serverDecided.TotalSeconds:0.00}s");
Console.WriteLine($"  First bad request to the running app seeing it off: {seen.TotalSeconds:0.00}s");
Console.WriteLine($"  Evidence: {rollback.Summary}");

await admin.DeleteAsync($"api/flags/{flagKey}");
return 0;

async Task<bool> IsEnabledAsync() =>
    (await admin.GetFromJsonAsync<FlagDefinition>($"api/flags/{flagKey}", ShipSafeJson.Options))!.Enabled;

string Option(string name, string fallback)
{
    var prefix = $"--{name}=";
    var match = args.FirstOrDefault(a => a.StartsWith(prefix, StringComparison.Ordinal));
    return match is null ? fallback : match[prefix.Length..];
}

internal sealed record AuditRow(DateTimeOffset At, string Action, string Summary);

internal sealed record ProposalRow(string FlagKey);
