using System.Threading.Channels;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using Microsoft.ML.Tokenizers;

namespace RMS.Api;

public sealed class AnswerSimilarity(IServiceScopeFactory scopes, IHostEnvironment env, IHubContext<DeskHub> hub, ILogger<AnswerSimilarity> logger) : BackgroundService
{
    public const string ModelId = "bge-m3-onnx-int8";
    public const float Threshold = 0.88f;
    public const int MinCharacters = 30;
    private const int MaxTokens = 256;

    private readonly Channel<int> _queue = Channel.CreateUnbounded<int>();
    private InferenceSession? _session;
    private SentencePieceTokenizer? _tokenizer;
    private bool _failed;

    public bool Ready => _session is not null && _tokenizer is not null;

    public static bool Matches(float cosine, int leftChars, int rightChars) =>
        leftChars >= MinCharacters && rightChars >= MinCharacters && cosine >= Threshold;

    public void Consider(int answerId)
    {
        if (!_failed)
            _queue.Writer.TryWrite(answerId);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            Load();
            logger.LogInformation("BGE-M3 is loaded ({ModelId}).", ModelId);
        }
        catch (Exception ex)
        {
            _failed = true;
            logger.LogError(ex, "BGE-M3 did not start. Short-answer similarity stays quiet.");
        }

        await foreach (var answerId in _queue.Reader.ReadAllAsync(stoppingToken))
        {
            if (!Ready)
                continue;
            try
            {
                await Compare(answerId, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Similarity check failed for answer {AnswerId}.", answerId);
            }
        }
    }

    private void Load()
    {
        var dir = Path.Combine(env.ContentRootPath, "models");
        var modelPath = Path.Combine(dir, "bge-m3-int8.onnx");
        var piecePath = Path.Combine(dir, "sentencepiece.bpe.model");
        if (!File.Exists(modelPath) || new FileInfo(modelPath).Length < 500_000_000)
            throw new FileNotFoundException("The BGE-M3 int8 ONNX file is not in the models folder.", modelPath);
        if (!File.Exists(piecePath))
            throw new FileNotFoundException("The BGE-M3 sentence-piece model is not in the models folder.", piecePath);

        using var piece = File.OpenRead(piecePath);
        _tokenizer = SentencePieceTokenizer.Create(piece, addBeginningOfSentence: false, addEndOfSentence: false);
        using var options = new Microsoft.ML.OnnxRuntime.SessionOptions
        {
            GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_EXTENDED,
            IntraOpNumThreads = Math.Max(1, Environment.ProcessorCount / 2)
        };
        _session = new InferenceSession(modelPath, options);
    }

    public override void Dispose()
    {
        _session?.Dispose();
        base.Dispose();
    }

    private async Task Compare(int answerId, CancellationToken stoppingToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        var answer = await (
            from row in db.Answers.AsNoTracking()
            join question in db.Questions.AsNoTracking() on row.QuestionId equals question.Id
            where row.Id == answerId
            select new { row.Id, row.SittingId, row.QuestionId, row.Response, question.Type }
        ).FirstOrDefaultAsync(stoppingToken);
        if (answer is null)
            return;

        if (answer.Type != "short" || answer.Response.Trim().Length < MinCharacters)
        {
            await DeleteVector(db, answer.Id);
            return;
        }

        var vector = Embed(answer.Response.Trim());
        await SaveVector(db, answer.Id, vector);

        var peers = await db.Answers.AsNoTracking()
            .Where(row => row.QuestionId == answer.QuestionId && row.Id != answer.Id && row.Response.Length >= MinCharacters)
            .Select(row => new { row.Id, row.SittingId, row.Response })
            .ToListAsync(stoppingToken);
        foreach (var peer in peers)
        {
            var other = await LoadVector(db, peer.Id);
            if (other is null || other.Length != vector.Length)
                continue;
            var cosine = Dot(vector, other);
            if (!Matches(cosine, answer.Response.Trim().Length, peer.Response.Trim().Length))
                continue;
            if (!await Remember(db, answer.Id, peer.Id, cosine))
                continue;
            await Notify(db, answer.SittingId, peer.SittingId, cosine);
        }
    }

    private float[] Embed(string text)
    {
        var encoded = _tokenizer!.EncodeToIds(text, addBeginningOfSentence: true, addEndOfSentence: true, considerPreTokenization: true, considerNormalization: true);
        if (encoded.Count > MaxTokens)
        {
            var eos = encoded[^1];
            var cut = encoded.Take(MaxTokens - 1).ToList();
            cut.Add(eos);
            encoded = cut;
        }

        var ids = encoded.Select(id => (long)id).ToArray();
        var length = ids.Length;
        var inputs = new List<NamedOnnxValue>();
        foreach (var (name, meta) in _session!.InputMetadata)
        {
            var values = name.Contains("mask", StringComparison.OrdinalIgnoreCase)
                ? Enumerable.Repeat(1L, length).ToArray()
                : name.Contains("type", StringComparison.OrdinalIgnoreCase)
                    ? new long[length]
                    : ids;
            inputs.Add(NamedOnnxValue.CreateFromTensor(name, ToTensor(values, length, meta.ElementDataType)));
        }

        using var results = _session.Run(inputs);
        var output = results.First(result => result.ElementType == TensorElementType.Float).AsTensor<float>();
        var hidden = output.Dimensions[^1];
        var vector = new float[hidden];
        if (output.Rank == 3)
        {
            for (var i = 0; i < hidden; i++)
                vector[i] = output[0, 0, i];
        }
        else
        {
            for (var i = 0; i < hidden; i++)
                vector[i] = output[0, i];
        }

        var norm = MathF.Sqrt(vector.Sum(value => value * value));
        if (norm > 0)
        {
            for (var i = 0; i < vector.Length; i++)
                vector[i] /= norm;
        }
        return vector;
    }

    private static Tensor<long> ToTensor(long[] values, int length, TensorElementType type)
    {
        if (type != TensorElementType.Int64)
            throw new InvalidOperationException($"BGE-M3 expected int64 inputs, and this model uses {type}.");
        return new DenseTensor<long>(values, [1, length]);
    }

    private static float Dot(float[] left, float[] right)
    {
        var sum = 0f;
        for (var i = 0; i < left.Length; i++)
            sum += left[i] * right[i];
        return sum;
    }

    private static async Task SaveVector(AppDb db, int answerId, float[] vector)
    {
        var bytes = new byte[vector.Length * sizeof(float)];
        Buffer.BlockCopy(vector, 0, bytes, 0, bytes.Length);
        var connection = Connection(db);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO AnswerVectors (AnswerId, ModelId, Vector)
            VALUES ($id, $model, $vector)
            ON CONFLICT(AnswerId) DO UPDATE SET ModelId = excluded.ModelId, Vector = excluded.Vector
            """;
        command.Parameters.Add(new SqliteParameter("$id", answerId));
        command.Parameters.Add(new SqliteParameter("$model", ModelId));
        command.Parameters.Add(new SqliteParameter("$vector", bytes));
        await command.ExecuteNonQueryAsync();
    }

    private static async Task DeleteVector(AppDb db, int answerId)
    {
        var connection = Connection(db);
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM AnswerVectors WHERE AnswerId = $id";
        command.Parameters.Add(new SqliteParameter("$id", answerId));
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<float[]?> LoadVector(AppDb db, int answerId)
    {
        var connection = Connection(db);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT Vector FROM AnswerVectors WHERE AnswerId = $id";
        command.Parameters.Add(new SqliteParameter("$id", answerId));
        var raw = await command.ExecuteScalarAsync();
        if (raw is not byte[] bytes || bytes.Length == 0 || bytes.Length % sizeof(float) != 0)
            return null;
        var vector = new float[bytes.Length / sizeof(float)];
        Buffer.BlockCopy(bytes, 0, vector, 0, bytes.Length);
        return vector;
    }

    private static async Task<bool> Remember(AppDb db, int leftId, int rightId, float cosine)
    {
        var first = Math.Min(leftId, rightId);
        var second = Math.Max(leftId, rightId);
        var connection = Connection(db);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO SimilarAnswers (LeftAnswerId, RightAnswerId, Cosine, ModelId, At)
            VALUES ($left, $right, $cosine, $model, $at)
            ON CONFLICT(LeftAnswerId, RightAnswerId) DO NOTHING
            """;
        command.Parameters.Add(new SqliteParameter("$left", first));
        command.Parameters.Add(new SqliteParameter("$right", second));
        command.Parameters.Add(new SqliteParameter("$cosine", cosine));
        command.Parameters.Add(new SqliteParameter("$model", ModelId));
        command.Parameters.Add(new SqliteParameter("$at", DateTimeOffset.UtcNow.ToString("O")));
        return await command.ExecuteNonQueryAsync() == 1;
    }

    private async Task Notify(AppDb db, int leftSittingId, int rightSittingId, float cosine)
    {
        var detail = $"Similar short answers, cosine {cosine:0.00}, model {ModelId}.";
        foreach (var sittingId in new[] { leftSittingId, rightSittingId })
        {
            await ExamLog.Record(db, sittingId, "similar", detail, warning: false);
            var who = await (
                from sitting in db.Sittings.AsNoTracking()
                join student in db.Users.AsNoTracking() on sitting.StudentId equals student.Id
                join paper in db.Assessments.AsNoTracking() on sitting.AssessmentId equals paper.Id
                where sitting.Id == sittingId
                select new { student.FullName, paper.Title }
            ).FirstOrDefaultAsync();
            if (who is null || !LiveBoard.MarkSignal(sittingId, "similar", DateTimeOffset.UtcNow))
                continue;
            await hub.Clients.Group("staff").SendAsync("signal", new DeskSignal(sittingId, who.FullName, who.Title, "similar", detail, DateTimeOffset.UtcNow));
        }
    }

    private static SqliteConnection Connection(AppDb db)
    {
        var connection = (SqliteConnection)db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
            connection.Open();
        return connection;
    }
}
