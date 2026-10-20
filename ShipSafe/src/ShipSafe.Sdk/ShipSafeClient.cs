using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using ShipSafe.Core;

namespace ShipSafe.Sdk;

public sealed class ShipSafeOptions
{
    public required Uri BaseUrl { get; init; }
    public required string SdkKey { get; init; }
    public TimeSpan FlushInterval { get; init; } = TimeSpan.FromMilliseconds(500);
    public TimeSpan StartTimeout { get; init; } = TimeSpan.FromSeconds(5);
    public TimeSpan MaxReconnectDelay { get; init; } = TimeSpan.FromSeconds(10);
    public TimeSpan StreamIdleTimeout { get; init; } = TimeSpan.FromSeconds(45);
    public HttpClient? HttpClient { get; init; }
    public ILogger? Logger { get; init; }
}

public sealed class ShipSafeClient : IDisposable, IAsyncDisposable
{
    private readonly ShipSafeOptions options;
    private readonly HttpClient http;
    private readonly bool ownsHttp;
    private readonly ILogger log;
    private readonly CancellationTokenSource stopping = new();
    private readonly TaskCompletionSource ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly ConcurrentDictionary<(string Key, bool Variant), Counter> counters = new();
    private readonly Task streamTask;
    private readonly Task flushTask;

    private Dictionary<string, FlagDefinition> flags = new();
    private long revision;

    private ShipSafeClient(ShipSafeOptions options)
    {
        this.options = options;
        log = options.Logger ?? NullLogger.Instance;
        ownsHttp = options.HttpClient is null;
        http = options.HttpClient ?? new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        streamTask = Task.Run(RunStreamAsync);
        flushTask = Task.Run(RunFlushAsync);
    }

    public event Action<FlagSnapshot>? Updated;

    public bool IsReady => ready.Task.IsCompletedSuccessfully;
    public long Revision => Volatile.Read(ref revision);

    public static async Task<ShipSafeClient> CreateAsync(ShipSafeOptions options, CancellationToken ct = default)
    {
        var client = new ShipSafeClient(options);
        var timeout = Task.Delay(options.StartTimeout, ct);
        await Task.WhenAny(client.ready.Task, timeout);
        ct.ThrowIfCancellationRequested();
        return client;
    }

    public FlagDefinition? GetFlag(string flagKey) =>
        Volatile.Read(ref flags).GetValueOrDefault(flagKey);

    public Decision Evaluate(string flagKey, UserContext user)
    {
        var current = Volatile.Read(ref flags);
        return current.TryGetValue(flagKey, out var flag)
            ? FlagEvaluator.Evaluate(flag, user)
            : new Decision(flagKey, false, DecisionReason.FlagNotFound);
    }

    public bool IsEnabled(string flagKey, UserContext user) => Evaluate(flagKey, user).Enabled;

    public void Track(Decision decision, bool success)
    {
        if (decision.Reason == DecisionReason.FlagNotFound)
        {
            return;
        }

        var counter = counters.GetOrAdd((decision.FlagKey, decision.Enabled), _ => new Counter());
        counter.Add(success);
    }

    public async Task FlushAsync(CancellationToken ct = default)
    {
        var reports = new List<MetricReport>();
        foreach (var (id, counter) in counters)
        {
            var (requests, errors) = counter.Drain();
            if (requests > 0)
            {
                reports.Add(new MetricReport(id.Key, id.Variant, requests, errors));
            }
        }

        if (reports.Count == 0)
        {
            return;
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(options.BaseUrl, "sdk/events"))
            {
                Content = JsonContent.Create(new MetricBatch(reports), options: ShipSafeJson.Options)
            };
            request.Headers.Add("X-Sdk-Key", options.SdkKey);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(10));
            using var response = await http.SendAsync(request, timeout.Token);
            response.EnsureSuccessStatusCode();
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            log.LogWarning(ex, "Failed to report metrics, requeueing {Count} entries", reports.Count);
            foreach (var report in reports)
            {
                counters.GetOrAdd((report.FlagKey, report.Variant), _ => new Counter()).Add(report.Requests, report.Errors);
            }
        }
    }

    public void Dispose() => DisposeAsync().AsTask().GetAwaiter().GetResult();

    public async ValueTask DisposeAsync()
    {
        if (stopping.IsCancellationRequested)
        {
            return;
        }

        stopping.Cancel();
        await Task.WhenAll(streamTask, flushTask).WaitAsync(TimeSpan.FromSeconds(2)).ContinueWith(_ => { });
        try
        {
            await FlushAsync(CancellationToken.None);
        }
        catch (Exception ex)
        {
            log.LogDebug(ex, "Final flush failed");
        }

        if (ownsHttp)
        {
            http.Dispose();
        }

        stopping.Dispose();
    }

    private async Task RunFlushAsync()
    {
        using var timer = new PeriodicTimer(options.FlushInterval);
        try
        {
            while (await timer.WaitForNextTickAsync(stopping.Token))
            {
                await FlushAsync(stopping.Token);
            }
        }
        catch (OperationCanceledException)
        {
        }
    }

    private async Task RunStreamAsync()
    {
        var delay = TimeSpan.FromMilliseconds(250);
        while (!stopping.IsCancellationRequested)
        {
            try
            {
                await ReadStreamAsync();
                delay = TimeSpan.FromMilliseconds(250);
            }
            catch (OperationCanceledException) when (stopping.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                log.LogWarning("Flag stream disconnected: {Message}. Retrying in {Delay}", ex.Message, delay);
            }

            try
            {
                await Task.Delay(delay, stopping.Token);
            }
            catch (OperationCanceledException)
            {
                return;
            }

            delay = TimeSpan.FromMilliseconds(Math.Min(delay.TotalMilliseconds * 2, options.MaxReconnectDelay.TotalMilliseconds));
        }
    }

    private async Task ReadStreamAsync()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(options.BaseUrl, "sdk/stream"));
        request.Headers.Add("X-Sdk-Key", options.SdkKey);
        request.Headers.Add("Accept", "text/event-stream");
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, stopping.Token);
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(stopping.Token);
        using var reader = new StreamReader(stream);
        using var idle = CancellationTokenSource.CreateLinkedTokenSource(stopping.Token);

        var eventName = "message";
        var data = new System.Text.StringBuilder();
        while (true)
        {
            idle.CancelAfter(options.StreamIdleTimeout);
            var line = await reader.ReadLineAsync(idle.Token);
            if (line is null)
            {
                throw new IOException("Stream closed by server");
            }

            if (line.Length == 0)
            {
                if (data.Length > 0 && eventName == "snapshot")
                {
                    Apply(JsonSerializer.Deserialize<FlagSnapshot>(data.ToString(), ShipSafeJson.Options)!);
                }

                eventName = "message";
                data.Clear();
            }
            else if (line.StartsWith("event:", StringComparison.Ordinal))
            {
                eventName = line[6..].Trim();
            }
            else if (line.StartsWith("data:", StringComparison.Ordinal))
            {
                data.Append(line[5..].TrimStart());
            }
        }
    }

    private void Apply(FlagSnapshot snapshot)
    {
        if (snapshot.Revision < Revision)
        {
            return;
        }

        Volatile.Write(ref flags, snapshot.Flags.ToDictionary(f => f.Key));
        Volatile.Write(ref revision, snapshot.Revision);
        ready.TrySetResult();
        Updated?.Invoke(snapshot);
    }

    private sealed class Counter
    {
        private long requests;
        private long errors;

        public void Add(bool success)
        {
            Interlocked.Increment(ref requests);
            if (!success)
            {
                Interlocked.Increment(ref errors);
            }
        }

        public void Add(long requestCount, long errorCount)
        {
            Interlocked.Add(ref requests, requestCount);
            Interlocked.Add(ref errors, errorCount);
        }

        public (long Requests, long Errors) Drain()
        {
            var r = Interlocked.Exchange(ref requests, 0);
            var e = Interlocked.Exchange(ref errors, 0);
            return (r, e);
        }
    }
}
