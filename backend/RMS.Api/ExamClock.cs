namespace RMS.Api;

public enum ClockPhase
{
    Running,
    Warm,
    Heavy,
    Ended
}

public static class ExamClock
{
    public static readonly TimeSpan WarmRemaining = TimeSpan.FromMinutes(20);
    public static readonly TimeSpan HeavyRemaining = TimeSpan.FromMinutes(5);

    public static ClockPhase Phase(TimeSpan remaining)
    {
        if (remaining <= TimeSpan.Zero)
            return ClockPhase.Ended;
        if (remaining <= HeavyRemaining)
            return ClockPhase.Heavy;
        if (remaining <= WarmRemaining)
            return ClockPhase.Warm;
        return ClockPhase.Running;
    }

    public static bool TrySubmit(Sitting sitting, DateTimeOffset now, int gradedScore)
    {
        if (sitting.Status != SittingStatus.InProgress)
            return false;
        if (now >= sitting.EndsAt)
        {
            Expire(sitting);
            return false;
        }

        sitting.Status = SittingStatus.Submitted;
        sitting.SubmittedAt = now;
        sitting.Score = gradedScore;
        return true;
    }

    public static bool TryExpire(Sitting sitting, DateTimeOffset now)
    {
        if (sitting.Status != SittingStatus.InProgress)
            return false;
        if (now < sitting.EndsAt)
            return false;

        Expire(sitting);
        return true;
    }

    private static void Expire(Sitting sitting)
    {
        sitting.Status = SittingStatus.Expired;
        sitting.Score = 0;
        sitting.SubmittedAt = null;
        foreach (var answer in sitting.Answers)
            answer.Awarded = 0;
    }
}

public static class SittingStatus
{
    public const string InProgress = "in_progress";
    public const string Submitted = "submitted";
    public const string Expired = "expired";
}
