using Microsoft.EntityFrameworkCore;
using ShipSafe.Core;
using ShipSafe.Server.Data;
using ShipSafe.Server.Services;

namespace ShipSafe.Server.Endpoints;

public sealed record FlagMetricsView(
    GuardAssessment Assessment,
    int WindowSeconds,
    IReadOnlyList<SeriesPoint> Series);

public sealed record ProposalView(
    int Id,
    string FlagKey,
    DateTimeOffset CreatedAt,
    string Status,
    GuardAssessment? Evidence,
    string? DecidedBy,
    DateTimeOffset? DecidedAt);

public sealed record AuditView(
    int Id,
    DateTimeOffset At,
    string Actor,
    string Action,
    string FlagKey,
    string Summary,
    GuardAssessment? Evidence);

public static class AdminEndpoints
{
    public static void MapAdmin(this WebApplication app)
    {
        var api = app.MapGroup("/api").RequireAdminKey();

        api.MapGet("/flags", (FlagService flags) => flags.Snapshot.Flags);

        api.MapGet("/flags/{key}", (string key, FlagService flags) =>
            flags.Find(key) is { } flag ? Results.Ok(flag) : Results.NotFound());

        api.MapPost("/flags", async (FlagInput input, HttpContext http, FlagService flags) =>
        {
            input = FlagValidator.Normalize(input);
            var errors = FlagValidator.Validate(input);
            if (errors.Count > 0)
            {
                return Results.ValidationProblem(errors);
            }

            var created = await flags.CreateAsync(input, Auth.Actor(http), http.RequestAborted);
            return created is null
                ? Results.Conflict(new { error = $"Flag '{input.Key}' already exists" })
                : Results.Created($"/api/flags/{created.Key}", created);
        });

        api.MapPut("/flags/{key}", async (string key, FlagInput input, HttpContext http, FlagService flags) =>
        {
            input = FlagValidator.Normalize(input with { Key = key });
            var errors = FlagValidator.Validate(input);
            if (errors.Count > 0)
            {
                return Results.ValidationProblem(errors);
            }

            var updated = await flags.UpdateAsync(key, input, Auth.Actor(http), http.RequestAborted);
            return updated is null ? Results.NotFound() : Results.Ok(updated);
        });

        api.MapDelete("/flags/{key}", async (string key, HttpContext http, FlagService flags) =>
            await flags.DeleteAsync(key, Auth.Actor(http), http.RequestAborted) ? Results.NoContent() : Results.NotFound());

        api.MapGet("/flags/{key}/metrics", (string key, int? seconds, FlagService flags, RollbackService rollbacks, MetricStore metrics) =>
        {
            if (flags.Find(key) is not { } flag)
            {
                return Results.NotFound();
            }

            var span = Math.Clamp(seconds ?? 120, 10, 900);
            return Results.Ok(new FlagMetricsView(rollbacks.Assess(flag), flag.Guard.WindowSeconds, metrics.Series(key, span)));
        });

        api.MapGet("/audit", async (string? flagKey, int? limit, IDbContextFactory<ShipSafeDb> dbFactory, CancellationToken ct) =>
        {
            await using var db = await dbFactory.CreateDbContextAsync(ct);
            var query = db.Audit.AsNoTracking();
            if (!string.IsNullOrEmpty(flagKey))
            {
                query = query.Where(a => a.FlagKey == flagKey);
            }

            var rows = await query.OrderByDescending(a => a.Id).Take(Math.Clamp(limit ?? 100, 1, 500)).ToListAsync(ct);
            return rows.Select(a => new AuditView(a.Id, a.At, a.Actor, a.Action, a.FlagKey, a.Summary, ParseEvidence(a.Evidence)));
        });

        api.MapGet("/proposals", async (string? status, RollbackService rollbacks, CancellationToken ct) =>
            (await rollbacks.ListAsync(status, ct)).Select(ToView));

        api.MapPost("/proposals/{id:int}/approve", async (int id, HttpContext http, RollbackService rollbacks) =>
            await rollbacks.ApproveAsync(id, Auth.Actor(http), http.RequestAborted) is { } p ? Results.Ok(ToView(p)) : Results.NotFound());

        api.MapPost("/proposals/{id:int}/dismiss", async (int id, HttpContext http, RollbackService rollbacks) =>
            await rollbacks.DismissAsync(id, Auth.Actor(http), http.RequestAborted) is { } p ? Results.Ok(ToView(p)) : Results.NotFound());
    }

    private static ProposalView ToView(RollbackProposal p) =>
        new(p.Id, p.FlagKey, p.CreatedAt, p.Status, ParseEvidence(p.Evidence), p.DecidedBy, p.DecidedAt);

    private static GuardAssessment? ParseEvidence(string? json) =>
        string.IsNullOrEmpty(json) ? null : System.Text.Json.JsonSerializer.Deserialize<GuardAssessment>(json, ShipSafeJson.Options);
}
