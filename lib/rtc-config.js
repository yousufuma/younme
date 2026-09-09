const { createHmac, randomBytes } = require("node:crypto");

const STUN_SERVERS = [
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
];
const CREDENTIAL_TTL = 86400;

// Provider tokens and coturn's shared secret stay on the server. Only expiring
// credentials for this visitor are returned to RTCPeerConnection.
async function createRtcConfig(env = process.env, fetchImpl = fetch) {
  const expiresAt = Date.now() + CREDENTIAL_TTL * 1000;
  let iceServers;

  if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) {
    const response = await fetchImpl(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: CREDENTIAL_TTL }),
        signal: AbortSignal.timeout(7000),
      }
    );
    if (!response.ok) throw new Error("TURN_PROVIDER_UNAVAILABLE");
    const data = await response.json();
    if (!Array.isArray(data.iceServers)) throw new Error("TURN_INVALID_RESPONSE");
    iceServers = data.iceServers.map((server) => ({
      urls: (Array.isArray(server.urls) ? server.urls : [server.urls])
        .filter((url) => typeof url === "string" && /^(stun|turn|turns):/.test(url))
        .filter((url) => !/:53(?:\?|$)/.test(url)),
      ...(server.username && server.credential
        ? { username: server.username, credential: server.credential }
        : {}),
    })).filter((server) => server.urls.length);
  } else if (env.TURN_URLS && env.TURN_SHARED_SECRET) {
    const urls = env.TURN_URLS.split(",").map((url) => url.trim());
    if (!urls.every((url) => /^turns?:[^\s]+$/.test(url))) {
      throw new Error("TURN_INVALID_URLS");
    }
    const username = `${Math.floor(expiresAt / 1000)}:${randomBytes(12).toString("hex")}`;
    const credential = createHmac("sha1", env.TURN_SHARED_SECRET)
      .update(username).digest("base64");
    iceServers = [...STUN_SERVERS, { urls, username, credential }];
  } else {
    return { iceServers: STUN_SERVERS, relayConfigured: false, expiresAt: null };
  }

  if (!iceServers.some((server) => server.username && server.credential &&
      server.urls.some((url) => /^turns?:/.test(url)))) {
    throw new Error("TURN_MISSING_RELAY");
  }
  return { iceServers, relayConfigured: true, expiresAt };
}

async function rtcConfigHandler(request, response) {
  response.set("Cache-Control", "private, no-store");
  // The public artwork has no login. Reject browser cross-site requests, and
  // keep credentials short-lived; provider quotas remain the billing boundary.
  if (request.get("sec-fetch-site") === "cross-site") {
    return response.status(403).json({ error: "CROSS_SITE_REQUEST" });
  }
  try {
    response.json(await createRtcConfig());
  } catch {
    // Never log provider responses, authorization headers, or credentials.
    console.error("[younme:rtc] TURN_CONFIG_UNAVAILABLE");
    response.status(503).json({ error: "TURN_CONFIG_UNAVAILABLE" });
  }
}

module.exports = { createRtcConfig, rtcConfigHandler };
