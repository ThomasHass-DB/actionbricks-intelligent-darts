"""Service for detecting dart scores using Claude Sonnet 4.5 model"""
import base64
import os
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
            
            # Log image details for debugging
            image_size_kb = len(after_image_base64) * 3 / 4 / 1024  # Approximate size in KB
            logger.info(f"Image size: ~{image_size_kb:.2f} KB (base64 length: {len(after_image_base64)})")
            logger.info(f"Timestamp: {after_timestamp:.2f}s")
            
            # Optionally save the image for debugging (if DEBUG_SAVE_IMAGES env var is set)
            if os.getenv("DEBUG_SAVE_IMAGES", "").lower() == "true":
                try:
                    import tempfile
                    from pathlib import Path
                    debug_dir = Path(tempfile.gettempdir()) / "intelligent_darts_debug"
                    debug_dir.mkdir(exist_ok=True)
                    image_path = debug_dir / f"frame_{after_timestamp:.2f}s.jpg"
                    
                    # Decode and save the image
                    image_data = base64.b64decode(after_image_base64)
                    with open(image_path, "wb") as f:
                        f.write(image_data)
                    logger.info(f"DEBUG: Saved image to {image_path}")
                except Exception as e:
                    logger.warning(f"Failed to save debug image: {e}")
            
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
            
            # Log the prompt being sent (without the full image data)
            logger.info("=" * 80)
            logger.info("SYSTEM PROMPT:")
            logger.info(self.SYSTEM_PROMPT)
            logger.info("=" * 80)
            logger.info("USER MESSAGE:")
            logger.info("- Text: 'Analyze this dartboard image and return the score for each dart visible on the board:'")
            logger.info(f"- Image: [base64 image data, ~{image_size_kb:.2f} KB]")
            logger.info("=" * 80)
            
            # Query the model serving endpoint
            response = self.ws.serving_endpoints.query(
                name=model_endpoint,
                messages=messages,
                temperature=0.3,  # Lower temperature for more consistent scoring
                max_tokens=100  # Allow more tokens for multiple dart responses
            )
            
            # Log the full response structure for debugging
            logger.info(f"Full API response type: {type(response)}")
            logger.info(f"Full API response: {response}")
            
            # Check for usage/token info
            if hasattr(response, 'usage'):
                logger.info(f"Token usage - Prompt: {response.usage.prompt_tokens}, Completion: {response.usage.completion_tokens}, Total: {response.usage.total_tokens}")
            
            # Extract the response text
            raw_response = ""
            if hasattr(response, 'choices') and response.choices:
                logger.info(f"Response has {len(response.choices)} choices")
                choice = response.choices[0]
                
                # Check finish reason for issues
                if hasattr(choice, 'finish_reason') and choice.finish_reason:
                    logger.info(f"Finish reason: {choice.finish_reason}")
                    if choice.finish_reason in ['content_filter', 'safety']:
                        logger.error(f"Model response blocked by {choice.finish_reason}")
                        raise ValueError(f"Model response blocked by {choice.finish_reason}. The image may have been flagged by safety filters.")
                
                if hasattr(choice, 'message'):
                    logger.info(f"Choice 0 has message: {choice.message}")
                    raw_response = choice.message.content or ""
                    
                    # Check if content is empty but there's a refusal
                    if not raw_response and hasattr(choice.message, 'refusal') and choice.message.refusal:
                        logger.error(f"Model refused to respond: {choice.message.refusal}")
                        raise ValueError(f"Model refused: {choice.message.refusal}")
                    
                elif hasattr(choice, 'text'):
                    logger.info(f"Choice 0 has text: {choice.text}")
                    raw_response = choice.text or ""
                else:
                    logger.error(f"Choice 0 structure: {dir(choice)}")
            else:
                logger.error(f"Response structure: {dir(response)}")
                logger.error(f"Response has no choices or choices is empty")
            
            # Check if response is empty
            if not raw_response or raw_response.strip() == "":
                logger.error(f"Model returned empty response. Model: {model_endpoint}, Completion tokens: {response.usage.completion_tokens if hasattr(response, 'usage') else 'unknown'}")
                raise ValueError(f"Model {model_endpoint} returned empty response. This may indicate a compatibility issue or safety filter.")
            
            logger.info(f"Extracted raw response from model: {raw_response}")
            
            # Parse the scores from the response
            scores = self._parse_scores(raw_response)
            
            # If parsing failed (empty list), retry with format correction
            if not scores:
                logger.warning("Initial parsing failed. Attempting format correction...")
                scores, raw_response = self._retry_with_format_correction(
                    model_endpoint, 
                    after_image_base64, 
                    after_timestamp, 
                    raw_response
                )
                
                # If still empty after retry, return [0] as safe default
                if not scores:
                    logger.error("Both attempts failed. Returning [0] as safe default")
                    scores = [0]
            
            return scores, raw_response
            
        except Exception as e:
            logger.error(f"Error detecting score: {str(e)}", exc_info=True)
            raise
    
    def _retry_with_format_correction(
        self,
        model_endpoint: str,
        image_base64: str,
        timestamp: float,
        previous_response: str
    ) -> Tuple[List[int], str]:
        """
        Retry the request with format correction instructions
        
        Args:
            model_endpoint: The model endpoint to use
            image_base64: The image data
            timestamp: The timestamp
            previous_response: The previous response that failed to parse
            
        Returns:
            Tuple of (list of scores, raw response)
        """
        try:
            logger.info("Retrying with format correction prompt...")
            
            # Create a follow-up message asking for correct format
            correction_prompt = f"""Your previous response was: "{previous_response}"

This response could not be parsed correctly. Please analyze the dartboard image again and respond with ONLY comma-separated numbers.

CRITICAL: Your response must be ONLY numbers separated by commas. Nothing else.

Examples of CORRECT responses:
- "20, 60, 50" (for 3 darts)
- "60, 50" (for 2 darts)
- "20" (for 1 dart)
- "0" (for no darts)

Do NOT include any text, labels, or explanations. ONLY the numbers.

Now, what are the scores for each dart visible on the dartboard?"""

            user_message_content = [
                self._create_image_content(image_base64, timestamp, "Dartboard"),
                self._create_text_content(correction_prompt)
            ]
            
            messages = [
                ChatMessage(
                    role=ChatMessageRole.USER,
                    content=user_message_content
                )
            ]
            
            # Query the model again
            response = self.ws.serving_endpoints.query(
                name=model_endpoint,
                messages=messages,
                temperature=0.1,  # Lower temperature for more deterministic output
                max_tokens=50
            )
            
            # Extract the response
            corrected_response = ""
            if hasattr(response, 'choices') and response.choices:
                if hasattr(response.choices[0], 'message'):
                    corrected_response = response.choices[0].message.content
                elif hasattr(response.choices[0], 'text'):
                    corrected_response = response.choices[0].text
            
            logger.info(f"Corrected response from model: {corrected_response}")
            
            # Try parsing again
            scores = self._parse_scores(corrected_response)
            
            # If still failed, return empty list (caller will handle default)
            if not scores:
                logger.error("Format correction retry also failed. Returning empty list")
                return [], f"Original: {previous_response}\nCorrected attempt: {corrected_response}"
            
            return scores, f"Original: {previous_response}\nCorrected: {corrected_response}"
            
        except Exception as e:
            logger.error(f"Error in format correction retry: {str(e)}", exc_info=True)
            # Return empty list (caller will handle default)
            return [], previous_response
    
    def _parse_scores(self, response: str) -> List[int]:
        """
        Parse multiple dart scores from the model response
        
        Args:
            response: Raw response from the model (expected format: "20, 60, 50" or "20")
            
        Returns:
            List of parsed integer scores (empty list if parsing completely fails)
        """
        try:
            # Clean the response
            cleaned = response.strip()
            
            # Check if response indicates no darts
            if any(phrase in cleaned.lower() for phrase in ["no dart", "no visible dart", "empty", "none"]):
                logger.info("Response indicates no darts visible")
                return [0]
            
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
                    return []  # Return empty to trigger retry
            else:
                logger.warning(f"Could not parse any scores from response: {response}")
                return []  # Return empty to trigger retry
                
        except Exception as e:
            logger.error(f"Error parsing scores from response '{response}': {str(e)}")
            return []  # Return empty to trigger retry

