import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Suspense, useState, useRef } from "react";
import { useGetVideoStreamSuspense } from "@/lib/api";
import { selector } from "@/lib/selector";
import { Video, Sparkles, Camera } from "lucide-react";
import { ScoreDetector } from "./ScoreDetector";

function VideoStreamContent() {
  const { data: stream } = useGetVideoStreamSuspense(selector());
  const [detectionMethod, setDetectionMethod] = useState<"generative-ai" | "computer-vision">("generative-ai");
  const [selectedModel, setSelectedModel] = useState<string>("databricks-claude-sonnet-4-5");
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
                  </SelectContent>
                </Select>
              )}
              
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
            <ScoreDetector videoRef={videoRef} selectedModel={selectedModel} />
          </div>
        )}
      </div>

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

