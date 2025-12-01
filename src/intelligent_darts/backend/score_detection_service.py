"""Service for detecting dart scores using Claude Sonnet 4.5 model"""
import base64
from typing import Tuple, List
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import ChatMessage, ChatMessageRole
from .logger import logger


class ScoreDetectionService:
    """Service for detecting dart scores from images using AI models"""
    
    SYSTEM_PROMPT = """You are a darts scoring agent. Analyze the dartboard image and identify ALL darts currently on the board.

PROCESS:
1. Identify all darts visible on the dartboard (count them carefully)
2. For each dart, determine its exact position on the board
3. Calculate the score for each dart individually

SCORING RULES:
- Inner bullseye (red center): 50 points
- Outer bullseye (green ring): 25 points
- Triple ring (inner thin ring): 3x the segment number
- Double ring (outer thin ring): 2x the segment number
- Single segments: Face value (1-20)
- Outside scoring area: 0 points

CRITICAL: Return ONLY a comma-separated list of individual dart scores. Do NOT sum them up.

OUTPUT FORMAT (scores only, separated by commas):
- If 3 darts: "20, 60, 50"
- If 2 darts: "60, 50"
- If 1 dart: "20"
- If no darts: "0"

DO NOT include labels like "Dart 1:" or "Dart 2:". ONLY return the numbers separated by commas.
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
        after_timestamp: float,
        model_endpoint: str = "databricks-claude-sonnet-4-5"
    ) -> Tuple[List[int], str]:
        """
        Detect the score from before/after dartboard images
        
        Args:
            before_image_base64: Base64 encoded image before the throw
            after_image_base64: Base64 encoded image after the throw
            before_timestamp: Timestamp of before image
            after_timestamp: Timestamp of after image
            model_endpoint: The AI model endpoint to use
            
        Returns:
            Tuple of (list of scores for each dart, raw_response)
        """
        try:
            logger.info(f"Calling model endpoint: {model_endpoint}")
            
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
            
            # Query the model serving endpoint
            response = self.ws.serving_endpoints.query(
                name=model_endpoint,
                messages=messages,
                temperature=0.3,  # Lower temperature for more consistent scoring
                max_tokens=100  # Allow more tokens for multiple dart responses
            )
            
            # Extract the response text
            raw_response = ""
            if hasattr(response, 'choices') and response.choices:
                if hasattr(response.choices[0], 'message'):
                    raw_response = response.choices[0].message.content
                elif hasattr(response.choices[0], 'text'):
                    raw_response = response.choices[0].text
            
            logger.info(f"Raw response from model: {raw_response}")
            
            # Parse the scores from the response
            scores = self._parse_scores(raw_response)
            
            return scores, raw_response
            
        except Exception as e:
            logger.error(f"Error detecting score: {str(e)}", exc_info=True)
            raise
    
    def _parse_scores(self, response: str) -> List[int]:
        """
        Parse multiple dart scores from the model response
        
        Args:
            response: Raw response from the model (expected format: "20, 60, 50" or "20")
            
        Returns:
            List of parsed integer scores
        """
        try:
            # Clean the response
            cleaned = response.strip()
            
            # Extract all numbers from the response
            import re
            numbers = re.findall(r'\d+', cleaned)
            
            if numbers:
                scores = []
                for num_str in numbers:
                    score = int(num_str)
                    # Validate each score is in reasonable range (max 60 for triple 20)
                    if 0 <= score <= 60:
                        scores.append(score)
                    else:
                        logger.warning(f"Score {score} out of valid range (0-60), skipping")
                
                if scores:
                    logger.info(f"Parsed {len(scores)} dart score(s): {scores}")
                    return scores
                else:
                    logger.warning(f"No valid scores found in response: {response}")
                    return [0]
            else:
                logger.warning(f"Could not parse any scores from response: {response}")
                return [0]
                
        except Exception as e:
            logger.error(f"Error parsing scores from response '{response}': {str(e)}")
            return [0]

