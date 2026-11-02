namespace RMS.Api;

public static class Places
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/places/summary", async (AppDb db) => Results.Ok(await Summary(db)));
        app.MapGet("/api/places/districts", async (AppDb db) => Results.Ok(await List(db, "SELECT \"Id\", \"Name\" FROM \"Districts\" ORDER BY \"Name\"")));
        app.MapGet("/api/places/counties", async (int districtId, AppDb db) => Results.Ok(await List(db, "SELECT \"Id\", \"Name\" FROM \"Counties\" WHERE \"DistrictId\" = $id ORDER BY \"Name\"", ("id", districtId))));
        app.MapGet("/api/places/subcounties", async (int countyId, AppDb db) => Results.Ok(await List(db, "SELECT \"Id\", \"Name\" FROM \"Subcounties\" WHERE \"CountyId\" = $id ORDER BY \"Name\"", ("id", countyId))));
        app.MapGet("/api/places/parishes", async (int subcountyId, AppDb db) => Results.Ok(await List(db, "SELECT \"Id\", \"Name\" FROM \"Parishes\" WHERE \"SubcountyId\" = $id ORDER BY \"Name\"", ("id", subcountyId))));
        app.MapGet("/api/places/villages", async (int parishId, AppDb db) => Results.Ok(await List(db, "SELECT \"Id\", \"Name\" FROM \"Villages\" WHERE \"ParishId\" = $id ORDER BY \"Name\"", ("id", parishId))));
        app.MapGet("/api/places/search", async (string? q, AppDb db) =>
        {
            var term = (q ?? "").Trim();
            if (term.Length < 2)
                return Results.Ok(Array.Empty<object>());
            var connection = await Sql.Open(db);
            await using var command = Sql.Prepare(connection, """
                SELECT v."Name", p."Name", s."Name", c."Name", d."Name"
                FROM "Villages" v
                JOIN "Parishes" p ON p."Id" = v."ParishId"
                JOIN "Subcounties" s ON s."Id" = p."SubcountyId"
                JOIN "Counties" c ON c."Id" = s."CountyId"
                JOIN "Districts" d ON d."Id" = c."DistrictId"
                WHERE v."Name" ILIKE $term
                ORDER BY v."Name"
                LIMIT 15
                """);
            command.Parameters.Add(Sql.Param("$term", $"%{term}%"));
            var rows = new List<object>();
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                rows.Add(new { village = reader.GetString(0), parish = reader.GetString(1), subcounty = reader.GetString(2), county = reader.GetString(3), district = reader.GetString(4) });
            return Results.Ok(rows);
        });
    }

    public static async Task<string?> Path(AppDb db, int villageId)
    {
        var connection = await Sql.Open(db);
        await using var command = Sql.Prepare(connection, """
            SELECT v."Name", p."Name", s."Name", c."Name", d."Name"
            FROM "Villages" v
            JOIN "Parishes" p ON p."Id" = v."ParishId"
            JOIN "Subcounties" s ON s."Id" = p."SubcountyId"
            JOIN "Counties" c ON c."Id" = s."CountyId"
            JOIN "Districts" d ON d."Id" = c."DistrictId"
            WHERE v."Id" = $id
            """);
        command.Parameters.Add(Sql.Param("$id", villageId));
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
            return null;
        return $"{reader.GetString(0)}, {reader.GetString(1)}, {reader.GetString(2)}, {reader.GetString(3)}, {reader.GetString(4)}";
    }

    private static async Task<object> Summary(AppDb db)
    {
        var connection = await Sql.Open(db);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT
                (SELECT COUNT(*) FROM "Districts"),
                (SELECT COUNT(*) FROM "Counties"),
                (SELECT COUNT(*) FROM "Subcounties"),
                (SELECT COUNT(*) FROM "Parishes"),
                (SELECT COUNT(*) FROM "Villages")
            """;
        await using var reader = await command.ExecuteReaderAsync();
        await reader.ReadAsync();
        return new
        {
            districts = Convert.ToInt32(reader.GetValue(0)),
            counties = Convert.ToInt32(reader.GetValue(1)),
            subcounties = Convert.ToInt32(reader.GetValue(2)),
            parishes = Convert.ToInt32(reader.GetValue(3)),
            villages = Convert.ToInt32(reader.GetValue(4))
        };
    }

    private static async Task<List<object>> List(AppDb db, string sql, params (string Name, object? Value)[] parameters)
    {
        var connection = await Sql.Open(db);
        await using var command = Sql.Prepare(connection, sql);
        foreach (var (name, value) in parameters)
            command.Parameters.Add(Sql.Param(name, value));
        var rows = new List<object>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            rows.Add(new { id = reader.GetInt32(0), name = reader.GetString(1) });
        return rows;
    }
}
