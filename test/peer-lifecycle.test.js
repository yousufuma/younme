const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

function fixture() {
  const timers = new Map();
  let nextTimer = 0;
  class FakePeer extends EventEmitter {
    constructor(options) { super(); this.options = options; this.destroyed = false; }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit("close"); } }
    signal(data) { this.lastSignal = data; }
  }
  const socket = new EventEmitter();
  socket.id = "local";
  socket.connected = true;
  const createdVideos = [];
  const document = {
    body: {
      appendChild(element) { element.parentNode = this; },
      removeChild(element) { element.parentNode = null; },
    },
    createElement() {
      const listeners = new Map();
      const element = {
        style: {},
        readyState: 0,
        videoWidth: 0,
        videoHeight: 0,
        setAttribute() {},
        addEventListener(name, callback) { listeners.set(name, callback); },
        emit(name) { listeners.get(name)?.({ target: element }); },
        play() { return Promise.resolve(); },
      };
      createdVideos.push(element);
      return element;
    },
  };
  class MediaElement {
    constructor(element) { this.elt = element; this.width = 0; this.height = 0; }
  }
  const context = vm.createContext({
    console, SimplePeer: FakePeer, io: { connect: () => socket },
    window: { younmeConnection: { peers: {} } }, recordConnectionEvent() {},
    document, p5: { MediaElement },
    setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(`${readFileSync(require.resolve("../public/p5livemedia.js"), "utf8")}\nthis.LiveMedia = p5LiveMedia;`, context);
  const config = { iceServers: [{ urls: "turns:example:443", username: "temporary", credential: "temporary" }], iceTransportPolicy: "relay" };
  const stream = { id: "camera", stopped: false };
  const sketch = { _elements: [] };
  const media = new context.LiveMedia(sketch, "CAPTURE", stream, "room", "http://localhost", config);
  return { media, socket, timers, config, stream, context, sketch, createdVideos };
}

test("both roles receive relay policy and camera in their first negotiation", () => {
  const { media, socket, config, stream } = fixture();
  socket.emit("listresults", ["first"]);
  socket.emit("signal", "local", "second", { type: "offer", sdp: "test" });
  for (const peer of media.simplepeers) {
    assert.equal(peer.simplepeer.options.config, config);
    assert.equal(peer.simplepeer.options.stream, stream);
  }
  assert.equal(media.simplepeers.length, 2);
});

test("socket loss disposes all peers and timers without stopping local camera", () => {
  const { media, socket, timers, stream, context } = fixture();
  socket.emit("listresults", ["first", "second"]);
  const peers = [...media.simplepeers];
  const removed = [];
  media.on("disconnect", id => removed.push(id));
  socket.connected = false;
  socket.emit("disconnect");
  assert.equal(media.simplepeers.length, 0);
  assert.equal(timers.size, 0);
  assert.equal(Object.keys(context.window.younmeConnection.peers).length, 0);
  assert.equal(removed.length, 2);
  assert.ok(peers.every(peer => peer.simplepeer.destroyed));
  assert.equal(stream.stopped, false);
});

test("peer leave cancels scheduled recovery and late candidates cannot resurrect it", () => {
  const { media, socket, timers } = fixture();
  socket.emit("listresults", ["remote"]);
  media.simplepeers[0].simplepeer.destroy();
  assert.equal(media.retryTimers.size, 1);
  socket.emit("peer_disconnect", "remote");
  socket.emit("signal", "local", "remote", { candidate: "late" });
  assert.equal(media.simplepeers.length, 0);
  assert.equal(timers.size, 0);
});

test("unreachable peer retries are bounded", () => {
  const { media, socket, timers } = fixture();
  socket.emit("listresults", ["remote"]);
  for (let i = 0; i < 4; i++) {
    media.simplepeers[0].simplepeer.destroy();
    const timerId = media.retryTimers.get("remote");
    if (timerId) { const fn = timers.get(timerId); timers.delete(timerId); fn(); }
  }
  assert.equal(media.simplepeers.length, 0);
  assert.equal(timers.size, 0);
  assert.equal(media.retryCounts.get("remote"), 3);
});

test("remote video stays composited and is drawable as soon as its stream arrives", () => {
  const { media, socket, sketch } = fixture();
  media.on("stream", () => {});
  socket.emit("listresults", ["remote"]);
  const peer = media.simplepeers[0];
  peer.simplepeer.emit("stream", { id: "remote-stream" });
  const video = peer.domElement;
  const wrapped = sketch._elements[0];

  assert.equal(video.style.position, "fixed");
  assert.equal(video.style.opacity, "0.01");
  assert.equal(video.style.display, undefined);
  assert.equal(video.style.zIndex, "0");
  assert.equal(video.muted, true);
  assert.equal(video.playsInline, true);
  assert.equal(wrapped.loadedmetadata, true);
  assert.equal(wrapped.width, 640);
  assert.equal(wrapped.height, 480);
  assert.equal(video.srcObject.id, "remote-stream");

  video.videoWidth = 640;
  video.videoHeight = 480;
  video.readyState = 2;
  video.emit("loadeddata");
  assert.equal(wrapped.loadedmetadata, true);
  assert.equal(wrapped._younmeFrameReady, true);
});
