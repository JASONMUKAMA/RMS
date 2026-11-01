using System.Net;
using System.Net.Mail;
using System.Security.Claims;
using System.Text.RegularExpressions;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

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

public sealed record JoinWrite(string Email, string GivenName, string FamilyName, string Phone, string Nin, string Address, string DateOfBirth, string Password);

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

public sealed record InviteParse(IReadOnlyList<string> Emails, IReadOnlyList<string> Invalid);

public static class InviteSheet
{
    public static InviteParse Read(Stream stream, string extension)
    {
        var rows = extension switch
        {
            ".csv" => ReadCsv(stream),
            ".xlsx" => ReadExcel(stream),
            _ => throw new InvalidDataException("Use an .xlsx or .csv sheet with an email column.")
        };
        return Parse(rows);
    }

    public static InviteParse Parse(IReadOnlyList<IReadOnlyList<string>> rows)
    {
        if (rows.Count == 0 || rows.All(row => row.All(string.IsNullOrWhiteSpace)))
            throw new InvalidDataException("The sheet is empty.");

        var header = rows[0].Select(cell => cell.Trim().ToLowerInvariant()).ToList();
        var column = header.FindIndex(cell => cell is "email" or "e-mail" or "email address");
        var start = 0;
        if (column >= 0)
            start = 1;
        else
            column = 0;

        var emails = new List<string>();
        var invalid = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var i = start; i < rows.Count; i++)
        {
            var raw = column < rows[i].Count ? rows[i][column].Trim() : "";
            if (raw.Length == 0)
                continue;
            var email = raw.ToLowerInvariant();
            if (!ProfileRules.IsEmail(email))
            {
                invalid.Add(raw);
                continue;
            }
            if (seen.Add(email))
                emails.Add(email);
        }
        return new InviteParse(emails, invalid);
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
            throw new InvalidDataException("That Excel file could not be read. Use a .xlsx sheet with an email column.");
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

    public static async Task SendResult(AppDb db, int sittingId)
    {
        var row = await (
            from sitting in db.Sittings.AsNoTracking()
            join student in db.Users.AsNoTracking() on sitting.StudentId equals student.Id
            join paper in db.Assessments.AsNoTracking() on sitting.AssessmentId equals paper.Id
            where sitting.Id == sittingId
            select new { student.Email, student.FullName, paper.Title, sitting.Score, sitting.MaxScore, sitting.Status }
        ).FirstOrDefaultAsync();
        if (row is null || row.Status is not ("submitted" or "expired") || string.IsNullOrWhiteSpace(row.Email))
            return;
        var outcome = row.Status == "submitted"
            ? "You submitted in time."
            : "The clock ran out before you submitted, so the score is 0.";
        var body = $"Hello {row.FullName},\n\n{row.Title} has closed.\n{outcome}\nScore: {row.Score} of {row.MaxScore}.\n";
        await Send(db, row.Email, $"Your result for {row.Title}", body, "result", sittingId);
    }

    private static async Task<MailReceipt> Send(AppDb db, string email, string subject, string body, string kind, int? sittingId)
    {
        long? id;
        try
        {
            id = await Insert(db, email, subject, body, kind, sittingId, "pending", "");
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
        {
            return new MailReceipt("held", "Already recorded.");
        }
        var (status, detail) = await Deliver(email, subject, body);
        await using var update = Open(db).CreateCommand();
        update.CommandText = "UPDATE OutboundMail SET Status = $status, Detail = $detail WHERE Id = $id";
        update.Parameters.Add(new SqliteParameter("$status", status));
        update.Parameters.Add(new SqliteParameter("$detail", detail));
        update.Parameters.Add(new SqliteParameter("$id", id));
        await update.ExecuteNonQueryAsync();
        return new MailReceipt(status, detail);
    }

    private static async Task<long> Insert(AppDb db, string email, string subject, string body, string kind, int? sittingId, string status, string detail)
    {
        await using var command = Open(db).CreateCommand();
        command.CommandText = """
            INSERT INTO OutboundMail (ToEmail, Subject, Body, Kind, SittingId, Status, Detail, CreatedAt)
            VALUES ($to, $subject, $body, $kind, $sitting, $status, $detail, $at)
            """;
        command.Parameters.Add(new SqliteParameter("$to", email));
        command.Parameters.Add(new SqliteParameter("$subject", subject));
        command.Parameters.Add(new SqliteParameter("$body", body));
        command.Parameters.Add(new SqliteParameter("$kind", kind));
        command.Parameters.Add(new SqliteParameter("$sitting", (object?)sittingId ?? DBNull.Value));
        command.Parameters.Add(new SqliteParameter("$status", status));
        command.Parameters.Add(new SqliteParameter("$detail", detail));
        command.Parameters.Add(new SqliteParameter("$at", DateTimeOffset.UtcNow.ToString("O")));
        await command.ExecuteNonQueryAsync();
        await using var id = Open(db).CreateCommand();
        id.CommandText = "SELECT last_insert_rowid()";
        return Convert.ToInt64(await id.ExecuteScalarAsync());
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

    private static SqliteConnection Open(AppDb db)
    {
        var connection = (SqliteConnection)db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
            connection.Open();
        return connection;
    }
}

public static class IdentitySchema
{
    public static async Task Ensure(AppDb db)
    {
        var connection = (SqliteConnection)db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
            await connection.OpenAsync();
        foreach (var (column, definition) in new (string Column, string Definition)[]
        {
            ("GivenName", "TEXT NOT NULL DEFAULT ''"),
            ("FamilyName", "TEXT NOT NULL DEFAULT ''"),
            ("Phone", "TEXT NOT NULL DEFAULT ''"),
            ("Nin", "TEXT NOT NULL DEFAULT ''"),
            ("Address", "TEXT NOT NULL DEFAULT ''"),
            ("DateOfBirth", "TEXT NOT NULL DEFAULT ''"),
            ("Active", "INTEGER NOT NULL DEFAULT 1"),
            ("ProfileComplete", "INTEGER NOT NULL DEFAULT 1")
        })
            await AddColumn(connection, column, definition);

        await using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS ExamDuties (
                Id INTEGER NOT NULL CONSTRAINT PK_ExamDuties PRIMARY KEY AUTOINCREMENT,
                AssessmentId INTEGER NOT NULL,
                TeacherId INTEGER NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS IX_ExamDuties_Pair ON ExamDuties (AssessmentId, TeacherId);
            CREATE TABLE IF NOT EXISTS Invites (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Email TEXT NOT NULL,
                CreatedAt TEXT NOT NULL,
                UsedAt TEXT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS IX_Invites_Email ON Invites (Email);
            CREATE TABLE IF NOT EXISTS Addresses (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Name TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS IX_Addresses_Name ON Addresses (Name);
            CREATE TABLE IF NOT EXISTS OutboundMail (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                ToEmail TEXT NOT NULL,
                Subject TEXT NOT NULL,
                Body TEXT NOT NULL,
                Kind TEXT NOT NULL,
                SittingId INTEGER,
                Status TEXT NOT NULL,
                Detail TEXT NOT NULL,
                CreatedAt TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS IX_OutboundMail_Result ON OutboundMail (Kind, SittingId) WHERE SittingId IS NOT NULL;
            """;
        await command.ExecuteNonQueryAsync();
    }

    private static async Task AddColumn(SqliteConnection connection, string column, string definition)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        await using (var read = connection.CreateCommand())
        {
            read.CommandText = "PRAGMA table_info(Users)";
            await using var reader = await read.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                names.Add(reader.GetString(1));
        }
        if (names.Contains(column))
            return;
        await using var alter = connection.CreateCommand();
        alter.CommandText = $"ALTER TABLE Users ADD COLUMN {column} {definition}";
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
            var addresses = await AddressNames(db);
            if (ProfileRules.Check(body, addresses, out var ready) is string error)
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
                1 => "Email",
                2 => "Role",
                3 => "Active",
                _ => "FullName"
            };
            var filter = table.Term.Length > 0 ? "WHERE FullName LIKE $term OR Email LIKE $term OR Role LIKE $term" : "";
            var rows = await Page(db, "Users", filter, order, table, """
                SELECT Id, FullName, Email, Role, Active, Phone, Nin, Address, DateOfBirth
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
            person.Role = body.Role;
            await db.SaveChangesAsync();
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
            if (parsed.Emails.Count == 0 && parsed.Invalid.Count == 0)
                return Results.BadRequest(new { error = "The sheet has no email rows." });

            var known = (await db.Users.AsNoTracking().Select(item => item.Email).ToListAsync()).ToHashSet(StringComparer.Ordinal);
            var invited = (await Emails(db, "SELECT Email FROM Invites")).ToHashSet(StringComparer.Ordinal);
            var added = 0;
            var already = 0;
            var now = DateTimeOffset.UtcNow.ToString("O");
            foreach (var email in parsed.Emails)
            {
                if (!known.Add(email) || !invited.Add(email))
                {
                    already++;
                    continue;
                }
                await using var insert = Open(db).CreateCommand();
                insert.CommandText = "INSERT INTO Invites (Email, CreatedAt) VALUES ($email, $at)";
                insert.Parameters.Add(new SqliteParameter("$email", email));
                insert.Parameters.Add(new SqliteParameter("$at", now));
                await insert.ExecuteNonQueryAsync();
                added++;
            }
            return Results.Ok(new { added, already, invalid = parsed.Invalid.Take(8).ToList(), invalidCount = parsed.Invalid.Count });
        }).RequireAuthorization();

        app.MapGet("/api/invites", async (ClaimsPrincipal actor, AppDb db, HttpRequest request) =>
        {
            if (!IsSystemAdmin(actor))
                return Results.Forbid();
            var table = ReadTable(request, 1);
            var order = table.Column switch
            {
                0 => "Email",
                2 => "UsedAt",
                _ => "CreatedAt"
            };
            var filter = table.Term.Length > 0 ? "WHERE Email LIKE $term" : "";
            return Results.Ok(await Page(db, "Invites", filter, order, table, "SELECT Id, Email, CreatedAt, UsedAt"));
        }).RequireAuthorization();

        app.MapGet("/api/addresses", async (ClaimsPrincipal actor, AppDb db) =>
        {
            if (!IsSystemAdmin(actor))
                return Results.Forbid();
            var rows = new List<object>();
            await using var command = Open(db).CreateCommand();
            command.CommandText = "SELECT Id, Name FROM Addresses ORDER BY Name";
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
                await using var insert = Open(db).CreateCommand();
                insert.CommandText = "INSERT INTO Addresses (Name) VALUES ($name)";
                insert.Parameters.Add(new SqliteParameter("$name", name));
                await insert.ExecuteNonQueryAsync();
                added++;
            }
            return Results.Ok(new { added });
        }).RequireAuthorization();

        app.MapDelete("/api/addresses/{id:int}", async (int id, ClaimsPrincipal actor, AppDb db) =>
        {
            if (!IsSystemAdmin(actor))
                return Results.Forbid();
            await using var command = Open(db).CreateCommand();
            command.CommandText = "DELETE FROM Addresses WHERE Id = $id";
            command.Parameters.Add(new SqliteParameter("$id", id));
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
                0 => "ToEmail",
                1 => "Subject",
                2 => "Kind",
                3 => "Status",
                _ => "CreatedAt"
            };
            var filter = table.Term.Length > 0 ? "WHERE ToEmail LIKE $term OR Subject LIKE $term OR Kind LIKE $term OR Status LIKE $term" : "";
            return Results.Ok(await Page(db, "OutboundMail", filter, order, table, "SELECT Id, ToEmail, Subject, Kind, Status, CreatedAt"));
        }).RequireAuthorization();

        app.MapGet("/api/mail/{id:int}", async (int id, ClaimsPrincipal actor, AppDb db) =>
        {
            if (!IsSystemAdmin(actor))
                return Results.Forbid();
            await using var command = Open(db).CreateCommand();
            command.CommandText = "SELECT ToEmail, Subject, Body, Kind, Status, Detail, CreatedAt FROM OutboundMail WHERE Id = $id";
            command.Parameters.Add(new SqliteParameter("$id", id));
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
        await Emails(db, "SELECT Name FROM Addresses ORDER BY Name");

    private static async Task<List<string>> Emails(AppDb db, string sql)
    {
        var rows = new List<string>();
        await using var command = Open(db).CreateCommand();
        command.CommandText = sql;
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            rows.Add(reader.GetString(0));
        return rows;
    }

    private static async Task<(bool Found, bool Used)?> FindInvite(AppDb db, string email)
    {
        await using var command = Open(db).CreateCommand();
        command.CommandText = "SELECT UsedAt FROM Invites WHERE Email = $email";
        command.Parameters.Add(new SqliteParameter("$email", email));
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
            return null;
        return (true, !reader.IsDBNull(0));
    }

    private static async Task MarkInviteUsed(AppDb db, string email)
    {
        await using var command = Open(db).CreateCommand();
        command.CommandText = "UPDATE Invites SET UsedAt = $at WHERE Email = $email";
        command.Parameters.Add(new SqliteParameter("$at", DateTimeOffset.UtcNow.ToString("O")));
        command.Parameters.Add(new SqliteParameter("$email", email));
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
        await using var total = Open(db).CreateCommand();
        total.CommandText = $"SELECT COUNT(*) FROM {table}";
        var recordsTotal = Convert.ToInt32(await total.ExecuteScalarAsync());

        await using var filtered = Open(db).CreateCommand();
        filtered.CommandText = $"SELECT COUNT(*) FROM {table} {filter}";
        if (query.Term.Length > 0)
            filtered.Parameters.Add(new SqliteParameter("$term", $"%{query.Term}%"));
        var recordsFiltered = Convert.ToInt32(await filtered.ExecuteScalarAsync());

        await using var page = Open(db).CreateCommand();
        page.CommandText = $"{select} FROM {table} {filter} ORDER BY {order} {direction}, Id DESC LIMIT $length OFFSET $start";
        page.Parameters.Add(new SqliteParameter("$length", query.Length));
        page.Parameters.Add(new SqliteParameter("$start", query.Start));
        if (query.Term.Length > 0)
            page.Parameters.Add(new SqliteParameter("$term", $"%{query.Term}%"));
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

    private static SqliteConnection Open(AppDb db)
    {
        var connection = (SqliteConnection)db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
            connection.Open();
        return connection;
    }
}
