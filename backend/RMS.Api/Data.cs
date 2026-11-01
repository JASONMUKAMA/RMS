using Microsoft.EntityFrameworkCore;

namespace RMS.Api;

public sealed class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<UserAccount> Users => Set<UserAccount>();
    public DbSet<Assessment> Assessments => Set<Assessment>();
    public DbSet<Question> Questions => Set<Question>();
    public DbSet<Sitting> Sittings => Set<Sitting>();
    public DbSet<Answer> Answers => Set<Answer>();
    public DbSet<Assignment> Assignments => Set<Assignment>();
    public DbSet<ExamDuty> ExamDuties => Set<ExamDuty>();
}

public sealed class UserAccount
{
    public int Id { get; set; }
    public string FullName { get; set; } = "";
    public string GivenName { get; set; } = "";
    public string FamilyName { get; set; } = "";
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Nin { get; set; } = "";
    public string Address { get; set; } = "";
    public string DateOfBirth { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string Role { get; set; } = "";
    public bool Active { get; set; } = true;
    public bool ProfileComplete { get; set; } = true;
}

public sealed class ExamDuty
{
    public int Id { get; set; }
    public int AssessmentId { get; set; }
    public int TeacherId { get; set; }
}

public sealed class Assessment
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public int DurationMinutes { get; set; }
    public int CreatedById { get; set; }
    public List<Question> Questions { get; set; } = [];
}

public sealed class Question
{
    public int Id { get; set; }
    public int AssessmentId { get; set; }
    public string Type { get; set; } = "mcq";
    public string Prompt { get; set; } = "";
    public string OptionsJson { get; set; } = "[]";
    public string Answer { get; set; } = "";
    public int Marks { get; set; } = 1;
}

public sealed class Sitting
{
    public int Id { get; set; }
    public int AssessmentId { get; set; }
    public Assessment? Assessment { get; set; }
    public int StudentId { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset EndsAt { get; set; }
    public DateTimeOffset? SubmittedAt { get; set; }
    public string Status { get; set; } = SittingStatus.InProgress;
    public int Score { get; set; }
    public int MaxScore { get; set; }
    public List<Answer> Answers { get; set; } = [];
}

public sealed class Assignment
{
    public int Id { get; set; }
    public int InvigilatorId { get; set; }
    public int StudentId { get; set; }
}

public sealed class Answer
{
    public int Id { get; set; }
    public int SittingId { get; set; }
    public int QuestionId { get; set; }
    public string Response { get; set; } = "";
    public int Awarded { get; set; }
}
