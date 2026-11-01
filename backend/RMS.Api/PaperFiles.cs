using System.Text.RegularExpressions;
using RMS.Api;
using ClosedXML.Excel;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;

public static partial class AssessmentFactory
{
    public static List<Question> ReadExcel(Stream stream)
    {
        try
        {
            using var book = new XLWorkbook(stream);
            var sheet = book.Worksheets.FirstOrDefault() ?? throw new InvalidDataException("The Excel file has no sheet.");
            var used = sheet.RangeUsed() ?? throw new InvalidDataException("The Excel sheet is empty.");
            var rows = used.RowsUsed().Select(row =>
                Enumerable.Range(1, used.ColumnCount()).Select(column => row.Cell(column).GetString().Trim()).ToList()).ToList();
            return FromRows(rows);
        }
        catch (InvalidDataException)
        {
            throw;
        }
        catch (Exception)
        {
            throw new InvalidDataException("That Excel file could not be read. Use a .xlsx sheet with a header row.");
        }
    }

    public static List<Question> ReadWord(Stream stream)
    {
        try
        {
            using var document = WordprocessingDocument.Open(stream, false);
            var body = document.MainDocumentPart?.Document?.Body ?? throw new InvalidDataException("This Word file has no text.");
            var table = body.Elements<Table>().FirstOrDefault();
            if (table is not null)
            {
                var rows = table.Elements<TableRow>().Select(row =>
                    row.Elements<TableCell>().Select(cell => cell.InnerText.Trim()).ToList()).ToList();
                return FromRows(rows);
            }

            var lines = body.Elements<Paragraph>().Select(paragraph => paragraph.InnerText.Trim()).Where(line => line.Length > 0);
            return ReadWordLines(lines);
        }
        catch (InvalidDataException)
        {
            throw;
        }
        catch (Exception)
        {
            throw new InvalidDataException("That Word file could not be read. Use a .docx table or a question list.");
        }
    }

    public static List<Question> ReadWordLines(IEnumerable<string> lines)
    {
        var blocks = new List<List<string>>();
        var current = new List<string>();
        foreach (var raw in lines)
        {
            var line = raw.Trim();
            if (line.Length == 0)
                continue;
            if (current.Count > 0 && (QuestionStart(line) || (current.Any(AnswerLine) && !MetaLine(line))))
            {
                blocks.Add(current);
                current = [];
            }
            current.Add(line);
        }
        if (current.Count > 0)
            blocks.Add(current);
        if (blocks.Count == 0)
            throw new InvalidDataException("The Word file has no questions.");

        var writes = new List<QuestionWrite>();
        foreach (var block in blocks)
        {
            var prompt = QuestionStartPattern().Replace(block[0], "").Trim();
            var options = new Dictionary<string, string> { ["A"] = "", ["B"] = "", ["C"] = "", ["D"] = "" };
            var answer = "";
            var marks = 1;
            foreach (var line in block.Skip(1))
            {
                var option = OptionPattern().Match(line);
                if (option.Success)
                {
                    options[option.Groups[1].Value.ToUpperInvariant()] = option.Groups[2].Value.Trim();
                    continue;
                }
                var marked = AnswerPattern().Match(line);
                if (marked.Success)
                {
                    answer = marked.Groups[2].Value.Trim();
                    continue;
                }
                var scored = MarksPattern().Match(line);
                if (scored.Success)
                {
                    marks = int.TryParse(scored.Groups[1].Value, out var parsed) ? parsed : 1;
                    continue;
                }
                if (prompt.Length == 0)
                    prompt = line;
                else if (answer.Length == 0)
                    prompt = $"{prompt} {line}";
            }
            var filled = options.Values.Any(value => value.Length > 0);
            var type = filled ? "mcq" : "short";
            writes.Add(new QuestionWrite(type, prompt, filled ? [options["A"], options["B"], options["C"], options["D"]] : null, answer, marks));
        }
        return FromWrites(writes);
    }

    private static List<Question> FromRows(List<List<string>> rows)
    {
        if (rows.Count < 2)
            throw new InvalidDataException("The file needs a header row and at least one question.");
        var map = HeaderMap(rows[0]);
        if (!map.ContainsKey("prompt") || !map.ContainsKey("answer"))
        {
            if (rows[0].Count >= 8)
                map = new Dictionary<string, int> { ["type"] = 0, ["prompt"] = 1, ["a"] = 2, ["b"] = 3, ["c"] = 4, ["d"] = 5, ["answer"] = 6, ["marks"] = 7 };
            else if (rows[0].Count >= 7)
                map = new Dictionary<string, int> { ["prompt"] = 0, ["a"] = 1, ["b"] = 2, ["c"] = 3, ["d"] = 4, ["answer"] = 5, ["marks"] = 6 };
            else
                throw new InvalidDataException("Use columns prompt, a, b, c, d, answer, and marks.");
        }

        var writes = new List<QuestionWrite>();
        foreach (var row in rows.Skip(1))
        {
            if (row.All(string.IsNullOrWhiteSpace))
                continue;
            var prompt = Cell(row, map, "prompt");
            var answer = Cell(row, map, "answer");
            var type = Cell(row, map, "type").ToLowerInvariant();
            var options = new[] { Cell(row, map, "a"), Cell(row, map, "b"), Cell(row, map, "c"), Cell(row, map, "d") };
            if (type is not ("mcq" or "short"))
                type = options.Any(option => option.Length > 0) ? "mcq" : "short";
            var marksText = Cell(row, map, "marks");
            var marks = int.TryParse(marksText, out var parsed) ? parsed : 1;
            writes.Add(new QuestionWrite(type, prompt, type == "mcq" ? options.ToList() : null, answer, marks));
        }
        if (writes.Count == 0)
            throw new InvalidDataException("The file has no questions.");
        return FromWrites(writes);
    }

    private static Dictionary<string, int> HeaderMap(List<string> header)
    {
        var map = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < header.Count; index++)
        {
            var key = header[index].Trim().ToLowerInvariant() switch
            {
                "type" or "kind" => "type",
                "prompt" or "question" or "q" => "prompt",
                "a" or "option a" or "optiona" => "a",
                "b" or "option b" or "optionb" => "b",
                "c" or "option c" or "optionc" => "c",
                "d" or "option d" or "optiond" => "d",
                "answer" or "correct" or "key" or "correct answer" => "answer",
                "marks" or "mark" or "points" or "score" => "marks",
                _ => ""
            };
            if (key.Length > 0)
                map.TryAdd(key, index);
        }
        return map;
    }

    private static string Cell(List<string> row, Dictionary<string, int> map, string key) =>
        map.TryGetValue(key, out var index) && index < row.Count ? row[index].Trim() : "";

    private static bool QuestionStart(string line) => QuestionStartPattern().IsMatch(line);

    private static bool AnswerLine(string line) => AnswerPattern().IsMatch(line);

    private static bool MetaLine(string line) =>
        OptionPattern().IsMatch(line) || AnswerPattern().IsMatch(line) || MarksPattern().IsMatch(line);

    private static Regex QuestionStartPattern() => new(@"^(?:\d+[\.\)]\s+|question\s*\d*\s*[:.\-]?\s+)", RegexOptions.IgnoreCase);

    private static Regex OptionPattern() => new(@"^([A-D])[\.\)]\s+(.+)$", RegexOptions.IgnoreCase);

    private static Regex AnswerPattern() => new(@"^(answer|correct)\s*[:\-]\s*(.+)$", RegexOptions.IgnoreCase);

    private static Regex MarksPattern() => new(@"^(?:marks|mark|points)\s*[:\-]\s*(\d+)\s*$", RegexOptions.IgnoreCase);
}
