# StreamLive2DModel — Streaming Live2D Model

`StreamLive2DModel` is an enhanced class that extends `Live2DModel`, designed for real-time lip-sync from audio streams. It can process `MediaStream` and `HTMLAudioElement` directly, without pre-recorded audio files.

## Features

- [x] Real-time audio stream processing
- [x] LiveKit audio track support
- [x] Direct `MediaStream` connection
- [x] Automatic audio analysis and lip-sync
- [x] Fully compatible with the original `Live2DModel`
- [x] Automatic resource management and cleanup

## Usage

### Basic Usage

```typescript
import { StreamLive2DModel } from '@/lib/live2d/stream-live2d';

// Create model instance
const model = new StreamLive2DModel();

// Load model data (same as regular Live2DModel)
const baseModel = await Live2DModel.from('path/to/model.json');
Object.setPrototypeOf(model, Object.getPrototypeOf(baseModel));
Object.assign(model, baseModel);

// Add to PIXI stage
app.stage.addChild(model);
```

### Connect LiveKit Audio

```typescript
// Inside the LiveKit audio track callback
const handleAudioTrack = async (audioElement: HTMLAudioElement, track: RemoteTrack) => {
    if (model.connectLiveKitAudio) {
        const success = await model.connectLiveKitAudio(audioElement, track);
        if (success) {
            console.log('Real-time lip-sync started');
        }
    }
};
```

### Connect MediaStream

```typescript
// Use MediaStream directly
const mediaStream = new MediaStream([audioTrack]);
const success = await model.connectMediaStream(mediaStream);
if (success) {
    console.log('MediaStream lip-sync started');
}
```

### Disconnect

```typescript
// Stop streaming audio processing
model.disconnectStream();

// Check connection status
if (model.isStreaming) {
    console.log('Audio stream is being processed');
}
```

### Debug Info

```typescript
// Get audio processing state
const audioData = model.getAudioData();
console.log('Audio state:', audioData);
// Output: { isActive: true, hasAnalyzer: true, contextState: 'running' }
```

## API Reference

### Methods

#### `connectLiveKitAudio(audioElement: HTMLAudioElement, track?: RemoteTrack): Promise<boolean>`
Connect a LiveKit audio element for real-time lip-sync.

**Parameters:**
- `audioElement`: HTML audio element from LiveKit
- `track`: Optional LiveKit `RemoteTrack` object

**Returns:** Promise<boolean> — whether the connection succeeded

#### `connectMediaStream(mediaStream: MediaStream): Promise<boolean>`
Connect a `MediaStream` directly for real-time lip-sync.

**Parameters:**
- `mediaStream`: `MediaStream` object containing an audio track

**Returns:** Promise<boolean> — whether the connection succeeded

#### `disconnectStream(): void`
Disconnect the current audio stream and clean up resources.

#### `getAudioData(): object`
Get the current audio processing status for debugging.

**Returns:** An object containing connection state information

### Properties

#### `isStreaming: boolean`
Read-only property indicating whether an audio stream is being processed.

## How It Works

1. **Audio connection**: Create an AudioContext and AnalyserNode using the Web Audio API
2. **Real-time analysis**: Analyze audio data in a `requestAnimationFrame` loop
3. **Lip-sync calculation**: Compute audio intensity and apply it to Live2D mouth parameters
4. **Parameter updates**: Support parameter updates for both Cubism 2.1 and Cubism 4 models

## Audio Processing Algorithm

Audio analysis uses the RMS (Root Mean Square) algorithm:

```typescript
// Compute audio intensity
const rms = Math.sqrt(sumSquares / pcmData.length);
const amplified = rms * 20; // Amplify signal
const normalizedValue = Math.min(Math.max(amplified, 0), 1); // Normalize to 0-1

// Apply Live2D transforms
let value = Math.pow(normalizedValue, 0.7); // Bias exponent
value = Math.min(Math.max(value * 1.2, min_), 1); // Bias scaling
```

## Compatibility

- [x] Cubism 2.1 models
- [x] Cubism 4 models  
- [x] All modern browsers (Web Audio API supported)
- [x] LiveKit audio tracks
- [x] Standard MediaStream

## Notes

1. **Browser permissions**: User interaction is required to start the AudioContext
2. **CORS settings**: Cross-origin audio requires proper CORS configuration
3. **Performance optimization**: Use `requestAnimationFrame` to avoid excessive computation
4. **Resource management**: Always call `disconnectStream()` when the component is destroyed

## Error Handling

```typescript
try {
    const success = await model.connectLiveKitAudio(audioElement, track);
    if (!success) {
        // Connection failed, may need to fall back to a legacy method
        console.warn('Streaming connection failed, falling back to traditional lip-sync');
    }
} catch (error) {
    console.error('Audio connection error:', error);
    // Implement error recovery strategy
}
```

## Full Example

See the complete integration example in `app/call/page.tsx`, which demonstrates how to use `StreamLive2DModel` with LiveKit in a React component.