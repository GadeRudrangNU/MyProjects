using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using ShipSafe.Core;
using ShipSafe.Server.Endpoints;

namespace ShipSafe.Tests;

public sealed class ServerFixture : WebApplicationFactory<Program>
{
    public const string AdminKey = "test-admin-key";
    public const string SdkKey = "test-sdk-key";

    private readonly string databasePath = Path.Combine(Path.GetTempPath(), $"shipsafe-test-{Guid.NewGuid():N}.db");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ShipSafe:Database"] = $"Data Source={databasePath}",
            ["ShipSafe:SeedDemo"] = "false",
            ["ShipSafe:MonitorIntervalMs"] = "50",
            ["ShipSafe:AdminKey"] = AdminKey,
            ["ShipSafe:SdkKey"] = SdkKey
        }));
    }

    public HttpClient Admin(string actor = "tester")
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Add("X-Admin-Key", AdminKey);
        client.DefaultRequestHeaders.Add("X-Actor", actor);
        return client;
    }

    public HttpClient Sdk()
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Add("X-Sdk-Key", SdkKey);
        return client;
    }

    public static string UniqueKey(string prefix = "flag") => $"{prefix}-{Guid.NewGuid():N}"[..24];

    public async Task<FlagDefinition> CreateFlagAsync(string key, double rollout = 50, GuardSettings? guard = null, bool enabled = true)
    {
        using var admin = Admin();
        var response = await admin.PostAsJsonAsync("/api/flags", new
        {
            key,
            description = "test flag",
            enabled,
            rolloutPercent = rollout,
            conditions = Array.Empty<Condition>(),
            guard = guard ?? new GuardSettings { MinSamples = 100, Alpha = 0.001, MinDifference = 0.05, WindowSeconds = 30 }
        }, ShipSafeJson.Options);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<FlagDefinition>(ShipSafeJson.Options))!;
    }

    public async Task<FlagDefinition> GetFlagAsync(string key)
    {
        using var admin = Admin();
        return (await admin.GetFromJsonAsync<FlagDefinition>($"/api/flags/{key}", ShipSafeJson.Options))!;
    }

    public async Task ReportAsync(string key, bool treatment, long requests, long errors)
    {
        using var sdk = Sdk();
        var response = await sdk.PostAsJsonAsync("/sdk/events",
            new MetricBatch([new MetricReport(key, treatment, requests, errors)]), ShipSafeJson.Options);
        response.EnsureSuccessStatusCode();
    }

    public async Task<List<AuditView>> AuditAsync(string key)
    {
        using var admin = Admin();
        return (await admin.GetFromJsonAsync<List<AuditView>>($"/api/audit?flagKey={key}", ShipSafeJson.Options))!;
    }

    public static async Task<bool> WaitUntilAsync(Func<Task<bool>> condition, int timeoutMs = 5000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            if (await condition())
            {
                return true;
            }

            await Task.Delay(25);
        }

        return await condition();
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        SqliteConnection.ClearAllPools();
        try
        {
            File.Delete(databasePath);
        }
        catch (IOException)
        {
        }
    }
}
