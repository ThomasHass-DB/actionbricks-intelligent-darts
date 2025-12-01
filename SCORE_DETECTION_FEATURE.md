# Score Detection Feature

## Overview
This feature uses Databricks Claude Sonnet 4.5 to detect dart scores from video frames by analyzing before/after images of the dartboard.

## Implementation Details

### Backend Components

1. **Model Serving Endpoint** (`databricks.yml`)
   - Added `databricks-claude-sonnet-4-5` as an app resource with `CAN_QUERY` permission
   - This allows the app to query the Claude Sonnet 4.5 model for score detection

2. **Data Models** (`backend/models.py`)
   - `ScoreDetectionIn`: Input model with before/after images (base64) and timestamps
   - `ScoreDetectionOut`: Output model with detected score, confidence, and raw response

3. **Score Detection Service** (`backend/score_detection_service.py`)
   - `ScoreDetectionService`: Core service that handles the AI interaction
   - Sends both images to Claude with a detailed prompt about dart scoring rules
   - Parses the response to extract the integer score
   - Validates scores are in the valid range (0-180)

4. **API Endpoint** (`backend/router.py`)
   - `POST /api/detect-score`: Endpoint that accepts before/after images
   - Uses OBO (On-Behalf-Of) authentication to query the model
   - Returns the detected score with confidence level

### Frontend Components

1. **ScoreDetector Component** (`ui/components/darts/ScoreDetector.tsx`)
   - Provides UI for capturing before/after frames from the video
   - Uses HTML5 Canvas API to extract frames from the video element
   - Converts frames to base64 JPEG format
   - Calls the `/api/detect-score` endpoint
   - Displays results with score and confidence level

2. **VideoStream Component** (`ui/components/darts/VideoStream.tsx`)
   - Updated to include a ref to the video element
   - Conditionally shows the ScoreDetector when "GenAI" mode is selected
   - Passes the video ref to the ScoreDetector component

3. **Index Page** (`ui/routes/index.tsx`)
   - Updated AI Features section to show score detection as active
   - Added "How to Use" instructions for users

## How It Works

1. **User captures "before" frame**: Pauses video before a dart is thrown and clicks "Capture Before"
2. **User captures "after" frame**: Plays video until dart hits, pauses, and clicks "Capture After"
3. **AI Analysis**: Clicks "Detect Score" which:
   - Sends both images to Claude Sonnet 4.5
   - Claude analyzes the difference between images
   - Identifies the newly thrown dart
   - Determines its position on the dartboard
   - Calculates the score based on dart rules
4. **Result Display**: Shows the detected score with confidence level

## API Usage

### Request
```typescript
POST /api/detect-score
Content-Type: application/json

{
  "before_image_base64": "base64_encoded_jpeg_data",
  "after_image_base64": "base64_encoded_jpeg_data",
  "before_timestamp": 1.23,
  "after_timestamp": 2.45
}
```

### Response
```typescript
{
  "score": 60,
  "confidence": 0.95,
  "raw_response": "60"
}
```

## Scoring Rules Implemented

The AI model is instructed with the following dart scoring rules:
- Inner bullseye (red center): 50 points
- Outer bullseye (green ring): 25 points
- Triple ring (inner thin ring): 3x the segment number
- Double ring (outer thin ring): 2x the segment number
- Single segments: Face value (1-20)
- Outside scoring area: 0 points

## Technical Details

### Image Processing
- Frames are captured using HTML5 Canvas API
- Images are encoded as JPEG with 80% quality
- Base64 encoding is used for transmission

### AI Model Configuration
- Model: `databricks-claude-sonnet-4-5`
- Temperature: 0.3 (lower for more consistent results)
- Max Tokens: 10 (we only need a short numeric response)
- System prompt includes detailed scoring rules and process

### Error Handling
- Backend validates score range (0-180)
- Frontend shows error alerts if detection fails
- Logs detailed error information for debugging

## Future Enhancements

Potential improvements for this feature:
1. Automatic frame capture when motion is detected
2. Real-time video processing for continuous scoring
3. Multi-dart detection in a single turn
4. Score history and game tracking
5. Computer vision fallback when AI is unavailable
6. Confidence threshold settings
7. Manual score correction interface

