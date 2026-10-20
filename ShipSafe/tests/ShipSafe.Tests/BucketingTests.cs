using System.Text;
using System.Text.Json;
using FsCheck;
using FsCheck.Xunit;
using ShipSafe.Core;

namespace ShipSafe.Tests;

public class BucketingTests
{
    [Theory]
    [InlineData("", 0x00000000u)]
    [InlineData("a", 0x3c2569b2u)]
    [InlineData("abc", 0xb3dd93fau)]
    [InlineData("hello", 0x248bfa47u)]
    [InlineData("The quick brown fox jumps over the lazy dog", 0x2e4ff723u)]
    public void Murmur3_matches_reference_values(string text, uint expected)
    {
        Assert.Equal(expected, Bucketing.Murmur3(Encoding.UTF8.GetBytes(text)));
    }

    [Fact]
    public void Buckets_match_the_vectors_shared_with_the_typescript_sdk()
    {
        var vectors = JsonSerializer.Deserialize<List<BucketVector>>(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "spec", "bucketing.json")), ShipSafeJson.Options)!;

        Assert.NotEmpty(vectors);
        foreach (var vector in vectors)
        {
            Assert.Equal(vector.Bucket, Bucketing.Bucket(vector.FlagKey, vector.UserId));
        }
    }

    [Fact]
    public void Very_long_user_ids_are_hashed_without_truncation()
    {
        var a = Bucketing.Bucket("flag", new string('x', 400) + "a");
        var b = Bucketing.Bucket("flag", new string('x', 400) + "b");
        Assert.NotEqual(a, b);
    }

    [Property(MaxTest = 500)]
    public bool Same_user_always_lands_in_the_same_bucket(string? flagKey, string? userId)
    {
        var first = Bucketing.Bucket(flagKey ?? "", userId ?? "");
        var second = Bucketing.Bucket(flagKey ?? "", userId ?? "");
        return first == second && first is >= 0 and < Bucketing.BucketCount;
    }

    [Property(MaxTest = 500)]
    public bool Same_user_always_gets_the_same_answer_from_independent_evaluations(int userSeed, byte percentSeed)
    {
        var percent = percentSeed % 101;
        var user = new UserContext($"user-{userSeed}");
        var results = Enumerable.Range(0, 5)
            .Select(_ => FlagEvaluator.Evaluate(Flag("stable", percent), user).Enabled)
            .Distinct()
            .ToList();
        return results.Count == 1;
    }

    [Property(MaxTest = 500)]
    public bool Raising_the_rollout_never_turns_a_user_off(int userSeed, byte lowSeed, byte highSeed)
    {
        var low = Math.Min(lowSeed % 101, highSeed % 101);
        var high = Math.Max(lowSeed % 101, highSeed % 101);
        var user = new UserContext($"user-{userSeed}");
        var atLow = FlagEvaluator.Evaluate(Flag("monotonic", low), user).Enabled;
        var atHigh = FlagEvaluator.Evaluate(Flag("monotonic", high), user).Enabled;
        return !atLow || atHigh;
    }

    [Property(MaxTest = 30)]
    public bool Rollout_percentage_is_accurate_within_statistical_tolerance(byte percentSeed, int keySeed)
    {
        var percent = 1 + percentSeed % 99;
        var flag = Flag($"flag-{keySeed}", percent);
        const int total = 20_000;
        var enabled = Enumerable.Range(0, total).Count(i => FlagEvaluator.Evaluate(flag, new UserContext($"user-{i}")).Enabled);

        var p = percent / 100.0;
        var tolerance = 4.5 * Math.Sqrt(total * p * (1 - p));
        return Math.Abs(enabled - p * total) <= tolerance;
    }

    [Fact]
    public void Different_flags_split_the_same_users_differently()
    {
        var users = Enumerable.Range(0, 5000).Select(i => new UserContext($"user-{i}")).ToList();
        var a = Flag("flag-a", 50);
        var b = Flag("flag-b", 50);

        var both = users.Count(u => FlagEvaluator.Evaluate(a, u).Enabled && FlagEvaluator.Evaluate(b, u).Enabled);
        Assert.InRange(both, 1000, 1500);
    }

    [Fact]
    public void Zero_percent_enables_nobody_and_hundred_percent_enables_everybody()
    {
        var users = Enumerable.Range(0, 2000).Select(i => new UserContext($"user-{i}")).ToList();
        Assert.DoesNotContain(users, u => FlagEvaluator.Evaluate(Flag("none", 0), u).Enabled);
        Assert.All(users, u => Assert.True(FlagEvaluator.Evaluate(Flag("all", 100), u).Enabled));
    }

    private static FlagDefinition Flag(string key, double percent) =>
        new() { Key = key, Enabled = true, RolloutPercent = percent };

    private sealed record BucketVector(string FlagKey, string UserId, int Bucket);
}
