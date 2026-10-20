using System.Text.Json;
using ShipSafe.Core;

namespace ShipSafe.Tests;

public class EvaluatorTests
{
    [Fact]
    public void Decisions_match_the_vectors_shared_with_the_typescript_sdk()
    {
        var vectors = JsonSerializer.Deserialize<List<EvaluationVector>>(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "spec", "evaluation.json")), ShipSafeJson.Options)!;

        Assert.NotEmpty(vectors);
        foreach (var vector in vectors)
        {
            var user = new UserContext(vector.User.Id, vector.User.Attributes);
            var decision = FlagEvaluator.Evaluate(vector.Flag, user);
            Assert.True(
                vector.Enabled == decision.Enabled && string.Equals(vector.Reason, decision.Reason.ToString(), StringComparison.OrdinalIgnoreCase),
                $"{vector.Flag.Key}/{vector.User.Id}: expected {vector.Enabled}/{vector.Reason}, got {decision.Enabled}/{decision.Reason}");
        }
    }

    [Fact]
    public void Disabled_flag_is_off_for_everyone()
    {
        var flag = new FlagDefinition { Key = "f", Enabled = false, RolloutPercent = 100 };
        var decision = FlagEvaluator.Evaluate(flag, new UserContext("u"));
        Assert.False(decision.Enabled);
        Assert.Equal(DecisionReason.Disabled, decision.Reason);
    }

    [Fact]
    public void Missing_attribute_fails_an_in_rule_and_passes_a_not_in_rule()
    {
        var inRule = new FlagDefinition
        {
            Key = "f", Enabled = true, RolloutPercent = 100,
            Conditions = [new Condition("country", ConditionOperator.In, ["CA"])]
        };
        var notInRule = inRule with { Conditions = [new Condition("country", ConditionOperator.NotIn, ["CA"])] };
        var anonymous = new UserContext("u");

        Assert.Equal(DecisionReason.ConditionNotMet, FlagEvaluator.Evaluate(inRule, anonymous).Reason);
        Assert.True(FlagEvaluator.Evaluate(notInRule, anonymous).Enabled);
    }

    [Fact]
    public void Attribute_names_and_values_ignore_case()
    {
        var flag = new FlagDefinition
        {
            Key = "f", Enabled = true, RolloutPercent = 100,
            Conditions = [new Condition("Country", ConditionOperator.In, ["ca"])]
        };
        var user = new UserContext("u", new Dictionary<string, string> { ["COUNTRY"] = "CA" });
        Assert.True(FlagEvaluator.Evaluate(flag, user).Enabled);
    }

    [Fact]
    public void Every_rule_must_match()
    {
        var flag = new FlagDefinition
        {
            Key = "f", Enabled = true, RolloutPercent = 100,
            Conditions =
            [
                new Condition("country", ConditionOperator.In, ["CA"]),
                new Condition("plan", ConditionOperator.In, ["beta"])
            ]
        };
        var canadianFree = new UserContext("u", new Dictionary<string, string> { ["country"] = "CA", ["plan"] = "free" });
        var canadianBeta = canadianFree.With("plan", "beta");

        Assert.False(FlagEvaluator.Evaluate(flag, canadianFree).Enabled);
        Assert.True(FlagEvaluator.Evaluate(flag, canadianBeta).Enabled);
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(0.01, 1)]
    [InlineData(12.34, 1234)]
    [InlineData(50, 5000)]
    [InlineData(100, 10000)]
    public void Percent_converts_to_a_bucket_threshold(double percent, int expected)
    {
        Assert.Equal(expected, FlagEvaluator.Threshold(percent));
    }

    private sealed record SpecUser(string Id, Dictionary<string, string>? Attributes);

    private sealed record EvaluationVector(FlagDefinition Flag, SpecUser User, bool Enabled, string Reason);
}
