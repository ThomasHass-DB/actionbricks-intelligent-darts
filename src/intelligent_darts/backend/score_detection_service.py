"""Service for detecting dart scores using Claude Sonnet 4.5 model"""
import base64
from typing import Tuple, List
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import ChatMessage, ChatMessageRole
from .logger import logger


class ScoreDetectionService:
    """Service for detecting dart scores from images using AI models"""
    
    SYSTEM_PROMPT = """You are a professional darts scoring agent. Analyze the provided dartboard image and identify ALL darts currently stuck in the board.

TASK:
Carefully examine the dartboard image and:
1. Count how many darts are visible on the board (look carefully - there may be 1, 2, or 3 darts)
2. For each dart, determine its exact position on the dartboard
3. Calculate the individual score for each dart based on where it landed

DARTBOARD SCORING RULES:
- Inner bullseye (small red center): 50 points
- Outer bullseye (green ring around center): 25 points
- Triple ring (thin inner colored ring): 3× the segment number (e.g., triple 20 = 60)
- Double ring (thin outer colored ring): 2× the segment number (e.g., double 20 = 40)
- Single segments (large colored areas): Face value 1-20
- Outside the scoring area: 0 points

CRITICAL INSTRUCTIONS:
- Return ONLY a comma-separated list of individual dart scores
- Do NOT sum the scores together
- Do NOT add any labels, explanations, or extra text
- Count each dart separately

OUTPUT FORMAT (numbers only, separated by commas):
- If 3 darts visible: "20, 60, 50"
- If 2 darts visible: "60, 50"  
- If 1 dart visible: "20"
- If no darts visible: "0"

ONLY return the comma-separated numbers. Nothing else.
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
            
            # Use the "after" image as the current frame to analyze
            # (Frontend sends the same image for both, so we just use one)
            user_message_content = [
                self._create_text_content(
                    "Analyze this dartboard image and return the score for each dart visible on the board:"
                ),
                self._create_image_content(after_image_base64, after_timestamp, "Current Frame")
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

