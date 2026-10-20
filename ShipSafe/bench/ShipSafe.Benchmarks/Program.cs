using BenchmarkDotNet.Attributes;
using BenchmarkDotNet.Running;
using ShipSafe.Core;

BenchmarkRunner.Run<EvaluationBenchmarks>(args: args);

[MemoryDiagnoser]
public class EvaluationBenchmarks
{
    private FlagDefinition simple = null!;
    private FlagDefinition targeted = null!;
    private Dictionary<string, FlagDefinition> cache = null!;
    private UserContext user = null!;
    private string[] userIds = null!;
    private int cursor;

    [GlobalSetup]
    public void Setup()
    {
        simple = new FlagDefinition { Key = "new-checkout", Enabled = true, RolloutPercent = 25 };
        targeted = new FlagDefinition
        {
            Key = "beta-recommendations",
            Enabled = true,
            RolloutPercent = 25,
            Conditions =
            [
                new Condition("country", ConditionOperator.In, ["CA", "US", "GB"]),
                new Condition("plan", ConditionOperator.In, ["beta", "pro"])
            ]
        };
        cache = new[] { simple, targeted }.ToDictionary(f => f.Key);
        user = new UserContext("user-48213", new Dictionary<string, string> { ["country"] = "CA", ["plan"] = "beta" });
        userIds = Enumerable.Range(0, 4096).Select(i => $"user-{i * 7919}").ToArray();
    }

    [Benchmark]
    public int Bucket() => Bucketing.Bucket("new-checkout", "user-48213");

    [Benchmark(Baseline = true)]
    public Decision EvaluateRolloutOnly() => FlagEvaluator.Evaluate(simple, user);

    [Benchmark]
    public Decision EvaluateWithTwoRules() => FlagEvaluator.Evaluate(targeted, user);

    [Benchmark]
    public Decision CacheLookupAndEvaluate()
    {
        var flag = cache["beta-recommendations"];
        return FlagEvaluator.Evaluate(flag, user);
    }

    [Benchmark]
    public Decision EvaluateRotatingUsers()
    {
        var id = userIds[cursor++ & 4095];
        return FlagEvaluator.Evaluate(simple, new UserContext(id));
    }
}
