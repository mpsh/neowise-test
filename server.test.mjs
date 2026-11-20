import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

let child;
let base;

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server.mjs"], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(base);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("server did not start");
});

after(() => child?.kill());

const post = (body) =>
  fetch(`${base}/api/triage`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
const triage = (text) => post(JSON.stringify({ text }));

const MANUAL_REVIEW = { status: "manual_review", topic: null, draft: null };

for (const marker of ["[timeout]", "[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
  test(`model failure ${marker} -> manual_review`, async () => {
    const started = Date.now();
    const reply = await triage(`Вопрос про доставку ${marker}`);
    assert.equal(reply.status, 200);
    assert.deepEqual(await reply.json(), MANUAL_REVIEW);
    assert.ok(Date.now() - started < 1000, "must not wait for the slow model");
  });
}

test("valid request -> ready", async () => {
  const reply = await triage("Какая стоимость доставки?");
  assert.equal(reply.status, 200);
  const body = await reply.json();
  assert.equal(body.status, "ready");
  assert.equal(body.topic, "pricing");
  assert.ok(body.draft.trim() !== "");
});

for (const [name, body] of [
  ["empty text", JSON.stringify({ text: "" })],
  ["blank text", JSON.stringify({ text: "   " })],
  ["missing text", JSON.stringify({})],
  ["non-string text", JSON.stringify({ text: 42 })],
  ["null body", "null"],
  ["broken JSON", "{not json"],
]) {
  test(`invalid input (${name}) -> 400`, async () => {
    const reply = await post(body);
    assert.equal(reply.status, 400);
    assert.deepEqual(await reply.json(), { status: "invalid_input" });
  });
}
