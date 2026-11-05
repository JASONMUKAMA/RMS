using RMS.Api;
using Xunit;

namespace RMS.Api.Tests;

public class PaperFileTests
{
    [Fact]
    public void AptitudePaper_ReadsTheQuestionTableAndTheAnswerSheet()
    {
        var root = RepoRoot();
        using var questions = File.OpenRead(Path.Combine(root, "APTITUDE TEST- Questions 4.11.25.docx"));
        using var key = File.OpenRead(Path.Combine(root, "Answer Sheet No1.docx"));
        var paper = AssessmentFactory.ReadWord(questions, key);

        Assert.Equal(48, paper.Count);
        Assert.Equal(80, paper.Sum(item => item.Marks));
        Assert.Equal("mcq", paper[0].Type);
        Assert.Equal("A", paper[0].Answer);
        Assert.Contains("Biometric Voter Verification System", paper[0].OptionsJson);
        Assert.Equal("B", paper[1].Answer);
        Assert.Equal("B", paper[10].Answer);
        Assert.Equal("A", paper[20].Answer);
        Assert.Equal("B", paper[21].Answer);
        Assert.Equal("True", JsonSerializerOptions(paper[20].OptionsJson)[0]);
        Assert.Equal("B", paper[30].Answer);
        Assert.Equal("B", paper[34].Answer);
        Assert.Equal("short", paper[40].Type);
        Assert.Contains("10", paper[40].Answer);
        Assert.Equal(2, paper[40].Marks);
        Assert.Equal(10, paper[45].Marks);
        Assert.Contains("fingerprint", paper[45].Answer, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(10, paper[47].Marks);
    }

    [Fact]
    public void AptitudePaper_WithoutTheKey_AsksForTheAnswerSheet()
    {
        var root = RepoRoot();
        using var questions = File.OpenRead(Path.Combine(root, "APTITUDE TEST- Questions 4.11.25.docx"));
        var error = Assert.Throws<InvalidDataException>(() => AssessmentFactory.ReadWord(questions));
        Assert.Contains("answer sheet", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    private static List<string> JsonSerializerOptions(string json) =>
        System.Text.Json.JsonSerializer.Deserialize<List<string>>(json) ?? [];

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "APTITUDE TEST- Questions 4.11.25.docx")))
                return dir.FullName;
            dir = dir.Parent;
        }
        throw new InvalidOperationException("The aptitude paper is not in the repo.");
    }
}
