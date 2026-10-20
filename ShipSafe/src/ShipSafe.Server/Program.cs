using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OpenTelemetry;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Serilog;
using ShipSafe.Core;
using ShipSafe.Server;
using ShipSafe.Server.Data;
using ShipSafe.Server.Endpoints;
using ShipSafe.Server.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, services, logger) => logger
    .ReadFrom.Configuration(context.Configuration)
    .ReadFrom.Services(services)
    .Enrich.FromLogContext()
    .WriteTo.Console(outputTemplate: "{Timestamp:HH:mm:ss} {Level:u3} {Message:lj}{NewLine}{Exception}"),
    preserveStaticLogger: true);

builder.Services.Configure<ShipSafeOptions>(builder.Configuration.GetSection(ShipSafeOptions.Section));

builder.Services.ConfigureHttpJsonOptions(json =>
{
    json.SerializerOptions.PropertyNamingPolicy = ShipSafeJson.Options.PropertyNamingPolicy;
    json.SerializerOptions.PropertyNameCaseInsensitive = true;
    foreach (var converter in ShipSafeJson.Options.Converters)
    {
        json.SerializerOptions.Converters.Add(converter);
    }
});

builder.Services.AddDbContextFactory<ShipSafeDb>((services, db) =>
    db.UseSqlite(services.GetRequiredService<IOptions<ShipSafeOptions>>().Value.Database));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<FlagBroadcaster>();
builder.Services.AddSingleton<MetricStore>();
builder.Services.AddSingleton<FlagService>();
builder.Services.AddSingleton<RollbackService>();
builder.Services.AddSingleton<RollbackMonitor>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<RollbackMonitor>());
builder.Services.AddCors(cors => cors.AddDefaultPolicy(policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

var telemetry = builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource.AddService("shipsafe-server"))
    .WithTracing(tracing =>
    {
        tracing.AddAspNetCoreInstrumentation(o => o.Filter = ctx => !ctx.Request.Path.StartsWithSegments("/sdk/stream"));
        if (builder.Configuration.GetValue<bool>("Telemetry:Console"))
        {
            tracing.AddConsoleExporter();
        }
    })
    .WithMetrics(metrics =>
    {
        metrics.AddAspNetCoreInstrumentation().AddMeter(Telemetry.MeterName);
        if (builder.Configuration.GetValue<bool>("Telemetry:Console"))
        {
            metrics.AddConsoleExporter();
        }
    });

if (!string.IsNullOrEmpty(builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"]))
{
    telemetry.UseOtlpExporter();
}

var app = builder.Build();

app.UseSerilogRequestLogging(request =>
{
    request.GetLevel = (ctx, _, ex) => ex is not null || ctx.Response.StatusCode >= 500
        ? Serilog.Events.LogEventLevel.Error
        : ctx.Request.Path.StartsWithSegments("/sdk") ? Serilog.Events.LogEventLevel.Debug : Serilog.Events.LogEventLevel.Information;
});
app.UseCors();

app.MapGet("/health", (FlagService flags, FlagBroadcaster broadcaster) =>
    new { status = "ok", flags = flags.Snapshot.Flags.Count, connections = broadcaster.SubscriberCount });
app.MapAdmin();
app.MapSdk();

var flagService = app.Services.GetRequiredService<FlagService>();
await flagService.InitializeAsync();
if (app.Services.GetRequiredService<IOptions<ShipSafeOptions>>().Value.SeedDemo && flagService.Snapshot.Flags.Count == 0)
{
    await DemoData.SeedAsync(flagService);
}

await app.RunAsync();

public partial class Program;
