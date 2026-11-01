using RMS.Api;
using Xunit;

namespace RMS.Api.Tests;

public class IdentityTests
{
    private static readonly string[] Addresses = ["Kampala Central"];

    [Fact]
    public void Wizard_AcceptsACompleteRecord()
    {
        var error = ProfileRules.Check(Sample(), Addresses, out var ready);
        Assert.Null(error);
        Assert.Equal("aisha.nakato@rms.local", ready.Email);
        Assert.Equal("CM123456789012", ready.Nin);
        Assert.Equal("Kampala Central", ready.Address);
        Assert.Equal("2000-01-15", ready.Birth);
    }

    [Fact]
    public void Wizard_WaitsForAddresses()
    {
        var error = ProfileRules.Check(Sample(), [], out _);
        Assert.Equal("The system admin has not published addresses yet.", error);
    }

    [Fact]
    public void Wizard_RejectsAShortNationalId()
    {
        var body = Sample() with { Nin = "CM12" };
        var error = ProfileRules.Check(body, Addresses, out _);
        Assert.Equal("The NIN is 14 letters and numbers.", error);
    }

    [Fact]
    public void EmailSheet_ReadsTheEmailColumn()
    {
        var parsed = InviteSheet.Parse(new IReadOnlyList<string>[]
        {
            new[] { "name", "email" },
            new[] { "Aisha", "Aisha.Nakato@rms.local" },
            new[] { "Blank", "" },
            new[] { "Bad", "not-an-email" },
            new[] { "Again", "aisha.nakato@rms.local" }
        });
        Assert.Equal(["aisha.nakato@rms.local"], parsed.Emails);
        Assert.Equal(["not-an-email"], parsed.Invalid);
    }

    [Fact]
    public void EmailSheet_UsesTheFirstColumnWhenThereIsNoHeader()
    {
        var parsed = InviteSheet.Parse(new IReadOnlyList<string>[]
        {
            new[] { "leila.nansubuga@rms.local" },
            new[] { "samuel.kato@rms.local" }
        });
        Assert.Equal(2, parsed.Emails.Count);
        Assert.Empty(parsed.Invalid);
    }

    private static JoinWrite Sample() => new(
        "Aisha.Nakato@rms.local",
        "Aisha",
        "Nakato",
        "+256 700 000 000",
        "cm123456789012",
        "kampala central",
        "2000-01-15",
        "Harbor-Study-19");
}
