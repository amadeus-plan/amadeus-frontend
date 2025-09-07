'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import * as PIXI from 'pixi.js-legacy';
import { RemoteTrack, Track, Room, LocalTrackPublication } from 'livekit-client';
import styles from './call.module.css';
import AgentClient from '@/components/agent/agent-client';
import { createStreamLive2DModel } from '@/lib/live2d/stream-live2d';

// Register PIXI plugin
if (typeof window !== 'undefined') {
    (window as any).PIXI = PIXI;
}

const MODEL_PATH = '/kurisu/kurisu.model.json';

function CallPage() {
    const [cameraEnabled, setCameraEnabled] = useState(false);
    const [micEnabled, setMicEnabled] = useState(false); // default off
    const [modelVisible, setModelVisible] = useState(true); // default visible
    const [speakerEnabled, setSpeakerEnabled] = useState(false); // default off
    const [currentFacingMode, setCurrentFacingMode] = useState<'user' | 'environment'>('environment'); // 'user' = front, 'environment' = rear
    const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
    const [live2dLoaded, setLive2dLoaded] = useState(false);
    const router = useRouter();

    const canvasRef = useRef(null);
    const pixiAppRef = useRef(null);
    const modelRef = useRef(null);
    const currentAudioRef = useRef<HTMLAudioElement | null>(null);

    const videoRef = useRef<HTMLVideoElement>(null);
    const roomRef = useRef<Room | null>(null);
    const cameraPubRef = useRef<LocalTrackPublication | null>(null);

    const publishFromVideoRef = async () => {
        const room = roomRef.current;
        if (!room || !videoRef.current) return;
        try {
            let stream = videoRef.current.srcObject as MediaStream | null;
            if (!stream && typeof (videoRef.current as any).captureStream === 'function') {
                try {
                    stream = (videoRef.current as any).captureStream();
                } catch { }
            }
            if (!stream) return;
            const [newTrack] = stream.getVideoTracks();
            if (!newTrack) return;

            // If already published, just replace the underlying MediaStreamTrack
            if (cameraPubRef.current?.track) {
                await cameraPubRef.current.track.replaceTrack(newTrack);
                return;
            }

            // Otherwise publish
            const pub = await room.localParticipant.publishTrack(newTrack, {
                name: 'camera-preview',
                source: Track.Source.Camera,
                simulcast: true,
            });
            cameraPubRef.current = pub;
        } catch (e) {
            console.warn('publishFromVideoRef failed:', e);
        }
    };

    const unpublishCamera = async () => {
        const room = roomRef.current;
        try {
            if (room && cameraPubRef.current?.track) {
                await room.localParticipant.unpublishTrack(cameraPubRef.current.track);
            }
        } catch { }
        finally {
            cameraPubRef.current = null;
        }
    };

    // Enumerate available camera devices
    const enumerateCameras = async () => {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(device => device.kind === 'videoinput');
            setAvailableCameras(videoDevices);
            console.log('Available cameras:', videoDevices);
        } catch (error) {
            console.error('Error enumerating cameras:', error);
        }
    };

    // Get camera stream (mobile Chrome compatible: prefer exact, fallback to ideal, then pick by deviceId)
    const getCameraStream = async (facingMode: 'user' | 'environment') => {
        try {
            // 1) Try exact first (forces switching on Chrome when supported)
            try {
                const exactStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { exact: facingMode } },
                    audio: false,
                });
                // Refresh device list (Chrome only fills labels after permission is granted)
                try { await navigator.mediaDevices.enumerateDevices(); } catch { }
                return exactStream;
            } catch {
                // ignore and fall through
            }

            // 2) Fallback to ideal
            let stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: facingMode } },
                audio: false,
            });

            // 3) If multiple cameras are available, select precisely by deviceId (more reliable on Chrome)
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const videoDevices = devices.filter(d => d.kind === 'videoinput');

                if (videoDevices.length > 1) {
                    const normalize = (s: string) => s.toLowerCase();
                    const frontKeywords = ['front', 'user', 'face', 'frontfacing', '前', '前置', '自拍'];
                    const backKeywords = ['back', 'rear', 'environment', '后', '后置', '背面'];

                    const matchByKeywords = (label: string, mode: 'user' | 'environment') => {
                        const l = normalize(label);
                        const keys = mode === 'user' ? frontKeywords : backKeywords;
                        return keys.some(k => l.includes(k));
                    };

                    const target =
                        videoDevices.find(d => matchByKeywords(d.label || '', facingMode))
                        || videoDevices.find(d => !!(d.label || '').trim()); // Prefer devices with label

                    if (target && target.deviceId) {
                        // Stop previous stream and reacquire by deviceId
                        stream.getTracks().forEach(t => t.stop());
                        stream = await navigator.mediaDevices.getUserMedia({
                            video: { deviceId: { exact: target.deviceId } },
                            audio: false,
                        });
                    }
                }
            } catch (e) {
                // Enumeration failure is non-fatal; continue using existing stream
                console.warn('enumerateDevices failed or unavailable:', e);
            }

            return stream;
        } catch (error) {
            console.error(`Error getting ${facingMode} camera:`, error);
            // Final fallback: default video device
            try {
                return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            } catch (fallbackError) {
                console.error('Failed to get any camera:', fallbackError);
                throw fallbackError;
            }
        }
    };

    const toggleCamera = () => {
        setCameraEnabled(!cameraEnabled);
    };

    const handleEndCall = () => {
        router.push('/'); // Navigate back to login page
    };

    const toggleFullscreen = async () => {
        if (typeof document === 'undefined') return;
        try {
            if (!document.fullscreenElement) {
                await document.documentElement.requestFullscreen();
            } else if (document.exitFullscreen) {
                await document.exitFullscreen();
            }
        } catch (err) {
            console.error('Fullscreen toggle failed:', err);
        }
    };

    const handleCameraSwitch = async () => {
        // Only allow switching when camera is enabled
        if (!cameraEnabled) {
            console.log('Camera is not enabled, cannot switch');
            return;
        }

        // Re-enumerate to avoid using cached device list without labels (common on Chrome)
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            if (videoDevices.length <= 1) {
                console.log('Only one camera available, cannot switch');
                return;
            }
        } catch (e) {
            console.warn('enumerateDevices failed when switching camera:', e);
        }

        try {
            // Switch to the other camera
            const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

            console.log(`Switching camera from ${currentFacingMode} to ${newFacingMode}`);

            // Stop current camera stream
            if (videoRef.current && videoRef.current.srcObject) {
                const currentStream = videoRef.current.srcObject as MediaStream;
                currentStream.getTracks().forEach(track => track.stop());
                videoRef.current.srcObject = null;
            }

            // Get new camera stream (prefer exact, then fallback)
            const newStream = await getCameraStream(newFacingMode);

            if (videoRef.current && newStream) {
                videoRef.current.srcObject = newStream;
                videoRef.current.play();
                setCurrentFacingMode(newFacingMode);
                console.log(`Successfully switched to ${newFacingMode} camera`);
                // If already published, replace track seamlessly
                const [newTrack] = newStream.getVideoTracks();
                if (newTrack && cameraPubRef.current?.track) {
                    try {
                        await cameraPubRef.current.track.replaceTrack(newTrack);
                    } catch (e) {
                        console.warn('replaceTrack failed, republishing...', e);
                        await unpublishCamera();
                        await publishFromVideoRef();
                    }
                } else if (newTrack && roomRef.current && cameraPubRef.current == null) {
                    await publishFromVideoRef();
                }
            }
        } catch (error) {
            console.error('Error switching camera:', error);
            // If switching fails, try restoring the previous camera
            try {
                const fallbackStream = await getCameraStream(currentFacingMode);
                if (videoRef.current && fallbackStream) {
                    videoRef.current.srcObject = fallbackStream;
                    videoRef.current.play();
                }
            } catch (fallbackError) {
                console.error('Failed to restore camera:', fallbackError);
            }
        }
    };

    // Handle audio track from LiveKit for Live2D lip sync
    const handleAudioTrack = (audioElement: HTMLAudioElement, track: RemoteTrack) => {
        console.log('Handling audio track for Live2D:', track);

        if (!modelRef.current) {
            console.warn('Live2D model not loaded yet, cannot sync audio');
            return;
        }

        // Check if this is our StreamLive2DModel
        if (modelRef.current && (modelRef.current as any).connectLiveKitAudio) {
            console.log('Using StreamLive2DModel for real-time lip sync');

            // Disconnect any previous stream
            if ((modelRef.current as any).disconnectStream) {
                (modelRef.current as any).disconnectStream();
            }

            // Connect the LiveKit audio for real-time lip sync
            (modelRef.current as any).connectLiveKitAudio(audioElement, track)
                .then((success: boolean) => {
                    if (success) {
                        try { audioElement.play().catch(() => { }); } catch { }
                        console.log('Successfully connected LiveKit audio to StreamLive2DModel');
                        currentAudioRef.current = audioElement;
                    } else {
                        console.error('Failed to connect LiveKit audio');
                    }
                })
                .catch((error: any) => {
                    console.error('Error connecting LiveKit audio:', error);
                });
        } else {
            console.log('Using traditional Live2D model');
        }
    };

    // Toggle microphone using LiveKit API
    const toggleMic = async () => {
        const room = roomRef.current;
        try {
            const next = !micEnabled;
            if (room) {
                await room.localParticipant.setMicrophoneEnabled(
                    next,
                    {
                        autoGainControl: true,
                        echoCancellation: true,
                        noiseSuppression: true,
                        channelCount: 1,
                    },
                    {
                        dtx: true,
                    }
                );
                if (next) {
                    try { await room.startAudio(); } catch {}
                }
            }
            setMicEnabled(next);
        } catch (e) {
            console.warn('toggleMic failed:', e);
        }
    };

    // Toggle model visibility by adjusting canvas CSS visibility
    const toggleModelVisible = () => {
        setModelVisible(!modelVisible);
    };

    // Toggle speaker by showing/hiding RoomAudioRenderer via prop
    const toggleSpeaker = async () => {
        const next = !speakerEnabled;
        setSpeakerEnabled(next);
        // Try to (re)start audio playback when enabling speakers
        try {
            if (next && roomRef.current) {
                await roomRef.current.startAudio();
            }
        } catch {}
    };

    // Initialize PIXI app and Live2D model
    useEffect(() => {
        // Wait for live2d.min.js to load before initializing
        if (!canvasRef.current || !live2dLoaded) return;

        // Create PIXI application and mount to the specified canvas
        const app = new PIXI.Application({
            view: canvasRef.current,
            width: 500,
            height: 650,
            autoDensity: true,
            backgroundAlpha: 0,
        });
        pixiAppRef.current = app as any;

        // Dynamically import Live2D model
        const loadLive2DModel = async () => {
            try {
                console.log('Loading StreamLive2DModel for real-time lip sync...');

                // Load base Live2D model
                const { Live2DModel } = await import('pixi-live2d-display-lipsyncpatch/cubism2');
                const baseModel = await Live2DModel.from(MODEL_PATH);

                // Use factory function to add streaming audio processing
                const model = createStreamLive2DModel(baseModel);

                console.log('StreamLive2DModel loaded successfully');
                modelRef.current = model as any;

                // Adjust size and position
                model.scale.set(0.35);
                model.anchor.set(0.5, 1);
                model.position.set(app.renderer.width / 20, app.renderer.height);

                (app.stage as any).addChild(model as any);

                // Start default animation
                if ((model as any).internalModel && (model as any).internalModel.motionManager) {
                    (model as any).motion('idle');
                }

                console.log('StreamLive2DModel ready for real-time audio sync');
            } catch (error: any) {
                console.error('Failed to load StreamLive2DModel: ', error);
            }
        };

        loadLive2DModel();

        return () => {
            // Clean up resources when component unmounts
            if (currentAudioRef.current && (currentAudioRef.current as any)._live2dCleanup) {
                (currentAudioRef.current as any)._live2dCleanup();
            }
            if (modelRef.current) {
                if ((modelRef.current as any).disconnectStream) {
                    (modelRef.current as any).disconnectStream();
                }
                // Call destroy method to free resources
                if ((modelRef.current as any).destroy) {
                    (modelRef.current as any).destroy();
                }
                modelRef.current = null;
            }
            if (pixiAppRef.current) {
                (pixiAppRef.current as any).destroy();
                pixiAppRef.current = null;
            }
            setLive2dLoaded(false)
        };
    }, [live2dLoaded]); // Depend on live2dLoaded state

    // Enumerate camera devices on mount
    useEffect(() => {
        enumerateCameras();
    }, []);

    // toggle camera
    useEffect(() => {
        if (cameraEnabled) {
            // Turn on camera
            getCameraStream(currentFacingMode)
                .then((stream) => {
                    if (videoRef.current) {
                        videoRef.current.srcObject = stream;
                        videoRef.current.play();
                        // publish to LiveKit if connected
                        if (roomRef.current) {
                            publishFromVideoRef();
                        }
                    }
                })
                .catch((err) => {
                    console.error(`video error occurred: ${err}`);
                });
        } else {
            // Turn off camera
            if (videoRef.current && videoRef.current.srcObject) {
                const stream = videoRef.current.srcObject as MediaStream;
                const tracks = stream.getTracks();

                // Stop all video tracks
                tracks.forEach(track => {
                    track.stop();
                });

                // Clear video source
                videoRef.current.srcObject = null;
            }
            // also unpublish from LiveKit
            unpublishCamera();
        }
    }, [cameraEnabled, availableCameras]);

    return (
        <>
            {/* Load live2d.min.js at the page level */}
            <Script
                src="/live2d.min.js"
                strategy="afterInteractive"
                onReady={() => {
                    console.log('live2d.min.js loaded successfully');
                    setLive2dLoaded(true);
                }}
                onError={(e) => {
                    console.error('Failed to load live2d.min.js:', e);
                }}
            />

            <div className={styles["call-page"]}>
                <button
                    className={styles["fullscreen-button"]}
                    onClick={toggleFullscreen}
                    aria-label="Toggle fullscreen"
                >
                    <img src="/fullscreen.png" alt="Fullscreen" />
                </button>
                {/* Camera preview area - shown only when camera is enabled */}
                {cameraEnabled && (
                    <div className={styles["camera-preview"]}>
                        <div className={styles["camera-placeholder"]}>
                            <video ref={videoRef}></video>
                        </div>
                    </div>
                )}
                <canvas ref={canvasRef} style={{ display: modelVisible ? 'block' : 'none' }} />
                {/* Bottom control buttons */}
                <div className={styles["controls-container"]}>
                    <div className={styles["control-buttons"]} style={{ marginBottom: 12 }}>
                        <button className={styles["control-button"]} onClick={toggleMic} aria-label="Toggle microphone">
                            <img src={micEnabled ? '/mic_on.png' : '/mic_off.png'} alt={micEnabled ? 'Mic On' : 'Mic Off'} />
                        </button>
                        <button className={styles["control-button"]} onClick={toggleModelVisible} aria-label="Toggle model visibility">
                            <img src={modelVisible ? '/model_on.png' : '/model_off.png'} alt={modelVisible ? 'Model Visible' : 'Model Hidden'} />
                        </button>
                        <button className={styles["control-button"]} onClick={toggleSpeaker} aria-label="Toggle speaker">
                            <img src={speakerEnabled ? '/speaker_on.png' : '/speaker_off.png'} alt={speakerEnabled ? 'Speaker On' : 'Speaker Off'} />
                        </button>
                    </div>

                    <div className={styles["control-buttons"]}>
                        {/* Camera toggle button */}
                        <button
                            className={`${styles["control-button"]} ${styles["camera-toggle"]}`}
                            onClick={toggleCamera}
                        >
                            <img
                                src={cameraEnabled ? '/cameraon.png' : '/cameraoff.png'}
                                alt={cameraEnabled ? 'Camera On' : 'Camera Off'}
                            />
                        </button>

                        {/* End call button */}
                        <button
                            className={`${styles["control-button"]} ${styles["end-call"]}`}
                            onClick={handleEndCall}
                        >
                            <img src="/call_end.png" alt="End Call" />
                        </button>

                        {/* Camera switch button */}
                        <button
                            className={`${styles["control-button"]} ${styles["camera-switch"]}`}
                            onClick={handleCameraSwitch}
                        >
                            <img src="/cameraswitch.png" alt="Switch Camera" />
                        </button>
                    </div>
                </div>

                <AgentClient
                    autoConnect
                    preConnectBuffer
                    defaultMicEnabled={micEnabled}
                    speakerEnabled={speakerEnabled}
                    onAudioTrack={handleAudioTrack}
                    onRoomReady={(room) => {
                        roomRef.current = room;
                        if (cameraEnabled) {
                            publishFromVideoRef();
                        }
                    }}
                />

            </div>
        </>
    );
}

export default CallPage; 
