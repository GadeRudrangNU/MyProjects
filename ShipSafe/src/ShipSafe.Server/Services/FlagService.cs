using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ShipSafe.Core;
using ShipSafe.Server.Data;

namespace ShipSafe.Server.Services;

public sealed class FlagService(
    IDbContextFactory<ShipSafeDb> dbFactory,
    FlagBroadcaster broadcaster,
    MetricStore metrics,
    TimeProvider clock)
{
    public const string SystemActor = "shipsafe-auto";

    private readonly SemaphoreSlim gate = new(1, 1);
    private FlagSnapshot snapshot = new(0, []);
    private long revision;

    public FlagSnapshot Snapshot => Volatile.Read(ref snapshot);

    public FlagDefinition? Find(string key) =>
        Snapshot.Flags.FirstOrDefault(f => f.Key == key);

    public async Task InitializeAsync(CancellationToken ct = default)
    {
        await using var db = await dbFactory.CreateDbContextAsync(ct);
        await db.Database.EnsureCreatedAsync(ct);
        revision = clock.GetUtcNow().ToUnixTimeMilliseconds();
        await RefreshAsync(db, ct, publish: false);
    }

    public async Task<FlagDefinition?> CreateAsync(FlagInput input, string actor, CancellationToken ct = default)
    {
        await gate.WaitAsync(ct);
        try
        {
            await using var db = await dbFactory.CreateDbContextAsync(ct);
            if (await db.Flags.AnyAsync(f => f.Key == input.Key, ct))
            {
                return null;
            }

            var now = clock.GetUtcNow();
            var entity = new FlagEntity { Key = input.Key, CreatedAt = now };
            Apply(entity, input, now);
            entity.Version = 1;
            db.Flags.Add(entity);
            var created = ToDefinition(entity);
            db.Audit.Add(Audit(now, actor, "created", created.Key,
                $"Created flag ({Describe(created)})", null, created));
            await db.SaveChangesAsync(ct);
            await RefreshAsync(db, ct);
            Telemetry.FlagChanges.Add(1);
            return created;
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<FlagDefinition?> UpdateAsync(string key, FlagInput input, string actor, CancellationToken ct = default)
    {
        await gate.WaitAsync(ct);
        try
        {
            await using var db = await dbFactory.CreateDbContextAsync(ct);
            var entity = await db.Flags.FirstOrDefaultAsync(f => f.Key == key, ct);
            if (entity is null)
            {
                return null;
            }

            var before = ToDefinition(entity);
            var now = clock.GetUtcNow();
            Apply(entity, input with { Key = key }, now);
            entity.Version++;
            var after = ToDefinition(entity);
            var changes = Diff(before, after);
            if (changes.Length == 0)
            {
                entity.Version--;
                entity.UpdatedAt = before.UpdatedAt;
                return before;
            }

            db.Audit.Add(Audit(now, actor, "updated", key, changes, before, after));
            await DismissPendingAsync(db, key, now, ct);
            await db.SaveChangesAsync(ct);
            await RefreshAsync(db, ct);
            Telemetry.FlagChanges.Add(1);
            return after;
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<bool> DeleteAsync(string key, string actor, CancellationToken ct = default)
    {
        await gate.WaitAsync(ct);
        try
        {
            await using var db = await dbFactory.CreateDbContextAsync(ct);
            var entity = await db.Flags.FirstOrDefaultAsync(f => f.Key == key, ct);
            if (entity is null)
            {
                return false;
            }

            var before = ToDefinition(entity);
            var now = clock.GetUtcNow();
            db.Flags.Remove(entity);
            db.Audit.Add(Audit(now, actor, "deleted", key, "Deleted flag", before, null));
            await DismissPendingAsync(db, key, now, ct);
            await db.SaveChangesAsync(ct);
            await RefreshAsync(db, ct);
            metrics.Remove(key);
            Telemetry.FlagChanges.Add(1);
            return true;
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<FlagDefinition?> DisableAsync(
        string key,
        int expectedVersion,
        string actor,
        string action,
        string summary,
        GuardAssessment evidence,
        int? proposalId = null,
        CancellationToken ct = default)
    {
        await gate.WaitAsync(ct);
        try
        {
            await using var db = await dbFactory.CreateDbContextAsync(ct);
            var entity = await db.Flags.FirstOrDefaultAsync(f => f.Key == key, ct);
            if (entity is null || !entity.Enabled || entity.Version != expectedVersion)
            {
                return null;
            }

            var before = ToDefinition(entity);
            var now = clock.GetUtcNow();
            entity.Enabled = false;
            entity.Version++;
            entity.UpdatedAt = now;
            var after = ToDefinition(entity);

            var entry = Audit(now, actor, action, key, summary, before, after);
            entry.Evidence = JsonSerializer.Serialize(evidence, ShipSafeJson.Options);
            db.Audit.Add(entry);

            await DismissPendingAsync(db, key, now, ct, except: proposalId);
            await db.SaveChangesAsync(ct);
            await RefreshAsync(db, ct);
            Telemetry.Rollbacks.Add(1);
            return after;
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task RefreshAsync(ShipSafeDb db, CancellationToken ct, bool publish = true)
    {
        var entities = await db.Flags.AsNoTracking().OrderBy(f => f.Key).ToListAsync(ct);
        var next = new FlagSnapshot(Interlocked.Increment(ref revision), entities.Select(ToDefinition).ToList());
        Volatile.Write(ref snapshot, next);
        if (publish)
        {
            broadcaster.Publish(next);
        }
    }

    private static async Task DismissPendingAsync(ShipSafeDb db, string key, DateTimeOffset now, CancellationToken ct, int? except = null)
    {
        var pending = await db.Proposals
            .Where(p => p.FlagKey == key && p.Status == ProposalStatus.Pending && p.Id != except)
            .ToListAsync(ct);
        foreach (var proposal in pending)
        {
            proposal.Status = ProposalStatus.Dismissed;
            proposal.DecidedBy = SystemActor;
            proposal.DecidedAt = now;
        }
    }

    private static AuditEntry Audit(DateTimeOffset at, string actor, string action, string key, string summary, FlagDefinition? before, FlagDefinition? after) => new()
    {
        At = at,
        Actor = actor,
        Action = action,
        FlagKey = key,
        Summary = summary,
        Before = before is null ? null : JsonSerializer.Serialize(before, ShipSafeJson.Options),
        After = after is null ? null : JsonSerializer.Serialize(after, ShipSafeJson.Options)
    };

    private static void Apply(FlagEntity entity, FlagInput input, DateTimeOffset now)
    {
        entity.Key = input.Key;
        entity.Description = input.Description;
        entity.Enabled = input.Enabled;
        entity.RolloutPercent = input.RolloutPercent;
        entity.ConditionsJson = JsonSerializer.Serialize(input.Conditions, ShipSafeJson.Options);
        entity.GuardJson = JsonSerializer.Serialize(input.Guard, ShipSafeJson.Options);
        entity.UpdatedAt = now;
    }

    public static FlagDefinition ToDefinition(FlagEntity entity) => new()
    {
        Key = entity.Key,
        Description = entity.Description,
        Enabled = entity.Enabled,
        RolloutPercent = entity.RolloutPercent,
        Conditions = JsonSerializer.Deserialize<List<Condition>>(entity.ConditionsJson, ShipSafeJson.Options) ?? [],
        Guard = JsonSerializer.Deserialize<GuardSettings>(entity.GuardJson, ShipSafeJson.Options) ?? new GuardSettings(),
        Version = entity.Version,
        UpdatedAt = entity.UpdatedAt
    };

    private static string Describe(FlagDefinition flag)
    {
        var parts = new List<string>
        {
            flag.Enabled ? "on" : "off",
            FormattableString.Invariant($"{flag.RolloutPercent:0.##}% rollout")
        };
        if (flag.Conditions.Count > 0)
        {
            parts.Add(string.Join(", ", flag.Conditions.Select(DescribeCondition)));
        }

        return string.Join(", ", parts);
    }

    private static string DescribeCondition(Condition c) =>
        $"{c.Attribute} {(c.Operator == ConditionOperator.In ? "in" : "not in")} [{string.Join(", ", c.Values)}]";

    private static string Diff(FlagDefinition before, FlagDefinition after)
    {
        var changes = new List<string>();
        if (before.Enabled != after.Enabled)
        {
            changes.Add(after.Enabled ? "Enabled flag" : "Disabled flag");
        }

        if (before.RolloutPercent != after.RolloutPercent)
        {
            changes.Add(FormattableString.Invariant($"Rollout {before.RolloutPercent:0.##}% to {after.RolloutPercent:0.##}%"));
        }

        var beforeRules = string.Join("; ", before.Conditions.Select(DescribeCondition));
        var afterRules = string.Join("; ", after.Conditions.Select(DescribeCondition));
        if (beforeRules != afterRules)
        {
            changes.Add($"Rules changed to {(afterRules.Length == 0 ? "none" : afterRules)}");
        }

        if (before.Guard != after.Guard)
        {
            changes.Add("Guard settings changed");
        }

        if (before.Description != after.Description)
        {
            changes.Add("Description changed");
        }

        return string.Join("; ", changes);
    }
}
