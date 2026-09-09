// Diagnostics deliberately exclude SDP, ICE addresses, camera data and secrets.
window.younmeConnection = {
  relay: "loading",
  signaling: "idle",
  peers: {},
  events: [],
};

function recordConnectionEvent(event, details = {}) {
  const entry = { time: new Date().toISOString(), event, ...details };
  window.younmeConnection.events.push(entry);
  if (window.younmeConnection.events.length > 80) {
    window.younmeConnection.events.shift();
  }
  console.info("[younme:connection]", JSON.stringify(entry));
}

async function loadRtcConfig() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch("/api/rtc-config", {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("RTC_CONFIG_UNAVAILABLE");
    const config = await response.json();
    if (!Array.isArray(config.iceServers)) throw new Error("RTC_CONFIG_INVALID");
    window.younmeConnection.relay = config.relayConfigured ? "configured" : "missing";
    recordConnectionEvent("rtc-config", { relay: window.younmeConnection.relay });
    return { iceServers: config.iceServers, iceTransportPolicy: relayTestEnabled() ? "relay" : "all" };
  } catch {
    window.younmeConnection.relay = "unavailable";
    recordConnectionEvent("rtc-config-unavailable");
    // Preserve local/LAN viewing during provider outages, but report that this
    // is STUN-only: it is not a successful cross-network connection.
    return {
      iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }],
      iceTransportPolicy: relayTestEnabled() ? "relay" : "all",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function relayTestEnabled() {
  return new URLSearchParams(window.location.search).get("relay") === "1";
}
