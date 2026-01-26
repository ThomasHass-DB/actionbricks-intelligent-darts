from pydantic import BaseModel, Field
from typing import List
from .. import __version__


class VersionOut(BaseModel):
    version: str

    @classmethod
    def from_metadata(cls):
        return cls(version=__version__)


class VideoStreamOut(BaseModel):
    stream_url: str
    status: str
    width: int
    height: int
    fps: int


class GameStatusOut(BaseModel):
    is_active: bool
    current_player: str | None = None
    current_score: int = 0


class ScoreDetectionIn(BaseModel):
    """Input model for score detection from video frames"""
    before_image_base64: str = Field(
        description="Base64 encoded image of the dartboard before the throw"
    )
    after_image_base64: str = Field(
        description="Base64 encoded image of the dartboard after the throw"
    )
    before_timestamp: float = Field(
        description="Timestamp of the before image in seconds"
    )
    after_timestamp: float = Field(
        description="Timestamp of the after image in seconds"
    )
    model: str = Field(
        default="databricks-claude-sonnet-4-5",
        description="The AI model endpoint to use for detection"
    )


class ScoreDetectionOut(BaseModel):
    """Output model for score detection"""
    scores: List[int] = Field(
        description="List of detected scores for each dart on the board"
    )
    confidence: float = Field(
        description="Confidence level of the detection (0-1)",
        ge=0.0,
        le=1.0
    )
    raw_response: str = Field(
        description="Raw response from the AI model"
    )


class AWSCredentialsIn(BaseModel):
    """Input model for AWS credentials"""
    access_key_id: str = Field(
        description="AWS Access Key ID"
    )
    secret_access_key: str = Field(
        description="AWS Secret Access Key"
    )
    region: str = Field(
        default="us-east-1",
        description="AWS Region"
    )


class WebRTCConfigOut(BaseModel):
    """Output model for WebRTC configuration"""
    signaling_channel: str = Field(
        description="Name of the Kinesis Video Signaling Channel"
    )
    region: str = Field(
        description="AWS Region"
    )
    ice_servers: List[dict] = Field(
        description="List of ICE servers for WebRTC connection"
    )


class WebRTCStatusOut(BaseModel):
    """Output model for WebRTC connection status"""
    connected: bool = Field(
        description="Whether the WebRTC connection is established"
    )
    status: str = Field(
        description="Current connection status"
    )
