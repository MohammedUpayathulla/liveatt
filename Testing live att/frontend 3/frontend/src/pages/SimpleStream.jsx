import React, { useEffect, useRef } from "react";
import Hls from "hls.js";

export default function StreamPlayer() {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;

    const streamUrl =
      "http://localhost:5005/hls/main_office/index.m3u8";

    if (Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: true,
        liveSyncDurationCount: 1,
      });

      hls.loadSource(streamUrl);

      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log("✓ Manifest Loaded");

        video
          .play()
          .then(() => {
            console.log("✓ Video Playing");
          })
          .catch((err) => {
            console.log("Autoplay blocked:", err);
          });
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error("HLS ERROR:", data);
      });

      return () => {
        hls.destroy();
      };
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
    }
  }, []);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      controls
      style={{
        width: "100%",
        height: "100%",
        background: "black",
      }}
    />
  );
}
