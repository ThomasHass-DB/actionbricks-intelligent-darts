# Automatic Score Detection Feature

## Overview
The automatic score detection feature continuously monitors the dart video stream and automatically detects scores every second using Claude Sonnet 4.5, providing real-time scoring without manual intervention.

## How It Works

### Automatic Mode
When automatic detection is enabled:

1. **Initial Frame Capture**: Captures the first frame as a baseline
2. **Continuous Monitoring**: Every 1 second:
   - Captures the current video frame
   - Compares it with the previous frame
   - Sends both frames to Claude Sonnet 4.5
   - Detects if a new dart was thrown and its score
3. **Score Tracking**: Maintains a history of detected scores with timestamps
4. **Real-time Updates**: Displays the latest score and recent detection history

### Frame Comparison Logic
```
Frame N-1 (before) + Frame N (after) → AI Analysis → Score Detection
                                                    ↓
                                            Frame N becomes the new "before"
                                            for the next comparison
```

## Implementation Details

### Frontend Components

#### ScoreDetector Component Updates

**New State Variables**:
```typescript
const [autoDetect, setAutoDetect] = useState<boolean>(false);
const [scoreHistory, setScoreHistory] = useState<ScoreHistory[]>([]);
const [lastCaptureTime, setLastCaptureTime] = useState<number>(0);
const intervalRef = useRef<NodeJS.Timeout | null>(null);
```

**Auto-Detection Effect**:
- Uses `setInterval` to trigger detection every 1000ms
- Throttles requests to prevent overlapping API calls
- Maintains frame history for comparison
- Automatically cleans up interval on unmount or when disabled

**Key Functions**:
- `captureCurrentFrame()`: Captures a frame without updating state
- `performAutoDetection()`: Main auto-detection logic that runs every second
- Automatic initialization of first frame when auto-detect is enabled

### UI Features

#### Toggle Switch
- Located at the top of the Score Detection card
- Shows "Automatic Detection (1s interval)" label
- Visual indicator (Play/Pause icon) shows current state
- Disables manual capture controls when enabled

#### Real-time Status
- Shows "Monitoring every second" when idle
- Shows "Analyzing frame..." when processing
- Animated pulse indicator for visual feedback

#### Score History Display
- Shows up to 10 most recent detections
- Each entry displays:
  - Score value in a badge
  - Confidence percentage
  - Timestamp of detection
- Scrollable list for easy review
- Only shows scores > 0 (filters out "no change" detections)

#### Latest Score Display
- Large badge showing current detected score
- Confidence level percentage
- Updates in real-time as new scores are detected

## User Experience

### Automatic Mode Workflow
1. User enables "Automatic Detection" toggle
2. User plays the video
3. System automatically:
   - Captures frames every second
   - Analyzes for new darts
   - Updates score display
   - Adds to history when score > 0
4. User can view:
   - Latest detected score
   - Recent detection history
   - Confidence levels

### Manual Mode Workflow (Still Available)
1. User disables "Automatic Detection"
2. Manual controls appear:
   - "Capture Before" button
   - "Capture After" button
   - "Detect Score" button
3. User manually captures and analyzes specific moments

## Performance Considerations

### Throttling
- Minimum 1-second interval between captures
- Prevents API rate limiting
- Ensures previous request completes before starting new one

### Resource Management
- Interval is properly cleaned up when:
  - Component unmounts
  - Auto-detect is disabled
  - User navigates away
- Uses `useCallback` for optimized function references
- Efficient state updates to prevent unnecessary re-renders

### API Efficiency
- Only sends requests when video is playing
- Skips analysis if no frame change detected
- Filters history to only show meaningful scores (> 0)

## Technical Implementation

### Frame Capture
```typescript
const captureCurrentFrame = useCallback(() => {
  const video = videoRef.current;
  const canvas = canvasRef.current;
  
  if (!video || !canvas) return null;

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  const base64 = dataUrl.split(',')[1];
  const timestamp = video.currentTime;

  return { base64, timestamp };
}, [videoRef]);
```

### Auto-Detection Loop
```typescript
useEffect(() => {
  if (!autoDetect) {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return;
  }

  const performAutoDetection = async () => {
    // Throttle requests
    const currentTime = Date.now();
    if (currentTime - lastCaptureTime < 1000) return;

    // Capture current frame
    const currentFrame = captureCurrentFrame();
    if (!currentFrame) return;

    setLastCaptureTime(currentTime);

    // Compare with previous frame
    if (afterImage) {
      try {
        const result = await detectScoreMutation.mutateAsync({
          data: {
            before_image_base64: afterImage,
            after_image_base64: currentFrame.base64,
            before_timestamp: afterTimestamp,
            after_timestamp: currentFrame.timestamp,
          }
        });

        // Update display and history
        setDetectedScore(result.data.score);
        setConfidence(result.data.confidence);
        
        if (result.data.score > 0) {
          setScoreHistory(prev => [...prev, {
            score: result.data.score,
            confidence: result.data.confidence,
            timestamp: Date.now()
          }].slice(-10));
        }
      } catch (error) {
        console.error('Auto-detection error:', error);
      }
    }

    // Update reference frame
    setAfterImage(currentFrame.base64);
    setAfterTimestamp(currentFrame.timestamp);
  };

  intervalRef.current = setInterval(performAutoDetection, 1000);

  return () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
  };
}, [autoDetect, afterImage, afterTimestamp, captureCurrentFrame, detectScoreMutation, lastCaptureTime]);
```

## Benefits

### For Users
- **Hands-free operation**: No manual button clicking required
- **Real-time feedback**: Immediate score detection as darts are thrown
- **Complete history**: Track all detected scores in a session
- **Confidence metrics**: Know how reliable each detection is

### For Development
- **Scalable**: Can easily adjust detection interval
- **Maintainable**: Clean separation of auto vs manual modes
- **Extensible**: Easy to add features like score aggregation, game tracking
- **Robust**: Proper cleanup and error handling

## Future Enhancements

Potential improvements:
1. **Adaptive interval**: Adjust detection frequency based on video activity
2. **Score aggregation**: Calculate running totals and game scores
3. **Motion detection**: Only analyze when movement is detected
4. **Confidence thresholds**: Filter out low-confidence detections
5. **Export history**: Save detection history to CSV or JSON
6. **Game modes**: Support different dart game types (301, Cricket, etc.)
7. **Multi-player tracking**: Detect and track multiple players
8. **Statistical analysis**: Show averages, patterns, and insights

## Configuration Options

Current settings (can be adjusted):
- Detection interval: 1000ms (1 second)
- History limit: 10 most recent scores
- Minimum score to record: > 0
- Image quality: 80% JPEG compression
- Throttle time: 1000ms minimum between requests

## Troubleshooting

### If auto-detection isn't working:
1. Ensure video is playing (not paused)
2. Check browser console for errors
3. Verify API endpoint is accessible
4. Check that model serving endpoint has permissions

### If scores seem inaccurate:
1. Ensure video quality is good
2. Check lighting conditions in video
3. Verify dartboard is clearly visible
4. Review confidence scores (low confidence = less reliable)

### If performance is slow:
1. Consider increasing detection interval
2. Check network latency to API
3. Verify model endpoint is responsive
4. Monitor browser memory usage

