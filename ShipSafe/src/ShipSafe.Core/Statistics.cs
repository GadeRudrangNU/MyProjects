namespace ShipSafe.Core;

public readonly record struct ZTestResult(double Z, double PValue);

public static class Statistics
{
    public static ZTestResult TwoProportionZ(long errors1, long n1, long errors2, long n2)
    {
        if (n1 <= 0 || n2 <= 0)
        {
            return new ZTestResult(0, 1);
        }

        var p1 = (double)errors1 / n1;
        var p2 = (double)errors2 / n2;
        var pooled = (double)(errors1 + errors2) / (n1 + n2);
        var standardError = Math.Sqrt(pooled * (1 - pooled) * (1.0 / n1 + 1.0 / n2));
        if (standardError == 0)
        {
            return new ZTestResult(0, 1);
        }

        var z = (p1 - p2) / standardError;
        return new ZTestResult(z, NormalCdf(-z));
    }

    public static double NormalCdf(double z) => 0.5 * Erfc(-z / Math.Sqrt(2));

    private static double Erfc(double x)
    {
        var z = Math.Abs(x);
        var t = 1.0 / (1.0 + 0.5 * z);
        var polynomial = -z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
            t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
            t * (-0.82215223 + t * 0.17087277))))))));
        var result = t * Math.Exp(polynomial);
        return x >= 0 ? result : 2.0 - result;
    }
}
