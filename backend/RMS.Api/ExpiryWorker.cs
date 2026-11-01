using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace RMS.Api;

public sealed class ExpiryWorker(IServiceScopeFactory scopes, IHubContext<DeskHub> hub, ILogger<ExpiryWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ExpireDue(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Exam clock failed to close due papers");
            }

            await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
        }
    }

    private async Task ExpireDue(CancellationToken stoppingToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        var now = DateTimeOffset.UtcNow;
        var open = await db.Sittings
            .Include(s => s.Answers)
            .Where(s => s.Status == SittingStatus.InProgress)
            .ToListAsync(stoppingToken);
        var due = open.Where(s => s.EndsAt <= now).ToList();

        foreach (var sitting in due)
        {
            if (!ExamClock.TryExpire(sitting, now))
                continue;
            await hub.Clients.Group(DeskHub.Group(sitting.Id)).SendAsync("expired", new
            {
                sittingId = sitting.Id,
                status = sitting.Status,
                score = 0,
                phase = nameof(ClockPhase.Ended).ToLowerInvariant()
            }, stoppingToken);
        }

        if (due.Count > 0)
        {
            await db.SaveChangesAsync(stoppingToken);
            foreach (var sitting in due.Where(item => item.Status == SittingStatus.Expired))
                await ExamLog.Seal(db, sitting.Id);
        }
    }
}
