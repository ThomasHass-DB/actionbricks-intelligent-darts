"""Service for managing AWS Kinesis WebRTC connections"""
import asyncio
import base64
import json
from typing import Optional, Dict, Any
from datetime import datetime
import boto3
from botocore.exceptions import ClientError
from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack
from aiortc.contrib.media import MediaRecorder
import av
from .logger import logger


class WebRTCConnectionManager:
    """Manages WebRTC connections to AWS Kinesis Video Streams"""
    
    def __init__(self):
        # Store active connections per session
        self.connections: Dict[str, 'KinesisWebRTCConnection'] = {}
        self.credentials_store: Dict[str, Dict[str, str]] = {}
    
    def store_credentials(self, session_id: str, access_key_id: str, secret_access_key: str, region: str):
        """Store AWS credentials for a session"""
        self.credentials_store[session_id] = {
            'access_key_id': access_key_id,
            'secret_access_key': secret_access_key,
            'region': region
        }
        logger.info(f"Stored credentials for session {session_id}")
    
    def get_credentials(self, session_id: str) -> Optional[Dict[str, str]]:
        """Get AWS credentials for a session"""
        return self.credentials_store.get(session_id)
    
    def clear_credentials(self, session_id: str):
        """Clear credentials for a session"""
        if session_id in self.credentials_store:
            del self.credentials_store[session_id]
            logger.info(f"Cleared credentials for session {session_id}")
    
    async def create_connection(self, session_id: str, signaling_channel: str) -> 'KinesisWebRTCConnection':
        """Create a new WebRTC connection to Kinesis"""
        credentials = self.get_credentials(session_id)
        if not credentials:
            raise ValueError("No credentials found for session")
        
        # Close existing connection if any
        if session_id in self.connections:
            await self.connections[session_id].close()
        
        connection = KinesisWebRTCConnection(
            access_key_id=credentials['access_key_id'],
            secret_access_key=credentials['secret_access_key'],
            region=credentials['region'],
            signaling_channel=signaling_channel
        )
        
        self.connections[session_id] = connection
        return connection
    
    async def get_connection(self, session_id: str) -> Optional['KinesisWebRTCConnection']:
        """Get existing connection for a session"""
        return self.connections.get(session_id)
    
    async def close_connection(self, session_id: str):
        """Close connection for a session"""
        if session_id in self.connections:
            await self.connections[session_id].close()
            del self.connections[session_id]
            logger.info(f"Closed connection for session {session_id}")


class KinesisWebRTCConnection:
    """Represents a WebRTC connection to AWS Kinesis Video Streams"""
    
    def __init__(self, access_key_id: str, secret_access_key: str, region: str, signaling_channel: str):
        self.access_key_id = access_key_id
        self.secret_access_key = secret_access_key
        self.region = region
        self.signaling_channel = signaling_channel
        
        self.kvs_client = None
        self.kvs_signaling_client = None
        self.pc: Optional[RTCPeerConnection] = None
        self.video_track: Optional[VideoStreamTrack] = None
        self.connected = False
        self.websocket = None
        
        # Frame queue for streaming
        self.frame_queue = asyncio.Queue(maxsize=30)
        
    async def initialize(self):
        """Initialize AWS clients and get signaling endpoints"""
        try:
            # Create boto3 clients
            self.kvs_client = boto3.client(
                'kinesisvideo',
                aws_access_key_id=self.access_key_id,
                aws_secret_access_key=self.secret_access_key,
                region_name=self.region
            )
            
            logger.info(f"Getting signaling channel endpoint for {self.signaling_channel}")
            
            # Get the signaling channel endpoint
            response = self.kvs_client.get_signaling_channel_endpoint(
                ChannelName=self.signaling_channel,
                SingleMasterChannelEndpointConfiguration={
                    'Protocols': ['WSS', 'HTTPS'],
                    'Role': 'VIEWER'
                }
            )
            
            endpoints = response['ResourceEndpointList']
            logger.info(f"Got endpoints: {endpoints}")
            
            # Extract WSS endpoint for signaling
            self.signaling_endpoint = None
            for endpoint in endpoints:
                if endpoint['Protocol'] == 'WSS':
                    self.signaling_endpoint = endpoint['ResourceEndpoint']
                    break
            
            if not self.signaling_endpoint:
                raise ValueError("No WSS endpoint found for signaling channel")
            
            logger.info(f"Signaling endpoint: {self.signaling_endpoint}")
            
            # Create signaling client
            self.kvs_signaling_client = boto3.client(
                'kinesis-video-signaling',
                aws_access_key_id=self.access_key_id,
                aws_secret_access_key=self.secret_access_key,
                region_name=self.region,
                endpoint_url=f"https://{self.signaling_endpoint}"
            )
            
            # Get ICE server configuration
            ice_response = self.kvs_signaling_client.get_ice_server_config(
                ChannelARN=self._get_channel_arn()
            )
            
            self.ice_servers = ice_response['IceServerList']
            logger.info(f"Got {len(self.ice_servers)} ICE servers")
            
            return True
            
        except ClientError as e:
            logger.error(f"AWS ClientError during initialization: {str(e)}")
            raise
        except Exception as e:
            logger.error(f"Error during initialization: {str(e)}", exc_info=True)
            raise
    
    def _get_channel_arn(self) -> str:
        """Get the ARN for the signaling channel"""
        try:
            response = self.kvs_client.describe_signaling_channel(
                ChannelName=self.signaling_channel
            )
            return response['ChannelInfo']['ChannelARN']
        except Exception as e:
            logger.error(f"Error getting channel ARN: {str(e)}")
            raise
    
    def get_ice_servers_config(self) -> list:
        """Get ICE servers in format suitable for WebRTC"""
        ice_config = []
        for server in self.ice_servers:
            urls = server.get('Uris', [])
            username = server.get('Username')
            credential = server.get('Password')
            
            config = {'urls': urls}
            if username:
                config['username'] = username
            if credential:
                config['credential'] = credential
            
            ice_config.append(config)
        
        return ice_config
    
    async def connect_as_viewer(self):
        """Connect to the signaling channel as a viewer and establish WebRTC connection"""
        try:
            # Initialize if not already done
            if not self.kvs_client:
                await self.initialize()
            
            # Create RTCPeerConnection
            self.pc = RTCPeerConnection()
            
            # Set up event handlers
            @self.pc.on("track")
            async def on_track(track):
                logger.info(f"Received track: {track.kind}")
                if track.kind == "video":
                    self.video_track = track
                    # Start processing video frames
                    asyncio.create_task(self._process_video_frames(track))
            
            @self.pc.on("connectionstatechange")
            async def on_connectionstatechange():
                logger.info(f"Connection state: {self.pc.connectionState}")
                if self.pc.connectionState == "connected":
                    self.connected = True
                elif self.pc.connectionState in ["failed", "closed"]:
                    self.connected = False
            
            # Note: For a complete implementation, we would need to:
            # 1. Connect to the signaling channel via WebSocket
            # 2. Exchange SDP offers/answers through the signaling channel
            # 3. Handle ICE candidates
            # 
            # This is a simplified implementation that shows the structure.
            # A full implementation would require the AWS Kinesis WebRTC SDK
            # or implementing the signaling protocol manually.
            
            logger.info("WebRTC connection setup initiated")
            
        except Exception as e:
            logger.error(f"Error connecting as viewer: {str(e)}", exc_info=True)
            raise
    
    async def _process_video_frames(self, track: VideoStreamTrack):
        """Process video frames from the WebRTC track"""
        try:
            while True:
                frame = await track.recv()
                
                # Convert frame to JPEG
                img = frame.to_ndarray(format="bgr24")
                
                # Encode to JPEG
                import cv2
                _, buffer = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 80])
                frame_bytes = buffer.tobytes()
                
                # Add to queue (non-blocking, drop old frames if queue is full)
                try:
                    self.frame_queue.put_nowait({
                        'timestamp': datetime.utcnow().isoformat(),
                        'frame': base64.b64encode(frame_bytes).decode('utf-8')
                    })
                except asyncio.QueueFull:
                    # Drop oldest frame and add new one
                    try:
                        self.frame_queue.get_nowait()
                        self.frame_queue.put_nowait({
                            'timestamp': datetime.utcnow().isoformat(),
                            'frame': base64.b64encode(frame_bytes).decode('utf-8')
                        })
                    except:
                        pass
                
        except Exception as e:
            logger.error(f"Error processing video frames: {str(e)}", exc_info=True)
    
    async def get_next_frame(self) -> Optional[Dict[str, Any]]:
        """Get the next video frame from the queue"""
        try:
            frame = await asyncio.wait_for(self.frame_queue.get(), timeout=5.0)
            return frame
        except asyncio.TimeoutError:
            return None
    
    async def close(self):
        """Close the WebRTC connection"""
        if self.pc:
            await self.pc.close()
        self.connected = False
        logger.info("WebRTC connection closed")


# Global connection manager instance
connection_manager = WebRTCConnectionManager()
