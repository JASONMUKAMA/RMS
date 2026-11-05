using RMS.Api;
using Xunit;

namespace RMS.Api.Tests;

public class MarkingTests
{
    [Fact]
    public void SeventyPercent_OpensTheWrittenPaper()
    {
        Assert.True(Marking.Passed(70, 100));
        Assert.True(Marking.Passed(7, 10));
        Assert.False(Marking.Passed(69, 100));
        Assert.Equal(70, Marking.Percent(7, 10));
        Assert.Equal(69, Marking.Percent(69, 100));
    }

    [Fact]
    public void SectionA_LeavesWrittenAnswersUnmarked()
    {
        var sitting = new Sitting
        {
            Assessment = new Assessment
            {
                Questions =
                [
                    new Question { Id = 1, Type = "mcq", Section = "A", Answer = "B", Marks = 2 },
                    new Question { Id = 2, Type = "short", Section = "B", Answer = "a long model answer here", Marks = 10 }
                ]
            },
            Answers =
            [
                new Answer { QuestionId = 1, Response = "B" },
                new Answer { QuestionId = 2, Response = "a long model answer here" }
            ]
        };

        var (score, max) = Marking.SectionA(sitting);

        Assert.Equal(2, score);
        Assert.Equal(2, max);
        Assert.Equal(0, sitting.Answers.Single(answer => answer.QuestionId == 2).Awarded);
        Assert.Equal(2, sitting.Answers.Single(answer => answer.QuestionId == 1).Awarded);
    }

    [Fact]
    public void Preview_DoesNotAwardMarks()
    {
        var sitting = new Sitting
        {
            Assessment = new Assessment
            {
                Questions = [new Question { Id = 1, Type = "mcq", Section = "A", Answer = "A", Marks = 1 }]
            },
            Answers = [new Answer { QuestionId = 1, Response = "A", Awarded = 0 }]
        };

        var (score, max) = Marking.Preview(sitting);

        Assert.Equal(1, score);
        Assert.Equal(1, max);
        Assert.Equal(0, sitting.Answers[0].Awarded);
    }
}
