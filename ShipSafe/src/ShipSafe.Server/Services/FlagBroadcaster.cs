using System.Collections.Concurrent;
using System.Threading.Channels;
using ShipSafe.Core;

namespace ShipSafe.Server.Services;

public sealed class FlagBroadcaster
{
    private readonly ConcurrentDictionary<Guid, Channel<FlagSnapshot>> subscribers = new();

    public int SubscriberCount => subscribers.Count;

    public Subscription Subscribe()
    {
        var channel = Channel.CreateBounded<FlagSnapshot>(new BoundedChannelOptions(1)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true
        });
        var id = Guid.NewGuid();
        subscribers[id] = channel;
        return new Subscription(channel.Reader, () => subscribers.TryRemove(id, out _));
    }

    public void Publish(FlagSnapshot snapshot)
    {
        foreach (var channel in subscribers.Values)
        {
            channel.Writer.TryWrite(snapshot);
        }
    }

    public sealed class Subscription(ChannelReader<FlagSnapshot> reader, Action onDispose) : IDisposable
    {
        public ChannelReader<FlagSnapshot> Reader { get; } = reader;

        public void Dispose() => onDispose();
    }
}
