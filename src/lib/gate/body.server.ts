/** Read a bounded UTF-8 JSON payload, including bodies without Content-Length. */
export async function readLimitedJson(request: Request, maxBytes = 4096): Promise<unknown> {
  if (Number(request.headers.get("content-length") || "0") > maxBytes) throw new Error("Payload too large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("Payload too large"); }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}
