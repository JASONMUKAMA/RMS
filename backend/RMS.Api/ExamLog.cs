using Microsoft.AspNetCore.SignalR;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace RMS.Api;

public sealed record CheckCall(int SittingId, string StudentName, string Paper, int Warnings);

public static class ExamLog
{
    public const int CheckAfter = 4;

    public static bool NeedsCheck(int warnings) => warnings > CheckAfter;

    public static async Task Record(AppDb db, int sittingId, string kind, string detail, bool warning, bool debounce = true)
    {
        if (warning && debounce && await RecentWarning(db, sittingId, kind))
            return;
        await using var command = Connection(db).CreateCommand();
        command.CommandText = """
            INSERT INTO ExamEvents (SittingId, Kind, Detail, Warning, At)
            VALUES ($sitting, $kind, $detail, $warning, $at)
            """;
        command.Parameters.Add(new SqliteParameter("$sitting", sittingId));
        command.Parameters.Add(new SqliteParameter("$kind", kind));
        command.Parameters.Add(new SqliteParameter("$detail", detail));
        command.Parameters.Add(new SqliteParameter("$warning", warning ? 1 : 0));
        command.Parameters.Add(new SqliteParameter("$at", DateTimeOffset.UtcNow.ToString("O")));
        await command.ExecuteNonQueryAsync();
    }

    public static async Task<CheckCall?> Warn(AppDb db, int sittingId, string kind, string detail, bool debounce = true)
    {
        await Record(db, sittingId, kind, detail, warning: true, debounce);
        var warnings = await WarningCount(db, sittingId);
        if (!NeedsCheck(warnings))
            return null;
        await using var open = Connection(db).CreateCommand();
        open.CommandText = """
            INSERT INTO ExamChecks (SittingId, OpenedAt)
            VALUES ($sitting, $at)
            ON CONFLICT(SittingId) DO NOTHING
            """;
        open.Parameters.Add(new SqliteParameter("$sitting", sittingId));
        open.Parameters.Add(new SqliteParameter("$at", DateTimeOffset.UtcNow.ToString("O")));
        if (await open.ExecuteNonQueryAsync() != 1)
            return null;

        var who = await (
            from sitting in db.Sittings.AsNoTracking()
            join student in db.Users.AsNoTracking() on sitting.StudentId equals student.Id
            join paper in db.Assessments.AsNoTracking() on sitting.AssessmentId equals paper.Id
            where sitting.Id == sittingId
            select new { student.FullName, paper.Title }
        ).FirstOrDefaultAsync();
        return who is null ? null : new CheckCall(sittingId, who.FullName, who.Title, warnings);
    }

    public static async Task<int?> AssignedInvigilator(AppDb db, int sittingId)
    {
        var studentId = await db.Sittings.AsNoTracking().Where(item => item.Id == sittingId).Select(item => item.StudentId).FirstAsync();
        return await db.Assignments.AsNoTracking()
            .Where(item => item.StudentId == studentId)
            .Select(item => (int?)item.InvigilatorId)
            .FirstOrDefaultAsync();
    }

    public static async Task NotifyCheck(IHubContext<DeskHub> hub, AppDb db, CheckCall call)
    {
        var watchers = new HashSet<int>();
        if (await AssignedInvigilator(db, call.SittingId) is int watch)
            watchers.Add(watch);
        var assessmentId = await db.Sittings.AsNoTracking()
            .Where(item => item.Id == call.SittingId)
            .Select(item => item.AssessmentId)
            .FirstAsync();
        var teachers = await db.ExamDuties.AsNoTracking()
            .Where(item => item.AssessmentId == assessmentId)
            .Select(item => item.TeacherId)
            .ToListAsync();
        foreach (var teacherId in teachers)
            watchers.Add(teacherId);
        foreach (var watcher in watchers)
            await hub.Clients.Group(DeskHub.WatchGroup(watcher)).SendAsync("checkCandidate", call);
    }

    public static async Task Seal(AppDb db, int sittingId)
    {
        var warnings = await WarningCount(db, sittingId);
        await using var command = Connection(db).CreateCommand();
        command.CommandText = """
            INSERT INTO ExamSummaries (SittingId, ClosedAt, Warnings)
            VALUES ($sitting, $at, $warnings)
            ON CONFLICT(SittingId) DO UPDATE SET Warnings = excluded.Warnings
            """;
        command.Parameters.Add(new SqliteParameter("$sitting", sittingId));
        command.Parameters.Add(new SqliteParameter("$at", DateTimeOffset.UtcNow.ToString("O")));
        command.Parameters.Add(new SqliteParameter("$warnings", warnings));
        await command.ExecuteNonQueryAsync();
        await Mailbox.SendResult(db, sittingId);
    }

    public static async Task<int> WarningCount(AppDb db, int sittingId)
    {
        await using var command = Connection(db).CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM ExamEvents WHERE SittingId = $sitting AND Warning = 1";
        command.Parameters.Add(new SqliteParameter("$sitting", sittingId));
        return Convert.ToInt32(await command.ExecuteScalarAsync());
    }

    private static async Task<bool> RecentWarning(AppDb db, int sittingId, string kind)
    {
        await using var command = Connection(db).CreateCommand();
        command.CommandText = "SELECT At FROM ExamEvents WHERE SittingId = $sitting AND Kind = $kind AND Warning = 1 ORDER BY Id DESC LIMIT 1";
        command.Parameters.Add(new SqliteParameter("$sitting", sittingId));
        command.Parameters.Add(new SqliteParameter("$kind", kind));
        var raw = await command.ExecuteScalarAsync() as string;
        return DateTimeOffset.TryParse(raw, out var at) && DateTimeOffset.UtcNow - at < TimeSpan.FromSeconds(12);
    }

    private static SqliteConnection Connection(AppDb db)
    {
        var connection = (SqliteConnection)db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
            connection.Open();
        return connection;
    }
}
