import { demoState } from "./data";

const FORMAT_FACTOR: Record<string, number> = { avif: 0.35, webp: 0.5, jpeg: 0.7, png: 1.15 };

function pdf(text: string) {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => (out += `${String(o).padStart(10, "0")} 00000 n \n`));
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return out;
}

export interface DemoAsset {
  status: number;
  contentType: string;
  body: string;
}

/** Stand-in for the delivery endpoint: renders a placeholder whose byte size follows the requested transform. */
export function demoAsset(bucket: string, key: string, query: URLSearchParams): DemoAsset {
  const obj = demoState().objects[bucket]?.find((o) => o.key === key);
  if (!obj) return { status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "File not found" } }) };

  if (obj.kind === "image") {
    const w = Number(query.get("w")) || 1600;
    const h = Math.round((w * 1000) / 1600);
    const q = Number(query.get("q")) || 80;
    const factor = FORMAT_FACTOR[query.get("format") ?? ""] ?? 1;
    const target = Math.max(900, Math.min(450_000, Math.round(obj.size * (w / 1600) ** 2 * factor * (q / 80) ** 1.3)));
    const hue = (obj.sha256.charCodeAt(0) * 7) % 360;
    const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 1600 1000"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},65%,52%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360},70%,32%)"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#g)"/><circle cx="1200" cy="300" r="220" fill="hsla(${(hue + 40) % 360},80%,75%,.3)"/><text x="80" y="920" font-size="72" font-family="sans-serif" fill="#fff">${obj.key.split("/").pop()}</text></svg>`;
    const pad = Math.max(0, target - head.length - 7);
    return { status: 200, contentType: "image/svg+xml", body: `${head}<!--${"x".repeat(pad)}-->` };
  }
  if (obj.kind === "pdf") return { status: 200, contentType: "application/pdf", body: pdf(obj.key) };
  if (obj.kind === "text") {
    return { status: 200, contentType: "text/plain", body: `${obj.key}\n\nThis is demo content for ${obj.key}.\nIt stands in for a real file in ${bucket}.\n` };
  }
  return { status: 200, contentType: obj.contentType, body: "demo" };
}
