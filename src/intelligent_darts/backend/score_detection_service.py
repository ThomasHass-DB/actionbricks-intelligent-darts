"""Service for detecting dart scores using Claude Sonnet 4.5 model"""
import base64
from typing import Tuple
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import ChatMessage, ChatMessageRole
from .logger import logger


class ScoreDetectionService:
    """Service for detecting dart scores from before/after images using Claude Sonnet"""
    
    MODEL_ENDPOINT = "databricks-claude-sonnet-4-5"
    
    SYSTEM_PROMPT = """You are a darts scoring agent. Analyze the dartboard image and identify ALL darts currently on the board.

PROCESS:
1. Identify all darts visible on the dartboard
2. For each dart, determine its exact position on the board
3. Calculate the score for each dart

SCORING RULES:
- Inner bullseye (red center): 50 points
- Outer bullseye (green ring): 25 points
- Triple ring (inner thin ring): 3x the segment number
- Double ring (outer thin ring): 2x the segment number
- Single segments: Face value (1-20)
- Outside scoring area: 0 points

OUTPUT FORMAT:
If multiple darts are present, list each one:
Dart 1: [score]
Dart 2: [score]
Dart 3: [score]

If only one dart is present:
Dart 1: [score]

If no darts are present:
Dart 1: 0

Example outputs:
- "Dart 1: 20"
- "Dart 1: 60, Dart 2: 50"
- "Dart 1: 20, Dart 2: 60, Dart 3: 50"
"""

    def __init__(self, workspace_client: WorkspaceClient):
        """Initialize the service with a Databricks workspace client"""
        self.ws = workspace_client
    
    def _create_image_content(self, image_base64: str, timestamp: float, label: str) -> dict:
        """Create image content for the Claude API"""
        return {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/jpeg;base64,{image_base64}"
            }
        }
    
    def _create_text_content(self, text: str) -> dict:
        """Create text content for the Claude API"""
        return {
            "type": "text",
            "text": text
        }
    
    def detect_score(
        self,
        before_image_base64: str,
        after_image_base64: str,
        before_timestamp: float,
        after_timestamp: float
    ) -> Tuple[int, str]:
        """
        Detect the score from before/after dartboard images
        
        Args:
            before_image_base64: Base64 encoded image before the throw
            after_image_base64: Base64 encoded image after the throw
            before_timestamp: Timestamp of before image
            after_timestamp: Timestamp of after image
            
        Returns:
            Tuple of (score, raw_response)
        """
        try:
            # Create the message content with both images
            user_message_content = [
                self._create_text_content(
                    f"BEFORE image (timestamp: {before_timestamp:.2f}s):"
                ),
                self._create_image_content(before_image_base64, before_timestamp, "BEFORE"),
                self._create_text_content(
                    f"AFTER image (timestamp: {after_timestamp:.2f}s):"
                ),
                self._create_image_content(after_image_base64, after_timestamp, "AFTER"),
                self._create_text_content(
                    "What score did the newly thrown dart achieve? Respond with only the integer score."
                )
            ]
            
            # Create messages for the API
            messages = [
                ChatMessage(
                    role=ChatMessageRole.SYSTEM,
                    content=self.SYSTEM_PROMPT
                ),
                ChatMessage(
                    role=ChatMessageRole.USER,
                    content=user_message_content
                )
            ]
            
            logger.info(f"Calling Claude Sonnet endpoint: {self.MODEL_ENDPOINT}")
            
            # Query the model serving endpoint
            response = self.ws.serving_endpoints.query(
                name=self.MODEL_ENDPOINT,
                messages=messages,
                temperature=0.3,  # Lower temperature for more consistent scoring
                max_tokens=10  # We only need a short response (just a number)
            )
            
            # Extract the response text
            raw_response = ""
            if hasattr(response, 'choices') and response.choices:
                if hasattr(response.choices[0], 'message'):
                    raw_response = response.choices[0].message.content
                elif hasattr(response.choices[0], 'text'):
                    raw_response = response.choices[0].text
            
            logger.info(f"Raw response from Claude: {raw_response}")
            
            # Parse the score from the response
            score = self._parse_score(raw_response)
            
            return score, raw_response
            
        except Exception as e:
            logger.error(f"Error detecting score: {str(e)}", exc_info=True)
            raise
    
    def _parse_score(self, response: str) -> int:
        """
        Parse the score from the model response
        
        Args:
            response: Raw response from the model
            
        Returns:
            Parsed integer score
        """
        try:
            # Clean the response and extract the number
            cleaned = response.strip()
            
            # Try to extract just the number
            import re
            numbers = re.findall(r'\d+', cleaned)
            
            if numbers:
                score = int(numbers[0])
                # Validate score is in reasonable range
                if 0 <= score <= 180:  # Max possible score in one throw is 60 (triple 20)
                    return score
                else:
                    logger.warning(f"Score {score} out of valid range, returning 0")
                    return 0
            else:
                logger.warning(f"Could not parse score from response: {response}")
                return 0
                
        except Exception as e:
            logger.error(f"Error parsing score from response '{response}': {str(e)}")
            return 0

