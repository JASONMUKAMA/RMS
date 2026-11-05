using System.Text.Json;
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

    public static List<Question> ReadWord(Stream stream) => ReadWord(stream, null);

    public static List<Question> ReadWord(Stream stream, Stream? answers)
    {
        try
        {
            var draft = LoadDraft(stream);
            if (answers is not null)
                draft.Absorb(LoadDraft(answers));
            if (draft.Slots.Count == 0 && draft.Scenarios.Count == 0)
                return ReadWordLines(draft.Lines);
            return draft.Build();
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

    private static PaperDraft LoadDraft(Stream stream)
    {
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        buffer.Position = 0;
        using var document = WordprocessingDocument.Open(buffer, false);
        var body = document.MainDocumentPart?.Document?.Body ?? throw new InvalidDataException("This Word file has no text.");
        var draft = new PaperDraft();
        var mode = "";
        var marks = 1;
        var modelTitle = "";
        var model = new List<string>();

        void FlushModel()
        {
            if (modelTitle.Length == 0)
                return;
            draft.Notes.Add((modelTitle, string.Join(" ", model.Where(line => line.Length > 0))));
            modelTitle = "";
            model.Clear();
        }

        foreach (var child in body.ChildElements)
        {
            if (child is Paragraph paragraph)
            {
                var line = paragraph.InnerText.Trim();
                if (line.Length == 0)
                    continue;
                draft.Lines.Add(line);
                if (ModelHeading(line))
                {
                    FlushModel();
                    mode = "model";
                    modelTitle = line;
                    var each = MarkEach(line);
                    if (each is int found)
                        marks = found;
                    continue;
                }
                if (mode == "model")
                {
                    if (RubricLine(line))
                    {
                        FlushModel();
                        mode = "";
                    }
                    else if (!SkipNote(line))
                        model.Add(line);
                    continue;
                }
                if (SectionLine(line) || EndLine(line))
                {
                    mode = "";
                    continue;
                }
                var eachMark = MarkEach(line);
                if (eachMark is int nextMarks)
                    marks = nextMarks;
                if (TrueFalseHeading(line))
                {
                    mode = "tf";
                    continue;
                }
                if (ShortHeading(line))
                {
                    mode = "short";
                    continue;
                }
                if (ChoiceHeading(line))
                {
                    mode = "";
                    continue;
                }
                if (mode == "tf")
                    draft.Add(line, ["True", "False"], "", marks);
                else if (mode == "short")
                    draft.Add(line, null, "", marks);
                continue;
            }

            if (child is not Table table)
                continue;
            FlushModel();
            mode = "";
            var rows = table.Elements<TableRow>().Select(row =>
                row.Elements<TableCell>().Select(cell => cell.InnerText.Trim()).ToList()).ToList();
            rows = rows.Where(row => row.Any(cell => cell.Length > 0)).ToList();
            if (rows.Count == 0)
                continue;
            ReadTable(draft, rows, ref marks);
        }
        FlushModel();
        return draft;
    }

    private static void ReadTable(PaperDraft draft, List<List<string>> rows, ref int marks)
    {
        if (rows[0][0].StartsWith("Scenario", StringComparison.OrdinalIgnoreCase) && !HeaderKind(rows[0]).Contains('s'))
        {
            for (var index = 0; index < rows.Count;)
            {
                var row = rows[index];
                if (row[0].StartsWith("Scenario", StringComparison.OrdinalIgnoreCase))
                {
                    var title = row.Count > 1 ? row[1] : row[0];
                    var prompt = index + 1 < rows.Count ? string.Join(" ", rows[index + 1]) : "";
                    var each = MarkEach(title) ?? marks;
                    draft.Scenarios.Add(new PaperScenario(title, prompt, each));
                    index += prompt.Length > 0 ? 2 : 1;
                    continue;
                }
                index++;
            }
            return;
        }

        var kinds = HeaderKind(rows[0]);
        if (kinds.Contains('q') && kinds.Contains('o'))
        {
            var numberAt = kinds.IndexOf('n');
            var questionAt = kinds.IndexOf('q');
            var optionAt = kinds.IndexOf('o');
            foreach (var row in rows.Skip(1))
            {
                if (questionAt >= row.Count)
                    continue;
                var prompt = row[questionAt];
                var packed = optionAt < row.Count ? SplitPacked(row[optionAt]) : null;
                var number = numberAt >= 0 && numberAt < row.Count && int.TryParse(row[numberAt], out var parsed) ? parsed : 0;
                draft.Add(prompt, packed, "", marks, number);
            }
            return;
        }

        if (kinds.Contains('n') && kinds.Contains('a'))
        {
            var pairs = new List<(int Number, int Answer, int Marks)>();
            var seen = -1;
            for (var index = 0; index < kinds.Length; index++)
            {
                if (kinds[index] != 'n' || index < seen)
                    continue;
                var answerAt = -1;
                var marksAt = -1;
                for (var next = index + 1; next < kinds.Length; next++)
                {
                    if (kinds[next] == 'a' && answerAt < 0)
                        answerAt = next;
                    else if ((kinds[next] is 'm' or 'c') && marksAt < 0)
                        marksAt = next;
                    else if (kinds[next] == 'n')
                        break;
                }
                if (answerAt >= 0)
                    pairs.Add((index, answerAt, marksAt));
                seen = index;
            }
            foreach (var row in rows.Skip(1))
            {
                foreach (var (numberAt, answerAt, marksAt) in pairs)
                {
                    if (numberAt >= row.Count || answerAt >= row.Count)
                        continue;
                    if (!int.TryParse(row[numberAt], out var number))
                        continue;
                    draft.Answers[number] = row[answerAt];
                    if (marksAt >= 0 && marksAt < row.Count && LeadingInt(row[marksAt]) is int scored)
                        draft.Marks[number] = scored;
                }
            }
            return;
        }

        if (kinds.Contains('s') && (kinds.Contains('c') || kinds.Contains('m')))
        {
            var titleAt = kinds.IndexOf('s');
            var criteriaAt = kinds.IndexOf('c');
            var marksAt = kinds.IndexOf('m');
            foreach (var row in rows.Skip(1))
            {
                if (titleAt >= row.Count)
                    continue;
                var criteria = criteriaAt >= 0 && criteriaAt < row.Count ? row[criteriaAt] : "";
                var scored = marksAt >= 0 && marksAt < row.Count && LeadingInt(row[marksAt]) is int found ? found : 0;
                draft.Keys.Add((row[titleAt], criteria, scored));
            }
            return;
        }

        if (kinds.Contains('q') && kinds.Contains('a') || rows[0].Count >= 7)
        {
            foreach (var question in FromRows(rows))
            {
                List<string>? options = question.Type == "mcq"
                    ? JsonSerializer.Deserialize<List<string>>(question.OptionsJson)
                    : null;
                draft.Add(question.Prompt, options, question.Answer, question.Marks);
            }
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

    private static string HeaderKind(List<string> header) => string.Concat(header.Select(KindOf));

    private static char KindOf(string cell)
    {
        var text = cell.Trim().ToLowerInvariant();
        return text switch
        {
            "q" or "#" or "sn" or "no" or "no." or "number" => 'n',
            "question" or "prompt" => 'q',
            "options" or "option" or "choices" or "choice" => 'o',
            "answer" or "correct" or "key" or "correct answer" or "expected answer" => 'a',
            "marks" or "mark" or "points" or "score" => 'm',
            "criteria" or "marking guide" or "guide" => 'c',
            "scenario" => 's',
            _ => ' '
        };
    }

    private static List<string>? SplitPacked(string cell)
    {
        cell = Regex.Replace(cell, @"(?<=\S)([A-D][\)\.])", " $1");
        var matches = Regex.Matches(cell, @"(?:^|\s)([A-D])[\)\.]\s*", RegexOptions.IgnoreCase);
        if (matches.Count < 2)
            return null;
        var options = new List<string>();
        for (var index = 0; index < matches.Count; index++)
        {
            var start = matches[index].Index + matches[index].Length;
            var end = index + 1 < matches.Count ? matches[index + 1].Index : cell.Length;
            var text = cell[start..end].Trim();
            if (text.Length == 0)
                return null;
            options.Add(text);
        }
        return options;
    }

    private static bool SectionLine(string line) => Regex.IsMatch(line, @"^section\b", RegexOptions.IgnoreCase);

    private static bool EndLine(string line) => Regex.IsMatch(line, @"^(end|instructions|answer all)\b", RegexOptions.IgnoreCase);

    private static bool TrueFalseHeading(string line) => Regex.IsMatch(line, @"true\s*/\s*false", RegexOptions.IgnoreCase);

    private static bool ShortHeading(string line) =>
        Regex.IsMatch(line, @"\bshort\b", RegexOptions.IgnoreCase) && Regex.IsMatch(line, @"mark|logic|answer|question", RegexOptions.IgnoreCase);

    private static bool ChoiceHeading(string line) => Regex.IsMatch(line, @"multiple\s*choice", RegexOptions.IgnoreCase);

    private static bool ModelHeading(string line) => Regex.IsMatch(line, @"^\d+\)\s+\S", RegexOptions.IgnoreCase);

    private static bool RubricLine(string line) => Regex.IsMatch(line, @"^rubric\b", RegexOptions.IgnoreCase);

    private static bool SkipNote(string line) =>
        Regex.IsMatch(line, @"^(candidate must mention|must include|model answers)\b", RegexOptions.IgnoreCase);

    private static int? MarkEach(string line)
    {
        if (SectionLine(line))
            return null;
        var matches = Regex.Matches(line, @"(\d+)\s*marks?", RegexOptions.IgnoreCase);
        if (matches.Count == 0 || !int.TryParse(matches[^1].Groups[1].Value, out var marks) || marks < 1)
            return null;
        return marks;
    }

    private static int? LeadingInt(string text)
    {
        var match = Regex.Match(text.Trim(), @"^(\d+)\b");
        return match.Success && int.TryParse(match.Groups[1].Value, out var number) ? number : null;
    }

    private static string Norm(string text) =>
        Regex.Replace(text.ToLowerInvariant(), @"[^a-z0-9@]+", "");

    private static string Letter(List<string> options, string raw)
    {
        var trimmed = raw.Trim().TrimEnd('.').Trim();
        if (trimmed.Length == 1)
        {
            var choice = char.ToUpperInvariant(trimmed[0]) - 'A';
            if (choice >= 0 && choice < options.Count)
                return ((char)('A' + choice)).ToString();
        }
        var wanted = Norm(trimmed);
        if (wanted.Length == 0)
            return "";
        var ranked = options.Select((option, index) => (option: Norm(option), index))
            .Where(item => item.option.Length > 0 && (item.option == wanted || wanted.Contains(item.option) || item.option.Contains(wanted)))
            .OrderByDescending(item => item.option == wanted)
            .ThenByDescending(item => item.option.Length)
            .ToList();
        if (ranked.Count == 0)
            return "";
        if (ranked.Count > 1 && ranked[0].option.Length == ranked[1].option.Length && ranked[0].option != wanted)
            return "";
        return ((char)('A' + ranked[0].index)).ToString();
    }

    private static string Stem(string word) => word.Length > 4 && word.EndsWith('s') ? word[..^1] : word;

    private static int Overlap(string left, string right)
    {
        var words = new HashSet<string>(Regex.Split(left.ToLowerInvariant(), @"[^a-z0-9]+").Where(word => word.Length > 3).Select(Stem));
        return Regex.Split(right.ToLowerInvariant(), @"[^a-z0-9]+").Where(word => word.Length > 3).Select(Stem).Count(words.Contains);
    }

    private sealed class PaperDraft
    {
        public List<string> Lines { get; } = [];
        public List<PaperSlot> Slots { get; } = [];
        public List<PaperScenario> Scenarios { get; } = [];
        public Dictionary<int, string> Answers { get; } = [];
        public Dictionary<int, int> Marks { get; } = [];
        public List<(string Title, string Criteria, int Marks)> Keys { get; } = [];
        public List<(string Title, string Text)> Notes { get; } = [];
        public int Next { get; private set; } = 1;

        public void Add(string prompt, List<string>? options, string answer, int marks, int number = 0)
        {
            if (string.IsNullOrWhiteSpace(prompt))
                return;
            if (number <= 0)
                number = Next;
            if (number >= Next)
                Next = number + 1;
            Slots.Add(new PaperSlot(number, prompt.Trim(), options, answer.Trim(), marks < 1 ? 1 : marks));
        }

        public void Absorb(PaperDraft other)
        {
            foreach (var pair in other.Answers)
                Answers[pair.Key] = pair.Value;
            foreach (var pair in other.Marks)
                Marks[pair.Key] = pair.Value;
            Keys.AddRange(other.Keys);
            Notes.AddRange(other.Notes);
        }

        public List<Question> Build()
        {
            var writes = new List<QuestionWrite>();
            var missing = new List<string>();
            foreach (var slot in Slots.OrderBy(item => item.Number))
            {
                var scored = Marks.TryGetValue(slot.Number, out var fromKey) ? fromKey : slot.Marks;
                var answer = slot.Answer;
                if (answer.Length == 0 && Answers.TryGetValue(slot.Number, out var raw))
                    answer = slot.Options is null ? raw.Trim() : Letter(slot.Options, raw);
                if (string.IsNullOrWhiteSpace(answer))
                    missing.Add(slot.Number.ToString());
                var choice = slot.Options is { Count: >= 2 };
                writes.Add(new QuestionWrite(choice ? "mcq" : "short", slot.Prompt, choice ? slot.Options : null, answer, scored));
            }
            foreach (var scenario in Scenarios)
            {
                var answer = ModelFor(scenario.Title);
                var scored = scenario.Marks;
                var key = BestKey(scenario.Title);
                if (key.Marks > 0)
                    scored = key.Marks;
                if (string.IsNullOrWhiteSpace(answer))
                    missing.Add(scenario.Title);
                writes.Add(new QuestionWrite("short", $"{scenario.Title}. {scenario.Prompt}".Trim().TrimEnd('.'), null, answer, scored < 1 ? 1 : scored));
            }
            if (writes.Count == 0)
                throw new InvalidDataException("The Word file has no questions.");
            if (missing.Count == writes.Count)
                throw new InvalidDataException("The questions were read, but this file has no answers. Add the answer sheet in the second box, then upload again.");
            if (missing.Count > 0)
                throw new InvalidDataException($"These questions have no answer: {string.Join(", ", missing)}.");
            return FromWrites(writes);
        }

        private string ModelFor(string title)
        {
            var parts = new List<string>();
            var key = BestKey(title);
            if (key.Criteria.Length > 0)
                parts.Add(key.Criteria);
            var note = Notes.Select(item => (item.Text, Score: Overlap(title, item.Title))).OrderByDescending(item => item.Score).FirstOrDefault();
            if (note.Score > 0 && note.Text.Length > 0)
                parts.Add(note.Text);
            return string.Join(" ", parts);
        }

        private (string Title, string Criteria, int Marks) BestKey(string title)
        {
            var best = Keys.Select(item => (item, Score: Overlap(title, item.Title))).OrderByDescending(item => item.Score).FirstOrDefault();
            return best.Score > 0 ? best.item : ("", "", 0);
        }
    }

    private sealed record PaperSlot(int Number, string Prompt, List<string>? Options, string Answer, int Marks);

    private sealed record PaperScenario(string Title, string Prompt, int Marks);
}
