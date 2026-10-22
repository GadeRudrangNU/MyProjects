import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { Config } from "./config";

export type TraceCarrier = Record<string, string>;

let provider: NodeTracerProvider | null = null;

export function initTelemetry(
  serviceName: string,
  cfg: Pick<Config, "OTEL_EXPORTER_OTLP_ENDPOINT" | "TRACE_STDOUT">,
  extra: SpanProcessor[] = [],
) {
  if (provider) return provider;
  const processors: SpanProcessor[] = [...extra];
  if (cfg.OTEL_EXPORTER_OTLP_ENDPOINT) {
    processors.push(
      new BatchSpanProcessor(new OTLPTraceExporter({ url: `${cfg.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` })),
    );
  }
  if (cfg.TRACE_STDOUT) processors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ "service.name": serviceName }),
    spanProcessors: processors,
  });
  provider.register();
  return provider;
}

export async function shutdownTelemetry() {
  await provider?.shutdown();
  provider = null;
}

export const tracer = () => trace.getTracer("bytedrop");

export function injectTrace(): TraceCarrier {
  const carrier: TraceCarrier = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

export function extractTrace(carrier: TraceCarrier | null | undefined): Context {
  return carrier ? propagation.extract(context.active(), carrier) : context.active();
}

export async function withSpan<T>(
  name: string,
  carrier: TraceCarrier | null | undefined,
  attrs: Record<string, string | number>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const parent = extractTrace(carrier);
  return tracer().startActiveSpan(name, { kind: SpanKind.CONSUMER, attributes: attrs }, parent, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}
