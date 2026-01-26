import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/Badge";
import { AlertCircle, CheckCircle2, Loader2, Signal } from "lucide-react";
import {
  KinesisVideoClient,
  DescribeSignalingChannelCommand,
  GetSignalingChannelEndpointCommand,
} from "@aws-sdk/client-kinesis-video";
import {
  KinesisVideoSignalingClient,
  GetIceServerConfigCommand,
} from "@aws-sdk/client-kinesis-video-signaling";
import { SignalingClient, Role } from "amazon-kinesis-video-streams-webrtc";

interface WebRTCPlayerProps {
  credentials: {
    access_key_id: string;
    secret_access_key: string;
    session_token?: string;
    region: string;
  } | null;
  onConnectionChange?: (connected: boolean) => void;
}

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

const SIGNALING_CHANNEL_NAME = "actionbricks_demo_darts";

export const WebRTCPlayer = forwardRef<HTMLCanvasElement, WebRTCPlayerProps>(
  ({ credentials, onConnectionChange }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [status, setStatus] = useState<ConnectionStatus>("disconnected");
    const [error, setError] = useState<string | null>(null);
    const [frameCount, setFrameCount] = useState(0);
    const signalingClientRef = useRef<SignalingClient | null>(null);
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const remoteStreamRef = useRef<MediaStream | null>(null);

    // Expose canvasRef through forwardRef (where frames are actually rendered)
    useImperativeHandle(ref, () => canvasRef.current!);

    // Render video frames to canvas
    useEffect(() => {
      if (status !== "connected" || !videoRef.current || !canvasRef.current) return;

      let animationFrameId: number;
      const renderFrame = () => {
        if (videoRef.current && canvasRef.current) {
          const canvas = canvasRef.current;
          const video = videoRef.current;
          const ctx = canvas.getContext("2d");
          
          if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            setFrameCount(prev => prev + 1);
          }
        }
        animationFrameId = requestAnimationFrame(renderFrame);
      };

      renderFrame();

      return () => {
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }
      };
    }, [status]);

    useEffect(() => {
      if (!credentials) {
        setStatus("disconnected");
        cleanup();
        return;
      }

      let mounted = true;

      const connect = async () => {
        try {
          setStatus("connecting");
          setError(null);
          console.log("[WebRTCPlayer] Starting connection...");

          // Create Kinesis Video client (AWS SDK v3)
          const kinesisVideoClient = new KinesisVideoClient({
            region: credentials.region,
            credentials: {
              accessKeyId: credentials.access_key_id,
              secretAccessKey: credentials.secret_access_key,
              sessionToken: credentials.session_token,
            },
          });

          console.log("[WebRTCPlayer] Getting signaling channel endpoint...");

          // Get signaling channel ARN
          const describeCommand = new DescribeSignalingChannelCommand({
            ChannelName: SIGNALING_CHANNEL_NAME,
          });
          const describeResponse = await kinesisVideoClient.send(describeCommand);

          const channelARN = describeResponse.ChannelInfo?.ChannelARN;
          if (!channelARN) {
            throw new Error("Channel ARN not found");
          }

          console.log("[WebRTCPlayer] Channel ARN:", channelARN);

          // Get signaling channel endpoints
          const endpointCommand = new GetSignalingChannelEndpointCommand({
            ChannelARN: channelARN,
            SingleMasterChannelEndpointConfiguration: {
              Protocols: ["WSS", "HTTPS"],
              Role: "VIEWER",
            },
          });
          const endpointResponse = await kinesisVideoClient.send(endpointCommand);

          const endpointsByProtocol = endpointResponse.ResourceEndpointList?.reduce(
            (endpoints, endpoint) => {
              endpoints[endpoint.Protocol!] = endpoint.ResourceEndpoint!;
              return endpoints;
            },
            {} as Record<string, string>
          );

          if (!endpointsByProtocol) {
            throw new Error("Endpoints not found");
          }

          console.log("[WebRTCPlayer] Endpoints:", endpointsByProtocol);

          // Get ICE server configuration
          const kinesisVideoSignalingClient = new KinesisVideoSignalingClient({
            region: credentials.region,
            endpoint: endpointsByProtocol.HTTPS,
            credentials: {
              accessKeyId: credentials.access_key_id,
              secretAccessKey: credentials.secret_access_key,
              sessionToken: credentials.session_token,
            },
          });

          const iceCommand = new GetIceServerConfigCommand({
            ChannelARN: channelARN,
          });
          const iceResponse = await kinesisVideoSignalingClient.send(iceCommand);

          const iceServers = iceResponse.IceServerList?.map(iceServer => ({
            urls: iceServer.Uris,
            username: iceServer.Username,
            credential: iceServer.Password,
          }));

          console.log("[WebRTCPlayer] ICE servers:", iceServers?.length);

          // Create RTCPeerConnection
          const configuration: RTCConfiguration = {
            iceServers: iceServers || [],
            iceTransportPolicy: "all",
          };

          const peerConnection = new RTCPeerConnection(configuration);
          peerConnectionRef.current = peerConnection;

          // Handle incoming tracks
          peerConnection.ontrack = (event) => {
            console.log("[WebRTCPlayer] Received remote track:", event.track.kind);
            if (event.streams && event.streams[0]) {
              remoteStreamRef.current = event.streams[0];
              if (videoRef.current) {
                videoRef.current.srcObject = event.streams[0];
                console.log("[WebRTCPlayer] Set video srcObject");
              }
            }
          };

          // Handle connection state changes
          peerConnection.onconnectionstatechange = () => {
            console.log("[WebRTCPlayer] Connection state:", peerConnection.connectionState);
            if (!mounted) return;

            if (peerConnection.connectionState === "connected") {
              setStatus("connected");
              onConnectionChange?.(true);
            } else if (peerConnection.connectionState === "failed" || peerConnection.connectionState === "closed") {
              setStatus("error");
              setError("Connection failed or closed");
              onConnectionChange?.(false);
            }
          };

          // Handle ICE connection state changes
          peerConnection.oniceconnectionstatechange = () => {
            console.log("[WebRTCPlayer] ICE connection state:", peerConnection.iceConnectionState);
          };

          // Create SignalingClient
          const signalingClient = new SignalingClient({
            channelARN,
            channelEndpoint: endpointsByProtocol.WSS,
            role: Role.VIEWER,
            region: credentials.region,
            clientId: Math.random().toString(36).substring(2, 15), // Generate unique client ID
            credentials: {
              accessKeyId: credentials.access_key_id,
              secretAccessKey: credentials.secret_access_key,
              sessionToken: credentials.session_token,
            },
          });

          signalingClientRef.current = signalingClient;

          // Handle signaling client events
          signalingClient.on("open", async () => {
            console.log("[WebRTCPlayer] Signaling client connected");
            
            // Create SDP offer
            const offer = await peerConnection.createOffer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: true,
            });
            await peerConnection.setLocalDescription(offer);

            console.log("[WebRTCPlayer] Sending SDP offer");
            signalingClient.sendSdpOffer(peerConnection.localDescription!);
          });

          signalingClient.on("sdpAnswer", async (answer: RTCSessionDescriptionInit) => {
            console.log("[WebRTCPlayer] Received SDP answer");
            await peerConnection.setRemoteDescription(answer);
          });

          signalingClient.on("iceCandidate", (candidate: RTCIceCandidateInit) => {
            console.log("[WebRTCPlayer] Received ICE candidate");
            peerConnection.addIceCandidate(candidate);
          });

          signalingClient.on("close", () => {
            console.log("[WebRTCPlayer] Signaling client closed");
          });

          signalingClient.on("error", (error: Error) => {
            console.error("[WebRTCPlayer] Signaling client error:", error);
            if (mounted) {
              setStatus("error");
              setError(error.message);
            }
          });

          // Handle local ICE candidates
          peerConnection.onicecandidate = ({ candidate }) => {
            if (candidate) {
              console.log("[WebRTCPlayer] Sending ICE candidate");
              signalingClient.sendIceCandidate(candidate);
            }
          };

          // Open signaling connection
          console.log("[WebRTCPlayer] Opening signaling client...");
          signalingClient.open();

        } catch (err) {
          console.error("[WebRTCPlayer] Connection error:", err);
          if (mounted) {
            setStatus("error");
            setError(err instanceof Error ? err.message : String(err));
            onConnectionChange?.(false);
          }
        }
      };

      connect();

      return () => {
        mounted = false;
        cleanup();
      };
    }, [credentials, onConnectionChange]);

    const cleanup = () => {
      console.log("[WebRTCPlayer] Cleaning up...");
      
      if (signalingClientRef.current) {
        try {
          signalingClientRef.current.close();
        } catch (e) {
          console.error("[WebRTCPlayer] Error closing signaling client:", e);
        }
        signalingClientRef.current = null;
      }

      if (peerConnectionRef.current) {
        try {
          peerConnectionRef.current.close();
        } catch (e) {
          console.error("[WebRTCPlayer] Error closing peer connection:", e);
        }
        peerConnectionRef.current = null;
      }

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      remoteStreamRef.current = null;
      setFrameCount(0);
    };

    const getStatusBadge = () => {
      switch (status) {
        case "connected":
          return (
            <Badge variant="default" className="bg-green-500">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Connected
            </Badge>
          );
        case "connecting":
          return (
            <Badge variant="secondary">
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Connecting
            </Badge>
          );
        case "error":
          return (
            <Badge variant="destructive">
              <AlertCircle className="w-3 h-3 mr-1" />
              Error
            </Badge>
          );
        default:
          return (
            <Badge variant="secondary">
              <Signal className="w-3 h-3 mr-1" />
              Disconnected
            </Badge>
          );
      }
    };

    return (
      <div className="relative w-full h-full bg-gray-900 rounded-lg overflow-hidden">
        {/* Status badge */}
        <div className="absolute top-4 left-4 z-10">
          {getStatusBadge()}
        </div>

        {/* Frame count (when connected) */}
        {status === "connected" && (
          <div className="absolute top-4 right-4 z-10">
            <Badge variant="secondary" className="bg-black/50 backdrop-blur-sm">
              {frameCount} frames
            </Badge>
          </div>
        )}

        {/* Hidden video element for receiving stream */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="hidden"
        />

        {/* Canvas for rendering frames */}
        <canvas
          ref={canvasRef}
          className={`w-full h-full object-contain ${status === "connected" ? "block" : "hidden"}`}
        />

        {/* Connection messages */}
        {status === "connecting" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-white">
              <Loader2 className="w-12 h-12 mb-4 animate-spin mx-auto" />
              <p className="text-lg font-medium">Connecting to live stream...</p>
              <p className="text-sm text-gray-400 mt-2">Establishing WebRTC connection</p>
            </div>
          </div>
        )}

        {status === "disconnected" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <Signal className="w-12 h-12 mb-4 mx-auto" />
              <p className="text-lg">No connection</p>
            </div>
          </div>
        )}

        {/* Error alert */}
        {status === "error" && error && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <Alert variant="destructive" className="max-w-md">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="font-semibold mb-1">Connection Error</div>
                <div className="text-sm">{error}</div>
              </AlertDescription>
            </Alert>
          </div>
        )}
      </div>
    );
  }
);

WebRTCPlayer.displayName = "WebRTCPlayer";
