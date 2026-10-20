using System.Collections.Concurrent;
using ShipSafe.Core;

namespace ShipSafe.Server.Services;

public sealed record SeriesPoint(long Second, long TreatmentRequests, long TreatmentErrors, long ControlRequests, long ControlErrors);

public sealed class MetricStore(TimeProvider clock)
{
    private static readonly TimeSpan Retention = TimeSpan.FromMinutes(15);

    private readonly ConcurrentDictionary<string, FlagMetrics> flags = new();

    public void Record(string flagKey, bool treatment, long requests, long errors)
    {
        var metrics = flags.GetOrAdd(flagKey, _ => new FlagMetrics());
        metrics.Add(Now(), treatment, requests, errors, Now() - (long)Retention.TotalSeconds);
    }

    public (ArmStats Treatment, ArmStats Control) Window(string flagKey, TimeSpan window, DateTimeOffset since)
    {
        if (!flags.TryGetValue(flagKey, out var metrics))
        {
            return (default, default);
        }

        var from = Math.Max(Now() - (long)window.TotalSeconds, since.ToUnixTimeSeconds() + 1);
        return metrics.Sum(from);
    }

    public IReadOnlyList<SeriesPoint> Series(string flagKey, int seconds)
    {
        var now = Now();
        return flags.TryGetValue(flagKey, out var metrics)
            ? metrics.Series(now - seconds + 1, now)
            : [];
    }

    public void Remove(string flagKey) => flags.TryRemove(flagKey, out _);

    private long Now() => clock.GetUtcNow().ToUnixTimeSeconds();

    private sealed class Bucket
    {
        public long TreatmentRequests;
        public long TreatmentErrors;
        public long ControlRequests;
        public long ControlErrors;
    }

    private sealed class FlagMetrics
    {
        private readonly object gate = new();
        private readonly SortedDictionary<long, Bucket> buckets = [];

        public void Add(long second, bool treatment, long requests, long errors, long oldest)
        {
            lock (gate)
            {
                if (!buckets.TryGetValue(second, out var bucket))
                {
                    bucket = new Bucket();
                    buckets[second] = bucket;
                    while (buckets.Count > 0 && buckets.Keys.First() < oldest)
                    {
                        buckets.Remove(buckets.Keys.First());
                    }
                }

                if (treatment)
                {
                    bucket.TreatmentRequests += requests;
                    bucket.TreatmentErrors += errors;
                }
                else
                {
                    bucket.ControlRequests += requests;
                    bucket.ControlErrors += errors;
                }
            }
        }

        public (ArmStats, ArmStats) Sum(long from)
        {
            long tr = 0, te = 0, cr = 0, ce = 0;
            lock (gate)
            {
                foreach (var (second, bucket) in buckets)
                {
                    if (second < from)
                    {
                        continue;
                    }

                    tr += bucket.TreatmentRequests;
                    te += bucket.TreatmentErrors;
                    cr += bucket.ControlRequests;
                    ce += bucket.ControlErrors;
                }
            }

            return (new ArmStats(tr, te), new ArmStats(cr, ce));
        }

        public List<SeriesPoint> Series(long from, long to)
        {
            var points = new List<SeriesPoint>((int)(to - from + 1));
            lock (gate)
            {
                for (var second = from; second <= to; second++)
                {
                    points.Add(buckets.TryGetValue(second, out var b)
                        ? new SeriesPoint(second, b.TreatmentRequests, b.TreatmentErrors, b.ControlRequests, b.ControlErrors)
                        : new SeriesPoint(second, 0, 0, 0, 0));
                }
            }

            return points;
        }
    }
}
