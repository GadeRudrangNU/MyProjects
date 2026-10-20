using System.Net;
using System.Net.Http.Json;
using ShipSafe.Core;
using ShipSafe.Server.Data;
using ShipSafe.Server.Endpoints;

namespace ShipSafe.Tests;

public class ApiTests(ServerFixture server) : IClassFixture<ServerFixture>
{
    private static readonly GuardSettings DefaultGuard = new() { MinSamples = 100, Alpha = 0.001, MinDifference = 0.05, WindowSeconds = 30 };

    [Fact]
    public async Task Health_is_open_but_admin_and_sdk_routes_need_keys()
    {
        using var anonymous = server.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await anonymous.GetAsync("/health")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/flags")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/sdk/flags")).StatusCode);

        anonymous.DefaultRequestHeaders.Add("X-Admin-Key", "wrong");
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/flags")).StatusCode);

        using var sdk = server.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await sdk.GetAsync($"/sdk/flags?key={ServerFixture.SdkKey}")).StatusCode);
    }

    [Fact]
    public async Task Flags_can_be_created_read_updated_and_deleted()
    {
        var key = ServerFixture.UniqueKey();
        var created = await server.CreateFlagAsync(key, 10);
        Assert.Equal(1, created.Version);

        using var admin = server.Admin("alice");
        var update = await admin.PutAsJsonAsync($"/api/flags/{key}", new
        {
            description = "now with rules",
            enabled = true,
            rolloutPercent = 25,
            conditions = new[] { new Condition("country", ConditionOperator.In, ["CA"]) },
            guard = DefaultGuard
        }, ShipSafeJson.Options);
        update.EnsureSuccessStatusCode();

        var current = await server.GetFlagAsync(key);
        Assert.Equal(2, current.Version);
        Assert.Equal(25, current.RolloutPercent);
        Assert.Single(current.Conditions);

        var all = await admin.GetFromJsonAsync<List<FlagDefinition>>("/api/flags", ShipSafeJson.Options);
        Assert.Contains(all!, f => f.Key == key);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/flags/{key}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/api/flags/{key}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync($"/api/flags/{key}")).StatusCode);
    }

    [Fact]
    public async Task Duplicate_and_invalid_flags_are_rejected()
    {
        var key = ServerFixture.UniqueKey();
        await server.CreateFlagAsync(key);

        using var admin = server.Admin();
        var duplicate = await admin.PostAsJsonAsync("/api/flags", new { key, enabled = true, rolloutPercent = 5 });
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);

        var invalid = await admin.PostAsJsonAsync("/api/flags", new
        {
            key = "Bad Key!",
            rolloutPercent = 150,
            conditions = new[] { new { attribute = "", @operator = "in", values = Array.Empty<string>() } },
            guard = new { minSamples = 0, alpha = 0.9, minDifference = 2, windowSeconds = 1 }
        });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        var body = await invalid.Content.ReadAsStringAsync();
        foreach (var field in new[] { "key", "rolloutPercent", "conditions", "guard.minSamples", "guard.alpha", "guard.minDifference", "guard.windowSeconds" })
        {
            Assert.Contains(field, body);
        }

        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync("/api/flags/missing", new { key = "missing", rolloutPercent = 1 })).StatusCode);
    }

    [Fact]
    public async Task Rollout_percent_is_rounded_to_two_decimals()
    {
        var key = ServerFixture.UniqueKey();
        var flag = await server.CreateFlagAsync(key, 33.3333);
        Assert.Equal(33.33, flag.RolloutPercent);
    }

    [Fact]
    public async Task Every_change_is_recorded_with_who_made_it()
    {
        var key = ServerFixture.UniqueKey();
        await server.CreateFlagAsync(key, 5);

        using var bob = server.Admin("bob");
        var flag = await server.GetFlagAsync(key);
        await bob.PutAsJsonAsync($"/api/flags/{key}", new
        {
            description = flag.Description,
            enabled = true,
            rolloutPercent = 40,
            conditions = Array.Empty<Condition>(),
            guard = flag.Guard
        }, ShipSafeJson.Options);
        await bob.DeleteAsync($"/api/flags/{key}");

        var audit = await server.AuditAsync(key);
        Assert.Equal(["deleted", "updated", "created"], audit.Select(a => a.Action));
        Assert.Equal(["bob", "bob", "tester"], audit.Select(a => a.Actor));
        Assert.Contains("5% to 40%", audit[1].Summary);
    }

    [Fact]
    public async Task Saving_without_changes_creates_no_version_or_audit_entry()
    {
        var key = ServerFixture.UniqueKey();
        var flag = await server.CreateFlagAsync(key, 5);

        using var admin = server.Admin();
        var response = await admin.PutAsJsonAsync($"/api/flags/{key}", new
        {
            description = flag.Description,
            enabled = flag.Enabled,
            rolloutPercent = flag.RolloutPercent,
            conditions = flag.Conditions,
            guard = flag.Guard
        }, ShipSafeJson.Options);
        response.EnsureSuccessStatusCode();

        Assert.Equal(1, (await server.GetFlagAsync(key)).Version);
        Assert.Single(await server.AuditAsync(key));
    }

    [Fact]
    public async Task Sdk_snapshot_contains_flags_and_a_revision_that_grows_with_changes()
    {
        var key = ServerFixture.UniqueKey();
        using var sdk = server.Sdk();
        var before = await sdk.GetFromJsonAsync<FlagSnapshot>("/sdk/flags", ShipSafeJson.Options);

        await server.CreateFlagAsync(key);
        var after = await sdk.GetFromJsonAsync<FlagSnapshot>("/sdk/flags", ShipSafeJson.Options);

        Assert.True(after!.Revision > before!.Revision);
        Assert.Contains(after.Flags, f => f.Key == key);
    }

    [Fact]
    public async Task Metric_reports_are_validated()
    {
        var key = ServerFixture.UniqueKey();
        await server.CreateFlagAsync(key);
        using var sdk = server.Sdk();

        var response = await sdk.PostAsJsonAsync("/sdk/events", new MetricBatch(
        [
            new MetricReport(key, true, 10, 2),
            new MetricReport(key, true, 5, 9),
            new MetricReport(key, false, 0, 0),
            new MetricReport("unknown-flag", true, 3, 0)
        ]), ShipSafeJson.Options);
        response.EnsureSuccessStatusCode();
        Assert.Contains("\"accepted\":1", await response.Content.ReadAsStringAsync());

        var tooMany = await sdk.PostAsJsonAsync("/sdk/events",
            new MetricBatch(Enumerable.Range(0, 1001).Select(_ => new MetricReport(key, true, 1, 0)).ToList()), ShipSafeJson.Options);
        Assert.Equal(HttpStatusCode.BadRequest, tooMany.StatusCode);
    }

    [Fact]
    public async Task Metrics_endpoint_reports_the_current_assessment()
    {
        var key = ServerFixture.UniqueKey();
        await server.CreateFlagAsync(key, 50, DefaultGuard with { Mode = GuardMode.Approval });
        await Task.Delay(1100);
        await server.ReportAsync(key, true, 50, 1);
        await server.ReportAsync(key, false, 50, 1);

        using var admin = server.Admin();
        var metrics = await admin.GetFromJsonAsync<FlagMetricsView>($"/api/flags/{key}/metrics?seconds=30", ShipSafeJson.Options);

        Assert.Equal(GuardVerdict.InsufficientData, metrics!.Assessment.Verdict);
        Assert.Equal(50, metrics.Assessment.Treatment.Requests);
        Assert.Equal(30, metrics.Series.Count);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/flags/nope/metrics")).StatusCode);
    }

    [Fact]
    public async Task A_regression_switches_the_flag_off_and_records_why()
    {
        var key = ServerFixture.UniqueKey();
        await server.CreateFlagAsync(key, 50);
        await Task.Delay(1100);

        await server.ReportAsync(key, false, 200, 2);
        await server.ReportAsync(key, true, 200, 80);

        Assert.True(await ServerFixture.WaitUntilAsync(async () => !(await server.GetFlagAsync(key)).Enabled));

        var audit = await server.AuditAsync(key);
        var rollback = Assert.Single(audit, a => a.Action == "rollback");
        Assert.Equal("shipsafe-auto", rollback.Actor);
        Assert.Equal(GuardVerdict.Regressed, rollback.Evidence!.Verdict);
        Assert.Equal(80, rollback.Evidence.Treatment.Errors);
        Assert.Contains("40.0%", rollback.Summary);
    }

    [Fact]
    public async Task A_handful_of_errors_does_not_trigger_a_rollback()
    {
        var key = ServerFixture.UniqueKey();
        await server.CreateFlagAsync(key, 50);
        await Task.Delay(1100);

        await server.ReportAsync(key, false, 90, 0);
        await server.ReportAsync(key, true, 90, 30);
        await Task.Delay(400);

        Assert.True((await server.GetFlagAsync(key)).Enabled);
        Assert.DoesNotContain(await server.AuditAsync(key), a => a.Action.StartsWith("rollback"));
    }

    [Fact]
    public async Task A_healthy_release_is_left_alone()
    {
        var key = ServerFixture.UniqueKey();
        await server.CreateFlagAsync(key, 50);
        await Task.Delay(1100);

        await server.ReportAsync(key, false, 1000, 20);
        await server.ReportAsync(key, true, 1000, 22);
        await Task.Delay(400);

        Assert.True((await server.GetFlagAsync(key)).Enabled);
    }

    [Fact]
    public async Task Guard_can_be_turned_off_per_flag()
    {
        var key = ServerFixture.UniqueKey();
        await server.CreateFlagAsync(key, 50, DefaultGuard with { Enabled = false });
        await Task.Delay(1100);

        await server.ReportAsync(key, false, 500, 0);
        await server.ReportAsync(key, true, 500, 400);
        await Task.Delay(400);

        Assert.True((await server.GetFlagAsync(key)).Enabled);
    }

    [Fact]
    public async Task Approval_mode_waits_for_a_person_before_switching_off()
    {
        var key = ServerFixture.UniqueKey();
        await server.CreateFlagAsync(key, 50, DefaultGuard with { Mode = GuardMode.Approval });
        await Task.Delay(1100);

        await server.ReportAsync(key, false, 200, 2);
        await server.ReportAsync(key, true, 200, 80);

        using var admin = server.Admin("carol");
        Proposal? pending = null;
        Assert.True(await ServerFixture.WaitUntilAsync(async () =>
        {
            var proposals = await admin.GetFromJsonAsync<List<ProposalView>>("/api/proposals?status=pending", ShipSafeJson.Options);
            var match = proposals!.FirstOrDefault(p => p.FlagKey == key);
            pending = match is null ? null : new Proposal(match.Id);
            return match is not null;
        }));

        await Task.Delay(300);
        Assert.True((await server.GetFlagAsync(key)).Enabled);
        var proposedOnce = (await server.AuditAsync(key)).Count(a => a.Action == "rollback-proposed");
        Assert.Equal(1, proposedOnce);

        var approve = await admin.PostAsync($"/api/proposals/{pending!.Id}/approve", null);
        approve.EnsureSuccessStatusCode();

        Assert.False((await server.GetFlagAsync(key)).Enabled);
        var approved = Assert.Single(await server.AuditAsync(key), a => a.Action == "rollback-approved");
        Assert.Equal("carol", approved.Actor);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync($"/api/proposals/{pending.Id}/approve", null)).StatusCode);
    }

    [Fact]
    public async Task A_dismissed_proposal_keeps_the_flag_on_and_is_logged()
    {
        var key = ServerFixture.UniqueKey();
        await server.CreateFlagAsync(key, 50, DefaultGuard with { Mode = GuardMode.Approval });
        await Task.Delay(1100);
        await server.ReportAsync(key, false, 200, 2);
        await server.ReportAsync(key, true, 200, 80);

        using var admin = server.Admin("dana");
        ProposalView? proposal = null;
        Assert.True(await ServerFixture.WaitUntilAsync(async () =>
        {
            var proposals = await admin.GetFromJsonAsync<List<ProposalView>>("/api/proposals?status=pending", ShipSafeJson.Options);
            proposal = proposals!.FirstOrDefault(p => p.FlagKey == key);
            return proposal is not null;
        }));

        var dismiss = await admin.PostAsync($"/api/proposals/{proposal!.Id}/dismiss", null);
        dismiss.EnsureSuccessStatusCode();

        Assert.True((await server.GetFlagAsync(key)).Enabled);
        Assert.Contains(await server.AuditAsync(key), a => a.Action == "rollback-dismissed" && a.Actor == "dana");
    }

    [Fact]
    public async Task Editing_a_flag_clears_stale_proposals_and_restarts_the_measurement()
    {
        var key = ServerFixture.UniqueKey();
        await server.CreateFlagAsync(key, 50, DefaultGuard with { Mode = GuardMode.Approval });
        await Task.Delay(1100);
        await server.ReportAsync(key, false, 200, 2);
        await server.ReportAsync(key, true, 200, 80);

        using var admin = server.Admin();
        Assert.True(await ServerFixture.WaitUntilAsync(async () =>
            (await admin.GetFromJsonAsync<List<ProposalView>>("/api/proposals?status=pending", ShipSafeJson.Options))!.Any(p => p.FlagKey == key)));

        var flag = await server.GetFlagAsync(key);
        await admin.PutAsJsonAsync($"/api/flags/{key}", new
        {
            description = flag.Description,
            enabled = true,
            rolloutPercent = 10,
            conditions = flag.Conditions,
            guard = flag.Guard
        }, ShipSafeJson.Options);

        var pending = await admin.GetFromJsonAsync<List<ProposalView>>("/api/proposals?status=pending", ShipSafeJson.Options);
        Assert.DoesNotContain(pending!, p => p.FlagKey == key);

        await Task.Delay(300);
        var metrics = await admin.GetFromJsonAsync<FlagMetricsView>($"/api/flags/{key}/metrics", ShipSafeJson.Options);
        Assert.Equal(0, metrics!.Assessment.Treatment.Requests);
        Assert.Equal(1, (await server.AuditAsync(key)).Count(a => a.Action == "rollback-proposed"));
    }

    [Fact]
    public async Task Re_enabling_after_a_rollback_gives_the_new_release_a_clean_slate()
    {
        var key = ServerFixture.UniqueKey();
        await server.CreateFlagAsync(key, 50);
        await Task.Delay(1100);
        await server.ReportAsync(key, false, 200, 2);
        await server.ReportAsync(key, true, 200, 80);
        Assert.True(await ServerFixture.WaitUntilAsync(async () => !(await server.GetFlagAsync(key)).Enabled));

        await Task.Delay(1100);
        using var admin = server.Admin();
        var flag = await server.GetFlagAsync(key);
        await admin.PutAsJsonAsync($"/api/flags/{key}", new
        {
            description = flag.Description,
            enabled = true,
            rolloutPercent = flag.RolloutPercent,
            conditions = flag.Conditions,
            guard = flag.Guard
        }, ShipSafeJson.Options);

        await Task.Delay(400);
        Assert.True((await server.GetFlagAsync(key)).Enabled);
    }

    private sealed record Proposal(int Id);
}
