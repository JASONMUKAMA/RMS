const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];

export function openViewer(connection, sittingId, onStream) {
  const pc = new RTCPeerConnection({ iceServers });
  const pending = [];
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.ontrack = (event) => onStream(event.streams[0] || new MediaStream([event.track]));
  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    connection.invoke("SendIce", sittingId, connection.connectionId, JSON.stringify(event.candidate.toJSON())).catch(() => {});
  };
  const offered = pc.createOffer()
    .then((offer) => pc.setLocalDescription(offer))
    .then(() => connection.invoke("SendOffer", sittingId, pc.localDescription.sdp));
  return {
    live: () => pc.getReceivers().some((receiver) => receiver.track && receiver.track.readyState === "live"),
    acceptAnswer: async (sdp) => {
      await offered;
      if (pc.signalingState !== "have-local-offer") return;
      await pc.setRemoteDescription({ type: "answer", sdp });
      while (pending.length) await pc.addIceCandidate(pending.shift()).catch(() => {});
    },
    addIce: async (candidate) => {
      if (!pc.currentRemoteDescription) {
        pending.push(candidate);
        return;
      }
      await pc.addIceCandidate(candidate).catch(() => {});
    },
    close: () => pc.close()
  };
}

export function openPublisher(connection, sittingId, viewerId, stream, earlyIce) {
  const pc = new RTCPeerConnection({ iceServers });
  const pending = [...earlyIce];
  for (const track of stream.getVideoTracks()) pc.addTrack(track, stream);
  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    connection.invoke("SendIce", sittingId, viewerId, JSON.stringify(event.candidate.toJSON())).catch(() => {});
  };
  return {
    pc,
    start: async (sdp) => {
      await pc.setRemoteDescription({ type: "offer", sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await connection.invoke("SendAnswer", sittingId, viewerId, pc.localDescription.sdp);
      while (pending.length) await pc.addIceCandidate(pending.shift()).catch(() => {});
    },
    addIce: async (candidate) => {
      if (!pc.currentRemoteDescription) {
        pending.push(candidate);
        return;
      }
      await pc.addIceCandidate(candidate).catch(() => {});
    },
    close: () => pc.close()
  };
}
