import { createServer } from "node:http";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./handler.js";

const port = Number(process.env.PORT ?? 8080);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const bodyChunks: Buffer[] = [];
    for await (const chunk of req) {
      bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(bodyChunks);
    const headers = normalizeHeaders(req.headers as Record<string, string | string[] | undefined>);

    const event: APIGatewayProxyEventV2 = {
      version: "2.0",
      routeKey: "$default",
      rawPath: url.pathname,
      rawQueryString: url.search.length > 0 ? url.search.slice(1) : "",
      headers,
      requestContext: {
        accountId: "",
        apiId: "",
        domainName: "",
        domainPrefix: "",
        requestId: "",
        routeKey: "$default",
        stage: "$default",
        time: "",
        timeEpoch: Date.now(),
        http: {
          method: req.method ?? "GET",
          path: url.pathname,
          protocol: "HTTP/1.1",
          sourceIp: headers["x-forwarded-for"] ?? "",
          userAgent: headers["user-agent"] ?? "",
        },
      },
      isBase64Encoded: rawBody.length > 0,
      body: rawBody.length > 0 ? rawBody.toString("base64") : undefined,
    };

    const lambdaResult = await handler(event, {} as never, () => undefined);
    const result =
      typeof lambdaResult === "string"
        ? { statusCode: 200, headers: { "content-type": "text/plain; charset=utf-8" }, body: lambdaResult }
        : (lambdaResult ?? { statusCode: 204, headers: {}, body: "" });
    const statusCode = result.statusCode ?? 200;
    const outHeaders = normalizeResponseHeaders(result.headers);
    if ("cookies" in result && result.cookies && result.cookies.length > 0) {
      outHeaders["set-cookie"] = result.cookies.join(", ");
    }
    res.writeHead(statusCode, outHeaders);
    res.end(result.body ?? "");
  } catch (err) {
    console.error("server error", err);
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "internal server error" }));
  }
});

server.listen(port, () => {
  console.log(`cairn backend listening on :${port}`);
});

function normalizeHeaders(
  input: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      headers[key.toLowerCase()] = value.join(", ");
    } else {
      headers[key.toLowerCase()] = value;
    }
  }
  return headers;
}

function normalizeResponseHeaders(
  input: Record<string, string | number | boolean> | undefined,
): Record<string, string> {
  if (!input) return {};
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    headers[key] = String(value);
  }
  return headers;
}
