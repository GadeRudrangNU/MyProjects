namespace ShipSafe.Server;

public sealed class ShipSafeOptions
{
    public const string Section = "ShipSafe";

    public string AdminKey { get; set; } = "dev-admin-key";
    public string SdkKey { get; set; } = "dev-sdk-key";
    public string Database { get; set; } = "Data Source=shipsafe.db";
    public bool SeedDemo { get; set; }
    public int MonitorIntervalMs { get; set; } = 500;
}
