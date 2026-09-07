export async function api(url: string, body?: unknown) {
  const r = await fetch("/api" + url, {
    credentials: "same-origin",
    ...(body !== undefined
      ? {
          method: "POST",
          headers:
            body instanceof FormData
              ? {}
              : { "Content-Type": "application/json" },
          body: body instanceof FormData ? body : JSON.stringify(body),
        }
      : {}),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Request failed");
  return d;
}
