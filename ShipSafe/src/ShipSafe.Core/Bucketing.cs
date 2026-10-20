using System.Buffers;
using System.Buffers.Binary;
using System.Numerics;
using System.Text;

namespace ShipSafe.Core;

public static class Bucketing
{
    public const int BucketCount = 10_000;

    public static int Bucket(string flagKey, string userId)
    {
        var length = Encoding.UTF8.GetByteCount(flagKey) + 1 + Encoding.UTF8.GetByteCount(userId);
        byte[]? rented = null;
        Span<byte> buffer = length <= 256
            ? stackalloc byte[length]
            : (rented = ArrayPool<byte>.Shared.Rent(length)).AsSpan(0, length);
        try
        {
            var written = Encoding.UTF8.GetBytes(flagKey, buffer);
            buffer[written++] = (byte)':';
            Encoding.UTF8.GetBytes(userId, buffer[written..]);
            return (int)(Murmur3(buffer) % BucketCount);
        }
        finally
        {
            if (rented is not null)
            {
                ArrayPool<byte>.Shared.Return(rented);
            }
        }
    }

    public static uint Murmur3(ReadOnlySpan<byte> data, uint seed = 0)
    {
        const uint c1 = 0xcc9e2d51;
        const uint c2 = 0x1b873593;
        var h = seed;
        var blocks = data.Length / 4;

        for (var i = 0; i < blocks; i++)
        {
            var k = BinaryPrimitives.ReadUInt32LittleEndian(data[(i * 4)..]);
            k *= c1;
            k = BitOperations.RotateLeft(k, 15);
            k *= c2;
            h ^= k;
            h = BitOperations.RotateLeft(h, 13);
            h = h * 5 + 0xe6546b64;
        }

        var tail = blocks * 4;
        uint rest = 0;
        switch (data.Length & 3)
        {
            case 3:
                rest ^= (uint)data[tail + 2] << 16;
                goto case 2;
            case 2:
                rest ^= (uint)data[tail + 1] << 8;
                goto case 1;
            case 1:
                rest ^= data[tail];
                rest *= c1;
                rest = BitOperations.RotateLeft(rest, 15);
                rest *= c2;
                h ^= rest;
                break;
        }

        h ^= (uint)data.Length;
        h ^= h >> 16;
        h *= 0x85ebca6b;
        h ^= h >> 13;
        h *= 0xc2b2ae35;
        h ^= h >> 16;
        return h;
    }
}
