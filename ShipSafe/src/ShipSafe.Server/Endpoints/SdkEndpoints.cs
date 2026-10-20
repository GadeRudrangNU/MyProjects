using System.Text;
using System.Text.Json;
using ShipSafe.Core;
using ShipSafe.Server.Services;

namespace ShipSafe.Server.Endpoints;

public static class SdkEndpoints
{
    private static readonly TimeSpan Heartbeat = TimeSpan.FromSeconds(15);

    public static void MapSdk(this WebApplication app)
    {
        var sdk = app.MapGroup("/sdk").RequireSdkKey();

        sdk.MapGet("/flags", (FlagService flags) => flags.Snapshot);

        sdk.MapPost("/events", (MetricBatch batch, FlagService flags, MetricStore metrics) =>
        {
            if (batch.Reports is null || batch.Reports.Count > 1000)
            {
                return Results.BadRequest(new { error = "Send between 0 and 1000 reports per batch" });
            }

            var accepted = 0;
            foreach (var report in batch.Reports)
            {
                if (report.Requests <= 0 || report.Errors < 0 || report.Errors > report.Requests || flags.Find(report.FlagKey) is null)
                {
                    continue;
                }

                metrics.Record(report.FlagKey, report.Variant, report.Requests, report.Errors);
                accepted++;
            }

            Telemetry.Reports.Add(accepted);
            return Results.Ok(new { accepted });
        });

        sdk.MapGet("/stream", Stream);
    }

    private static async Task Stream(HttpContext http, FlagService flags, FlagBroadcaster broadcaster)
    {
        var response = http.Response;
        response.Headers.ContentType = "text/event-stream";
        response.Headers.CacheControl = "no-cache";
        response.Headers["X-Accel-Buffering"] = "no";

        Telemetry.StreamConnections.Add(1);
        using var subscription = broadcaster.Subscribe();
        try
        {
            await WriteSnapshot(response, flags.Snapshot, http.RequestAborted);
            var reader = subscription.Reader;
            while (!http.RequestAborted.IsCancellationRequested)
            {
                using var wait = CancellationTokenSource.CreateLinkedTokenSource(http.RequestAborted);
                wait.CancelAfter(Heartbeat);
                try
                {
                    var snapshot = await reader.ReadAsync(wait.Token);
                    await WriteSnapshot(response, snapshot, http.RequestAborted);
                }
                catch (OperationCanceledException) when (!http.RequestAborted.IsCancellationRequested)
                {
                    await response.WriteAsync(": ping\n\n", http.RequestAborted);
                    await response.Body.FlushAsync(http.RequestAborted);
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            Telemetry.StreamConnections.Add(-1);
        }
    }

    private static async Task WriteSnapshot(HttpResponse response, FlagSnapshot snapshot, CancellationToken ct)
    {
        var payload = $"event: snapshot\ndata: {JsonSerializer.Serialize(snapshot, ShipSafeJson.Options)}\n\n";
        await response.Body.WriteAsync(Encoding.UTF8.GetBytes(payload), ct);
        await response.Body.FlushAsync(ct);
    }
}
