using Microsoft.Extensions.Time.Testing;
using ShipSafe.Server.Services;

namespace ShipSafe.Tests;

public class MetricStoreTests
{
    private readonly FakeTimeProvider clock = new(new DateTimeOffset(2026, 1, 1, 12, 0, 0, TimeSpan.Zero));

    [Fact]
    public void Counts_each_version_separately()
    {
        var store = new MetricStore(clock);
        store.Record("f", true, 10, 4);
        store.Record("f", false, 20, 1);

        var (treatment, control) = store.Window("f", TimeSpan.FromSeconds(30), DateTimeOffset.MinValue);
        Assert.Equal((10, 4), (treatment.Requests, treatment.Errors));
        Assert.Equal((20, 1), (control.Requests, control.Errors));
    }

    [Fact]
    public void Old_traffic_falls_out_of_the_window()
    {
        var store = new MetricStore(clock);
        store.Record("f", true, 10, 10);
        clock.Advance(TimeSpan.FromSeconds(31));
        store.Record("f", true, 5, 0);

        var (treatment, _) = store.Window("f", TimeSpan.FromSeconds(30), DateTimeOffset.MinValue);
        Assert.Equal(5, treatment.Requests);
    }

    [Fact]
    public void Traffic_from_before_a_flag_change_is_ignored()
    {
        var store = new MetricStore(clock);
        store.Record("f", true, 50, 50);
        clock.Advance(TimeSpan.FromSeconds(2));
        var changedAt = clock.GetUtcNow();
        clock.Advance(TimeSpan.FromSeconds(1));
        store.Record("f", true, 7, 1);

        var (treatment, _) = store.Window("f", TimeSpan.FromSeconds(30), changedAt);
        Assert.Equal((7, 1), (treatment.Requests, treatment.Errors));
    }

    [Fact]
    public void Series_has_one_point_per_second_including_quiet_ones()
    {
        var store = new MetricStore(clock);
        store.Record("f", true, 3, 1);
        clock.Advance(TimeSpan.FromSeconds(2));
        store.Record("f", false, 4, 0);

        var series = store.Series("f", 5);
        Assert.Equal(5, series.Count);
        Assert.Equal(3, series.Sum(p => p.TreatmentRequests));
        Assert.Equal(4, series.Sum(p => p.ControlRequests));
        Assert.Equal(series.Select(p => p.Second).OrderBy(s => s), series.Select(p => p.Second));
    }

    [Fact]
    public void Unknown_flags_have_empty_stats_and_removal_clears_history()
    {
        var store = new MetricStore(clock);
        Assert.Equal(default, store.Window("missing", TimeSpan.FromSeconds(30), DateTimeOffset.MinValue).Treatment);
        Assert.Empty(store.Series("missing", 10));

        store.Record("f", true, 1, 0);
        store.Remove("f");
        Assert.Empty(store.Series("f", 10));
    }

    [Fact]
    public void Concurrent_writers_do_not_lose_counts()
    {
        var store = new MetricStore(clock);
        Parallel.For(0, 10_000, _ => store.Record("f", true, 1, 1));

        var (treatment, _) = store.Window("f", TimeSpan.FromSeconds(30), DateTimeOffset.MinValue);
        Assert.Equal(10_000, treatment.Requests);
        Assert.Equal(10_000, treatment.Errors);
    }
}
