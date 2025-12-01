import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useDetectScore } from "@/lib/api";
import { useState, useRef, useCallback } from "react";
import { Sparkles, AlertCircle, CheckCircle2 } from "lucide-react";

interface ScoreDetectorProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

interface DartScore {
  dart_number: number;
  score: number;
}

interface ScoreHistory {
  score: number;
  confidence: number;
  timestamp: number;
}

export function ScoreDetector({ videoRef }: ScoreDetectorProps) {
  const [dartScores, setDartScores] = useState<DartScore[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const detectScoreMutation = useDetectScore();


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
    const currentFrame = captureCurrentFrame();
    if (!currentFrame) {
      console.error('Could not capture current frame');
      return;
    }

    try {
      // Send the same image twice - we're detecting all darts on current screen
      const result = await detectScoreMutation.mutateAsync({
        data: {
          before_image_base64: currentFrame.base64,
          after_image_base64: currentFrame.base64,
          before_timestamp: currentFrame.timestamp,
          after_timestamp: currentFrame.timestamp,
        }
      });

      // Parse the response - expecting format like "Dart 1: 20, Dart 2: 60, Dart 3: 50"
      const scoreText = result.data.raw_response || String(result.data.score);
      const dartMatches = scoreText.matchAll(/Dart\s+(\d+):\s+(\d+)/gi);
      const scores: DartScore[] = [];
      
      for (const match of dartMatches) {
        scores.push({
          dart_number: parseInt(match[1]),
          score: parseInt(match[2])
        });
      }

      if (scores.length === 0 && result.data.score !== undefined) {
        // Fallback: single score
        scores.push({ dart_number: 1, score: result.data.score });
      }

      setDartScores(scores);
      setConfidence(result.data.confidence);
    } catch (error) {
      console.error('Error detecting score:', error);
    }
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
            Click "Detect" to identify all darts on the current screen
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Detect Button */}
          <Button
            onClick={handleDetectScore}
            disabled={detectScoreMutation.isPending}
            className="w-full"
            size="lg"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            {detectScoreMutation.isPending ? 'Detecting Scores...' : 'Detect'}
          </Button>

          {/* Detected Scores */}
          {dartScores.length > 0 && (
            <div className="space-y-3">
              {dartScores.map((dart) => (
                <Alert key={dart.dart_number} className="border-green-500/50 bg-green-500/10">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <AlertDescription className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-lg">
                        Dart {dart.dart_number}
                      </div>
                      {confidence !== null && (
                        <div className="text-xs text-muted-foreground">
                          Confidence: {(confidence * 100).toFixed(0)}%
                        </div>
                      )}
                    </div>
                    <Badge variant="default" className="text-2xl px-4 py-2">
                      {dart.score}
                    </Badge>
                  </AlertDescription>
                </Alert>
              ))}
            </div>
          )}

          {/* Error */}
          {detectScoreMutation.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Failed to detect scores. Please try again.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </>
  );
}

