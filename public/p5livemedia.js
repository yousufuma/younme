/**
 *
 * @class p5LiveMedia
 * @constructor
 * @param {p5.sketch} [something] blah blah blah.
 * @param {p5LiveMedia.MEDIA TYPE}
 * @param {WebRTC stream}
 * @example
 *  		
    function setup() {
        // Stream Audio/Video
        createCanvas(400, 300);
        // For A/V streams, we need to use the createCapture callback method to get the "stream" object
        video = createCapture(VIDEO, function(stream) {
            let p5lm = new p5LiveMedia(this,"CAPTURE",stream)
            p5lm.on('stream', gotStream);
            p5lm.on('data', gotData);
            p5lm.on('disconnect', gotDisconnect);
        });  
        video.muted = true;     
        video.hide();

        // OR //

        // Stream Canvas as Video
        let c = createCanvas(400, 300);
        video = createCapture(VIDEO);
        video.muted = true;     
        video.hide();				
        let p5lm = new p5LiveMedia(this,"CANVAS",c);
        p5lm.on('stream', gotStream);
        p5lm.on('data', gotData);
        p5lm.on('disconnect', gotDisconnect);


        // OR //

        // Just Data
        createCanvas(400, 300);
        let p5lm = new p5LiveMedia(this,"DATA");
        p5lm.on('data', gotData);
        p5lm.on('disconnect', gotDisconnect);
    }

    function draw() {
        image(video,0,0,width/2,height);
        ellipse(mouseX,mouseY,100,100);
        if (ovideo != null) {
            rect(10,10,10,10);
            image(ovideo,width/2,0,width/2,height);
        }
    }		
    
    // We got a new stream!
    function gotStream(stream, id) {
        print("New Stream from " + id);
        // This is just like a video/stream from createCapture(VIDEO)
        ovideo = stream;
        //ovideo.hide();
    }

    function gotData(data, id) {
        print("New Data from " + id);
        // Got some data from a peer
        print(data);
    }

    function gotDisconnect(id) {
        print(id + " disconnected");
    }
*/
class p5LiveMedia {

    constructor(sketch, type, elem, room, host, rtcConfig) {

        this.sketch = sketch;
        //sketch.disableFriendlyErrors = true;

        this.simplepeers = [];
        this.rtcConfig = rtcConfig || { iceServers: [] };
        this.retryCounts = new Map();
        this.retryTimers = new Map();
        this.mystream;
        this.onStreamCallback;
        this.onDataCallback;
        this.onDisconnectCallback;
        
        if (!host) {
            this.socket = io.connect("https://p5livemedia.itp.io/");
        } else {
            this.socket = io.connect(host);
        }
        
        //console.log(elem.elt);
    
        if (type == "CANVAS") {
            this.mystream = elem.elt.captureStream(30);
        } else if (type == "CAPTURE") {
            this.mystream = elem;
        } else {
            // Assume it is just "DATA"

        }

        this.socket.on('connect', () => {
            window.younmeConnection.signaling = 'connected';
            recordConnectionEvent('signaling-connected');
            //console.log("Socket Connected");
            //console.log("My socket id: ", this.socket.id);

            //console.log("***"+window.location.href);

            // Sends back a list of users in the room
            if (!room) {
                this.socket.emit("room_connect", window.location.href);
            } else {
                this.socket.emit("room_connect", room);
            }
        });

        this.socket.on('disconnect', (data) => {
            window.younmeConnection.signaling = 'disconnected';
            recordConnectionEvent('signaling-disconnected');
            for (const timer of this.retryTimers.values()) clearTimeout(timer);
            this.retryTimers.clear();
            this.retryCounts.clear();
            for (const peer of [...this.simplepeers]) this.removePeer(peer.socket_id);
        });

        this.socket.on('connect_error', () => {
            window.younmeConnection.signaling = 'error';
            recordConnectionEvent('signaling-error');
        });

        this.socket.on('peer_disconnect', (data) => {
            clearTimeout(this.retryTimers.get(data));
            this.retryTimers.delete(data);
            this.retryCounts.delete(data);
            this.removePeer(data);
        });

        // Receive listresults from server
        this.socket.on('listresults', (data) => {
            //console.log(data);
            for (let i = 0; i < data.length; i++) {
                // Make sure it's not us
                if (
                    data[i] != this.socket.id &&
                    !this.simplepeers.some(peer => peer.socket_id == data[i])
                ) {

                    // create a new simplepeer and we'll be the "initiator"			
                    let simplepeer = new SimplePeerWrapper(this,
                        true, data[i], this.socket, this.mystream
                    );

                    // Push into our array
                    this.simplepeers.push(simplepeer);	
                }
            }
        });
            
        this.socket.on('signal', (to, from, data) => {

            //console.log("Got a signal from the server: ", to, from, data);

            // // to should be us
            // if (to != this.socket.id) {
            //     console.log("Socket IDs don't match");
            // }

            // Look for the right simplepeer in our array
            let found = false;
            for (let i = 0; i < this.simplepeers.length; i++)
            {
                
                if (this.simplepeers[i].socket_id == from) {
                    //console.log("Found right object");
                    // Give that simplepeer the signal
                    this.simplepeers[i].inputsignal(data);
                    found = true;
                    break;
                }
            
            }	
            if (!found) {
                // Late trickle candidates from a closed session must not create
                // a new peer with no offer; wait for the next real offer.
                if (!data || data.type !== 'offer') return;
                clearTimeout(this.retryTimers.get(from));
                this.retryTimers.delete(from);
                //console.log("Never found right simplepeer object");
                // Let's create it then, we won't be the "initiator"
                let simplepeer = new SimplePeerWrapper(this,
                    false, from, this.socket, this.mystream
                );
                
                // Push into our array
                this.simplepeers.push(simplepeer);	
                    
                // Tell the new simplepeer that signal
                simplepeer.inputsignal(data);
            }
        });
    }

    removePeer(id) {
        const peer = this.simplepeers.find(item => item.socket_id === id);
        if (!peer) return;
        this.simplepeers = this.simplepeers.filter(item => item !== peer);
        peer.disposed = true;
        this.callOnDisconnectCallback(id);
        peer.destroy();
        this.removeDomElement(peer);
        delete window.younmeConnection.peers[id];
    }

    retryPeer(peer) {
        if (peer.disposed) return;
        const id = peer.socket_id;
        const shouldRetry = peer.initiator && this.socket.connected;
        this.removePeer(id);
        const attempts = this.retryCounts.get(id) || 0;
        if (!shouldRetry || attempts >= 3) return;
        this.retryCounts.set(id, attempts + 1);
        this.retryTimers.set(id, setTimeout(() => {
            this.retryTimers.delete(id);
            if (!this.socket.connected || this.simplepeers.some(item => item.socket_id === id)) return;
            recordConnectionEvent('peer-retry', { peer: id, attempt: attempts + 1 });
            this.simplepeers.push(new SimplePeerWrapper(this, true, id, this.socket, this.mystream));
        }, 3000 * (attempts + 1)));
    }

    // // use this to add a track to a stream - assuming this is a stream, it will have to extract the track out
    // addtrack(stream, type) {
    //     if (type == "CANVAS") {
    //         this.mystream = elem.elt.captureStream(30);
    //     } else if (type == "CAPTURE") {
    //         this.mystream = elem;
    //     }
    // }

    send(data) {
        for (let i = 0; i < this.simplepeers.length; i++) {
            if (this.simplepeers[i] != null) {
                this.simplepeers[i].send(data);
            }
        }
    }

    on(event, callback) {
        if (event == 'stream') {
            this.onStream(callback);
        } else if (event == 'data') {
            this.onData(callback);
        } else if (event == "disconnect") {
            this.onDisconnect(callback);
        }
    }

    onDisconnect(callback) {
        this.onDisconnectCallback = callback;
    }

    onStream(callback) {
        this.onStreamCallback = callback;
    }

    onData(callback) {
        this.onDataCallback = callback;
    }

    callOnDisconnectCallback(id) {
        if (this.onDisconnectCallback) {
            this.onDisconnectCallback(id);
        }
    }

    callOnDataCallback(data, id) {
        if (this.onDataCallback) {
            this.onDataCallback(data, id);
        }
    }

    removeDomElement(ssp) {
        if (ssp.domElement && ssp.domElement.parentNode) {
            ssp.domElement.parentNode.removeChild(ssp.domElement);
        }
    }

    callOnStreamCallback(domElement, id) {
        if (this.onStreamCallback) {

            //////////////////////
            // Copied from createCapture and addElement in p5.js source 10/12/2020
            //const videoEl = addElement(domElement, this.sketch, true);
            // Safari can stop decoding a remote WebRTC video when the source is
            // display:none. Keep a tiny, non-interactive element in the page so
            // p5 can copy decoded frames into the sculpture texture.
            domElement.muted = true;
            domElement.defaultMuted = true;
            domElement.autoplay = true;
            domElement.playsInline = true;
            domElement.setAttribute('playsinline', '');
            domElement.setAttribute('webkit-playsinline', '');
            domElement.setAttribute('aria-hidden', 'true');
            domElement.style.position = 'fixed';
            domElement.style.left = '0';
            domElement.style.top = '0';
            domElement.style.width = '2px';
            domElement.style.height = '2px';
            domElement.style.opacity = '0.01';
            domElement.style.pointerEvents = 'none';
            // Keep it in the composited page. A negative stacking level can
            // make mobile browsers treat the element as fully occluded and
            // suspend frame production even though the WebRTC track is live.
            domElement.style.zIndex = '0';
            document.body.appendChild(domElement);
            let videoEl = new p5.MediaElement(domElement, this.sketch);
            this.sketch._elements.push(videoEl);

            // The stream event itself is the eligibility signal. Do not gate
            // the sculpture on a later metadata/frame event: those events can
            // be missed when a remote video starts before handlers are added.
            videoEl.loadedmetadata = true;
            const videoTrack = domElement.srcObject &&
              typeof domElement.srcObject.getVideoTracks === 'function'
              ? domElement.srcObject.getVideoTracks()[0]
              : null;
            const trackSettings = videoTrack &&
              typeof videoTrack.getSettings === 'function'
              ? videoTrack.getSettings()
              : {};
            // p5 uses the wrapper's width/height as its source crop. Give it a
            // usable size immediately, even on browsers that fired metadata
            // before this wrapper existed.
            videoEl.width = domElement.width = trackSettings.width || 640;
            videoEl.height = domElement.height = trackSettings.height || 480;
            const markFrameAvailable = function() {
              domElement.play().catch(() => {});
              if (domElement.videoWidth > 0 && domElement.videoHeight > 0) {
                videoEl.width = videoEl.elt.width = domElement.videoWidth;
                videoEl.height = videoEl.elt.height = domElement.videoHeight;
                if (domElement.readyState >= 2) {
                  videoEl._younmeFrameReady = true;
                }
              }
            };
            domElement.addEventListener('loadedmetadata', markFrameAvailable);
            domElement.addEventListener('loadeddata', markFrameAvailable);
            domElement.addEventListener('canplay', markFrameAvailable);
            /////////////////////////////

            this.onStreamCallback(videoEl, id);
        }
        else {
            //console.log("no onStreamCallback set");
        }
    }
}

// A wrapper for simplepeer as we need a bit more than it provides
class SimplePeerWrapper {

    constructor(p5lm, initiator, socket_id, socket, stream) {
        this.initiator = initiator;
        this.disposed = false;
        this.simplepeer = new SimplePeer({
            initiator: initiator,
            trickle: true,
            stream: stream || undefined,
            config: p5lm.rtcConfig
        });

        this.p5livemedia = p5lm;

        // Their socket id, our unique id for them
        this.socket_id = socket_id;

        // Socket.io Socket
        this.socket = socket;

        // Are we connected?
        this.connected = false;

        // Our video stream
        this.stream = stream;

        // Dom Element
        this.domElement = null;
        window.younmeConnection.peers[socket_id] = { state: 'connecting', route: 'unknown', video: false };
        this.connectionTimeout = setTimeout(() => {
            if (!this.connected && !this.disposed) {
                recordConnectionEvent('peer-timeout', { peer: socket_id });
                this.simplepeer.destroy();
            }
        }, 35000);

        this.simplepeer.on('iceStateChange', state => {
            const status = window.younmeConnection.peers[socket_id];
            if (status) status.state = state;
            recordConnectionEvent('ice-state', { peer: socket_id, state });
        });

        // simplepeer generates signals which need to be sent across socket
        this.simplepeer.on('signal', data => {						
            this.socket.emit('signal', this.socket_id, this.socket.id, data);
        });

        // When we have a connection, send our stream
        this.simplepeer.on('connect', () => {
            //console.log('simplepeer connection')
            //console.log(this.simplepeer);
            //p.send('whatever' + Math.random())

            // We are connected
            this.connected = true;
            clearTimeout(this.connectionTimeout);
            recordConnectionEvent('peer-connected', { peer: socket_id });
            // Check the selected candidate pair: having TURN configured alone
            // does not prove the media actually used a relay.
            this.simplepeer.getStats((error, reports) => {
                if (error || this.disposed) return;
                const transport = reports.find(report => report.type === 'transport' && report.selectedCandidatePairId);
                const pair = reports.find(report => report.type === 'candidate-pair' &&
                    (transport ? report.id === transport.selectedCandidatePairId : report.nominated && report.state === 'succeeded'));
                if (!pair) return;
                const candidates = reports.filter(report => report.id === pair.localCandidateId || report.id === pair.remoteCandidateId);
                const route = candidates.some(candidate => candidate.candidateType === 'relay') ? 'relay' : 'direct';
                window.younmeConnection.peers[socket_id].route = route;
                recordConnectionEvent('media-route', { peer: socket_id, route });
            });
        });

        // Stream coming in to us
        this.simplepeer.on('stream', stream => {
            //console.log('Incoming Stream');

            // This should really be a callback

            // Create a video object
            this.domElement = document.createElement("VIDEO");
            this.domElement.id = this.socket_id;
            this.domElement.srcObject = stream;
            this.domElement.muted = true;
            this.domElement.defaultMuted = true;
            this.domElement.autoplay = true;
            this.domElement.playsInline = true;
            this.domElement.setAttribute('playsinline', '');
            this.domElement.setAttribute('webkit-playsinline', '');
            this.domElement.onloadedmetadata = function(e) {
                e.target.play().catch(() => {});
            };
            window.younmeConnection.peers[socket_id].video = true;
            recordConnectionEvent('remote-stream', { peer: socket_id });
            //document.body.appendChild(ovideo);
            //console.log(this.domElement);

            this.p5livemedia.callOnStreamCallback(this.domElement, this.socket_id);
        });		
        
        this.simplepeer.on('data', data => {
            let stringData = String(data);

            this.p5livemedia.callOnDataCallback(stringData, this.socket_id);
        });

        this.simplepeer.on('error', (err) => {
            // ERR_WEBRTC_SUPPORT
            // ERR_CREATE_OFFER
            // ERR_CREATE_ANSWER
            // ERR_SET_LOCAL_DESCRIPTION
            // ERR_SET_REMOTE_DESCRIPTION
            // ERR_ADD_ICE_CANDIDATE
            // ERR_ICE_CONNECTION_FAILURE
            // ERR_SIGNALING
            // ERR_DATA_CHANNEL
            // ERR_CONNECTION_FAILURE
            this.connected = false;
            recordConnectionEvent('peer-error', { peer: socket_id, code: err.code || 'WEBRTC_ERROR' });
        });

        this.simplepeer.on('close', () => {
            this.connected = false;
            clearTimeout(this.connectionTimeout);
            this.p5livemedia.retryPeer(this);
        });
    }

    send(data) {
        if (this.connected) {
            this.simplepeer.send(data);
        } else {
            //console.log("Can't send, not connected");
        }
    }

    inputsignal(sig) {
        this.simplepeer.signal(sig);
    }

    destroy() {
        this.connected = false;
        this.disposed = true;
        clearTimeout(this.connectionTimeout);

        if (this.domElement && this.domElement.srcObject) {
            this.domElement.srcObject.getTracks().forEach(track => track.stop());
            this.domElement.srcObject = null;
        }

        if (this.simplepeer && !this.simplepeer.destroyed) {
            this.simplepeer.destroy();
        }
    }
}		
