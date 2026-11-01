using RMS.Api;
using Xunit;

namespace RMS.Api.Tests;

public class SimilarityTests
{
    [Fact]
    public void LongCloseAnswers_Match()
    {
        Assert.True(AnswerSimilarity.Matches(0.88f, 30, 30));
        Assert.False(AnswerSimilarity.Matches(0.87f, 40, 40));
        Assert.False(AnswerSimilarity.Matches(0.95f, 29, 80));
    }
}