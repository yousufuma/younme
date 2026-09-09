const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { createRtcConfig, summarizeRtcConfig } = require("../lib/rtc-config");

test("missing credentials explicitly report STUN-only, not relay success", async () => {
  const result = await createRtcConfig({});
  assert.equal(result.relayConfigured, false);
  assert.equal(result.expiresAt, null);
  assert.ok(result.iceServers.every(server => server.urls.startsWith("stun:")));
});

test("coturn receives unique expiring credentials, never the signing secret", async () => {
  const env = { TURN_URLS: "turn:relay.example:3478?transport=udp,turns:relay.example:443?transport=tcp", TURN_SHARED_SECRET: "test-only-signing-secret" };
  const a = await createRtcConfig(env);
  const b = await createRtcConfig(env);
  const relay = a.iceServers.at(-1);
  assert.equal(a.relayConfigured, true);
  assert.notEqual(relay.username, b.iceServers.at(-1).username);
  assert.ok(Number(relay.username.split(":")[0]) > Date.now() / 1000);
  assert.equal(relay.credential, createHmac("sha1", env.TURN_SHARED_SECRET).update(relay.username).digest("base64"));
  assert.equal(JSON.stringify(a).includes(env.TURN_SHARED_SECRET), false);
});

test("Cloudflare token stays server-side and UDP/TLS relay alternatives survive", async () => {
  const env = { TURN_KEY_ID: "test-key", TURN_KEY_API_TOKEN: "test-secret" };
  const result = await createRtcConfig(env, async (url, options) => {
    assert.ok(url.endsWith("/test-key/credentials/generate-ice-servers"));
    assert.equal(options.headers.Authorization, "Bearer test-secret");
    assert.equal(options.method, "POST");
    return { ok: true, json: async () => ({ iceServers: [{
      urls: ["turn:relay.example:53?transport=udp", "turn:relay.example:3478?transport=udp", "turns:relay.example:443?transport=tcp"],
      username: "expiring-user", credential: "expiring-password", extraSecret: "not-for-client",
    }] }) };
  });
  assert.deepEqual(result.iceServers[0].urls, ["turn:relay.example:3478?transport=udp", "turns:relay.example:443?transport=tcp"]);
  assert.equal(JSON.stringify(result).includes("test-secret"), false);
  assert.equal(JSON.stringify(result).includes("not-for-client"), false);
});

test("provider errors cannot silently become a relay-ready response", async () => {
  const env = { TURN_KEY_ID: "id", TURN_KEY_API_TOKEN: "test-secret" };
  await assert.rejects(createRtcConfig(env, async () => ({ ok: false })), /TURN_PROVIDER_UNAVAILABLE/);
  await assert.rejects(createRtcConfig(env, async () => ({ ok: true, json: async () => ({ iceServers: [{ urls: "stun:only.example" }] }) })), /TURN_MISSING_RELAY/);
  await assert.rejects(createRtcConfig({ TURN_URLS: "https://wrong.example", TURN_SHARED_SECRET: "test" }), /TURN_INVALID_URLS/);
});

test("public status only reports safe relay facts", () => {
  const status = summarizeRtcConfig({
    relayConfigured: true,
    iceServers: [
      { urls: ["stun:stun.cloudflare.com:3478"] },
      {
        urls: [
          "turn:turn.cloudflare.com:3478?transport=udp",
          "turns:turn.cloudflare.com:443?transport=tcp",
        ],
        username: "temporary-user",
        credential: "temporary-secret",
      },
    ],
  });
  assert.deepEqual(status, {
    relayConfigured: true,
    serverCount: 2,
    protocols: ["stun", "turn", "turns"],
  });
  assert.equal(JSON.stringify(status).includes("temporary"), false);
});
