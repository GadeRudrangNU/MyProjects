namespace ShipSafe.Core;

public readonly record struct ArmStats(long Requests, long Errors)
{
    public double Rate => Requests == 0 ? 0 : (double)Errors / Requests;
}

public enum GuardVerdict
{
    Disabled,
    InsufficientData,
    Healthy,
    Regressed
}

public sealed record GuardAssessment(
    GuardVerdict Verdict,
    ArmStats Treatment,
    ArmStats Control,
    double Z,
    double PValue,
    double Difference);

public static class RollbackPolicy
{
    public static GuardAssessment Assess(GuardSettings guard, ArmStats treatment, ArmStats control)
    {
        var difference = treatment.Rate - control.Rate;
        if (!guard.Enabled)
        {
            return new GuardAssessment(GuardVerdict.Disabled, treatment, control, 0, 1, difference);
        }

        if (treatment.Requests < guard.MinSamples || control.Requests < guard.MinSamples)
        {
            return new GuardAssessment(GuardVerdict.InsufficientData, treatment, control, 0, 1, difference);
        }

        var test = Statistics.TwoProportionZ(treatment.Errors, treatment.Requests, control.Errors, control.Requests);
        var regressed = test.PValue <= guard.Alpha && difference >= guard.MinDifference;
        return new GuardAssessment(
            regressed ? GuardVerdict.Regressed : GuardVerdict.Healthy,
            treatment,
            control,
            test.Z,
            test.PValue,
            difference);
    }
}
