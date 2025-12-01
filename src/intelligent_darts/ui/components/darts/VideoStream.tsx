import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Suspense, useState, useRef } from "react";
import { useGetVideoStreamSuspense, useGetGameStatusSuspense } from "@/lib/api";
import { selector } from "@/lib/selector";
import { Video, Activity, Sparkles, Camera } from "lucide-react";
import { ScoreDetector } from "./ScoreDetector";

function VideoStreamContent() {
  const { data: stream } = useGetVideoStreamSuspense(selector());
  const { data: gameStatus } = useGetGameStatusSuspense(selector());
  const [detectionMethod, setDetectionMethod] = useState<"generative-ai" | "computer-vision">("generative-ai");
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <div className="space-y-4">
      {/* Main content - Video and Detection side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Video Stream Card - Takes 2 columns on large screens */}
        <div className="lg:col-span-2">
          <Card className="overflow-hidden h-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="flex items-center gap-2">
                  <Video className="h-5 w-5" />
                  Live Darts Stream
                </CardTitle>
                <div className="flex items-center gap-3">
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
                  
                  {/* Live Indicator */}
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-sm text-muted-foreground">LIVE</span>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="relative aspect-video bg-black">
                <video
                  ref={videoRef}
                  className="w-full h-full object-contain"
                  src={stream.stream_url}
                  controls
                  autoPlay
                  loop
                  muted
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Score Detection Card - Takes 1 column on large screens, only show when GenAI is selected */}
        {detectionMethod === "generative-ai" && (
          <div className="lg:col-span-1">
            <ScoreDetector videoRef={videoRef} />
          </div>
        )}
      </div>

      {/* Game Status Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Game Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Status</span>
              <span className={`text-sm font-medium ${gameStatus.is_active ? 'text-green-500' : 'text-gray-500'}`}>
                {gameStatus.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
            {gameStatus.current_player && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Current Player</span>
                <span className="text-sm font-medium">{gameStatus.current_player}</span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Score</span>
              <span className="text-2xl font-bold">{gameStatus.current_score}</span>
            </div>
          </div>
        </CardContent>
      </Card>
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

