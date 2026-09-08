import { deflateSync } from "node:zlib";
// Small PNG encoder for deterministic CPU render captures; no browser process.
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, body: Buffer) {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, body])));
  return Buffer.concat([length, name, body, crc]);
}
export function rasterImage(
  triangles: {
    pts: number[][];
    fill: string;
    world?: number[][];
    appearance?: (p: number[]) => number[];
  }[],
  minX: number,
  minY: number,
  scale: number,
) {
  const width = 1200,
    height = 900,
    pixels = Buffer.alloc(width * height * 4),
    depths = new Float32Array(width * height).fill(-Infinity);
  for (const t of triangles) {
    const p = t.pts.map((p) => [
        140 + (p[0] - minX) * scale,
        110 + (p[1] - minY) * scale,
        p[2],
      ]),
      [a, b, c] = p,
      den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(den) < 1e-8) continue;
    const color = (t.fill.match(/\d+/g) || []).map(Number),
      left = Math.max(120, Math.floor(Math.min(...p.map((p) => p[0])))),
      right = Math.min(1099, Math.ceil(Math.max(...p.map((p) => p[0])))),
      top = Math.max(105, Math.floor(Math.min(...p.map((p) => p[1])))),
      bottom = Math.min(804, Math.ceil(Math.max(...p.map((p) => p[1]))));
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++) {
        const u =
            ((b[1] - c[1]) * (x + 0.5 - c[0]) +
              (c[0] - b[0]) * (y + 0.5 - c[1])) /
            den,
          v =
            ((c[1] - a[1]) * (x + 0.5 - c[0]) +
              (a[0] - c[0]) * (y + 0.5 - c[1])) /
            den,
          w = 1 - u - v;
        if (u < 0 || v < 0 || w < 0) continue;
        const z = u * a[2] + v * b[2] + w * c[2],
          i = y * width + x;
        if (z < depths[i]) continue;
        depths[i] = z;
        const shaded =
          t.appearance && t.world
            ? t
                .appearance(
                  [0, 1, 2].map(
                    (axis) =>
                      u * t.world![0][axis] +
                      v * t.world![1][axis] +
                      w * t.world![2][axis],
                  ),
                )
                .map((n) => Math.round(Math.max(0, Math.min(1, n)) * 255))
            : color;
        pixels[i * 4] = shaded[0];
        pixels[i * 4 + 1] = shaded[1];
        pixels[i * 4 + 2] = shaded[2];
        pixels[i * 4 + 3] = 255;
      }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    pixels.copy(
      rows,
      y * (width * 4 + 1) + 1,
      y * width * 4,
      (y + 1) * width * 4,
    );
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
