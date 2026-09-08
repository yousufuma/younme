const MAX_PARTICIPANTS = 12;
const RINGS_PER_PARTICIPANT = 4;
const TOTAL_RINGS = MAX_PARTICIPANTS * RINGS_PER_PARTICIPANT;
const TEXTURE_SIZE = 1024;
const PRESENCE_BROADCAST_INTERVAL = 1500;
const SCENE_REFERENCE_SIZE = 768;
const SCENE_OFFSET_X = -130;
const SCENE_OFFSET_Y = 45;
const SPHERE_OFFSET_X = 185;

const LANGUAGE_TEXT = {
  ar: "أنا وأنت",
  de: "Ich und Du",
  en: "Me and You",
  es: "Yo y tú",
  fr: "Moi et toi",
  ja: "私とあなた",
  ko: "나와 너",
  pt: "Eu e você",
  ru: "Я и ты",
  zh: "我和你",
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
let previewNetworkState = { listedPeers: 0, receivedSignals: 0 };
let localPresence;
let remotePresence = {};
let lastPresenceBroadcast = -PRESENCE_BROADCAST_INTERVAL;
let touchDragPosition = null;

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
      connectLiveMedia(stream, "Shared Space");
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

  if (previewNetworkEnabled) {
    canvas.elt.dataset.participants = String(participants.length);
    canvas.elt.dataset.remoteParticipants = String(
      Object.keys(remoteVideos).length
    );
    canvas.elt.dataset.remotePresence = String(
      Object.keys(remotePresence).length
    );
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
      if (video && video.loadedmetadata) {
        participants.push({ id: id, video: video });
      }
    }

    return participants.sort((a, b) => a.id.localeCompare(b.id));
  }

  const participants = [];
  const localId = liveMedia && liveMedia.socket ? liveMedia.socket.id : "local";

  if (webcam && webcam.loadedmetadata) {
    participants.push({ id: localId || "local", video: webcam });
  }

  for (const id in remoteVideos) {
    const video = remoteVideos[id];
    if (video && video.loadedmetadata) {
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
  SimplePeer.config = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  };

  liveMedia = new p5LiveMedia(
    p5.instance,
    "CAPTURE",
    stream,
    room,
    window.location.origin
  );
  liveMedia.on("stream", gotStream);
  liveMedia.on("data", gotData);
  liveMedia.on("disconnect", gotDisconnect);

  if (previewNetworkEnabled) {
    liveMedia.socket.on("listresults", (ids) => {
      previewNetworkState.listedPeers = ids.length;
    });
    liveMedia.socket.on("signal", () => {
      previewNetworkState.receivedSignals += 1;
    });
  }
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

  const visibleRingCount = min(
    TOTAL_RINGS,
    participants.length * RINGS_PER_PARTICIPANT
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
  const sourceStripHeight = max(1, sourceHeight / RINGS_PER_PARTICIPANT);
  const sourceY =
    (sequenceIndex % RINGS_PER_PARTICIPANT) * sourceStripHeight;

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
  stream.elt.muted = true;
  stream.elt.autoplay = true;
  stream.elt.setAttribute("playsinline", "");
  stream.hide();
  remoteVideos[id] = stream;
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
  return LANGUAGE_TEXT[languageCode] || "Me和你&我和You";
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
  sphereTexture.textSize(54);
  sphereTexture.noStroke();

  let lineIndex = 0;
  for (
    let participantIndex = 0;
    participantIndex < presences.length;
    participantIndex++
  ) {
    const presence = presences[participantIndex];
    const downlink = Number.isFinite(presence.downlink) ? presence.downlink : 5;
    const lineCount = floor(map(constrain(downlink, 0, 10), 0, 10, 2, 11));
    const alpha = map(constrain(downlink, 0, 10), 0, 10, 55, 235);
    const text = presence.text || languageText(presence.language);
    const advance = max(230, sphereTexture.textWidth(text) + 70);

    sphereTexture.fill(30, 255, 105, alpha);

    for (let i = 0; i < lineCount; i++) {
      const y = ((lineIndex + i) * 67 + participantIndex * 29) % TEXTURE_SIZE;
      const speed = 0.45 + participantIndex * 0.08;
      const offset = -((frameCount * speed + i * 83) % advance);

      for (let x = offset; x < TEXTURE_SIZE + advance; x += advance) {
        sphereTexture.text(text, x, y);
      }
    }

    lineIndex += lineCount;
  }

  sphereTexture.pop();
}
