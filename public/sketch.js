let obj, obj2, pg;

let myvideo;

let otherVideo = {};

let p5l;

let socket;

function preload() {
  obj = loadModel("neo.obj", true);
  obj2 = loadModel("x.obj", true);
  // sound = loadSound('002.mp3');
}

function setup() {
  createCanvas(622, 622, WEBGL);
  pg = createGraphics(width, height);
  angleMode(DEGREES);
  textureMode(IMAGE);
  textureWrap(CLAMP);

//   socket = io.connect('http://localhost:3000')

  let constraints = { audio: true, video: true };
  myvideo = createCapture(constraints, function (stream) {
    p5l = new p5LiveMedia(this, "CAPTURE", stream, "Shared Space");
    p5l.on("stream", gotStream);
    p5l.on("disconnect", gotDisconnect);
  });
  myvideo.elt.muted = true;
  myvideo.hide();
}

function draw() {
  // clear();

  stroke(200);

  rotateZ(180);

  rotateY(58);

  pg.clear();
  pg.push();
  // pg.background("white");
  pg.translate(pg.width / 2, pg.height);
  pg.rotate(radians(180));
  pg.textAlign(LEFT, CENTER);

  pg.randomSeed(4);
  for (let i = 0; i < 44; i++) {
    let txtSize = 122;
    let x =
      ((pg.random(pg.width) + frameCount) % (pg.width + txtSize)) -
      pg.width / 5;
    let y = i * 40;
    pg.fill("green");
    pg.stroke("green");
    pg.textSize(65);
    pg.text("Me和你&我和You", -x, y);
  }
  pg.pop();
  textureMode(IMAGE);
  textureWrap(CLAMP);

  push();
  translate(486, 10, -300);
  scale(2.75);
  rotateY(frameCount * 0.3);
  strokeWeight(0);
  noStroke();
  //   ambientLight(180);
  //   let locX = mouseX - width / 2;
  //   let locY = mouseY - height / 2;
  //   pointLight(100, 0, 0, locX, locY, 50);

  //   specularMaterial(200,200);
  //   shininess(20);
  texture(pg);
  sphere(185);

  pop();

  scale(2.45);
  rotateY(-frameCount * 2);
  noStroke();
  texture(myvideo);
  model(obj);

  let count = 1;
  for (const id in otherVideo) {
    scale(1);
    rotateY(-frameCount * 1);
    noStroke();

    texture(otherVideo[id].stream);
    model(obj2);

    count++;
  }
}

// We got a new stream!
function gotStream(stream, id) {
  stream.hide();
  otherVideo[id] = { stream: stream };
}

function gotDisconnect(id) {
  delete otherVideo[id];
}
