using RMS.Api;
using Xunit;

namespace RMS.Api.Tests;

public class ExamClockTests
{
    [Fact]
    public void TwentyMinutesLeft_IsWarm()
    {
        Assert.Equal(ClockPhase.Warm, ExamClock.Phase(TimeSpan.FromMinutes(20)));
        Assert.Equal(ClockPhase.Running, ExamClock.Phase(TimeSpan.FromMinutes(20) + TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public void FiveMinutesLeft_IsHeavy()
    {
        Assert.Equal(ClockPhase.Heavy, ExamClock.Phase(TimeSpan.FromMinutes(5)));
        Assert.Equal(ClockPhase.Warm, ExamClock.Phase(TimeSpan.FromMinutes(5) + TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public void Zero_IsEnded()
    {
        Assert.Equal(ClockPhase.Ended, ExamClock.Phase(TimeSpan.Zero));
        Assert.Equal(ClockPhase.Ended, ExamClock.Phase(TimeSpan.FromSeconds(-1)));
    }

    [Fact]
    public void SubmitBeforeTheEnd_KeepsTheMarks()
    {
        var sitting = Paper(endsIn: TimeSpan.FromMinutes(4), savedMarks: 3);
        var submitted = ExamClock.TrySubmit(sitting, DateTimeOffset.UtcNow, gradedScore: 3);

        Assert.True(submitted);
        Assert.Equal(SittingStatus.Submitted, sitting.Status);
        Assert.Equal(3, sitting.Score);
    }

    [Fact]
    public void TimeUpWithoutSubmit_ScoresZero_AndALateSubmitStaysZero()
    {
        var sitting = Paper(endsIn: TimeSpan.FromSeconds(-1), savedMarks: 3);
        var now = DateTimeOffset.UtcNow;

        Assert.True(ExamClock.TryExpire(sitting, now));
        Assert.Equal(SittingStatus.Expired, sitting.Status);
        Assert.Equal(0, sitting.Score);
        Assert.All(sitting.Answers, answer => Assert.Equal(0, answer.Awarded));

        Assert.False(ExamClock.TrySubmit(sitting, now, gradedScore: 3));
        Assert.Equal(0, sitting.Score);
    }

    [Fact]
    public void SubmitOnTheExactEnd_IsOutWithNoMarks()
    {
        var ends = DateTimeOffset.UtcNow;
        var sitting = new Sitting
        {
            Status = SittingStatus.InProgress,
            EndsAt = ends,
            Answers = [new Answer { Response = "A", Awarded = 2 }]
        };

        Assert.False(ExamClock.TrySubmit(sitting, ends, gradedScore: 2));
        Assert.Equal(SittingStatus.Expired, sitting.Status);
        Assert.Equal(0, sitting.Score);
    }

    private static Sitting Paper(TimeSpan endsIn, int savedMarks) => new()
    {
        Status = SittingStatus.InProgress,
        EndsAt = DateTimeOffset.UtcNow.Add(endsIn),
        Answers = [new Answer { Response = "A", Awarded = savedMarks }]
    };
}
