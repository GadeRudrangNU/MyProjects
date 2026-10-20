using System.Text.Json;
using System.Text.Json.Serialization;

namespace ShipSafe.Core;

public sealed class UserContext
{
    private static readonly Dictionary<string, string> EmptyAttributes = new(StringComparer.OrdinalIgnoreCase);

    public UserContext(string id, IReadOnlyDictionary<string, string>? attributes = null)
    {
        Id = id;
        Attributes = attributes switch
        {
            null or { Count: 0 } => EmptyAttributes,
            Dictionary<string, string> d when ReferenceEquals(d.Comparer, StringComparer.OrdinalIgnoreCase) => d,
            _ => Copy(attributes)
        };
    }

    public string Id { get; }
    public IReadOnlyDictionary<string, string> Attributes { get; }

    public UserContext With(string key, string value)
    {
        var copy = Copy(Attributes);
        copy[key] = value;
        return new UserContext(Id, copy);
    }

    private static Dictionary<string, string> Copy(IReadOnlyDictionary<string, string> source)
    {
        var copy = new Dictionary<string, string>(source.Count, StringComparer.OrdinalIgnoreCase);
        foreach (var pair in source)
        {
            copy[pair.Key] = pair.Value;
        }

        return copy;
    }
}

public enum ConditionOperator
{
    In,
    NotIn
}

public sealed record Condition(string Attribute, ConditionOperator Operator, IReadOnlyList<string> Values);

public enum GuardMode
{
    Auto,
    Approval
}

public sealed record GuardSettings
{
    public bool Enabled { get; init; } = true;
    public GuardMode Mode { get; init; } = GuardMode.Auto;
    public int MinSamples { get; init; } = 200;
    public double Alpha { get; init; } = 0.001;
    public double MinDifference { get; init; } = 0.02;
    public int WindowSeconds { get; init; } = 60;
}

public sealed record FlagDefinition
{
    public required string Key { get; init; }
    public string Description { get; init; } = "";
    public bool Enabled { get; init; }
    public double RolloutPercent { get; init; }
    public IReadOnlyList<Condition> Conditions { get; init; } = [];
    public GuardSettings Guard { get; init; } = new();
    public int Version { get; init; } = 1;
    public DateTimeOffset UpdatedAt { get; init; }
}

public sealed record FlagSnapshot(long Revision, IReadOnlyList<FlagDefinition> Flags);

public enum DecisionReason
{
    FlagNotFound,
    Disabled,
    ConditionNotMet,
    OutsideRollout,
    InRollout
}

public readonly record struct Decision(string FlagKey, bool Enabled, DecisionReason Reason);

public sealed record MetricReport(string FlagKey, bool Variant, long Requests, long Errors);

public sealed record MetricBatch(IReadOnlyList<MetricReport> Reports);

public static class ShipSafeJson
{
    public static JsonSerializerOptions Options { get; } = Create();

    private static JsonSerializerOptions Create()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            DefaultIgnoreCondition = JsonIgnoreCondition.Never
        };
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return options;
    }
}
