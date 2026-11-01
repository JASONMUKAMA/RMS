using RMS.Api;
using Xunit;

namespace RMS.Api.Tests;

public class SummaryTests
{
    [Fact]
    public void MoreThanFourWarnings_NeedsACheck()
    {
        Assert.False(ExamLog.NeedsCheck(4));
        Assert.True(ExamLog.NeedsCheck(5));
    }
}