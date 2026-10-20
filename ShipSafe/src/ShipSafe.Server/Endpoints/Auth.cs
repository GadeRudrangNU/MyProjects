using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace ShipSafe.Server.Endpoints;

public static class Auth
{
    public static RouteGroupBuilder RequireAdminKey(this RouteGroupBuilder group) =>
        group.AddEndpointFilter(async (context, next) =>
        {
            var expected = context.HttpContext.RequestServices.GetRequiredService<IOptions<ShipSafeOptions>>().Value.AdminKey;
            return Matches(context.HttpContext.Request.Headers["X-Admin-Key"].ToString(), expected)
                ? await next(context)
                : Results.Json(new { error = "Invalid admin key" }, statusCode: StatusCodes.Status401Unauthorized);
        });

    public static RouteGroupBuilder RequireSdkKey(this RouteGroupBuilder group) =>
        group.AddEndpointFilter(async (context, next) =>
        {
            var request = context.HttpContext.Request;
            var expected = context.HttpContext.RequestServices.GetRequiredService<IOptions<ShipSafeOptions>>().Value.SdkKey;
            var supplied = request.Headers["X-Sdk-Key"].ToString();
            if (supplied.Length == 0)
            {
                supplied = request.Query["key"].ToString();
            }

            return Matches(supplied, expected)
                ? await next(context)
                : Results.Json(new { error = "Invalid SDK key" }, statusCode: StatusCodes.Status401Unauthorized);
        });

    public static string Actor(HttpContext context)
    {
        var actor = context.Request.Headers["X-Actor"].ToString().Trim();
        return actor.Length == 0 ? "admin" : actor[..Math.Min(actor.Length, 64)];
    }

    private static bool Matches(string supplied, string expected) =>
        supplied.Length > 0 && CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(supplied)),
            SHA256.HashData(Encoding.UTF8.GetBytes(expected)));
}
