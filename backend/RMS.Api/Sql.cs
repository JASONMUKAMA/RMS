using System.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace RMS.Api;

public static class Sql
{
    public static async Task<NpgsqlConnection> Open(AppDb db)
    {
        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        if (connection.State != ConnectionState.Open)
            await connection.OpenAsync();
        return connection;
    }

    public static NpgsqlCommand Prepare(NpgsqlConnection connection, string text)
    {
        var command = connection.CreateCommand();
        command.CommandText = text.Replace("$", "@");
        return command;
    }

    public static NpgsqlParameter Param(string name, object? value) =>
        new(name.TrimStart('$'), value ?? DBNull.Value);
}
