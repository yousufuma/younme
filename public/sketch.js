const MAX_PARTICIPANTS = 12;
const TOTAL_RINGS = 72;
const SOLO_VISIBLE_RINGS = 14;
const SOURCE_STRIP_COUNT = 12;
const TEXTURE_SIZE = 1024;
const PRESENCE_BROADCAST_INTERVAL = 1500;
const SCENE_REFERENCE_SIZE = 768;
const SCENE_OFFSET_X = -130;
const SCENE_OFFSET_Y = 45;
const SPHERE_OFFSET_X = 185;

const LANGUAGE_TEXT = {
  ar: ["أنا", "أنت"],
  de: ["Ich", "Du"],
  en: ["Me", "You"],
  es: ["Yo", "Tú"],
  fr: ["Moi", "Toi"],
  ja: ["私", "あなた"],
  ko: ["나", "너"],
  pt: ["Eu", "Você"],
  ru: ["Я", "Ты"],
  zh: ["我", "你"],
};

const revealVertexShader = `
  precision mediump float;

  attribute vec3 aPosition;
  attribute vec2 aTexCoord;

  uniform mat4 uModelViewMatrix;
  uniform mat4 uProjectionMatrix;

  varying vec2 vTexCoord;

  void main() {
    vTexCoord = aTexCoord;
    gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
  }
`;

const revealFragmentShader = `
  precision mediump float;

  uniform sampler2D uTexture;
  varying vec2 vTexCoord;

  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);

    if (color.a < 0.1) {
      discard;
    }

    gl_FragColor = color;
  }
`;

let sculpture;
let webcam;
let liveMedia;
let materialTexture;
let sphereTexture;
let revealShader;
let canvas;
let rotationX = 0;
let rotationY = 58;
let remoteVideos = {};
let previewParticipants = [];
let previewNetworkEnabled = false;
let previewUsesPublicSignaling = false;
let previewNetworkState = { listedPeers: 0, receivedSignals: 0 };
let localPresence;
let remotePresence = {};
let lastPresenceBroadcast = -PRESENCE_BROADCAST_INTERVAL;
let touchDragPosition = null;
let sphereTextParticles = [];
let knownSphereTextSources = new Set();

function preload() {
  sculpture = loadModel("neo.obj", true);
}

function setup() {
  canvas = createCanvas(windowWidth, windowHeight, WEBGL);
  canvas.elt.setAttribute("aria-label", "Shared webcam sculpture");

  pixelDensity(1);
  angleMode(DEGREES);
  textureMode(IMAGE);
  textureWrap(CLAMP);

  materialTexture = createGraphics(TEXTURE_SIZE, TEXTURE_SIZE);
  materialTexture.pixelDensity(1);
  sphereTexture = createGraphics(TEXTURE_SIZE, TEXTURE_SIZE);
  sphereTexture.pixelDensity(1);
  revealShader = createShader(revealVertexShader, revealFragmentShader);
  localPresence = readBrowserPresence();
  listenForPresenceChanges();

  if (window.__YOUNME_PREVIEW__) {
    const requestedCount = Number(window.__YOUNME_PREVIEW__.participants);
    const requestedSeed = Number(window.__YOUNME_PREVIEW__.seed);
    const participantCount = constrain(
      Number.isFinite(requestedCount) ? floor(requestedCount) : 1,
      1,
      MAX_PARTICIPANTS
    );
    const previewSeed = Number.isFinite(requestedSeed) ? floor(requestedSeed) : 0;
    previewNetworkEnabled = Boolean(window.__YOUNME_PREVIEW__.network);
    previewUsesPublicSignaling =
      window.__YOUNME_PREVIEW__.signaling === "public";
    previewParticipants = createPreviewParticipants(
      previewNetworkEnabled ? 1 : participantCount,
      previewSeed
    );

    if (previewNetworkEnabled) {
      const stream = previewParticipants[0].video.elt.captureStream(15);
      connectLiveMedia(stream, "WebRTC Development Preview");
    }
    return;
  }

  webcam = createCapture(
    {
      audio: false,
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    },
    function (stream) {
      connectLiveMedia(stream, "younme-public-sculpture-v1");
    }
  );
  webcam.elt.muted = true;
  webcam.elt.autoplay = true;
  webcam.elt.setAttribute("playsinline", "");
  webcam.hide();
}

function draw() {
  background(0);

  const participants = getParticipants();
  updatePreviewParticipants();
  broadcastPresenceIfDue();
  drawSphereTexture(getPresenceContributors());
  drawMaterial(participants);

  canvas.elt.dataset.participants = String(participants.length);
  canvas.elt.dataset.remoteParticipants = String(
    Object.keys(remoteVideos).length
  );
  canvas.elt.dataset.sphereTextParticles = String(sphereTextParticles.length);
  canvas.elt.dataset.signaling = previewNetworkEnabled
    ? previewUsesPublicSignaling
      ? "p5livemedia-public-preview"
      : "local-preview"
    : "p5livemedia-public";
  canvas.elt.dataset.socketConnected = String(
    Boolean(liveMedia && liveMedia.socket && liveMedia.socket.connected)
  );
  canvas.elt.dataset.peerConnections = String(
    liveMedia ? liveMedia.simplepeers.length : 0
  );
  canvas.elt.dataset.connectedPeers = String(
    liveMedia
      ? liveMedia.simplepeers.filter((peer) => peer.connected).length
      : 0
  );
  canvas.elt.dataset.listedPeers = String(previewNetworkState.listedPeers);
  canvas.elt.dataset.receivedSignals = String(
    previewNetworkState.receivedSignals
  );

  if (previewNetworkEnabled) {
    canvas.elt.dataset.remotePresence = String(
      Object.keys(remotePresence).length
    );
    canvas.elt.setAttribute(
      "aria-label",
      `WebRTC preview: ${participants.length} participants, ${Object.keys(remoteVideos).length} remote videos, ${previewNetworkState.receivedSignals} signals, ${previewNetworkState.listedPeers} listed peers, ${liveMedia ? liveMedia.simplepeers.length : 0} peer connections, ${liveMedia ? liveMedia.simplepeers.filter((peer) => peer.connected).length : 0} connected peers, socket ${liveMedia && liveMedia.socket && liveMedia.socket.connected ? "connected" : "disconnected"}`
    );
  }

  const participantCount = max(1, participants.length);
  const sculptureScale = map(
    constrain(participantCount, 1, MAX_PARTICIPANTS),
    1,
    MAX_PARTICIPANTS,
    2.1,
    3.15
  );
  const portraitScale = height > width ? 0.82 : 1;
  const sceneScale = constrain(
    (min(width, height) / SCENE_REFERENCE_SIZE) * portraitScale,
    0.34,
    1
  );
  const portraitExcess = max(0, height - width);
  const portraitCenteringOffsetX = portraitExcess * 0.245;
  const portraitCenteringOffsetY = portraitExcess * 0.09;
  const landscapeExcess = max(0, width - height);
  const landscapeCenteringOffsetY = landscapeExcess * 0.065;
  const sphereViewportScale = constrain(min(width, height) / 520, 0.72, 1);

  resetShader();
  push();
  translate(
    SCENE_OFFSET_X * sceneScale - portraitCenteringOffsetX,
    SCENE_OFFSET_Y * sceneScale -
      portraitCenteringOffsetY -
      landscapeCenteringOffsetY,
    0
  );
  scale(sceneScale);

  push();
  translate(SPHERE_OFFSET_X, 0, -450);
  scale(2.4 * sphereViewportScale);
  rotateY(frameCount * 0.3);
  noStroke();
  texture(sphereTexture);
  sphere(185, 36, 24);
  pop();

  push();
  rotateZ(180);
  rotateX(rotationX);
  rotateY(rotationY);
  scale(sculptureScale);
  noStroke();
  shader(revealShader);
  revealShader.setUniform("uTexture", materialTexture);
  model(sculpture);
  pop();

  pop();
}

function getParticipants() {
  if (previewParticipants.length > 0) {
    if (!previewNetworkEnabled) {
      return previewParticipants;
    }

    const localId =
      liveMedia && liveMedia.socket && liveMedia.socket.id
        ? liveMedia.socket.id
        : previewParticipants[0].id;
    const participants = [
      {
        ...previewParticipants[0],
        id: localId,
      },
    ];

    for (const id in remoteVideos) {
      const video = remoteVideos[id];
      if (videoIsReady(video)) {
        participants.push({ id: id, video: video });
      }
    }

    return participants.sort((a, b) => a.id.localeCompare(b.id));
  }

  const participants = [];
  const localId = liveMedia && liveMedia.socket ? liveMedia.socket.id : "local";

  if (videoIsReady(webcam)) {
    participants.push({ id: localId || "local", video: webcam });
  }

  for (const id in remoteVideos) {
    const video = remoteVideos[id];
    if (videoIsReady(video)) {
      participants.push({ id: id, video: video });
    }
  }

  return participants.sort((a, b) => a.id.localeCompare(b.id));
}

function createPreviewParticipants(count, seed) {
  const participants = [];

  for (let i = 0; i < count; i++) {
    const previewIndex = seed + i;
    const video = createGraphics(640, 480);
    video.pixelDensity(1);
    video.loadedmetadata = true;
    participants.push({
      id: `preview-${String(previewIndex).padStart(2, "0")}`,
      video: video,
      index: previewIndex,
      presence: previewPresence(previewIndex),
    });
  }

  return participants;
}

function connectLiveMedia(stream, room) {
  const signalingHost = previewNetworkEnabled && !previewUsesPublicSignaling
    ? window.location.origin
    : undefined;

  liveMedia = new p5LiveMedia(
    p5.instance,
    "CAPTURE",
    stream,
    room,
    signalingHost
  );
  liveMedia.on("stream", gotStream);
  liveMedia.on("data", gotData);
  liveMedia.on("disconnect", gotDisconnect);

  liveMedia.socket.on("listresults", (ids) => {
    previewNetworkState.listedPeers = ids.length;
  });
  liveMedia.socket.on("signal", () => {
    previewNetworkState.receivedSignals += 1;
  });
}

function updatePreviewParticipants() {
  for (const participant of previewParticipants) {
    const video = participant.video;
    const index = participant.index;
    const phase = frameCount * (0.7 + index * 0.04) + index * 53;
    const hue = (index * 47) % 255;

    video.background(hue, 255 - hue, 120 + ((index * 29) % 110));
    video.noStroke();
    video.fill(10);
    video.rect((phase % 760) - 120, 0, 110, video.height);
    video.fill(245);
    video.ellipse(video.width * 0.5, video.height * 0.42, 230, 300);
    video.fill(20);
    video.ellipse(video.width * 0.44, video.height * 0.38, 24, 18);
    video.ellipse(video.width * 0.56, video.height * 0.38, 24, 18);
    video.rect(video.width * 0.43, video.height * 0.55, 90, 16);
  }
}

function drawMaterial(participants) {
  materialTexture.clear();

  if (participants.length === 0) {
    return;
  }

  const visibleRingCount = round(
    map(
      constrain(participants.length, 1, MAX_PARTICIPANTS),
      1,
      MAX_PARTICIPANTS,
      SOLO_VISIBLE_RINGS,
      TOTAL_RINGS
    )
  );
  const ringOrder = shuffledRingOrder();

  for (let i = 0; i < visibleRingCount; i++) {
    const participant = participants[i % participants.length];
    const ringIndex = ringOrder[i];
    const participantRingIndex = floor(i / participants.length);
    drawVideoRing(participant.video, ringIndex, participantRingIndex);
  }
}

function drawVideoRing(video, ringIndex, sequenceIndex) {
  const cellHeight = TEXTURE_SIZE / TOTAL_RINGS;
  const destinationY = ringIndex * cellHeight;
  const destinationHeight = ceil(cellHeight);

  const sourceWidth = video.width || video.elt.videoWidth || 1;
  const sourceHeight = video.height || video.elt.videoHeight || 1;
  const sourceStripHeight = max(1, sourceHeight / SOURCE_STRIP_COUNT);
  const sourceY = (sequenceIndex % SOURCE_STRIP_COUNT) * sourceStripHeight;

  materialTexture.image(
    video,
    0,
    destinationY,
    TEXTURE_SIZE,
    destinationHeight,
    0,
    sourceY,
    sourceWidth,
    sourceStripHeight
  );
}

function shuffledRingOrder() {
  const order = Array.from({ length: TOTAL_RINGS }, (_, index) => index);
  let seed = 48271;

  for (let i = order.length - 1; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    const current = order[i];
    order[i] = order[j];
    order[j] = current;
  }

  return order;
}

function mouseDragged() {
  if (!pointerIsOverCanvas()) {
    return;
  }

  rotationY += movedX * 0.45;
  rotationX = constrain(rotationX - movedY * 0.45, -90, 90);
  return false;
}

function touchMoved() {
  if (touches.length !== 1 || !touchDragPosition) {
    return;
  }

  const touch = touches[0];
  const deltaX = touch.x - touchDragPosition.x;
  const deltaY = touch.y - touchDragPosition.y;
  rotationY += deltaX * 0.45;
  rotationX = constrain(rotationX - deltaY * 0.45, -90, 90);
  touchDragPosition = { x: touch.x, y: touch.y };
  return false;
}

function touchStarted() {
  if (touches.length !== 1 || !pointIsOverCanvas(touches[0])) {
    touchDragPosition = null;
    return;
  }

  touchDragPosition = { x: touches[0].x, y: touches[0].y };
  return false;
}

function touchEnded() {
  touchDragPosition = null;
  return false;
}

function pointerIsOverCanvas() {
  return mouseX >= 0 && mouseX <= width && mouseY >= 0 && mouseY <= height;
}

function pointIsOverCanvas(point) {
  return point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function gotStream(stream, id) {
  const videoElement = stream.elt;
  const markVideoReady = () => {
    stream.loadedmetadata = true;
    if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
      stream.width = videoElement.videoWidth;
      stream.height = videoElement.videoHeight;
    }
  };

  videoElement.muted = true;
  videoElement.autoplay = true;
  videoElement.setAttribute("playsinline", "");
  videoElement.addEventListener("loadedmetadata", markVideoReady);
  videoElement.addEventListener("loadeddata", markVideoReady);
  stream.hide();
  markVideoReady();
  remoteVideos[id] = stream;

  const playPromise = videoElement.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {});
  }
}

function videoIsReady(video) {
  if (!video) {
    return false;
  }

  const videoElement = video.elt || video;
  return Boolean(
    video.loadedmetadata ||
      (videoElement &&
        videoElement.readyState >= 2 &&
        (videoElement.videoWidth > 0 || video.width > 0))
  );
}

function gotDisconnect(id) {
  const video = remoteVideos[id];
  if (video) {
    video.remove();
  }
  delete remoteVideos[id];
  delete remotePresence[id];
}

function gotData(data, id) {
  try {
    const presence = JSON.parse(data);
    if (presence.type !== "presence") {
      return;
    }

    const language =
      typeof presence.language === "string"
        ? presence.language.slice(0, 35)
        : "und";
    const downlink = Number.isFinite(presence.downlink)
      ? constrain(presence.downlink, 0, 10)
      : null;

    remotePresence[id] = {
      type: "presence",
      language: language,
      text: languageText(language),
      downlink: downlink,
    };
  } catch (error) {
    // Ignore non-presence data sent through the shared p5LiveMedia channel.
  }
}

function readBrowserPresence() {
  const language = navigator.language || "und";
  const connection = getNetworkInformation();
  const downlink =
    connection && Number.isFinite(connection.downlink)
      ? constrain(connection.downlink, 0, 10)
      : null;

  return {
    type: "presence",
    language: language,
    text: languageText(language),
    downlink: downlink,
  };
}

function getNetworkInformation() {
  return (
    navigator.connection ||
    navigator.mozConnection ||
    navigator.webkitConnection ||
    null
  );
}

function listenForPresenceChanges() {
  window.addEventListener("languagechange", refreshLocalPresence);

  const connection = getNetworkInformation();
  if (connection && typeof connection.addEventListener === "function") {
    connection.addEventListener("change", refreshLocalPresence);
  }
}

function refreshLocalPresence() {
  localPresence = readBrowserPresence();
  lastPresenceBroadcast = -PRESENCE_BROADCAST_INTERVAL;
}

function languageText(language) {
  const languageCode = String(language || "und").toLowerCase().split("-")[0];
  return LANGUAGE_TEXT[languageCode] || ["Me", "You"];
}

function previewPresence(index) {
  const languages = ["zh-CN", "en-US", "ja-JP", "es-ES", "fr-FR", "ko-KR"];
  const language = languages[index % languages.length];

  return {
    type: "presence",
    language: language,
    text: languageText(language),
    downlink: 1 + ((index * 2.3) % 9),
  };
}

function currentLocalPresence() {
  if (previewParticipants.length > 0) {
    return previewParticipants[0].presence;
  }
  return localPresence;
}

function getPresenceContributors() {
  if (previewParticipants.length > 0 && !previewNetworkEnabled) {
    return previewParticipants.map((participant) => participant.presence);
  }

  return [currentLocalPresence(), ...Object.values(remotePresence)].filter(
    Boolean
  );
}

function broadcastPresenceIfDue() {
  if (
    !liveMedia ||
    millis() - lastPresenceBroadcast < PRESENCE_BROADCAST_INTERVAL
  ) {
    return;
  }

  const presence = currentLocalPresence();
  liveMedia.send(
    JSON.stringify({
      type: "presence",
      language: presence.language,
      downlink: presence.downlink,
    })
  );
  lastPresenceBroadcast = millis();
}

function drawSphereTexture(presences) {
  sphereTexture.clear();
  sphereTexture.push();
  sphereTexture.textAlign(LEFT, CENTER);
  sphereTexture.textStyle(BOLD);
  sphereTexture.noStroke();

  const sources = presences.map((presence, index) => ({
    key: `${index}:${presence.language || "und"}:${presence.text || ""}`,
    presence: presence,
  }));
  const activeKeys = new Set(sources.map((source) => source.key));
  const presenceByKey = new Map(
    sources.map((source) => [source.key, source.presence])
  );

  for (const source of sources) {
    const targetCount = sphereTextTargetCount(source.presence);
    const currentCount = sphereTextParticles.filter(
      (particle) => particle.sourceKey === source.key
    ).length;
    const isNewSource = !knownSphereTextSources.has(source.key);
    const spawnCount = isNewSource
      ? max(0, targetCount - currentCount)
      : min(1, max(0, targetCount - currentCount));

    for (let i = 0; i < spawnCount; i++) {
      sphereTextParticles.push(
        createSphereTextParticle(
          source.presence,
          source.key,
          isNewSource
        )
      );
    }

    knownSphereTextSources.add(source.key);
  }

  for (const sourceKey of Array.from(knownSphereTextSources)) {
    if (!activeKeys.has(sourceKey)) {
      knownSphereTextSources.delete(sourceKey);
    }
  }

  const frameStep = constrain(deltaTime / (1000 / 60), 0.25, 3);
  const nextParticles = [];

  for (const particle of sphereTextParticles) {
    particle.life += frameStep;
    if (particle.life >= particle.lifetime) {
      continue;
    }

    const progress = particle.life / particle.lifetime;
    const fadeIn = constrain(progress / 0.12, 0, 1);
    const fadeOut = constrain((1 - progress) / 0.28, 0, 1);
    const presence = presenceByKey.get(particle.sourceKey);
    const alpha =
      (presence ? sphereTextAlpha(presence) : particle.baseAlpha) *
      min(fadeIn, fadeOut);
    const x =
      particle.x +
      sin(frameCount * particle.waveSpeed + particle.wavePhase) *
        particle.waveWidth;
    const y = lerp(particle.startY, particle.endY, progress);

    sphereTexture.textSize(particle.textSize);
    for (let trailIndex = particle.trailLength; trailIndex >= 0; trailIndex--) {
      const trailAlpha =
        alpha * (trailIndex === 0 ? 1 : 0.34 / trailIndex);
      sphereTexture.fill(30, 255, 105, trailAlpha);
      sphereTexture.text(
        particle.text,
        x,
        y - trailIndex * particle.trailSpacing
      );
    }
    nextParticles.push(particle);
  }

  sphereTextParticles = nextParticles;

  sphereTexture.pop();
}

function sphereTextTargetCount(presence) {
  const downlink = Number.isFinite(presence.downlink) ? presence.downlink : 5;
  return floor(map(constrain(downlink, 0, 10), 0, 10, 5, 18));
}

function sphereTextAlpha(presence) {
  const downlink = Number.isFinite(presence.downlink) ? presence.downlink : 5;
  return map(constrain(downlink, 0, 10), 0, 10, 65, 235);
}

function createSphereTextParticle(presence, sourceKey, distributeAcrossSphere) {
  const lifetime = random(150, 310);
  const initialProgress = distributeAcrossSphere ? random(0, 0.9) : 0;
  const words = Array.isArray(presence.text)
    ? presence.text
    : languageText(presence.language);

  return {
    sourceKey: sourceKey,
    text: random(words),
    textSize: random(42, 62),
    baseAlpha: sphereTextAlpha(presence),
    x: random(20, TEXTURE_SIZE - 90),
    startY: random(-260, -55),
    endY: random(TEXTURE_SIZE + 70, TEXTURE_SIZE + 260),
    waveWidth: random(2, 12),
    waveSpeed: random(0.25, 0.7),
    wavePhase: random(360),
    trailLength: floor(random(1, 4)),
    trailSpacing: random(30, 55),
    life: lifetime * initialProgress,
    lifetime: lifetime,
  };
}
