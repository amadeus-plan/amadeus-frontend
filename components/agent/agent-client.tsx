"use client";

import { useEffect, useMemo } from "react";
import { Room, RoomEvent, RemoteTrack, RemoteTrackPublication, RemoteParticipant, Track } from "livekit-client";
import { RoomAudioRenderer, RoomContext } from "@livekit/components-react";

// Matches the shape returned by /api/connection-details
type ConnectionDetails = {
  serverUrl: string;
  participantToken: string;
};

export type AgentClientProps = {
  // Auto connect on mount. If false, the component will be inert until this becomes true.
  autoConnect?: boolean;
  // Whether to enable LiveKit's pre-connect microphone buffer.
  preConnectBuffer?: boolean;
  // Whether speaker output should be enabled (controls RoomAudioRenderer rendering)
  speakerEnabled?: boolean;
  // Initial microphone state when connecting
  defaultMicEnabled?: boolean;
  // Optional error callback
  onError?: (error: Error) => void;
  // Callback when audio track is received (for Live2D integration)
  onAudioTrack?: (audioElement: HTMLAudioElement, track: RemoteTrack) => void;
  // Callback when room is connected and ready
  onRoomReady?: (room: Room) => void;
};

export default function AgentClient({
  autoConnect = true,
  preConnectBuffer = false,
  speakerEnabled = true,
  defaultMicEnabled = true,
  onError,
  onAudioTrack,
  onRoomReady,
}: AgentClientProps) {
  const room = useMemo(() => new Room({
    // Prefer mono voice-optimized capture by default
    audioCaptureDefaults: {
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
      channelCount: 1,
    },
    publishDefaults: {
      dtx: true,
    },
  }), []);

  // Basic error handling for media device failures
  useEffect(() => {
    const onMediaDevicesError = (error: Error) => {
      console.error("Media devices error:", error);
      onError?.(error);
    };
    room.on(RoomEvent.MediaDevicesError, onMediaDevicesError);
    return () => {
      room.off(RoomEvent.MediaDevicesError, onMediaDevicesError);
    };
  }, [room, onError]);

  // Handle audio track subscription for Live2D integration
  useEffect(() => {
    const handleTrackSubscribed = (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      console.log('Track subscribed:', track.kind, track.source);

      if (track.kind === Track.Kind.Audio && onAudioTrack) {
        console.log('Audio track received, creating audio element for Live2D');

        // Create audio element and attach the track
        const audioElement = track.attach() as HTMLAudioElement;

        // Configure audio element for Live2D
        audioElement.crossOrigin = "anonymous";
        audioElement.autoplay = true;
        // Avoid double playback; RoomAudioRenderer already outputs audio
        audioElement.muted = true;
        // Ensure playback so WebAudio can pull data on Chrome/WebView
        audioElement.play().catch(() => {});

        // Call the callback with the audio element and track
        onAudioTrack(audioElement, track);
      }
    };

    const handleTrackUnsubscribed = (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      console.log('Track unsubscribed:', track.kind);
      if (track.kind === Track.Kind.Audio) {
        // Clean up the audio elements
        track.detach();
      }
    };

    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);

    return () => {
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
    };
  }, [room, onAudioTrack]);

  // Connect, enable mic, and try to start audio playback
  useEffect(() => {
    if (!autoConnect) return;

    let cancelled = false;

    const connect = async () => {
      try {
        const res = await fetch("/api/connection-details", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`Failed to get connection details: ${res.status} ${res.statusText}`);
        }
        const { serverUrl, participantToken } = (await res.json()) as ConnectionDetails;
        if (cancelled) return;

        await room.connect(serverUrl, participantToken);
        // notify parent that room is ready
        try {
          onRoomReady?.(room);
        } catch {}
        await room.localParticipant.setMicrophoneEnabled(
          defaultMicEnabled,
          {
            autoGainControl: true,
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1,
          },
          {
            preConnectBuffer,
            dtx: true,
          },
        );

        // Attempt to start audio immediately; may be blocked by browser until user gesture
        try {
          await room.startAudio();
        } catch {
          // Will attempt again on first user gesture below
        }
      } catch (e) {
        console.error("Error connecting to agent:", e);
        onError?.(e as Error);
      }
    };

    connect();

    // As a fallback for autoplay policies, unlock audio on first user gesture
    const unlock = async () => {
      try {
        await room.startAudio();
      } catch {
        // ignore
      } finally {
        document.removeEventListener("click", unlock);
        document.removeEventListener("touchstart", unlock);
        document.removeEventListener("keydown", unlock);
      }
    };

    document.addEventListener("click", unlock, { once: true });
    document.addEventListener("touchstart", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });

    return () => {
      cancelled = true;
      room.disconnect();
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, [autoConnect, preConnectBuffer, room, onError]);

  // Headless: only render audio elements; no UI
  return (
    <RoomContext.Provider value={room}>
      {speakerEnabled ? <RoomAudioRenderer /> : null}
    </RoomContext.Provider>
  );
}
