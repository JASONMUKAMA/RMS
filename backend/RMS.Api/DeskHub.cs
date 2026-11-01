using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace RMS.Api;

public sealed record HandCall(int SittingId, string StudentName, string Paper, string Note, DateTimeOffset RaisedAt);

public sealed record DeskSignal(int SittingId, string StudentName, string Paper, string Kind, string Detail, DateTimeOffset At);

public static class CameraWall
{
    private static readonly ConcurrentDictionary<int, byte[]> Frames = new();
    private static readonly ConcurrentDictionary<int, long> Versions = new();
    private static readonly ConcurrentDictionary<int, DateTimeOffset> Seen = new();
    public static readonly TimeSpan FreshFor = TimeSpan.FromSeconds(3);

    public static void Store(int sittingId, byte[] jpeg)
    {
        Frames[sittingId] = jpeg;
        Seen[sittingId] = DateTimeOffset.UtcNow;
        Versions.AddOrUpdate(sittingId, 1, static (_, version) => version + 1);
    }

    public static bool TryGetNewer(int sittingId, long since, out byte[] jpeg, out long version)
    {
        version = Versions.TryGetValue(sittingId, out var current) ? current : 0;
        if (version == 0 || version == since || !Frames.TryGetValue(sittingId, out jpeg!))
        {
            jpeg = [];
            return false;
        }
        return true;
    }

    public static bool IsFresh(int sittingId, DateTimeOffset now) =>
        Seen.TryGetValue(sittingId, out var at) && now - at <= FreshFor;
}

public static class LiveBoard
{
    public static ConcurrentDictionary<int, HandCall> Hands { get; } = new();
    private static readonly ConcurrentDictionary<string, DateTimeOffset> SignalSeen = new();

    public static bool MarkSignal(int sittingId, string kind, DateTimeOffset now)
    {
        var key = $"{sittingId}:{kind}";
        if (SignalSeen.TryGetValue(key, out var last) && now - last < TimeSpan.FromSeconds(20))
            return false;
        SignalSeen[key] = now;
        return true;
    }
}

[Authorize]
public sealed class DeskHub(IServiceScopeFactory scopes) : Hub
{
    public async Task JoinSitting(int sittingId)
    {
        var sitting = await Load(sittingId);
        if (sitting is null)
            throw new HubException("Sitting not found.");
        if (sitting.StudentId != UserId && !IsStaff)
            throw new HubException("Forbidden.");

        await Groups.AddToGroupAsync(Context.ConnectionId, Group(sittingId));
    }

    public async Task JoinStaff()
    {
        if (!IsStaff)
            throw new HubException("Forbidden.");
        await Groups.AddToGroupAsync(Context.ConnectionId, "staff");
        if (Role is "invigilator" or "teacher" or "superadmin")
            await Groups.AddToGroupAsync(Context.ConnectionId, WatchGroup(UserId));
    }

    public Task<HandCall[]> OpenHands()
    {
        if (!IsStaff)
            throw new HubException("Forbidden.");
        return Task.FromResult(LiveBoard.Hands.Values.OrderBy(call => call.RaisedAt).ToArray());
    }

    public async Task RaiseHand(int sittingId, string? note)
    {
        var sitting = await Load(sittingId) ?? throw new HubException("Sitting not found.");
        if (sitting.StudentId != UserId)
            throw new HubException("Forbidden.");
        if (sitting.Status != SittingStatus.InProgress)
            throw new HubException("This paper is not open.");

        var (name, paper) = await Names(sitting);
        var clean = (note ?? "").Trim();
        if (clean.Length > 200)
            clean = clean[..200];
        var call = new HandCall(sitting.Id, name, paper, clean, DateTimeOffset.UtcNow);
        LiveBoard.Hands[sitting.Id] = call;
        await Clients.Group("staff").SendAsync("hand", call);
    }

    public async Task AcknowledgeHand(int sittingId)
    {
        if (!IsStaff)
            throw new HubException("Forbidden.");
        LiveBoard.Hands.TryRemove(sittingId, out _);
        await Clients.Group("staff").SendAsync("handClear", sittingId);
        await Clients.Group(Group(sittingId)).SendAsync("handSeen");
    }

    public async Task ReportSignal(int sittingId, string kind)
    {
        var detail = kind switch
        {
            "window" => "Left the exam window",
            "copy" => "Copied from the paper",
            "paste" => "Pasted into the paper",
            "face-missing" => "Face missing from the camera",
            "second-face" => "A second face is in the camera",
            "head-away" => "Head turned away from the screen",
            "hand-ear" => "A hand stayed at an ear",
            "camera-interrupted" => "Camera stopped",
            _ => null
        };
        if (detail is null)
            throw new HubException("Unknown signal.");

        var sitting = await Load(sittingId) ?? throw new HubException("Sitting not found.");
        if (sitting.StudentId != UserId || sitting.Status != SittingStatus.InProgress)
            return;

        var now = DateTimeOffset.UtcNow;
        if (!LiveBoard.MarkSignal(sittingId, kind, now))
            return;

        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        CheckCall? check = null;
        if (kind is "window" or "head-away" or "face-missing")
            check = await ExamLog.Warn(db, sitting.Id, kind, detail);
        else
            await ExamLog.Record(db, sitting.Id, kind, detail, warning: false);

        var (name, paper) = await Names(sitting);
        await Clients.Group("staff").SendAsync("signal", new DeskSignal(sitting.Id, name, paper, kind, detail, now));
        if (check is not null && await ExamLog.AssignedInvigilator(db, sitting.Id) is int watch)
            await Clients.Group(WatchGroup(watch)).SendAsync("checkCandidate", check);
    }

    private static readonly ConcurrentDictionary<string, int> Enlarged = new();

    public async Task SendOffer(int sittingId, string sdp)
    {
        if (!await CanWatch(sittingId))
            throw new HubException("This candidate is not on your desk.");
        await Clients.Group(Group(sittingId)).SendAsync("viewerOffer", Context.ConnectionId, sdp);
    }

    public async Task SendAnswer(int sittingId, string viewerId, string sdp)
    {
        var sitting = await Load(sittingId) ?? throw new HubException("Sitting not found.");
        if (sitting.StudentId != UserId)
            throw new HubException("Forbidden.");
        await Clients.Client(viewerId).SendAsync("candidateAnswer", sittingId, sdp);
    }

    public async Task SendIce(int sittingId, string viewerId, string candidate)
    {
        if (Role == "student")
        {
            var sitting = await Load(sittingId) ?? throw new HubException("Sitting not found.");
            if (sitting.StudentId != UserId)
                throw new HubException("Forbidden.");
            await Clients.Client(viewerId).SendAsync("candidateIce", sittingId, candidate);
            return;
        }

        if (!await CanWatch(sittingId))
            throw new HubException("This candidate is not on your desk.");
        await Clients.Group(Group(sittingId)).SendAsync("viewerIce", Context.ConnectionId, candidate);
    }

    public async Task Watch(int sittingId)
    {
        if (!await CanWatch(sittingId))
            throw new HubException("This candidate is not on your desk.");
        if (Enlarged.TryGetValue(Context.ConnectionId, out var previous) && previous != sittingId)
            await Clients.Group(Group(previous)).SendAsync("watching", false);
        Enlarged[Context.ConnectionId] = sittingId;
        await Clients.Group(Group(sittingId)).SendAsync("watching", true);
    }

    public async Task Unwatch(int sittingId)
    {
        if (Role is not ("invigilator" or "superadmin" or "teacher"))
            throw new HubException("Forbidden.");
        if (!Enlarged.TryGetValue(Context.ConnectionId, out var current) || current != sittingId)
            return;
        Enlarged.TryRemove(Context.ConnectionId, out _);
        await Clients.Group(Group(sittingId)).SendAsync("watching", false);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (Enlarged.TryRemove(Context.ConnectionId, out var sittingId))
            await Clients.Group(Group(sittingId)).SendAsync("watching", false);
        await base.OnDisconnectedAsync(exception);
    }

    public static string Group(int sittingId) => $"sitting-{sittingId}";

    public static string WatchGroup(int invigilatorId) => $"watch-{invigilatorId}";

    private async Task<bool> CanWatch(int sittingId)
    {
        if (Role is not ("invigilator" or "superadmin" or "teacher"))
            return false;
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        var sitting = await db.Sittings.AsNoTracking().FirstOrDefaultAsync(item => item.Id == sittingId);
        if (sitting is null || sitting.Status != SittingStatus.InProgress)
            return false;
        if (Role is "superadmin" or "teacher")
            return true;
        return await db.Assignments.AnyAsync(item => item.InvigilatorId == UserId && item.StudentId == sitting.StudentId);
    }

    private bool IsStaff => Role is "teacher" or "superadmin" or "invigilator";

    private int UserId => int.Parse(Context.User!.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private string? Role => Context.User!.FindFirstValue(ClaimTypes.Role);

    private async Task<Sitting?> Load(int sittingId)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        return await db.Sittings.AsNoTracking().FirstOrDefaultAsync(item => item.Id == sittingId);
    }

    private async Task<(string Name, string Paper)> Names(Sitting sitting)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        var name = await db.Users.AsNoTracking().Where(user => user.Id == sitting.StudentId).Select(user => user.FullName).FirstAsync();
        var paper = await db.Assessments.AsNoTracking().Where(item => item.Id == sitting.AssessmentId).Select(item => item.Title).FirstAsync();
        return (name, paper);
    }
}
