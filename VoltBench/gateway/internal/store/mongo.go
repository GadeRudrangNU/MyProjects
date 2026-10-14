package store

import (
	"context"
	"log/slog"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type Meta struct {
	DeviceID int    `bson:"device_id"`
	Signal   string `bson:"signal"`
}

type Sample struct {
	TS    time.Time `bson:"ts"`
	Meta  Meta      `bson:"meta"`
	Value float64   `bson:"value"`
	Seq   int       `bson:"seq"`
}

type Mongo struct {
	client  *mongo.Client
	coll    *mongo.Collection
	in      chan Sample
	done    chan struct{}
	observe func(time.Duration)
}

func OpenMongo(ctx context.Context, uri, dbName string, observe func(time.Duration)) (*Mongo, error) {
	client, err := mongo.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		return nil, err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx, nil); err != nil {
		return nil, err
	}
	db := client.Database(dbName)
	names, err := db.ListCollectionNames(ctx, bson.M{"name": "telemetry"})
	if err != nil {
		return nil, err
	}
	if len(names) == 0 {
		ts := options.TimeSeries().SetTimeField("ts").SetMetaField("meta").SetGranularity("seconds")
		opts := options.CreateCollection().SetTimeSeriesOptions(ts).SetExpireAfterSeconds(7 * 24 * 3600)
		if err := db.CreateCollection(ctx, "telemetry", opts); err != nil {
			return nil, err
		}
	}
	return &Mongo{client: client, coll: db.Collection("telemetry"), in: make(chan Sample, 20000), done: make(chan struct{}), observe: observe}, nil
}

// Enqueue hands a sample to the batch writer. It drops the sample rather than
// blocking the frame reader if the writer has fallen far behind.
func (m *Mongo) Enqueue(s Sample) bool {
	if m == nil {
		return false
	}
	select {
	case m.in <- s:
		return true
	default:
		return false
	}
}

const (
	flushEvery = 200 * time.Millisecond
	flushSize  = 500
)

func (m *Mongo) Run(ctx context.Context) {
	defer close(m.done)
	batch := make([]any, 0, flushSize)
	ticker := time.NewTicker(flushEvery)
	defer ticker.Stop()
	flush := func() {
		if len(batch) == 0 {
			return
		}
		start := time.Now()
		wctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		_, err := m.coll.InsertMany(wctx, batch, options.InsertMany().SetOrdered(false))
		cancel()
		if m.observe != nil {
			m.observe(time.Since(start))
		}
		if err != nil {
			slog.Error("telemetry batch insert failed", "err", err, "size", len(batch))
		}
		batch = batch[:0]
	}
	for {
		select {
		case s := <-m.in:
			batch = append(batch, s)
			if len(batch) >= flushSize {
				flush()
			}
		case <-ticker.C:
			flush()
		case <-ctx.Done():
			flush()
			return
		}
	}
}

func (m *Mongo) Wait() { <-m.done }

type Point struct {
	Signal string  `json:"signal"`
	TS     int64   `json:"ts"`
	Value  float64 `json:"value"`
}

func (m *Mongo) Query(ctx context.Context, deviceID int, signal string, from, to time.Time, stepMs int64, limit int64) ([]Point, error) {
	match := bson.M{"meta.device_id": deviceID, "ts": bson.M{"$gte": from, "$lte": to}}
	if signal != "" {
		match["meta.signal"] = signal
	}
	pipeline := mongo.Pipeline{{{Key: "$match", Value: match}}}
	if stepMs > 0 {
		pipeline = append(pipeline,
			bson.D{{Key: "$group", Value: bson.M{
				"_id": bson.M{
					"signal": "$meta.signal",
					"bin":    bson.M{"$dateTrunc": bson.M{"date": "$ts", "unit": "millisecond", "binSize": stepMs}},
				},
				"value": bson.M{"$avg": "$value"},
			}}},
			bson.D{{Key: "$project", Value: bson.M{"_id": 0, "signal": "$_id.signal", "ts": "$_id.bin", "value": 1}}},
		)
	} else {
		pipeline = append(pipeline, bson.D{{Key: "$project", Value: bson.M{"_id": 0, "signal": "$meta.signal", "ts": 1, "value": 1}}})
	}
	pipeline = append(pipeline, bson.D{{Key: "$sort", Value: bson.D{{Key: "ts", Value: 1}}}}, bson.D{{Key: "$limit", Value: limit}})
	cur, err := m.coll.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	out := []Point{}
	for cur.Next(ctx) {
		var row struct {
			Signal string    `bson:"signal"`
			TS     time.Time `bson:"ts"`
			Value  float64   `bson:"value"`
		}
		if err := cur.Decode(&row); err != nil {
			return nil, err
		}
		out = append(out, Point{Signal: row.Signal, TS: row.TS.UnixMilli(), Value: row.Value})
	}
	return out, cur.Err()
}

func (m *Mongo) Close(ctx context.Context) { _ = m.client.Disconnect(ctx) }
