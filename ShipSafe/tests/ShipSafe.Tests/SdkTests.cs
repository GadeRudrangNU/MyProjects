using System.Net.Http.Json;
using ShipSafe.Core;
using ShipSafe.Sdk;
using ShipSafe.Server.Endpoints;

namespace ShipSafe.Tests;

public class SdkTests(ServerFixture server) : IClassFixture<ServerFixture>
{
    private Task<ShipSafeClient> ConnectAsync(TimeSpan? flush = null) =>
        ShipSafeClient.CreateAsync(new ShipSafeOptions
        {
            BaseUrl = new Uri("http://localhost/"),
            SdkKey = ServerFixture.SdkKey,
            HttpClient = server.CreateClient(),
            FlushInterval = flush ?? TimeSpan.FromMilliseconds(100)
        });

    [Fact]
    public async Task Client_loads_flags_and_evaluates_them_locally()
    {
        var key = ServerFixture.UniqueKey();
        await server.CreateFlagAsync(key, 100);

        await using var client = await ConnectAsync();
        Assert.True(client.IsReady);
        Assert.True(await ServerFixture.WaitUntilAsync(() => Task.FromResult(client.GetFlag(key) is not null)));

        var decision = client.Evaluate(key, new UserContext("u-1"));
        Assert.True(decision.Enabled);
        Assert.Equal(DecisionReason.InRollout, decision.Reason);
        Assert.Equal(DecisionReason.FlagNotFound, client.Evaluate("missing-flag", new UserContext("u-1")).Reason);
        Assert.False(client.IsEnabled("missing-flag", new UserContext("u-1")));
    }

    [Fact]
    public async Task Changes_reach_a_running_client_within_a_second_without_a_restart()
    {
        var key = ServerFixture.UniqueKey();
        await server.CreateFlagAsync(key, 0);

        await using var client = await ConnectAsync();
        Assert.True(await ServerFixture.WaitUntilAsync(() => Task.FromResult(client.GetFlag(key) is not null)));
        var user = new UserContext("u-1");
        Assert.False(client.IsEnabled(key, user));

        var flag = await server.GetFlagAsync(key);
        using var admin = server.Admin();

        async Task<TimeSpan> ChangeRolloutAsync(double percent)
        {
            var updated = new TaskCompletionSource();
            client.Updated += snapshot =>
            {
                if (snapshot.Flags.Any(f => f.Key == key && f.RolloutPercent == percent))
                {
                    updated.TrySetResult();
                }
            };

            var started = DateTime.UtcNow;
            await admin.PutAsJsonAsync($"/api/flags/{key}", new
            {
                description = flag.Description,
                enabled = true,
                rolloutPercent = percent,
                conditions = flag.Conditions,
                guard = flag.Guard
            }, ShipSafeJson.Options);
            await updated.Task.WaitAsync(TimeSpan.FromSeconds(5));
            return DateTime.UtcNow - started;
        }

        await ChangeRolloutAsync(1);
        var elapsed = await ChangeRolloutAsync(100);

        Assert.True(elapsed < TimeSpan.FromSeconds(1), $"update took {elapsed.TotalMilliseconds:0} ms");
        Assert.True(client.IsEnabled(key, user));
    }

    [Fact]
    public async Task Tracked_results_reach_the_server_and_trigger_a_rollback()
    {
        var key = ServerFixture.UniqueKey();
        await server.CreateFlagAsync(key, 50);
        await Task.Delay(1100);

        await using var client = await ConnectAsync();
        Assert.True(await ServerFixture.WaitUntilAsync(() => Task.FromResult(client.GetFlag(key) is not null)));

        var random = new Random(1);
        for (var i = 0; i < 2000; i++)
        {
            var decision = client.Evaluate(key, new UserContext($"user-{i}"));
            var failureRate = decision.Enabled ? 0.4 : 0.01;
            client.Track(decision, random.NextDouble() >= failureRate);
        }

        Assert.True(await ServerFixture.WaitUntilAsync(async () => !(await server.GetFlagAsync(key)).Enabled));
        Assert.True(await ServerFixture.WaitUntilAsync(() => Task.FromResult(!client.IsEnabled(key, new UserContext("user-1")))));
        Assert.Contains(await server.AuditAsync(key), a => a.Action == "rollback");
    }

    [Fact]
    public async Task Tracking_an_unknown_flag_is_ignored()
    {
        await using var client = await ConnectAsync();
        client.Track(client.Evaluate("missing-flag", new UserContext("u")), false);
        await client.FlushAsync();
    }

    [Fact]
    public async Task Metrics_that_fail_to_send_are_kept_and_retried()
    {
        var key = ServerFixture.UniqueKey();
        await server.CreateFlagAsync(key, 100);
        await Task.Delay(1100);
        var handler = new FlakyHandler(server.Server.CreateHandler());
        var http = new HttpClient(handler) { BaseAddress = new Uri("http://localhost/"), Timeout = Timeout.InfiniteTimeSpan };

        await using var client = await ShipSafeClient.CreateAsync(new ShipSafeOptions
        {
            BaseUrl = new Uri("http://localhost/"),
            SdkKey = ServerFixture.SdkKey,
            HttpClient = http,
            FlushInterval = TimeSpan.FromHours(1)
        });
        Assert.True(await ServerFixture.WaitUntilAsync(() => Task.FromResult(client.GetFlag(key) is not null)));

        var decision = client.Evaluate(key, new UserContext("u"));
        for (var i = 0; i < 150; i++)
        {
            client.Track(decision, i % 3 != 0);
        }

        handler.FailEvents = true;
        await client.FlushAsync();
        handler.FailEvents = false;
        await client.FlushAsync();

        using var admin = server.Admin();
        var metrics = await admin.GetFromJsonAsync<FlagMetricsView>($"/api/flags/{key}/metrics", ShipSafeJson.Options);
        Assert.Equal(150, metrics!.Assessment.Treatment.Requests);
        Assert.Equal(50, metrics.Assessment.Treatment.Errors);
    }

    private sealed class FlakyHandler(HttpMessageHandler inner) : DelegatingHandler(inner)
    {
        public bool FailEvents { get; set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (FailEvents && request.RequestUri!.AbsolutePath == "/sdk/events")
            {
                return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.ServiceUnavailable));
            }

            return base.SendAsync(request, cancellationToken);
        }
    }
}
