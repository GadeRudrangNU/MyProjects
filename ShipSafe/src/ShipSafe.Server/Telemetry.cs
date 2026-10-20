using System.Diagnostics.Metrics;

namespace ShipSafe.Server;

public static class Telemetry
{
    public const string MeterName = "ShipSafe.Server";

    private static readonly Meter Meter = new(MeterName);

    public static readonly Counter<long> Reports = Meter.CreateCounter<long>("shipsafe.sdk.reports");
    public static readonly Counter<long> FlagChanges = Meter.CreateCounter<long>("shipsafe.flag.changes");
    public static readonly Counter<long> Rollbacks = Meter.CreateCounter<long>("shipsafe.rollbacks");
    public static readonly Counter<long> Proposals = Meter.CreateCounter<long>("shipsafe.rollback.proposals");
    public static readonly UpDownCounter<long> StreamConnections = Meter.CreateUpDownCounter<long>("shipsafe.stream.connections");
}
