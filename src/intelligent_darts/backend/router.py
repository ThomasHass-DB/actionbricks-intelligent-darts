from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException
from .models import VersionOut, VideoStreamOut, GameStatusOut, ScoreDetectionIn, ScoreDetectionOut
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.iam import User as UserOut
from .dependencies import get_obo_ws, get_app_ws
from .config import conf
from .score_detection_service import ScoreDetectionService
from .logger import logger

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
        
        # Detect the score
        score, raw_response = service.detect_score(
            before_image_base64=request.before_image_base64,
            after_image_base64=request.after_image_base64,
            before_timestamp=request.before_timestamp,
            after_timestamp=request.after_timestamp,
            model_endpoint=request.model
        )
        
        # Calculate confidence based on whether we got a valid score
        # In a real implementation, you might want to get this from the model
        confidence = 0.95 if score > 0 else 0.5
        
        logger.info(f"Detected score: {score} (confidence: {confidence})")
        
        return ScoreDetectionOut(
            score=score,
            confidence=confidence,
            raw_response=raw_response
        )
        
    except Exception as e:
        logger.error(f"Error in detect_score endpoint: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to detect score: {str(e)}"
        )
