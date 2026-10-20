namespace ShipSafe.Core;

public static class FlagEvaluator
{
    public static Decision Evaluate(FlagDefinition flag, UserContext user)
    {
        if (!flag.Enabled)
        {
            return new Decision(flag.Key, false, DecisionReason.Disabled);
        }

        var conditions = flag.Conditions;
        for (var i = 0; i < conditions.Count; i++)
        {
            if (!Matches(conditions[i], user))
            {
                return new Decision(flag.Key, false, DecisionReason.ConditionNotMet);
            }
        }

        var inRollout = Bucketing.Bucket(flag.Key, user.Id) < Threshold(flag.RolloutPercent);
        return new Decision(flag.Key, inRollout, inRollout ? DecisionReason.InRollout : DecisionReason.OutsideRollout);
    }

    public static int Threshold(double percent) =>
        (int)Math.Round(percent * 100, MidpointRounding.AwayFromZero);

    private static bool Matches(Condition condition, UserContext user)
    {
        var listed = false;
        if (TryGetAttribute(condition.Attribute, user, out var actual))
        {
            var values = condition.Values;
            for (var i = 0; i < values.Count; i++)
            {
                if (string.Equals(values[i], actual, StringComparison.OrdinalIgnoreCase))
                {
                    listed = true;
                    break;
                }
            }
        }

        return condition.Operator == ConditionOperator.In ? listed : !listed;
    }

    private static bool TryGetAttribute(string name, UserContext user, out string value)
    {
        if (string.Equals(name, "id", StringComparison.OrdinalIgnoreCase))
        {
            value = user.Id;
            return true;
        }

        if (user.Attributes.TryGetValue(name, out var found))
        {
            value = found;
            return true;
        }

        value = "";
        return false;
    }
}
