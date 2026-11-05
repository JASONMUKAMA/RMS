using System.Net;
using System.Net.Mail;
using System.Security.Claims;
using System.Text.RegularExpressions;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace RMS.Api;

public static class AccountRoles
{
    public const string SystemAdmin = "systemadmin";
    public const string Manager = "superadmin";
    public const string Teacher = "teacher";
    public const string Student = "student";
    public const string Invigilator = "invigilator";

    public static readonly string[] Staff = [SystemAdmin, Manager, Teacher, Invigilator];
    public static readonly string[] All = [SystemAdmin, Manager, Teacher, Student, Invigilator];

    public static string Label(string role) => role switch
    {
        SystemAdmin => "system admin",
        Manager => "manager",
        Teacher => "teacher",
        Student => "candidate",
        Invigilator => "invigilator",
        _ => role
    };
}

public readonly record struct JoinReady(string Email, string Given, string Family, string Phone, string Nin, string Address, string Birth);

public sealed record JoinWrite(string Email, string GivenName, string FamilyName, string Phone, string Nin, string Address, string DateOfBirth, string Password, int? VillageId = null);

public static class ProfileRules
{
    public static bool IsEmail(string email) =>
        Regex.IsMatch(email, "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", RegexOptions.CultureInvariant);

    public static string? Name(string value, string label)
    {
        var clean = value.Trim();
        if (clean.Length is < 2 or > 40)
            return $"{label} should be 2 to 40 letters.";
        if (!Regex.IsMatch(clean, "^[\\p{L}][\\p{L} '\\-]*$"))
            return $"{label} should use letters.";
        return null;
    }

    public static string? Phone(string value, out string stored)
    {
        stored = value.Trim();
        var digits = new string(stored.Where(char.IsDigit).ToArray());
        if (digits.Length is < 9 or > 15)
            return "Enter a phone number with 9 to 15 digits.";
        return null;
    }

    public static string? NationalId(string value, out string stored)
    {
        stored = value.Trim().ToUpperInvariant();
        if (!Regex.IsMatch(stored, "^[A-Z0-9]{14}$"))
            return "The NIN is 14 letters and numbers.";
        return null;
    }

    public static string? Birth(string value, out string stored)
    {
        stored = "";
        if (!DateOnly.TryParse(value.Trim(), out var dob))
            return "Enter a date of birth.";
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var age = today.Year - dob.Year;
        if (dob > today.AddYears(-age))
            age--;
        if (age is < 16 or > 100)
            return "The date of birth has to be a real age of at least 16.";
        stored = dob.ToString("yyyy-MM-dd");
        return null;
    }

    public static string? Secret(string value) =>
        value.Length < 8 ? "Use a password of at least 8 characters." : null;

    public static string? Check(JoinWrite body, IReadOnlyCollection<string> addresses, out JoinReady ready)
    {
        ready = default;
        var email = body.Email.Trim().ToLowerInvariant();
        if (!IsEmail(email))
            return "Enter the email from the invitation sheet.";
        if (Name(body.GivenName, "The given name") is string given)
            return given;
        if (Name(body.FamilyName, "The family name") is string family)
            return family;
        if (Phone(body.Phone, out var phone) is string phoneError)
            return phoneError;
        if (NationalId(body.Nin, out var nin) is string ninError)
            return ninError;
        var address = addresses.FirstOrDefault(item => string.Equals(item, body.Address.Trim(), StringComparison.OrdinalIgnoreCase));
        if (address is null)
            return addresses.Count == 0
                ? "The system admin has not published addresses yet."
                : "Choose an address from the list.";
        if (Birth(body.DateOfBirth, out var birth) is string birthError)
            return birthError;
        if (Secret(body.Password) is string passwordError)
            return passwordError;
        ready = new JoinReady(email, body.GivenName.Trim(), body.FamilyName.Trim(), phone, nin, address, birth);
        return null;
    }
}

public sealed record InviteRow(string Email, string Test);
public sealed record InviteParse(IReadOnlyList<InviteRow> Rows, IReadOnlyList<string> Invalid);

public static class InviteSheet
{
    public static InviteParse Read(Stream stream, string extension)
    {
        var rows = extension switch
        {
            ".csv" => ReadCsv(stream),
            ".xlsx" => ReadExcel(stream),
            _ => throw new InvalidDataException("Use an .xlsx or .csv sheet with an email column and a test column.")
        };
        return Parse(rows);
    }

    public static InviteParse Parse(IReadOnlyList<IReadOnlyList<string>> rows)
    {
        if (rows.Count == 0 || rows.All(row => row.All(string.IsNullOrWhiteSpace)))
            throw new InvalidDataException("The sheet is empty.");

        var header = rows[0].Select(cell => cell.Trim().ToLowerInvariant()).ToList();
        var emailColumn = header.FindIndex(cell => cell is "email" or "e-mail" or "email address");
        var testColumn = header.FindIndex(cell => cell is "test" or "paper" or "exam" or "assessment");
        if (emailColumn < 0 || testColumn < 0)
            throw new InvalidDataException("The sheet needs an email column and a test column. The test is the paper title.");

        var parsed = new List<InviteRow>();
        var invalid = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 1; i < rows.Count; i++)
        {
            var rawEmail = emailColumn < rows[i].Count ? rows[i][emailColumn].Trim() : "";
            var test = testColumn < rows[i].Count ? rows[i][testColumn].Trim() : "";
            if (rawEmail.Length == 0 && test.Length == 0)
                continue;
            var email = rawEmail.ToLowerInvariant();
            if (!ProfileRules.IsEmail(email))
            {
                invalid.Add(rawEmail.Length == 0 ? $"Row {i + 1} has no email" : rawEmail);
                continue;
            }
            if (test.Length == 0)
            {
                invalid.Add($"{email} has no test");
                continue;
            }
            if (seen.Add($"{email}\n{test.ToLowerInvariant()}"))
                parsed.Add(new InviteRow(email, test));
        }
        return new InviteParse(parsed, invalid);
    }

    private static List<List<string>> ReadExcel(Stream stream)
    {
        try
        {
            using var book = new XLWorkbook(stream);
            var sheet = book.Worksheets.FirstOrDefault() ?? throw new InvalidDataException("The Excel file has no sheet.");
            var used = sheet.RangeUsed() ?? throw new InvalidDataException("The Excel sheet is empty.");
            return used.RowsUsed().Select(row =>
                Enumerable.Range(1, used.ColumnCount()).Select(column => row.Cell(column).GetString().Trim()).ToList()).ToList();
        }
        catch (InvalidDataException)
        {
            throw;
        }
        catch (Exception)
        {
            throw new InvalidDataException("That Excel file could not be read. Use a .xlsx sheet with an email column and a test column.");
        }
    }

    private static List<List<string>> ReadCsv(Stream stream)
    {
        using var reader = new StreamReader(stream);
        var lines = reader.ReadToEnd().Replace("\r\n", "\n").Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return lines.Select(Split).ToList();
    }

    private static List<string> Split(string line)
    {
        var cells = new List<string>();
        var current = new System.Text.StringBuilder();
        var quoted = false;
        foreach (var ch in line)
        {
            if (ch == '"')
            {
                quoted = !quoted;
                continue;
            }
            if (ch == ',' && !quoted)
            {
                cells.Add(current.ToString().Trim());
                current.Clear();
                continue;
            }
            current.Append(ch);
        }
        cells.Add(current.ToString().Trim());
        return cells;
    }
}

public sealed record MailReceipt(string Status, string Detail);

public static class Mailbox
{
    public static async Task<MailReceipt> SendWelcome(AppDb db, string email, string name)
    {
        var body = $"Hello {name},\n\nYour exam account is ready.\nSign in with {email}.\n";
        return await Send(db, email, "Your RMS exam account", body, "welcome", null);
    }

    public static async Task<MailReceipt> SendStaff(AppDb db, string email, string name, string role, string password)
    {
        var body = $"Hello {name},\n\nThe system admin created your {AccountRoles.Label(role)} account.\nEmail: {email}\nTemporary password: {password}\n\nSign in and keep this password private.\n";
        return await Send(db, email, "Your RMS staff account", body, "staff", null);
    }

    public static async Task SendGate(AppDb db, int sittingId)
    {
        var row = await (
            from sitting in db.Sittings.AsNoTracking()
            join student in db.Users.AsNoTracking() on sitting.StudentId equals student.Id
            join paper in db.Assessments.AsNoTracking() on sitting.AssessmentId equals paper.Id
            where sitting.Id == sittingId
            select new
            {
                student.Email,
                student.FullName,
                paper.Title,
                sitting.Status,
                sitting.SectionAScore,
                sitting.SectionAMax,
                sitting.SectionBMax
            }
        ).FirstOrDefaultAsync();
        if (row is null || string.IsNullOrWhiteSpace(row.Email))
            return;

        var percent = Marking.Percent(row.SectionAScore, row.SectionAMax);
        var marks = $"Score: {row.SectionAScore} of {row.SectionAMax} ({percent}%).";
        string subject;
        string body;
        if (row.Status == SittingStatus.Expired)
        {
            subject = $"Result for {row.Title}: Fail";
            body = $"Hello {row.FullName},\n\nThe clock ended before you submitted Section A of {row.Title}.\nScore: 0 of {row.SectionAMax}.\nYou needed 70% to open the written paper (Section B). The result is Fail.\n";
        }
        else if (row.Status == SittingStatus.Failed || !Marking.Passed(row.SectionAScore, row.SectionAMax))
        {
            subject = $"Result for {row.Title}: Fail";
            body = $"Hello {row.FullName},\n\nSection A (objectives) of {row.Title} is marked.\n{marks}\nYou needed 70% to open the written paper (Section B). The result is Fail.\n";
        }
        else if (row.SectionBMax == 0)
        {
            subject = $"Result for {row.Title}: Pass";
            body = $"Hello {row.FullName},\n\nSection A (objectives) of {row.Title} is marked.\n{marks}\nYou reached 70%. This paper has no written section. Your result is {row.SectionAScore} of {row.SectionAMax}.\n";
        }
        else
        {
            subject = $"Result for {row.Title}: Pass";
            body = $"Hello {row.FullName},\n\nSection A (objectives) of {row.Title} is marked.\n{marks}\nYou reached 70%, so the written paper (Section B) is open. Those answers are saved and are not marked by the system. An examiner will award the marks.\n";
        }

        await Send(db, row.Email, subject, body, "gate", sittingId);
    }

    public static async Task SendWritten(AppDb db, int sittingId)
    {
        var row = await (
            from sitting in db.Sittings.AsNoTracking()
            join student in db.Users.AsNoTracking() on sitting.StudentId equals student.Id
            join paper in db.Assessments.AsNoTracking() on sitting.AssessmentId equals paper.Id
            where sitting.Id == sittingId
            select new
            {
                student.Email,
                student.FullName,
                paper.Title,
                sitting.Score,
                sitting.MaxScore,
                sitting.SectionAScore,
                sitting.SectionAMax,
                sitting.SectionBScore,
                sitting.SectionBMax
            }
        ).FirstOrDefaultAsync();
        if (row is null || string.IsNullOrWhiteSpace(row.Email))
            return;

        var percent = Marking.Percent(row.SectionAScore, row.SectionAMax);
        var body = $"Hello {row.FullName},\n\nThe examiner has marked the written section of {row.Title}.\nSection A: {row.SectionAScore} of {row.SectionAMax} ({percent}%).\nSection B: {row.SectionBScore} of {row.SectionBMax}.\nTotal: {row.Score} of {row.MaxScore}.\n";
        await Send(db, row.Email, $"Written marks for {row.Title}", body, "written", sittingId);
    }

    private static async Task<MailReceipt> Send(AppDb db, string email, string subject, string body, string kind, int? sittingId)
    {
        long? id;
        try
        {
            id = await Insert(db, email, subject, body, kind, sittingId, "pending", "");
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return new MailReceipt("held", "Already recorded.");
        }
        var (status, detail) = await Deliver(email, subject, body);
        var connection = await Sql.Open(db);
        await using var update = Sql.Prepare(connection, "UPDATE \"OutboundMail\" SET \"Status\" = $status, \"Detail\" = $detail WHERE \"Id\" = $id");
        update.Parameters.Add(Sql.Param("$status", status));
        update.Parameters.Add(Sql.Param("$detail", detail));
        update.Parameters.Add(Sql.Param("$id", id));
        await update.ExecuteNonQueryAsync();
        return new MailReceipt(status, detail);
    }

    private static async Task<long> Insert(AppDb db, string email, string subject, string body, string kind, int? sittingId, string status, string detail)
    {
        var connection = await Sql.Open(db);
        await using var command = Sql.Prepare(connection, """
            INSERT INTO "OutboundMail" ("ToEmail", "Subject", "Body", "Kind", "SittingId", "Status", "Detail", "CreatedAt")
            VALUES ($to, $subject, $body, $kind, $sitting, $status, $detail, $at)
            RETURNING "Id"
            """);
        command.Parameters.Add(Sql.Param("$to", email));
        command.Parameters.Add(Sql.Param("$subject", subject));
        command.Parameters.Add(Sql.Param("$body", body));
        command.Parameters.Add(Sql.Param("$kind", kind));
        command.Parameters.Add(Sql.Param("$sitting", (object?)sittingId ?? DBNull.Value));
        command.Parameters.Add(Sql.Param("$status", status));
        command.Parameters.Add(Sql.Param("$detail", detail));
        command.Parameters.Add(Sql.Param("$at", DateTimeOffset.UtcNow.ToString("O")));
        return Convert.ToInt64(await command.ExecuteScalarAsync());
    }

    private static async Task<(string Status, string Detail)> Deliver(string email, string subject, string body)
    {
        var host = Environment.GetEnvironmentVariable("RMS_SMTP_HOST");
        if (string.IsNullOrWhiteSpace(host))
            return ("held", "No mail server is configured. The message is kept on this desk.");
        try
        {
            var port = int.TryParse(Environment.GetEnvironmentVariable("RMS_SMTP_PORT"), out var parsed) ? parsed : 587;
            var from = Environment.GetEnvironmentVariable("RMS_SMTP_FROM");
            if (string.IsNullOrWhiteSpace(from))
                from = Environment.GetEnvironmentVariable("RMS_SMTP_USER") ?? "desk@rms.local";
#pragma warning disable SYSLIB0014
            using var message = new MailMessage(from, email, subject, body);
            using var client = new SmtpClient(host, port);
#pragma warning restore SYSLIB0014
            client.EnableSsl = Environment.GetEnvironmentVariable("RMS_SMTP_SSL") != "false";
            client.Timeout = 8000;
            var user = Environment.GetEnvironmentVariable("RMS_SMTP_USER");
            var password = Environment.GetEnvironmentVariable("RMS_SMTP_PASSWORD");
            if (!string.IsNullOrEmpty(user))
                client.Credentials = new NetworkCredential(user, password);
            await client.SendMailAsync(message);
            return ("sent", "");
        }
        catch (Exception ex)
        {
            return ("failed", ex.Message);
        }
    }

}

public static class IdentitySchema
{
    public static async Task Ensure(AppDb db)
    {
        var connection = await Sql.Open(db);
        foreach (var (column, definition) in new (string Column, string Definition)[]
        {
            ("GivenName", "text NOT NULL DEFAULT ''"),
            ("FamilyName", "text NOT NULL DEFAULT ''"),
            ("Phone", "text NOT NULL DEFAULT ''"),
            ("Nin", "text NOT NULL DEFAULT ''"),
            ("Address", "text NOT NULL DEFAULT ''"),
            ("DateOfBirth", "text NOT NULL DEFAULT ''"),
            ("Active", "boolean NOT NULL DEFAULT true"),
            ("ProfileComplete", "boolean NOT NULL DEFAULT true")
        })
            await AddColumn(connection, column, definition);

        await using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS "ExamDuties" (
                "Id" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                "AssessmentId" integer NOT NULL,
                "TeacherId" integer NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_ExamDuties_Pair" ON "ExamDuties" ("AssessmentId", "TeacherId");
            CREATE TABLE IF NOT EXISTS "Invites" (
                "Id" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                "Email" text NOT NULL,
                "CreatedAt" text NOT NULL,
                "UsedAt" text
            );
            ALTER TABLE "Invites" ADD COLUMN IF NOT EXISTS "AssessmentId" integer;
            DROP INDEX IF EXISTS "IX_Invites_Email";
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_Invites_Email_Test" ON "Invites" ("Email", "AssessmentId");
            CREATE TABLE IF NOT EXISTS "Addresses" (
                "Id" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                "Name" text NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_Addresses_Name" ON "Addresses" ("Name");
            CREATE TABLE IF NOT EXISTS "Districts" (
                "Id" integer PRIMARY KEY,
                "Name" text NOT NULL
            );
            CREATE TABLE IF NOT EXISTS "Counties" (
                "Id" integer PRIMARY KEY,
                "Name" text NOT NULL,
                "DistrictId" integer NOT NULL
            );
            CREATE INDEX IF NOT EXISTS "IX_Counties_District" ON "Counties" ("DistrictId");
            CREATE TABLE IF NOT EXISTS "Subcounties" (
                "Id" integer PRIMARY KEY,
                "Name" text NOT NULL,
                "CountyId" integer NOT NULL
            );
            CREATE INDEX IF NOT EXISTS "IX_Subcounties_County" ON "Subcounties" ("CountyId");
            CREATE TABLE IF NOT EXISTS "Parishes" (
                "Id" integer PRIMARY KEY,
                "Name" text NOT NULL,
                "SubcountyId" integer NOT NULL
            );
            CREATE INDEX IF NOT EXISTS "IX_Parishes_Subcounty" ON "Parishes" ("SubcountyId");
            CREATE TABLE IF NOT EXISTS "Villages" (
                "Id" integer PRIMARY KEY,
                "Name" text NOT NULL,
                "ParishId" integer NOT NULL
            );
            CREATE INDEX IF NOT EXISTS "IX_Villages_Parish" ON "Villages" ("ParishId");
            CREATE TABLE IF NOT EXISTS "OutboundMail" (
                "Id" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                "ToEmail" text NOT NULL,
                "Subject" text NOT NULL,
                "Body" text NOT NULL,
                "Kind" text NOT NULL,
                "SittingId" integer,
                "Status" text NOT NULL,
                "Detail" text NOT NULL,
                "CreatedAt" text NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_OutboundMail_Result" ON "OutboundMail" ("Kind", "SittingId") WHERE "SittingId" IS NOT NULL;
            ALTER TABLE "Questions" ADD COLUMN IF NOT EXISTS "Section" text NOT NULL DEFAULT 'A';
            UPDATE "Questions" SET "Section" = 'B' WHERE "Type" = 'short' AND "Section" <> 'B';
            ALTER TABLE "Sittings" ADD COLUMN IF NOT EXISTS "Stage" text NOT NULL DEFAULT 'A';
            ALTER TABLE "Sittings" ADD COLUMN IF NOT EXISTS "SectionAScore" integer NOT NULL DEFAULT 0;
            ALTER TABLE "Sittings" ADD COLUMN IF NOT EXISTS "SectionAMax" integer NOT NULL DEFAULT 0;
            ALTER TABLE "Sittings" ADD COLUMN IF NOT EXISTS "SectionBScore" integer NOT NULL DEFAULT 0;
            ALTER TABLE "Sittings" ADD COLUMN IF NOT EXISTS "SectionBMax" integer NOT NULL DEFAULT 0;
            CREATE TABLE IF NOT EXISTS "AuditTrail" (
                "Id" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                "At" text NOT NULL,
                "ActorId" integer,
                "ActorName" text NOT NULL,
                "ActorEmail" text NOT NULL,
                "Action" text NOT NULL,
                "Detail" text NOT NULL
            );
            CREATE INDEX IF NOT EXISTS "IX_AuditTrail_Id" ON "AuditTrail" ("Id" DESC);
            """;
        await command.ExecuteNonQueryAsync();
    }

    private static async Task AddColumn(NpgsqlConnection connection, string column, string definition)
    {
        await using var read = connection.CreateCommand();
        read.CommandText = """
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'Users' AND column_name = @column
            """;
        read.Parameters.Add(new NpgsqlParameter("column", column));
        if (await read.ExecuteScalarAsync() is not null)
            return;
        await using var alter = connection.CreateCommand();
        alter.CommandText = $"ALTER TABLE \"Users\" ADD COLUMN \"{column}\" {definition}";
        await alter.ExecuteNonQueryAsync();
    }
}

public static class Sessions
{
    public static async Task SignIn(HttpContext http, UserAccount user)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.FullName),
            new(ClaimTypes.Email, user.Email),
            new(ClaimTypes.Role, user.Role)
        };
        var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
        await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity));
    }
}

public sealed record StaffWrite(string GivenName, string FamilyName, string Email, string Role, string Password);
public sealed record RoleWrite(string Role);
public sealed record ActiveWrite(bool Active);
public sealed record AddressWrite(List<string>? Names);
public sealed record DutyWrite(int AssessmentId, int TeacherId, bool Assigned);
public sealed record EmailCheck(string Email);

public static class PeopleEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/join/addresses", async (AppDb db) => Results.Ok(await AddressNames(db)));
        Places.Map(app);

        app.MapPost("/api/join/check", async (EmailCheck body, AppDb db) =>
        {
            var email = body.Email.Trim().ToLowerInvariant();
            if (!ProfileRules.IsEmail(email))
                return Results.BadRequest(new { error = "Enter the email from the invitation sheet." });
            var invite = await FindInvite(db, email);
            if (invite is null)
                return Results.BadRequest(new { error = "That email is not on the invitation sheet. The system admin uploads emails before a candidate can register." });
            if (invite.Value.Used || await db.Users.AnyAsync(user => user.Email == email))
                return Results.BadRequest(new { error = "This email already has an account. Sign in." });
            return Results.Ok(new { email });
        });

        app.MapPost("/api/join", async (JoinWrite body, AppDb db, HttpContext http) =>
        {
            var place = body.VillageId is int villageId ? await Places.Path(db, villageId) : null;
            if (body.VillageId is not null && place is null)
                return Results.BadRequest(new { error = "Choose a village from the list." });
            var addresses = place is not null ? new List<string> { place } : await AddressNames(db);
            if (ProfileRules.Check(place is null ? body : body with { Address = place }, addresses, out var ready) is string error)
                return Results.BadRequest(new { error });
            var invite = await FindInvite(db, ready.Email);
            if (invite is null)
                return Results.BadRequest(new { error = "That email is not on the invitation sheet. The system admin uploads emails before a candidate can register." });
            if (invite.Value.Used || await db.Users.AnyAsync(user => user.Email == ready.Email))
                return Results.BadRequest(new { error = "This email already has an account. Sign in." });
            if (await db.Users.AnyAsync(user => user.Nin == ready.Nin))
                return Results.BadRequest(new { error = "This NIN is already on record." });

            var user = new UserAccount
            {
                GivenName = ready.Given,
                FamilyName = ready.Family,
                FullName = $"{ready.Given} {ready.Family}",
                Email = ready.Email,
                Phone = ready.Phone,
                Nin = ready.Nin,
                Address = ready.Address,
                DateOfBirth = ready.Birth,
                PasswordHash = Passwords.Hash(body.Password),
                Role = AccountRoles.Student,
                Active = true,
                ProfileComplete = true
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            await MarkInviteUsed(db, ready.Email);
            var mail = await Mailbox.SendWelcome(db, user.Email, user.FullName);
            await Audit.Note(db, user.Id, user.FullName, user.Email, "Candidate joined", $"{user.FullName} joined from the invitation sheet.");
            await Sessions.SignIn(http, user);
            return Results.Ok(new { id = user.Id, fullName = user.FullName, email = user.Email, role = user.Role, mail });
        });

        app.MapGet("/api/people", async (ClaimsPrincipal user, AppDb db, HttpRequest request) =>
        {
            if (!IsSystemAdmin(user))
                return Results.Forbid();
            var table = ReadTable(request, 0);
            var order = table.Column switch
            {
                1 => "\"Email\"",
                2 => "\"Role\"",
                3 => "\"Active\"",
                _ => "\"FullName\""
            };
            var filter = table.Term.Length > 0 ? "WHERE \"FullName\" ILIKE $term OR \"Email\" ILIKE $term OR \"Role\" ILIKE $term" : "";
            var rows = await Page(db, "\"Users\"", filter, order, table, """
                SELECT "Id", "FullName", "Email", "Role", "Active", "Phone", "Nin", "Address", "DateOfBirth"
                """);
            return Results.Ok(rows);
        }).RequireAuthorization();

        app.MapPost("/api/people", async (StaffWrite body, ClaimsPrincipal actor, AppDb db) =>
        {
            if (!IsSystemAdmin(actor))
                return Results.Forbid();
            if (ProfileRules.Name(body.GivenName, "The given name") is string given)
                return Results.BadRequest(new { error = given });
            if (ProfileRules.Name(body.FamilyName, "The family name") is string family)
                return Results.BadRequest(new { error = family });
            var email = body.Email.Trim().ToLowerInvariant();
            if (!ProfileRules.IsEmail(email))
                return Results.BadRequest(new { error = "Enter a real email." });
            if (!AccountRoles.Staff.Contains(body.Role))
                return Results.BadRequest(new { error = "Choose a staff role. Candidates join from the invitation sheet." });
            if (ProfileRules.Secret(body.Password) is string password)
                return Results.BadRequest(new { error = password });
            if (await db.Users.AnyAsync(item => item.Email == email))
                return Results.BadRequest(new { error = "That email is already an account." });

            var name = $"{body.GivenName.Trim()} {body.FamilyName.Trim()}";
            var user = new UserAccount
            {
                GivenName = body.GivenName.Trim(),
                FamilyName = body.FamilyName.Trim(),
                FullName = name,
                Email = email,
                PasswordHash = Passwords.Hash(body.Password),
                Role = body.Role,
                Active = true,
                ProfileComplete = true
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            var mail = await Mailbox.SendStaff(db, email, name, body.Role, body.Password);
            await Audit.Note(db, actor, "Staff created", $"{name} ({email}) was created as {Audit.RoleName(body.Role)}.");
            return Results.Ok(new { id = user.Id, fullName = user.FullName, email = user.Email, role = user.Role, mail });
        }).RequireAuthorization();

        app.MapPost("/api/people/{id:int}/role", async (int id, RoleWrite body, ClaimsPrincipal actor, AppDb db) =>
        {
            if (!IsSystemAdmin(actor))
                return Results.Forbid();
            if (!AccountRoles.All.Contains(body.Role))
                return Results.BadRequest(new { error = "Choose a role." });
            if (id == ActorId(actor))
                return Results.BadRequest(new { error = "Another system admin has to change your role." });
            var person = await db.Users.FirstOrDefaultAsync(item => item.Id == id);
            if (person is null)
                return Results.NotFound();
            if (person.Role == AccountRoles.SystemAdmin && body.Role != AccountRoles.SystemAdmin && await LastSystemAdmin(db, person.Id))
                return Results.BadRequest(new { error = "Keep at least one system admin." });
            var previous = person.Role;
            person.Role = body.Role;
            await db.SaveChangesAsync();
            await Audit.Note(db, actor, "Role changed", $"{person.FullName} changed from {Audit.RoleName(previous)} to {Audit.RoleName(body.Role)}.");
            return Results.NoContent();
        }).RequireAuthorization();

        app.MapPost("/api/people/{id:int}/active", async (int id, ActiveWrite body, ClaimsPrincipal actor, AppDb db) =>
        {
            if (!IsSystemAdmin(actor))
                return Results.Forbid();
            if (id == ActorId(actor))
                return Results.BadRequest(new { error = "You cannot switch off the account you are using." });
            var person = await db.Users.FirstOrDefaultAsync(item => item.Id == id);
            if (person is null)
                return Results.NotFound();
            if (!body.Active && person.Role == AccountRoles.SystemAdmin && await LastSystemAdmin(db, person.Id))
                return Results.BadRequest(new { error = "Keep at least one system admin." });
            person.Active = body.Active;
            await db.SaveChangesAsync();
            await Audit.Note(db, actor, "Account switched", $"{person.FullName} was switched {(body.Active ? "on" : "off")}.");
            return Results.NoContent();
        }).RequireAuthorization();

        app.MapPost("/api/invites/file", async (HttpRequest request, ClaimsPrincipal actor, AppDb db) =>
        {
            if (!IsSystemAdmin(actor))
                return Results.Forbid();
            if (!request.HasFormContentType)
                return Results.BadRequest(new { error = "Choose an Excel or CSV sheet." });
            var form = await request.ReadFormAsync();
            var file = form.Files.GetFile("file");
            if (file is null || file.Length == 0)
                return Results.BadRequest(new { error = "Choose an Excel or CSV sheet." });
            if (file.Length > 2_000_000)
                return Results.BadRequest(new { error = "The file is larger than 2 MB." });
            InviteParse parsed;
            try
            {
                parsed = InviteSheet.Read(file.OpenReadStream(), Path.GetExtension(file.FileName).ToLowerInvariant());
            }
            catch (InvalidDataException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            if (parsed.Rows.Count == 0 && parsed.Invalid.Count == 0)
                return Results.BadRequest(new { error = "The sheet has no email rows." });

            var papers = await db.Assessments.AsNoTracking().Select(item => new { item.Id, item.Title }).ToListAsync();
            var byTitle = papers
                .GroupBy(item => item.Title.Trim(), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(group => group.Key, group => group.Select(item => item.Id).Distinct().ToList(), StringComparer.OrdinalIgnoreCase);
            var added = 0;
            var already = 0;
            var invalid = parsed.Invalid.ToList();
            var now = DateTimeOffset.UtcNow.ToString("O");
            foreach (var row in parsed.Rows)
            {
                if (!byTitle.TryGetValue(row.Test, out var matches) || matches.Count == 0)
                {
                    invalid.Add($"{row.Email} · no paper named {row.Test}");
                    continue;
                }
                if (matches.Count > 1)
                {
                    invalid.Add($"{row.Email} · more than one paper is named {row.Test}");
                    continue;
                }
                if (await AssignInvite(db, row.Email, matches[0], now))
                    added++;
                else
                    already++;
            }
            await Audit.Note(db, actor, "Invitations uploaded", $"{file.FileName}: {added} added, {already} already on a paper, {invalid.Count} skipped.");
            return Results.Ok(new { added, already, invalid = invalid.Take(8).ToList(), invalidCount = invalid.Count });
        }).RequireAuthorization();

        app.MapGet("/api/invites", async (ClaimsPrincipal actor, AppDb db, HttpRequest request) =>
        {
            if (!IsSystemAdmin(actor))
                return Results.Forbid();
            var table = ReadTable(request, 2);
            var order = table.Column switch
            {
                0 => "\"Email\"",
                1 => "\"Test\"",
                3 => "\"UsedAt\"",
                _ => "\"CreatedAt\""
            };
            var filter = table.Term.Length > 0
                ? "WHERE \"Email\" ILIKE $term OR COALESCE((SELECT \"Title\" FROM \"Assessments\" WHERE \"Id\" = \"Invites\".\"AssessmentId\"), '') ILIKE $term"
                : "";
            return Results.Ok(await Page(db, "\"Invites\"", filter, order, table, """
                SELECT "Id", "Email", "CreatedAt", "UsedAt",
                    COALESCE((SELECT "Title" FROM "Assessments" WHERE "Id" = "Invites"."AssessmentId"), '') AS "Test"
                """));
        }).RequireAuthorization();

        app.MapGet("/api/addresses", async (ClaimsPrincipal actor, AppDb db) =>
        {
            if (!IsSystemAdmin(actor))
                return Results.Forbid();
            var rows = new List<object>();
            var connection = await Sql.Open(db);
            await using var command = Sql.Prepare(connection, "SELECT \"Id\", \"Name\" FROM \"Addresses\" ORDER BY \"Name\"");
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                rows.Add(new { id = reader.GetInt32(0), name = reader.GetString(1) });
            return Results.Ok(rows);
        }).RequireAuthorization();

        app.MapPost("/api/addresses", async (AddressWrite body, ClaimsPrincipal actor, AppDb db) =>
        {
            if (!IsSystemAdmin(actor))
                return Results.Forbid();
            var names = (body.Names ?? []).Select(item => item.Trim()).Where(item => item.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (names.Count == 0)
                return Results.BadRequest(new { error = "Add at least one address." });
            if (names.Any(item => item.Length is < 2 or > 80))
                return Results.BadRequest(new { error = "Each address should be 2 to 80 characters." });
            var existing = (await AddressNames(db)).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var added = 0;
            foreach (var name in names)
            {
                if (!existing.Add(name))
                    continue;
                var connection = await Sql.Open(db);
                await using var insert = Sql.Prepare(connection, "INSERT INTO \"Addresses\" (\"Name\") VALUES ($name)");
                insert.Parameters.Add(Sql.Param("$name", name));
                await insert.ExecuteNonQueryAsync();
                added++;
            }
            return Results.Ok(new { added });
        }).RequireAuthorization();

        app.MapDelete("/api/addresses/{id:int}", async (int id, ClaimsPrincipal actor, AppDb db) =>
        {
            if (!IsSystemAdmin(actor))
                return Results.Forbid();
            var connection = await Sql.Open(db);
            await using var command = Sql.Prepare(connection, "DELETE FROM \"Addresses\" WHERE \"Id\" = $id");
            command.Parameters.Add(Sql.Param("$id", id));
            await command.ExecuteNonQueryAsync();
            return Results.NoContent();
        }).RequireAuthorization();

        app.MapGet("/api/mail", async (ClaimsPrincipal actor, AppDb db, HttpRequest request) =>
        {
            if (!IsSystemAdmin(actor))
                return Results.Forbid();
            var table = ReadTable(request, 4);
            var order = table.Column switch
            {
                0 => "\"ToEmail\"",
                1 => "\"Subject\"",
                2 => "\"Kind\"",
                3 => "\"Status\"",
                _ => "\"CreatedAt\""
            };
            var filter = table.Term.Length > 0 ? "WHERE \"ToEmail\" ILIKE $term OR \"Subject\" ILIKE $term OR \"Kind\" ILIKE $term OR \"Status\" ILIKE $term" : "";
            return Results.Ok(await Page(db, "\"OutboundMail\"", filter, order, table, "SELECT \"Id\", \"ToEmail\", \"Subject\", \"Kind\", \"Status\", \"CreatedAt\""));
        }).RequireAuthorization();

        app.MapGet("/api/mail/{id:int}", async (int id, ClaimsPrincipal actor, AppDb db) =>
        {
            if (!IsSystemAdmin(actor))
                return Results.Forbid();
            var connection = await Sql.Open(db);
            await using var command = Sql.Prepare(connection, """
                SELECT "ToEmail", "Subject", "Body", "Kind", "Status", "Detail", "CreatedAt" FROM "OutboundMail" WHERE "Id" = $id
                """);
            command.Parameters.Add(Sql.Param("$id", id));
            await using var reader = await command.ExecuteReaderAsync();
            if (!await reader.ReadAsync())
                return Results.NotFound();
            return Results.Ok(new
            {
                to = reader.GetString(0),
                subject = reader.GetString(1),
                body = reader.GetString(2),
                kind = reader.GetString(3),
                status = reader.GetString(4),
                detail = reader.GetString(5),
                at = reader.GetString(6)
            });
        }).RequireAuthorization();

        app.MapGet("/api/duties", async (ClaimsPrincipal actor, AppDb db) =>
        {
            if (actor.FindFirstValue(ClaimTypes.Role) != AccountRoles.Manager)
                return Results.Forbid();
            var exams = await db.Assessments.AsNoTracking().OrderBy(item => item.Title).Select(item => new { item.Id, item.Title }).ToListAsync();
            var duties = await db.ExamDuties.AsNoTracking().ToListAsync();
            var teachers = await db.Users.AsNoTracking()
                .Where(item => item.Role == AccountRoles.Teacher && item.Active)
                .OrderBy(item => item.FullName)
                .Select(item => new { item.Id, item.FullName, item.Email })
                .ToListAsync();
            return Results.Ok(new
            {
                teachers,
                exams = exams.Select(exam => new
                {
                    exam.Id,
                    exam.Title,
                    teacherIds = duties.Where(duty => duty.AssessmentId == exam.Id).Select(duty => duty.TeacherId).ToList()
                })
            });
        }).RequireAuthorization();

        app.MapPost("/api/duties", async (DutyWrite body, ClaimsPrincipal actor, AppDb db) =>
        {
            if (actor.FindFirstValue(ClaimTypes.Role) != AccountRoles.Manager)
                return Results.Forbid();
            var exam = await db.Assessments.AnyAsync(item => item.Id == body.AssessmentId);
            if (!exam)
                return Results.BadRequest(new { error = "Choose an exam." });
            var teacher = await db.Users.FirstOrDefaultAsync(item => item.Id == body.TeacherId && item.Role == AccountRoles.Teacher && item.Active);
            if (teacher is null)
                return Results.BadRequest(new { error = "Choose a teacher." });
            var existing = await db.ExamDuties.FirstOrDefaultAsync(item => item.AssessmentId == body.AssessmentId && item.TeacherId == teacher.Id);
            if (body.Assigned)
            {
                if (existing is null)
                    db.ExamDuties.Add(new ExamDuty { AssessmentId = body.AssessmentId, TeacherId = teacher.Id });
            }
            else if (existing is not null)
            {
                db.ExamDuties.Remove(existing);
            }
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequireAuthorization();
    }

    private static bool IsSystemAdmin(ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.Role) == AccountRoles.SystemAdmin;

    private static int ActorId(ClaimsPrincipal user) =>
        int.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private static async Task<bool> LastSystemAdmin(AppDb db, int id) =>
        !await db.Users.AnyAsync(item => item.Role == AccountRoles.SystemAdmin && item.Active && item.Id != id);

    private static async Task<List<string>> AddressNames(AppDb db) =>
        await Emails(db, "SELECT \"Name\" FROM \"Addresses\" ORDER BY \"Name\"");

    private static async Task<List<string>> Emails(AppDb db, string sql)
    {
        var rows = new List<string>();
        var connection = await Sql.Open(db);
        await using var command = Sql.Prepare(connection, sql);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            rows.Add(reader.GetString(0));
        return rows;
    }

    public static Task<bool> GiveExam(AppDb db, string email, int assessmentId) =>
        AssignInvite(db, email, assessmentId, DateTimeOffset.UtcNow.ToString("O"));

    private static async Task<bool> AssignInvite(AppDb db, string email, int assessmentId, string now)
    {
        var connection = await Sql.Open(db);
        await using var existing = Sql.Prepare(connection, "SELECT \"Id\", \"AssessmentId\" FROM \"Invites\" WHERE \"Email\" = $email");
        existing.Parameters.Add(Sql.Param("$email", email));
        var blank = 0;
        await using (var reader = await existing.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                if (!reader.IsDBNull(1) && reader.GetInt32(1) == assessmentId)
                    return false;
                if (reader.IsDBNull(1) && blank == 0)
                    blank = reader.GetInt32(0);
            }
        }
        if (blank > 0)
        {
            await using var update = Sql.Prepare(connection, "UPDATE \"Invites\" SET \"AssessmentId\" = $paper WHERE \"Id\" = $id");
            update.Parameters.Add(Sql.Param("$paper", assessmentId));
            update.Parameters.Add(Sql.Param("$id", blank));
            await update.ExecuteNonQueryAsync();
            return true;
        }
        await using var insert = Sql.Prepare(connection, "INSERT INTO \"Invites\" (\"Email\", \"CreatedAt\", \"AssessmentId\") VALUES ($email, $at, $paper)");
        insert.Parameters.Add(Sql.Param("$email", email));
        insert.Parameters.Add(Sql.Param("$at", now));
        insert.Parameters.Add(Sql.Param("$paper", assessmentId));
        await insert.ExecuteNonQueryAsync();
        return true;
    }

    public static async Task<HashSet<int>> TestsFor(AppDb db, string email)
    {
        var ids = new HashSet<int>();
        var connection = await Sql.Open(db);
        await using var command = Sql.Prepare(connection, "SELECT \"AssessmentId\" FROM \"Invites\" WHERE \"Email\" = $email AND \"AssessmentId\" IS NOT NULL");
        command.Parameters.Add(Sql.Param("$email", email));
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            ids.Add(reader.GetInt32(0));
        return ids;
    }

    private static async Task<(bool Found, bool Used)?> FindInvite(AppDb db, string email)
    {
        var connection = await Sql.Open(db);
        await using var command = Sql.Prepare(connection, "SELECT \"UsedAt\" FROM \"Invites\" WHERE \"Email\" = $email");
        command.Parameters.Add(Sql.Param("$email", email));
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
            return null;
        return (true, !reader.IsDBNull(0));
    }

    private static async Task MarkInviteUsed(AppDb db, string email)
    {
        var connection = await Sql.Open(db);
        await using var command = Sql.Prepare(connection, "UPDATE \"Invites\" SET \"UsedAt\" = $at WHERE \"Email\" = $email");
        command.Parameters.Add(Sql.Param("$at", DateTimeOffset.UtcNow.ToString("O")));
        command.Parameters.Add(Sql.Param("$email", email));
        await command.ExecuteNonQueryAsync();
    }

    private readonly record struct TableQuery(int Draw, int Start, int Length, string Term, int Column, bool Descending);

    private static TableQuery ReadTable(HttpRequest request, int defaultColumn)
    {
        var draw = int.TryParse(request.Query["draw"], out var parsedDraw) ? parsedDraw : 1;
        var start = int.TryParse(request.Query["start"], out var parsedStart) && parsedStart > 0 ? parsedStart : 0;
        var length = int.TryParse(request.Query["length"], out var parsedLength) && parsedLength is > 0 and <= 100 ? parsedLength : 8;
        var term = request.Query["search[value]"].ToString().Trim().Replace("%", "").Replace("_", "");
        var column = int.TryParse(request.Query["order[0][column]"], out var parsedColumn) ? parsedColumn : defaultColumn;
        var descending = request.Query["order[0][dir]"].ToString() != "asc";
        return new TableQuery(draw, start, length, term, column, descending);
    }

    private static async Task<object> Page(AppDb db, string table, string filter, string order, TableQuery query, string select)
    {
        var direction = query.Descending ? "DESC" : "ASC";
        var connection = await Sql.Open(db);
        await using var total = Sql.Prepare(connection, $"SELECT COUNT(*) FROM {table}");
        var recordsTotal = Convert.ToInt32(await total.ExecuteScalarAsync());

        await using var filtered = Sql.Prepare(connection, $"SELECT COUNT(*) FROM {table} {filter}");
        if (query.Term.Length > 0)
            filtered.Parameters.Add(Sql.Param("$term", $"%{query.Term}%"));
        var recordsFiltered = Convert.ToInt32(await filtered.ExecuteScalarAsync());

        await using var page = Sql.Prepare(connection, $"{select} FROM {table} {filter} ORDER BY {order} {direction}, \"Id\" DESC LIMIT $length OFFSET $start");
        page.Parameters.Add(Sql.Param("$length", query.Length));
        page.Parameters.Add(Sql.Param("$start", query.Start));
        if (query.Term.Length > 0)
            page.Parameters.Add(Sql.Param("$term", $"%{query.Term}%"));
        var data = new List<Dictionary<string, object?>>();
        await using var reader = await page.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var row = new Dictionary<string, object?>();
            for (var i = 0; i < reader.FieldCount; i++)
            {
                var key = reader.GetName(i);
                key = char.ToLowerInvariant(key[0]) + key[1..];
                row[key] = reader.IsDBNull(i) ? null : reader.GetValue(i);
            }
            data.Add(row);
        }
        return new { draw = query.Draw, recordsTotal, recordsFiltered, data };
    }
}
