using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ShipSafe.Core;
using ShipSafe.Server.Data;

namespace ShipSafe.Server.Services;

public sealed class RollbackService(
    FlagService flags,
    MetricStore metrics,
    IDbContextFactory<ShipSafeDb> dbFactory,
    TimeProvider clock)
{
    public GuardAssessment Assess(FlagDefinition flag)
    {
        var (treatment, control) = metrics.Window(flag.Key, TimeSpan.FromSeconds(flag.Guard.WindowSeconds), flag.UpdatedAt);
        return RollbackPolicy.Assess(flag.Guard, treatment, control);
    }

    public async Task EvaluateAsync(FlagDefinition flag, CancellationToken ct = default)
    {
        if (!flag.Enabled || !flag.Guard.Enabled)
        {
            return;
        }

        var assessment = Assess(flag);
        if (assessment.Verdict != GuardVerdict.Regressed)
        {
            return;
        }

        if (flag.Guard.Mode == GuardMode.Auto)
        {
            await flags.DisableAsync(flag.Key, flag.Version, FlagService.SystemActor, "rollback", Describe(assessment), assessment, ct: ct);
            return;
        }

        await ProposeAsync(flag, assessment, ct);
    }

    public async Task<IReadOnlyList<RollbackProposal>> ListAsync(string? status, CancellationToken ct = default)
    {
        await using var db = await dbFactory.CreateDbContextAsync(ct);
        var query = db.Proposals.AsNoTracking();
        if (!string.IsNullOrEmpty(status))
        {
            query = query.Where(p => p.Status == status);
        }

        return await query.OrderByDescending(p => p.Id).Take(100).ToListAsync(ct);
    }

    public async Task<RollbackProposal?> ApproveAsync(int id, string actor, CancellationToken ct = default)
    {
        await using var db = await dbFactory.CreateDbContextAsync(ct);
        var proposal = await db.Proposals.FirstOrDefaultAsync(p => p.Id == id && p.Status == ProposalStatus.Pending, ct);
        if (proposal is null)
        {
            return null;
        }

        var flag = flags.Find(proposal.FlagKey);
        var evidence = JsonSerializer.Deserialize<GuardAssessment>(proposal.Evidence, ShipSafeJson.Options)!;
        if (flag is not null)
        {
            await flags.DisableAsync(flag.Key, flag.Version, actor, "rollback-approved",
                $"Approved rollback. {Describe(evidence)}", evidence, proposal.Id, ct);
        }

        await using var write = await dbFactory.CreateDbContextAsync(ct);
        proposal = await write.Proposals.FirstAsync(p => p.Id == id, ct);
        proposal.Status = ProposalStatus.Approved;
        proposal.DecidedBy = actor;
        proposal.DecidedAt = clock.GetUtcNow();
        await write.SaveChangesAsync(ct);
        return proposal;
    }

    public async Task<RollbackProposal?> DismissAsync(int id, string actor, CancellationToken ct = default)
    {
        await using var db = await dbFactory.CreateDbContextAsync(ct);
        var proposal = await db.Proposals.FirstOrDefaultAsync(p => p.Id == id && p.Status == ProposalStatus.Pending, ct);
        if (proposal is null)
        {
            return null;
        }

        var now = clock.GetUtcNow();
        proposal.Status = ProposalStatus.Dismissed;
        proposal.DecidedBy = actor;
        proposal.DecidedAt = now;
        db.Audit.Add(new AuditEntry
        {
            At = now,
            Actor = actor,
            Action = "rollback-dismissed",
            FlagKey = proposal.FlagKey,
            Summary = "Dismissed rollback proposal",
            Evidence = proposal.Evidence
        });
        await db.SaveChangesAsync(ct);
        return proposal;
    }

    private async Task ProposeAsync(FlagDefinition flag, GuardAssessment assessment, CancellationToken ct)
    {
        await using var db = await dbFactory.CreateDbContextAsync(ct);
        if (await db.Proposals.AnyAsync(p => p.FlagKey == flag.Key && p.Status == ProposalStatus.Pending, ct))
        {
            return;
        }

        var now = clock.GetUtcNow();
        var evidence = JsonSerializer.Serialize(assessment, ShipSafeJson.Options);
        db.Proposals.Add(new RollbackProposal { FlagKey = flag.Key, CreatedAt = now, Evidence = evidence });
        db.Audit.Add(new AuditEntry
        {
            At = now,
            Actor = FlagService.SystemActor,
            Action = "rollback-proposed",
            FlagKey = flag.Key,
            Summary = $"Rollback proposed, waiting for approval. {Describe(assessment)}",
            Evidence = evidence
        });
        await db.SaveChangesAsync(ct);
        Telemetry.Proposals.Add(1);
    }

    private static string Describe(GuardAssessment a) =>
        $"New version error rate {a.Treatment.Rate:P1} ({a.Treatment.Errors}/{a.Treatment.Requests}) vs " +
        $"{a.Control.Rate:P1} ({a.Control.Errors}/{a.Control.Requests}) on the old version, z={a.Z:0.0}, p={a.PValue:0.#####e+0}";
}
