import { createServer } from "node:http";
import { handle } from "../api/outthink.mjs";
const server = createServer(async (req, res) => {
  try {
    let size = 0,
      chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 40000) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(chunk);
    }
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: req.headers,
      ...(!["GET", "HEAD"].includes(req.method)
        ? { body: Buffer.concat(chunks) }
        : {}),
    });
    const result = await handle(request);
    res.writeHead(result.status, Object.fromEntries(result.headers));
    res.end(await result.text());
  } catch {
    res.writeHead(500);
    res.end("Server error");
  }
});
server.listen(3001, "127.0.0.1", () =>
  console.log("OutThink API ready on 127.0.0.1:3001"),
);
