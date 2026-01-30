from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from .models import (
    VersionOut, VideoStreamOut, GameStatusOut, ScoreDetectionIn, ScoreDetectionOut,
    AWSCredentialsIn, WebRTCConfigOut, WebRTCStatusOut,
    CommentaryIn, CommentaryOut, CommentaryHistoryOut
)
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.iam import User as UserOut
from .dependencies import get_obo_ws, get_app_ws
from .config import conf
from .score_detection_service import ScoreDetectionService
from .commentary_service import CommentaryService
from .webrtc_service import connection_manager
from .logger import logger
import json
import uuid

api = APIRouter(prefix=conf.api_prefix)


@api.get("/version", response_model=VersionOut, operation_id="version")
async def version():
    return VersionOut.from_metadata()


@api.get("/current-user", response_model=UserOut, operation_id="currentUser")
def me(obo_ws: Annotated[WorkspaceClient, Depends(get_obo_ws)]):
    return obo_ws.current_user.me()


@api.get("/video-stream", response_model=VideoStreamOut, operation_id="getVideoStream")
async def get_video_stream():
    """Get the current video stream configuration"""
    return VideoStreamOut(
        stream_url="/darts_gameplay.mp4",
        status="active",
        width=1920,
        height=1080,
        fps=30
    )


@api.get("/game-status", response_model=GameStatusOut, operation_id="getGameStatus")
async def get_game_status():
    """Get the current game status"""
    return GameStatusOut(
        is_active=True,
        current_player="Player 1",
        current_score=301
    )


@api.post("/detect-score", response_model=ScoreDetectionOut, operation_id="detectScore")
async def detect_score(
    request: ScoreDetectionIn,
    app_ws: Annotated[WorkspaceClient, Depends(get_app_ws)]
):
    """
    Detect the score from before/after dartboard images using Claude Sonnet 4.5
    
    This endpoint analyzes two timestamped images of a dartboard and uses AI
    to determine what score was achieved by the newly thrown dart.
    """
    try:
        logger.info(
            f"Detecting score from images at timestamps "
            f"{request.before_timestamp:.2f}s and {request.after_timestamp:.2f}s"
        )
        
        # Create the score detection service
        service = ScoreDetectionService(app_ws)
        
        # Detect the scores
        scores, raw_response = service.detect_score(
            before_image_base64=request.before_image_base64,
            after_image_base64=request.after_image_base64,
            before_timestamp=request.before_timestamp,
            after_timestamp=request.after_timestamp,
            model_endpoint=request.model
        )
        
        # Calculate confidence based on whether we got valid scores
        # In a real implementation, you might want to get this from the model
        confidence = 0.95 if any(s > 0 for s in scores) else 0.5
        
        logger.info(f"Detected {len(scores)} dart score(s): {scores} (confidence: {confidence})")
        
        return ScoreDetectionOut(
            scores=scores,
            confidence=confidence,
            raw_response=raw_response
        )
        
    except Exception as e:
        logger.error(f"Error in detect_score endpoint: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to detect score: {str(e)}"
        )


@api.post("/generate-commentary", response_model=CommentaryOut, operation_id="generateCommentary")
async def generate_commentary(
    request: CommentaryIn,
    app_ws: Annotated[WorkspaceClient, Depends(get_app_ws)]
):
    """
    Generate AI commentary for a video frame
    
    This endpoint analyzes a video frame and generates engaging sports-style
    commentary. The commentary is saved to a Delta table in Unity Catalog.
    """
    try:
        logger.info(f"Generating commentary for frame at {request.frame_timestamp:.2f}s")
        
        # Create the commentary service
        service = CommentaryService(app_ws)
        
        # Generate commentary
        result = service.generate_commentary(
            image_base64=request.image_base64,
            frame_timestamp=request.frame_timestamp,
            session_id=request.session_id,
            model_endpoint=request.model,
            scores=request.scores,
            confidence=request.confidence
        )
        
        logger.info(f"Generated commentary: {result['commentary'][:50]}...")
        
        return CommentaryOut(**result)
        
    except Exception as e:
        logger.error(f"Error in generate_commentary endpoint: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate commentary: {str(e)}"
        )


@api.get("/commentary/{session_id}", response_model=CommentaryHistoryOut, operation_id="getCommentaryHistory")
async def get_commentary_history(
    session_id: str,
    app_ws: Annotated[WorkspaceClient, Depends(get_app_ws)],
    limit: int = 50
):
    """
    Get commentary history for a session
    
    Retrieves all commentary records for a given session from the Delta table.
    """
    try:
        logger.info(f"Retrieving commentary for session {session_id}")
        
        # Create the commentary service
        service = CommentaryService(app_ws)
        
        # Get commentary history
        commentaries = service.get_session_commentary(session_id, limit)
        
        # Convert to output models
        commentary_list = [CommentaryOut(**c) for c in commentaries]
        
        return CommentaryHistoryOut(
            commentaries=commentary_list,
            session_id=session_id,
            total_count=len(commentary_list)
        )
        
    except Exception as e:
        logger.error(f"Error in get_commentary_history endpoint: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve commentary: {str(e)}"
        )


@api.post("/webrtc/credentials", response_model=WebRTCStatusOut, operation_id="storeWebRTCCredentials")
async def store_webrtc_credentials(credentials: AWSCredentialsIn):
    """
    Store AWS credentials for WebRTC connection
    
    This endpoint stores the AWS credentials in the server session for establishing
    a WebRTC connection to Kinesis Video Streams.
    """
    try:
        # Generate a session ID (in production, use proper session management)
        session_id = str(uuid.uuid4())
        
        # Store credentials
        connection_manager.store_credentials(
            session_id=session_id,
            access_key_id=credentials.access_key_id,
            secret_access_key=credentials.secret_access_key,
            region=credentials.region
        )
        
        logger.info(f"Stored credentials for session {session_id}")
        
        return WebRTCStatusOut(
            connected=False,
            status="credentials_stored"
        )
        
    except Exception as e:
        logger.error(f"Error storing credentials: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to store credentials: {str(e)}"
        )


@api.get("/webrtc/config", response_model=WebRTCConfigOut, operation_id="getWebRTCConfig")
async def get_webrtc_config():
    """
    Get WebRTC configuration for Kinesis Video Streams
    
    Returns the signaling channel name and region for the WebRTC connection.
    """
    try:
        return WebRTCConfigOut(
            signaling_channel="actionbricks_demo_darts",
            region="us-east-1",
            ice_servers=[]  # Will be populated after connection
        )
    except Exception as e:
        logger.error(f"Error getting WebRTC config: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get WebRTC config: {str(e)}"
        )


@api.websocket("/webrtc/stream")
async def webrtc_stream(websocket: WebSocket):
    """
    WebSocket endpoint for streaming video from Kinesis WebRTC
    
    This endpoint establishes a WebSocket connection and streams video frames
    from the AWS Kinesis WebRTC connection to the frontend.
    """
    await websocket.accept()
    session_id = None
    
    try:
        logger.info("WebSocket connection established")
        
        # Wait for initial message with session info
        init_data = await websocket.receive_text()
        init_msg = json.loads(init_data)
        
        if init_msg.get('type') == 'init':
            # Extract credentials from init message
            credentials = init_msg.get('credentials', {})
            access_key_id = credentials.get('access_key_id')
            secret_access_key = credentials.get('secret_access_key')
            region = credentials.get('region', 'us-east-1')
            
            if not access_key_id or not secret_access_key:
                await websocket.send_text(json.dumps({
                    'type': 'error',
                    'message': 'Missing credentials'
                }))
                await websocket.close()
                return
            
            # Generate session ID and store credentials
            session_id = str(uuid.uuid4())
            connection_manager.store_credentials(
                session_id=session_id,
                access_key_id=access_key_id,
                secret_access_key=secret_access_key,
                region=region
            )
            
            # Create WebRTC connection
            try:
                connection = await connection_manager.create_connection(
                    session_id=session_id,
                    signaling_channel="actionbricks_demo_darts"
                )
                
                # Initialize the connection
                await connection.initialize()
                
                # Send success message
                await websocket.send_text(json.dumps({
                    'type': 'connected',
                    'status': 'WebRTC connection initialized'
                }))
                
                # Note: In a complete implementation, we would now:
                # 1. Call connection.connect_as_viewer() to establish WebRTC peer connection
                # 2. Start streaming frames from connection.get_next_frame()
                # 
                # For now, we'll send a placeholder message
                await websocket.send_text(json.dumps({
                    'type': 'info',
                    'message': 'WebRTC connection established. Frame streaming not yet implemented.'
                }))
                
                # Keep connection alive and stream frames
                while True:
                    # In a complete implementation, get frames from the connection:
                    # frame = await connection.get_next_frame()
                    # if frame:
                    #     await websocket.send_text(json.dumps({
                    #         'type': 'frame',
                    #         'timestamp': frame['timestamp'],
                    #         'data': frame['frame']
                    #     }))
                    
                    # For now, just wait for incoming messages
                    try:
                        message = await websocket.receive_text()
                        msg_data = json.loads(message)
                        
                        if msg_data.get('type') == 'ping':
                            await websocket.send_text(json.dumps({'type': 'pong'}))
                        elif msg_data.get('type') == 'close':
                            break
                            
                    except WebSocketDisconnect:
                        break
                
            except Exception as e:
                logger.error(f"Error establishing WebRTC connection: {str(e)}", exc_info=True)
                await websocket.send_text(json.dumps({
                    'type': 'error',
                    'message': f'Failed to establish WebRTC connection: {str(e)}'
                }))
        
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"Error in WebSocket handler: {str(e)}", exc_info=True)
        try:
            await websocket.send_text(json.dumps({
                'type': 'error',
                'message': str(e)
            }))
        except:
            pass
    finally:
        # Clean up
        if session_id:
            await connection_manager.close_connection(session_id)
            connection_manager.clear_credentials(session_id)
        try:
            await websocket.close()
        except:
            pass
