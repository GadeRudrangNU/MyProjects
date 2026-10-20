using System.Text.RegularExpressions;
using ShipSafe.Core;

namespace ShipSafe.Server.Services;

public sealed record FlagInput
{
    public string Key { get; init; } = "";
    public string Description { get; init; } = "";
    public bool Enabled { get; init; }
    public double RolloutPercent { get; init; }
    public IReadOnlyList<Condition> Conditions { get; init; } = [];
    public GuardSettings Guard { get; init; } = new();
}

public static partial class FlagValidator
{
    [GeneratedRegex("^[a-z0-9][a-z0-9._-]{0,63}$")]
    private static partial Regex KeyPattern();

    public static Dictionary<string, string[]> Validate(FlagInput input)
    {
        var errors = new Dictionary<string, string[]>();

        if (!KeyPattern().IsMatch(input.Key))
        {
            errors["key"] = ["Use 1-64 lowercase letters, digits, '.', '_' or '-', starting with a letter or digit."];
        }

        if (input.Description.Length > 500)
        {
            errors["description"] = ["Keep the description under 500 characters."];
        }

        if (double.IsNaN(input.RolloutPercent) || input.RolloutPercent is < 0 or > 100)
        {
            errors["rolloutPercent"] = ["Rollout must be between 0 and 100."];
        }

        if (input.Conditions.Count > 20)
        {
            errors["conditions"] = ["At most 20 conditions are allowed."];
        }
        else if (input.Conditions.Any(c => string.IsNullOrWhiteSpace(c.Attribute) || c.Values is null || c.Values.Count == 0 || c.Values.Any(string.IsNullOrWhiteSpace)))
        {
            errors["conditions"] = ["Every condition needs an attribute and at least one value."];
        }

        var guard = input.Guard;
        if (guard.MinSamples < 1)
        {
            errors["guard.minSamples"] = ["Minimum samples must be at least 1."];
        }

        if (guard.Alpha is <= 0 or >= 0.5)
        {
            errors["guard.alpha"] = ["Alpha must be between 0 and 0.5."];
        }

        if (guard.MinDifference is < 0 or > 1)
        {
            errors["guard.minDifference"] = ["Minimum difference must be between 0 and 1."];
        }

        if (guard.WindowSeconds is < 5 or > 3600)
        {
            errors["guard.windowSeconds"] = ["Window must be between 5 and 3600 seconds."];
        }

        return errors;
    }

    public static FlagInput Normalize(FlagInput input) => input with
    {
        Key = input.Key.Trim(),
        Description = input.Description.Trim(),
        RolloutPercent = Math.Round(input.RolloutPercent, 2, MidpointRounding.AwayFromZero),
        Conditions = input.Conditions
            .Select(c => c with { Attribute = c.Attribute.Trim(), Values = c.Values.Select(v => v.Trim()).ToList() })
            .ToList()
    };
}
