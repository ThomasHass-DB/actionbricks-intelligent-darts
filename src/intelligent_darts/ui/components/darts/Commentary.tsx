import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, Trash2, Volume2, VolumeX, Gauge } from "lucide-react";
import * as axios from "axios";
import { commentarySpeech, isSpeechSupported } from "@/lib/speechService";

interface CommentaryProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  selectedModel: string;
  scores?: number[];
  confidence?: number;
}

interface CommentaryEntry {
  id: string;
  frame_timestamp: number;
  commentary: string;
  created_at: string;
  scores?: number[];
}

export function Commentary({ videoRef, selectedModel, scores, confidence }: CommentaryProps) {
  const [commentaries, setCommentaries] = useState<CommentaryEntry[]>([]);
  const [isAutoMode, setIsAutoMode] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSpeechEnabled, setIsSpeechEnabled] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [sessionId] = useState(() => `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const autoIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const commentaryListRef = useRef<HTMLDivElement>(null);
  const lastCommentaryRef = useRef<string>("");

  // Sync speech service with enabled state
  useEffect(() => {
    commentarySpeech.setEnabled(isSpeechEnabled);
  }, [isSpeechEnabled]);

  // Sync video playback speed
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, videoRef]);

  // Auto-scroll to latest commentary
  useEffect(() => {
    if (commentaryListRef.current && commentaries.length > 0) {
      commentaryListRef.current.scrollTop = 0;
    }
  }, [commentaries]);

  // Auto mode: generate commentary every few seconds
  useEffect(() => {
    if (isAutoMode) {
      // Generate immediately
      generateCommentary();
      
      // Then set interval (every 3 seconds for real-time feel)
      autoIntervalRef.current = setInterval(() => {
        generateCommentary();
      }, 3000);
    } else {
      if (autoIntervalRef.current) {
        clearInterval(autoIntervalRef.current);
        autoIntervalRef.current = null;
      }
    }

    return () => {
      if (autoIntervalRef.current) {
        clearInterval(autoIntervalRef.current);
      }
    };
  }, [isAutoMode]);

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

    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    const base64 = dataUrl.split(',')[1];
    const timestamp = video.currentTime;

    return { base64, timestamp };
  }, [videoRef]);

  const generateCommentary = async () => {
    if (isGenerating) return;
    
    const currentFrame = captureCurrentFrame();
    if (!currentFrame) {
      console.error('Could not capture current frame');
      return;
    }

    setIsGenerating(true);

    try {
      // First, detect scores from the current frame
      let detectedScores: number[] | undefined = scores;
      let detectedConfidence: number | undefined = confidence;
      
      try {
        const scoreResponse = await axios.default.post('/api/detect-score', {
          before_image_base64: currentFrame.base64,
          after_image_base64: currentFrame.base64,
          before_timestamp: currentFrame.timestamp,
          after_timestamp: currentFrame.timestamp,
          model: selectedModel
        });
        
        detectedScores = scoreResponse.data.scores;
        detectedConfidence = scoreResponse.data.confidence;
        console.log('Detected scores for commentary:', detectedScores);
      } catch (scoreError) {
        console.error('Score detection failed, generating commentary without scores:', scoreError);
      }

      // Then generate commentary based on detected scores
      const response = await axios.default.post('/api/generate-commentary', {
        image_base64: currentFrame.base64,
        frame_timestamp: currentFrame.timestamp,
        session_id: sessionId,
        model: selectedModel,
        scores: detectedScores,
        confidence: detectedConfidence
      });

      const newCommentary: CommentaryEntry = {
        id: response.data.id,
        frame_timestamp: response.data.frame_timestamp,
        commentary: response.data.commentary,
        created_at: response.data.created_at,
        scores: response.data.scores
      };

      // Skip exact duplicate commentary
      const isDuplicate = newCommentary.commentary === lastCommentaryRef.current;
      if (isDuplicate) {
        return;
      }

      // Update last commentary reference
      lastCommentaryRef.current = newCommentary.commentary;

      // Add to the beginning of the list (most recent first)
      setCommentaries(prev => [newCommentary, ...prev].slice(0, 20)); // Keep last 20

      // Speak the commentary if speech is enabled
      if (isSpeechEnabled && isSpeechSupported()) {
        commentarySpeech.speakCommentary(newCommentary.commentary);
      }

    } catch (error) {
      console.error('Error generating commentary:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const clearCommentary = () => {
    setCommentaries([]);
  };

  const formatTimestamp = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <>
      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <Card className="h-full flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Mic className="h-5 w-5 text-red-500" />
              Live Commentary
            </CardTitle>
            <div className="flex items-center gap-3">
              {/* Playback speed control */}
              <div className="flex items-center gap-1">
                <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
                <Select 
                  value={playbackSpeed.toString()} 
                  onValueChange={(v) => setPlaybackSpeed(parseFloat(v))}
                >
                  <SelectTrigger className="h-7 w-[70px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.25">0.25x</SelectItem>
                    <SelectItem value="0.5">0.5x</SelectItem>
                    <SelectItem value="0.75">0.75x</SelectItem>
                    <SelectItem value="1">1x</SelectItem>
                    <SelectItem value="1.5">1.5x</SelectItem>
                    <SelectItem value="2">2x</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Speech toggle */}
              {isSpeechSupported() && (
                <Button
                  variant={isSpeechEnabled ? "default" : "ghost"}
                  size="icon"
                  onClick={() => setIsSpeechEnabled(!isSpeechEnabled)}
                  className="h-8 w-8"
                  title={isSpeechEnabled ? "Mute commentary" : "Enable speech"}
                >
                  {isSpeechEnabled ? (
                    <Volume2 className="h-4 w-4" />
                  ) : (
                    <VolumeX className="h-4 w-4" />
                  )}
                </Button>
              )}

              {/* Auto mode toggle */}
              <div className="flex items-center gap-2">
                <Switch
                  id="auto-mode"
                  checked={isAutoMode}
                  onCheckedChange={setIsAutoMode}
                />
                <Label htmlFor="auto-mode" className="text-xs">
                  Auto
                </Label>
              </div>
              
              {/* Clear button */}
              <Button
                variant="ghost"
                size="icon"
                onClick={clearCommentary}
                className="h-8 w-8"
                title="Clear commentary"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          {/* Status indicator */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {isAutoMode ? (
              <>
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span>Live commentary (3s)</span>
              </>
            ) : (
              <>
                <div className="h-2 w-2 rounded-full bg-gray-400" />
                <span>Manual mode</span>
              </>
            )}
            {isGenerating && (
              <Badge variant="secondary" className="ml-2 text-xs">
                Generating...
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="flex-1 flex flex-col gap-3 overflow-hidden">
          {/* Manual generate button */}
          {!isAutoMode && (
            <Button
              onClick={generateCommentary}
              disabled={isGenerating}
              className="w-full"
              variant="outline"
            >
              <Volume2 className="h-4 w-4 mr-2" />
              {isGenerating ? 'Generating...' : 'Generate Commentary'}
            </Button>
          )}

          {/* Commentary list */}
          <div 
            ref={commentaryListRef}
            className="flex-1 overflow-y-auto space-y-3 pr-1"
            style={{ maxHeight: '300px' }}
          >
            {commentaries.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-8">
                <Mic className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No commentary yet</p>
                <p className="text-xs mt-1">
                  {isAutoMode ? 'Commentary will appear shortly...' : 'Click "Generate Commentary" to start'}
                </p>
              </div>
            ) : (
              commentaries.map((entry, index) => (
                <div
                  key={entry.id}
                  className={`p-3 rounded-lg border transition-all ${
                    index === 0 
                      ? 'bg-primary/5 border-primary/20 shadow-sm' 
                      : 'bg-muted/30 border-transparent'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <Badge 
                      variant={index === 0 ? "default" : "secondary"} 
                      className="text-xs"
                    >
                      {formatTimestamp(entry.frame_timestamp)}
                    </Badge>
                    {entry.scores && entry.scores.length > 0 && (
                      <div className="flex gap-1">
                        {entry.scores.map((score, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {score}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className={`text-sm ${index === 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {entry.commentary}
                  </p>
                </div>
              ))
            )}
          </div>

          {/* Session info */}
          <div className="text-xs text-muted-foreground text-center border-t pt-2">
            Session: {sessionId.slice(0, 20)}... • {commentaries.length} entries
          </div>
        </CardContent>
      </Card>
    </>
  );
}

