using FsCheck.Xunit;
using ShipSafe.Core;

namespace ShipSafe.Tests;

public class RollbackPolicyTests
{
    private static readonly GuardSettings Guard = new()
    {
        MinSamples = 100, Alpha = 0.001, MinDifference = 0.05, WindowSeconds = 30
    };

    [Theory]
    [InlineData(0.0, 0.5)]
    [InlineData(1.0, 0.8413447)]
    [InlineData(-1.0, 0.1586553)]
    [InlineData(1.96, 0.9750021)]
    [InlineData(3.0902323, 0.9990000)]
    public void Normal_cdf_matches_reference_values(double z, double expected)
    {
        Assert.Equal(expected, Statistics.NormalCdf(z), 5);
    }

    [Fact]
    public void Two_proportion_test_matches_a_worked_example()
    {
        var result = Statistics.TwoProportionZ(60, 400, 40, 400);
        Assert.Equal(2.138, result.Z, 3);
        Assert.Equal(0.016, result.PValue, 3);
    }

    [Fact]
    public void Test_is_neutral_when_there_is_nothing_to_compare()
    {
        Assert.Equal(new ZTestResult(0, 1), Statistics.TwoProportionZ(0, 0, 5, 100));
        Assert.Equal(new ZTestResult(0, 1), Statistics.TwoProportionZ(0, 100, 0, 100));
        Assert.Equal(new ZTestResult(0, 1), Statistics.TwoProportionZ(100, 100, 100, 100));
    }

    [Property(MaxTest = 300)]
    public bool Swapping_the_groups_negates_z_and_p_values_stay_valid(byte e1, byte e2, byte extra1, byte extra2)
    {
        long n1 = e1 + extra1 + 1;
        long n2 = e2 + extra2 + 1;
        var forward = Statistics.TwoProportionZ(e1, n1, e2, n2);
        var backward = Statistics.TwoProportionZ(e2, n2, e1, n1);
        return Math.Abs(forward.Z + backward.Z) < 1e-9
            && forward.PValue is >= 0 and <= 1
            && backward.PValue is >= 0 and <= 1;
    }

    [Fact]
    public void Too_few_requests_never_triggers_a_rollback()
    {
        var result = RollbackPolicy.Assess(Guard, new ArmStats(99, 99), new ArmStats(5000, 0));
        Assert.Equal(GuardVerdict.InsufficientData, result.Verdict);

        result = RollbackPolicy.Assess(Guard, new ArmStats(5000, 5000), new ArmStats(99, 0));
        Assert.Equal(GuardVerdict.InsufficientData, result.Verdict);
    }

    [Fact]
    public void A_clear_regression_is_flagged()
    {
        var result = RollbackPolicy.Assess(Guard, new ArmStats(200, 60), new ArmStats(200, 2));
        Assert.Equal(GuardVerdict.Regressed, result.Verdict);
        Assert.True(result.PValue < 0.001);
        Assert.True(result.Difference > 0.25);
    }

    [Fact]
    public void Equal_error_rates_are_healthy()
    {
        var result = RollbackPolicy.Assess(Guard, new ArmStats(500, 10), new ArmStats(500, 10));
        Assert.Equal(GuardVerdict.Healthy, result.Verdict);
    }

    [Fact]
    public void The_new_version_failing_less_than_the_old_one_is_healthy()
    {
        var result = RollbackPolicy.Assess(Guard, new ArmStats(500, 1), new ArmStats(500, 100));
        Assert.Equal(GuardVerdict.Healthy, result.Verdict);
    }

    [Fact]
    public void Statistically_significant_but_tiny_differences_do_not_roll_back()
    {
        var guard = Guard with { MinDifference = 0.05 };
        var result = RollbackPolicy.Assess(guard, new ArmStats(200_000, 4_400), new ArmStats(200_000, 4_000));
        Assert.True(result.PValue < 0.001);
        Assert.Equal(GuardVerdict.Healthy, result.Verdict);
    }

    [Fact]
    public void A_disabled_guard_never_judges()
    {
        var result = RollbackPolicy.Assess(Guard with { Enabled = false }, new ArmStats(500, 500), new ArmStats(500, 0));
        Assert.Equal(GuardVerdict.Disabled, result.Verdict);
    }

    [Fact]
    public void Healthy_releases_are_almost_never_rolled_back_by_chance()
    {
        var random = new Random(12345);
        var guard = Guard with { MinDifference = 0 };
        const int trials = 5000;
        var falseRollbacks = 0;

        for (var i = 0; i < trials; i++)
        {
            var treatment = Sample(random, 300, 0.03);
            var control = Sample(random, 300, 0.03);
            if (RollbackPolicy.Assess(guard, treatment, control).Verdict == GuardVerdict.Regressed)
            {
                falseRollbacks++;
            }
        }

        Assert.True(falseRollbacks <= 10, $"{falseRollbacks} false rollbacks in {trials} identical comparisons");
    }

    [Fact]
    public void A_real_regression_is_always_caught_once_enough_traffic_arrives()
    {
        var random = new Random(777);
        var caught = 0;
        for (var i = 0; i < 500; i++)
        {
            var treatment = Sample(random, 150, 0.30);
            var control = Sample(random, 150, 0.02);
            if (RollbackPolicy.Assess(Guard, treatment, control).Verdict == GuardVerdict.Regressed)
            {
                caught++;
            }
        }

        Assert.Equal(500, caught);
    }

    private static ArmStats Sample(Random random, int requests, double errorRate)
    {
        var errors = 0;
        for (var i = 0; i < requests; i++)
        {
            if (random.NextDouble() < errorRate)
            {
                errors++;
            }
        }

        return new ArmStats(requests, errors);
    }
}
