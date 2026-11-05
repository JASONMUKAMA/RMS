using System.Security.Claims;

namespace RMS.Api;

public static class Audit
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/audit", async (ClaimsPrincipal user, AppDb db, HttpRequest request) =>
        {
            if (user.FindFirstValue(ClaimTypes.Role) is not ("systemadmin" or "superadmin"))
                return Results.Forbid();

            var draw = int.TryParse(request.Query["draw"], out var parsedDraw) ? parsedDraw : 1;
            var start = int.TryParse(request.Query["start"], out var parsedStart) && parsedStart > 0 ? parsedStart : 0;
            var length = int.TryParse(request.Query["length"], out var parsedLength) && parsedLength is > 0 and <= 100 ? parsedLength : 8;
            var term = request.Query["search[value]"].ToString().Trim().Replace("%", "").Replace("_", "");
            var column = int.TryParse(request.Query["order[0][column]"], out var parsedColumn) ? parsedColumn : 0;
            var descending = request.Query["order[0][dir]"].ToString() != "asc";
            var order = column switch
            {
                1 => "\"ActorName\"",
                2 => "\"Action\"",
                3 => "\"Detail\"",
                _ => "\"Id\""
            };
            var filter = term.Length > 0
                ? "WHERE \"ActorName\" ILIKE $term OR \"ActorEmail\" ILIKE $term OR \"Action\" ILIKE $term OR \"Detail\" ILIKE $term"
                : "";

            var connection = await Sql.Open(db);
            await using var total = Sql.Prepare(connection, "SELECT COUNT(*) FROM \"AuditTrail\"");
            var recordsTotal = Convert.ToInt32(await total.ExecuteScalarAsync());

            await using var filtered = Sql.Prepare(connection, $"SELECT COUNT(*) FROM \"AuditTrail\" {filter}");
            if (term.Length > 0)
                filtered.Parameters.Add(Sql.Param("$term", $"%{term}%"));
            var recordsFiltered = Convert.ToInt32(await filtered.ExecuteScalarAsync());

            var direction = descending ? "DESC" : "ASC";
            await using var page = Sql.Prepare(connection, $"""
                SELECT "Id", "At", "ActorName", "ActorEmail", "Action", "Detail"
                FROM "AuditTrail" {filter}
                ORDER BY {order} {direction}, "Id" DESC
                LIMIT $length OFFSET $start
                """);
            page.Parameters.Add(Sql.Param("$length", length));
            page.Parameters.Add(Sql.Param("$start", start));
            if (term.Length > 0)
                page.Parameters.Add(Sql.Param("$term", $"%{term}%"));

            var data = new List<object>();
            await using var reader = await page.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                data.Add(new
                {
                    id = reader.GetInt32(0),
                    at = reader.GetString(1),
                    actorName = reader.GetString(2),
                    actorEmail = reader.GetString(3),
                    action = reader.GetString(4),
                    detail = reader.GetString(5)
                });
            }
            return Results.Ok(new { draw, recordsTotal, recordsFiltered, data });
        }).RequireAuthorization();
    }

    public static string RoleName(string role) => role switch
    {
        "systemadmin" => "system admin",
        "superadmin" => "manager",
        "teacher" => "teacher",
        "student" => "candidate",
        "invigilator" => "invigilator",
        _ => role
    };

    public static Task Note(AppDb db, ClaimsPrincipal actor, string action, string detail)
    {
        var id = int.TryParse(actor.FindFirstValue(ClaimTypes.NameIdentifier), out var parsed) ? parsed : (int?)null;
        return Write(db, id, actor.FindFirstValue(ClaimTypes.Name) ?? "", actor.FindFirstValue(ClaimTypes.Email) ?? "", action, detail);
    }

    public static Task Note(AppDb db, int? actorId, string name, string email, string action, string detail) =>
        Write(db, actorId, name, email, action, detail);

    private static async Task Write(AppDb db, int? actorId, string name, string email, string action, string detail)
    {
        var connection = await Sql.Open(db);
        await using var command = Sql.Prepare(connection, """
            INSERT INTO "AuditTrail" ("At", "ActorId", "ActorName", "ActorEmail", "Action", "Detail")
            VALUES ($at, $actor, $name, $email, $action, $detail)
            """);
        command.Parameters.Add(Sql.Param("$at", DateTimeOffset.UtcNow.ToString("O")));
        command.Parameters.Add(Sql.Param("$actor", actorId));
        command.Parameters.Add(Sql.Param("$name", Clip(name, 160)));
        command.Parameters.Add(Sql.Param("$email", Clip(email, 200)));
        command.Parameters.Add(Sql.Param("$action", Clip(action, 80)));
        command.Parameters.Add(Sql.Param("$detail", Clip(detail, 500)));
        await command.ExecuteNonQueryAsync();
    }

    private static string Clip(string value, int max)
    {
        var text = (value ?? "").Trim();
        return text.Length <= max ? text : text[..max];
    }
}
