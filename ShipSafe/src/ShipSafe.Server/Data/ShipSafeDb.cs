using Microsoft.EntityFrameworkCore;

namespace ShipSafe.Server.Data;

public sealed class FlagEntity
{
    public int Id { get; set; }
    public string Key { get; set; } = "";
    public string Description { get; set; } = "";
    public bool Enabled { get; set; }
    public double RolloutPercent { get; set; }
    public string ConditionsJson { get; set; } = "[]";
    public string GuardJson { get; set; } = "{}";
    public int Version { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class AuditEntry
{
    public int Id { get; set; }
    public DateTimeOffset At { get; set; }
    public string Actor { get; set; } = "";
    public string Action { get; set; } = "";
    public string FlagKey { get; set; } = "";
    public string Summary { get; set; } = "";
    public string? Before { get; set; }
    public string? After { get; set; }
    public string? Evidence { get; set; }
}

public static class ProposalStatus
{
    public const string Pending = "pending";
    public const string Approved = "approved";
    public const string Dismissed = "dismissed";
}

public sealed class RollbackProposal
{
    public int Id { get; set; }
    public string FlagKey { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public string Status { get; set; } = ProposalStatus.Pending;
    public string Evidence { get; set; } = "{}";
    public string? DecidedBy { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
}

public sealed class ShipSafeDb(DbContextOptions<ShipSafeDb> options) : DbContext(options)
{
    public DbSet<FlagEntity> Flags => Set<FlagEntity>();
    public DbSet<AuditEntry> Audit => Set<AuditEntry>();
    public DbSet<RollbackProposal> Proposals => Set<RollbackProposal>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<FlagEntity>().HasIndex(f => f.Key).IsUnique();
        modelBuilder.Entity<AuditEntry>().HasIndex(a => a.FlagKey);
        modelBuilder.Entity<RollbackProposal>().HasIndex(p => new { p.FlagKey, p.Status });
    }
}
