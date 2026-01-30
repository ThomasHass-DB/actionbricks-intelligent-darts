import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Suspense, useState, useRef } from "react";
import { useGetVideoStreamSuspense } from "@/lib/api";
import { selector } from "@/lib/selector";
import { Video, Sparkles, Camera, Wifi, Film } from "lucide-react";
import { ScoreDetector } from "./ScoreDetector";
import { AWSCredentialsDialog } from "./AWSCredentialsDialog";
import { WebRTCPlayer } from "./WebRTCPlayer";
import { Commentary } from "./Commentary";

type VideoSource = "local" | "webrtc";

function VideoStreamContent() {
  const { data: stream } = useGetVideoStreamSuspense(selector());
  const [videoSource, setVideoSource] = useState<VideoSource>("local");
  const [detectionMethod, setDetectionMethod] = useState<"generative-ai" | "computer-vision">("generative-ai");
  const [selectedModel, setSelectedModel] = useState<string>("databricks-claude-sonnet-4-5");
  const [showCredentialsDialog, setShowCredentialsDialog] = useState(false);
  const [awsCredentials, setAwsCredentials] = useState<{
    access_key_id: string;
    secret_access_key: string;
    session_token?: string;
    region: string;
  } | null>(null);
  const [isWebRTCConnected, setIsWebRTCConnected] = useState(false);
  // Store scores from detection to pass to commentary (for future enhancement)
  const [currentScores] = useState<number[] | undefined>();
  const [currentConfidence] = useState<number | undefined>();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const webrtcCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // Use the appropriate ref based on video source
  const activeVideoRef = videoSource === "local" ? localVideoRef : webrtcCanvasRef;

  const handleVideoSourceChange = (value: string) => {
    const newSource = value as VideoSource;
    setVideoSource(newSource);
    
    // If switching to WebRTC and no credentials, show dialog
    if (newSource === "webrtc" && !awsCredentials) {
      setShowCredentialsDialog(true);
    }
  };

  const handleCredentialsConnect = async (credentials: {
    access_key_id: string;
    secret_access_key: string;
    session_token?: string;
    region: string;
  }) => {
    // Store credentials
    setAwsCredentials(credentials);
    // Connection will be established by WebRTCPlayer component
  };

  return (
    <div className="space-y-4">
      {/* Main content - Video and Detection side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Video Stream Card - Takes 2 columns on large screens */}
        <div className="lg:col-span-2">
          <Card className="overflow-hidden h-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <CardTitle className="flex items-center gap-2">
                  <Video className="h-5 w-5" />
                  Darts Stream
                </CardTitle>
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Video Source Toggle */}
                  <ToggleGroup 
                    type="single" 
                    value={videoSource} 
                    onValueChange={handleVideoSourceChange}
                    size="sm"
                  >
                    <ToggleGroupItem value="local" aria-label="Local Video" className="gap-1.5 text-xs">
                      <Film className="h-3.5 w-3.5" />
                      <span>Local</span>
                    </ToggleGroupItem>
                    <ToggleGroupItem value="webrtc" aria-label="Live Camera" className="gap-1.5 text-xs">
                      <Wifi className="h-3.5 w-3.5" />
                      <span>Live Camera</span>
                    </ToggleGroupItem>
                  </ToggleGroup>

                  {/* Settings button for WebRTC credentials */}
                  {videoSource === "webrtc" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowCredentialsDialog(true)}
                      className="h-8 text-xs"
                    >
                      {awsCredentials ? "Update Credentials" : "Configure"}
                    </Button>
                  )}

                  {/* Detection Method Choice Chips */}
                  <ToggleGroup 
                    type="single" 
                    value={detectionMethod} 
                    onValueChange={(value) => value && setDetectionMethod(value as "generative-ai" | "computer-vision")}
                    size="sm"
                  >
                    <ToggleGroupItem value="generative-ai" aria-label="Generative AI" className="gap-1.5 text-xs">
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>GenAI</span>
                    </ToggleGroupItem>
                    <ToggleGroupItem value="computer-vision" aria-label="Traditional Computer Vision" disabled className="gap-1.5 text-xs opacity-50">
                      <Camera className="h-3.5 w-3.5" />
                      <span>CV</span>
                    </ToggleGroupItem>
                  </ToggleGroup>

                  {/* Model Selector - Only show when GenAI is selected */}
                  {detectionMethod === "generative-ai" && (
                    <Select value={selectedModel} onValueChange={setSelectedModel}>
                      <SelectTrigger className="w-[180px] h-8 text-xs">
                        <SelectValue placeholder="Select model" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="databricks-claude-sonnet-4-5">Claude Sonnet 4.5</SelectItem>
                        <SelectItem value="databricks-gpt-5-1">GPT-5.1</SelectItem>
                        <SelectItem value="databricks-llama-4-maverick">Llama 4 Maverick</SelectItem>
                        <SelectItem value="databricks-gemini-3-pro">Gemini 3 Pro</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  
                  {/* Live Indicator */}
                  {(videoSource === "local" || isWebRTCConnected) && (
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-sm text-muted-foreground">LIVE</span>
                    </div>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {videoSource === "local" ? (
                <div className="relative aspect-video bg-black">
                  <video
                    ref={localVideoRef}
                    className="w-full h-full object-contain"
                    src={stream.stream_url}
                    controls
                    autoPlay
                    loop
                    muted
                  />
                </div>
              ) : (
                <div className="relative aspect-video bg-black p-4">
                  <WebRTCPlayer 
                    ref={webrtcCanvasRef}
                    credentials={awsCredentials}
                    onConnectionChange={setIsWebRTCConnected}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Score Detection Card - Takes 1 column on large screens, only show when GenAI is selected */}
        {detectionMethod === "generative-ai" && (
          <div className="lg:col-span-1">
            <ScoreDetector videoRef={activeVideoRef as React.RefObject<HTMLVideoElement | HTMLCanvasElement | null>} selectedModel={selectedModel} />
          </div>
        )}
      </div>

      {/* Commentary Section - Full width below the main content */}
      {detectionMethod === "generative-ai" && videoSource === "local" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-3">
            <Commentary 
              videoRef={localVideoRef} 
              selectedModel={selectedModel}
              scores={currentScores}
              confidence={currentConfidence}
            />
          </div>
        </div>
      )}

      {/* AWS Credentials Dialog */}
      <AWSCredentialsDialog
        open={showCredentialsDialog}
        onOpenChange={setShowCredentialsDialog}
        onConnect={handleCredentialsConnect}
      />
    </div>
  );
}

function VideoStreamSkeleton() {
  return (
    <div className="space-y-4">
      {/* Video Stream Skeleton */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-8 w-32" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Skeleton className="aspect-video w-full" />
        </CardContent>
      </Card>
      
      {/* Game Status Skeleton */}
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-8 w-24" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function DartsVideoStream() {
  return (
    <Suspense fallback={<VideoStreamSkeleton />}>
      <VideoStreamContent />
    </Suspense>
  );
}

