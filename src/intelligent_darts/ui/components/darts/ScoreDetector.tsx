import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useDetectScore } from "@/lib/api";
import { useState, useRef, useEffect, useCallback } from "react";
import { Camera, Sparkles, AlertCircle, CheckCircle2, Play, Pause } from "lucide-react";

interface ScoreDetectorProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

interface ScoreHistory {
  score: number;
  confidence: number;
  timestamp: number;
}

export function ScoreDetector({ videoRef }: ScoreDetectorProps) {
  const [beforeImage, setBeforeImage] = useState<string | null>(null);
  const [afterImage, setAfterImage] = useState<string | null>(null);
  const [beforeTimestamp, setBeforeTimestamp] = useState<number>(0);
  const [afterTimestamp, setAfterTimestamp] = useState<number>(0);
  const [detectedScore, setDetectedScore] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [autoDetect, setAutoDetect] = useState<boolean>(false);
  const [scoreHistory, setScoreHistory] = useState<ScoreHistory[]>([]);
  const [lastCaptureTime, setLastCaptureTime] = useState<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const detectScoreMutation = useDetectScore();

  const captureFrame = useCallback((type: 'before' | 'after') => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas) {
      console.error('Video or canvas not available');
      return null;
    }

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    // Draw the current video frame to canvas
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('Could not get canvas context');
      return null;
    }
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert canvas to base64 (without the data:image/jpeg;base64, prefix)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const base64 = dataUrl.split(',')[1];
    
    const timestamp = video.currentTime;

    if (type === 'before') {
      setBeforeImage(base64);
      setBeforeTimestamp(timestamp);
      setDetectedScore(null); // Reset score when capturing new before image
      setConfidence(null);
    } else {
      setAfterImage(base64);
      setAfterTimestamp(timestamp);
    }

    return { base64, timestamp };
  }, [videoRef]);

  const captureCurrentFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas) {
      return null;
    }

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const base64 = dataUrl.split(',')[1];
    const timestamp = video.currentTime;

    return { base64, timestamp };
  }, [videoRef]);

  const handleDetectScore = async () => {
    if (!beforeImage || !afterImage) {
      console.error('Both before and after images are required');
      return;
    }

    try {
      const result = await detectScoreMutation.mutateAsync({
        data: {
          before_image_base64: beforeImage,
          after_image_base64: afterImage,
          before_timestamp: beforeTimestamp,
          after_timestamp: afterTimestamp,
        }
      });

      setDetectedScore(result.data.score);
      setConfidence(result.data.confidence);
      
      // Add to history
      setScoreHistory(prev => [...prev, {
        score: result.data.score,
        confidence: result.data.confidence,
        timestamp: Date.now()
      }].slice(-10)); // Keep last 10 scores
    } catch (error) {
      console.error('Error detecting score:', error);
    }
  };

  // Automatic detection effect
  useEffect(() => {
    if (!autoDetect) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const performAutoDetection = async () => {
      const currentTime = Date.now();
      
      // Throttle to prevent too many requests
      if (currentTime - lastCaptureTime < 1000) {
        return;
      }

      const currentFrame = captureCurrentFrame();
      if (!currentFrame) {
        return;
      }

      setLastCaptureTime(currentTime);

      // Use the previous frame as "before" and current as "after"
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

          setDetectedScore(result.data.score);
          setConfidence(result.data.confidence);
          
          // Add to history only if score is non-zero (likely a new dart)
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

      // Update the "after" image for the next comparison
      setAfterImage(currentFrame.base64);
      setAfterTimestamp(currentFrame.timestamp);
    };

    // Start interval
    intervalRef.current = setInterval(performAutoDetection, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [autoDetect, afterImage, afterTimestamp, captureCurrentFrame, detectScoreMutation, lastCaptureTime]);

  // Initialize first frame when auto-detect is enabled
  useEffect(() => {
    if (autoDetect && !afterImage) {
      const frame = captureCurrentFrame();
      if (frame) {
        setAfterImage(frame.base64);
        setAfterTimestamp(frame.timestamp);
      }
    }
  }, [autoDetect, afterImage, captureCurrentFrame]);

  const reset = () => {
    setBeforeImage(null);
    setAfterImage(null);
    setBeforeTimestamp(0);
    setAfterTimestamp(0);
    setDetectedScore(null);
    setConfidence(null);
  };

  return (
    <>
      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI Score Detection
          </CardTitle>
          <CardDescription>
            Automatic real-time detection or manual before/after capture
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Auto-Detection Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50">
            <div className="flex items-center gap-2">
              {autoDetect ? (
                <Play className="h-4 w-4 text-green-500" />
              ) : (
                <Pause className="h-4 w-4 text-muted-foreground" />
              )}
              <Label htmlFor="auto-detect" className="cursor-pointer">
                Automatic Detection (1s interval)
              </Label>
            </div>
            <Switch
              id="auto-detect"
              checked={autoDetect}
              onCheckedChange={setAutoDetect}
            />
          </div>

          {/* Manual Capture Controls - Only show when auto-detect is off */}
          {!autoDetect && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  onClick={() => captureFrame('before')}
                  variant={beforeImage ? "default" : "outline"}
                  className="w-full"
                  disabled={detectScoreMutation.isPending}
                >
                  <Camera className="h-4 w-4 mr-2" />
                  Capture Before
                  {beforeImage && <CheckCircle2 className="h-4 w-4 ml-2" />}
                </Button>
                <Button
                  onClick={() => captureFrame('after')}
                  variant={afterImage ? "default" : "outline"}
                  className="w-full"
                  disabled={detectScoreMutation.isPending}
                >
                  <Camera className="h-4 w-4 mr-2" />
                  Capture After
                  {afterImage && <CheckCircle2 className="h-4 w-4 ml-2" />}
                </Button>
              </div>

              {/* Timestamps */}
              {(beforeImage || afterImage) && (
                <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    {beforeImage && `Before: ${beforeTimestamp.toFixed(2)}s`}
                  </div>
                  <div>
                    {afterImage && `After: ${afterTimestamp.toFixed(2)}s`}
                  </div>
                </div>
              )}

              {/* Detect Button */}
              <Button
                onClick={handleDetectScore}
                disabled={!beforeImage || !afterImage || detectScoreMutation.isPending}
                className="w-full"
                size="lg"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                {detectScoreMutation.isPending ? 'Detecting Score...' : 'Detect Score'}
              </Button>
            </>
          )}

          {/* Current Score Result */}
          {detectedScore !== null && confidence !== null && (
            <Alert className="border-green-500/50 bg-green-500/10">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <AlertDescription className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-lg">
                    {autoDetect ? 'Latest Score' : 'Detected Score'}: {detectedScore}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Confidence: {(confidence * 100).toFixed(0)}%
                  </div>
                </div>
                <Badge variant="default" className="text-2xl px-4 py-2">
                  {detectedScore}
                </Badge>
              </AlertDescription>
            </Alert>
          )}

          {/* Score History - Only show when auto-detect is on and we have history */}
          {autoDetect && scoreHistory.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-semibold">Recent Detections</div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {scoreHistory.slice().reverse().map((item) => (
                  <div
                    key={item.timestamp}
                    className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono">
                        {item.score}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {(item.confidence * 100).toFixed(0)}% confident
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {detectScoreMutation.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Failed to detect score. Please try again.
              </AlertDescription>
            </Alert>
          )}

          {/* Reset Button - Only show in manual mode */}
          {!autoDetect && (beforeImage || afterImage) && (
            <Button
              onClick={reset}
              variant="ghost"
              size="sm"
              className="w-full"
            >
              Reset
            </Button>
          )}

          {/* Status indicator for auto-detect */}
          {autoDetect && (
            <div className="text-xs text-center text-muted-foreground">
              {detectScoreMutation.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                  Analyzing frame...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  Monitoring every second
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

