using ShipSafe.Core;
using ShipSafe.Server.Services;

namespace ShipSafe.Server;

public static class DemoData
{
    public static async Task SeedAsync(FlagService flags)
    {
        var guard = new GuardSettings { MinSamples = 100, Alpha = 0.001, MinDifference = 0.05, WindowSeconds = 30 };

        await flags.CreateAsync(new FlagInput
        {
            Key = "new-checkout",
            Description = "Redesigned one-step checkout",
            Enabled = true,
            RolloutPercent = 50,
            Guard = guard
        }, "seed");

        await flags.CreateAsync(new FlagInput
        {
            Key = "canada-free-shipping",
            Description = "Free shipping banner for Canadian shoppers",
            Enabled = true,
            RolloutPercent = 100,
            Conditions = [new Condition("country", ConditionOperator.In, ["CA"])],
            Guard = guard
        }, "seed");

        await flags.CreateAsync(new FlagInput
        {
            Key = "beta-recommendations",
            Description = "Recommendation carousel for the beta plan",
            Enabled = true,
            RolloutPercent = 25,
            Conditions = [new Condition("plan", ConditionOperator.In, ["beta"])],
            Guard = guard with { Mode = GuardMode.Approval }
        }, "seed");
    }
}
