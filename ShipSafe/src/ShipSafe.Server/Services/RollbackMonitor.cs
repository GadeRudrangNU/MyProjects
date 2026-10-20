using Microsoft.Extensions.Options;

namespace ShipSafe.Server.Services;

public sealed class RollbackMonitor(
    FlagService flags,
    RollbackService rollbacks,
    IOptions<ShipSafeOptions> options,
    TimeProvider clock,
    ILogger<RollbackMonitor> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(options.Value.MonitorIntervalMs), clock);
        while (await WaitAsync(timer, stoppingToken))
        {
            await TickAsync(stoppingToken);
        }
    }

    public async Task TickAsync(CancellationToken ct)
    {
        foreach (var flag in flags.Snapshot.Flags)
        {
            try
            {
                await rollbacks.EvaluateAsync(flag, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Guard evaluation failed for {FlagKey}", flag.Key);
            }
        }
    }

    private static async Task<bool> WaitAsync(PeriodicTimer timer, CancellationToken ct)
    {
        try
        {
            return await timer.WaitForNextTickAsync(ct);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }
}
