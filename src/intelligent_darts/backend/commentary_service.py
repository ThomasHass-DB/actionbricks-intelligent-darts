"""Service for generating AI commentary for dart game video frames"""
import base64
import os
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import ChatMessage, ChatMessageRole
from .logger import logger


class CommentaryService:
    """Service for generating real-time AI commentary for dart games"""
    
    COMMENTARY_PROMPT = """You are Sid Waddell, the legendary enthusiastic darts commentator!

Generate LIVE COMMENTARY for these dart scores: {scores}

RULES:
- DO NOT describe the dartboard
- DO NOT mention colors, rings, segments, or board layout
- ONLY comment on the SCORES and the player's performance
- Be ENTHUSIASTIC and DRAMATIC
- Keep it to 1-2 SHORT punchy sentences MAX

SCORING CONTEXT:
- 60 = Triple 20 (maximum single dart score)
- 50 = Bullseye
- 25 = Outer bull
- 40 = Double 20
- Scores like 57, 54, 51 = Triple 19, 18, 17

EXAMPLES:
- For [60]: "TRIPLE TWENTY! Maximum damage!"
- For [20, 20, 20]: "Three twenties! Sixty points of pure consistency!"
- For [50]: "BULLSEYE! Right in the heart!"
- For [60, 60, 60]: "ONE HUNDRED AND EIGHTY! The perfect visit!"
- For [26, 45]: "Seventy-one scored, keeping the pressure on!"
- For [0]: "Oh no, outside the scoring area! The pressure got to him!"

Now give me exciting commentary for: {scores}"""

    CATALOG = "arijit_metric_views"
    SCHEMA = "video_analysis"
    TABLE = "dart_commentary"
    
    def __init__(self, workspace_client: WorkspaceClient):
        """Initialize the service with a Databricks workspace client"""
        self.ws = workspace_client
        self._ensure_table_exists()
    
    def _ensure_table_exists(self):
        """Ensure the Delta table exists in Unity Catalog"""
        try:
            # Create schema if not exists
            create_schema_sql = f"""
            CREATE SCHEMA IF NOT EXISTS {self.CATALOG}.{self.SCHEMA}
            """
            
            # Create table if not exists
            create_table_sql = f"""
            CREATE TABLE IF NOT EXISTS {self.CATALOG}.{self.SCHEMA}.{self.TABLE} (
                id STRING NOT NULL,
                session_id STRING NOT NULL,
                timestamp DOUBLE NOT NULL,
                frame_timestamp DOUBLE NOT NULL,
                commentary TEXT NOT NULL,
                model_used STRING NOT NULL,
                scores ARRAY<INT>,
                confidence DOUBLE,
                created_at TIMESTAMP NOT NULL,
                metadata STRING
            )
            USING DELTA
            COMMENT 'Real-time AI commentary for dart game video analysis'
            """
            
            # Execute using statement execution API (max timeout is 50s)
            self.ws.statement_execution.execute_statement(
                warehouse_id=self._get_warehouse_id(),
                statement=create_schema_sql,
                wait_timeout="50s"
            )
            
            self.ws.statement_execution.execute_statement(
                warehouse_id=self._get_warehouse_id(),
                statement=create_table_sql,
                wait_timeout="50s"
            )
            
            logger.info(f"Ensured table {self.CATALOG}.{self.SCHEMA}.{self.TABLE} exists")
        except Exception as e:
            logger.warning(f"Could not ensure table exists (may already exist): {e}")
    
    def _get_warehouse_id(self) -> str:
        """Get the SQL warehouse ID from environment variable"""
        # Get warehouse from environment variable (format: /sql/1.0/warehouses/<id>)
        warehouse_path = os.getenv("SQL_WAREHOUSE", "")
        if warehouse_path:
            # Extract the ID from the path
            warehouse_id = warehouse_path.split("/")[-1]
            logger.info(f"Using SQL warehouse from env: {warehouse_id}")
            return warehouse_id
        
        # Fallback: try to list warehouses
        try:
            warehouses = list(self.ws.warehouses.list())
            if warehouses:
                return warehouses[0].id
            raise ValueError("No SQL warehouse available. Set SQL_WAREHOUSE in .env")
        except Exception as e:
            logger.error(f"Error getting warehouse: {e}")
            raise
    
    def generate_commentary(
        self,
        image_base64: str,
        frame_timestamp: float,
        session_id: str,
        model_endpoint: str = "databricks-claude-sonnet-4-5",
        scores: Optional[List[int]] = None,
        confidence: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        Generate AI commentary for a video frame
        
        Args:
            image_base64: Base64 encoded image of the current frame
            frame_timestamp: Timestamp of the frame in seconds
            session_id: Unique session identifier for the video analysis
            model_endpoint: The AI model endpoint to use
            scores: Optional detected scores to include in context
            confidence: Optional confidence level of score detection
            
        Returns:
            Dictionary containing commentary and metadata
        """
        try:
            logger.info(f"Generating commentary for frame at {frame_timestamp:.2f}s with scores: {scores}")
            
            # If we have scores, generate commentary based on scores (no image needed)
            if scores and len(scores) > 0:
                # Calculate total score for context
                total = sum(scores)
                
                # Format the prompt with actual scores
                prompt = self.COMMENTARY_PROMPT.format(scores=scores)
                
                # Add total context
                prompt += f"\n\nTotal scored this visit: {total} points"
                
                # Check for special scores
                if total == 180:
                    prompt += " (MAXIMUM SCORE!)"
                elif total >= 140:
                    prompt += " (Excellent visit!)"
                elif total >= 100:
                    prompt += " (Solid scoring!)"
                
                # Text-only query for score-based commentary
                user_content = prompt
                
                logger.info(f"Generating score-based commentary for: {scores} (total: {total})")
            else:
                # No scores provided - generate generic commentary
                user_content = "Generate a brief, exciting darts commentary line about anticipation or the next throw. Keep it to one short sentence. Do NOT describe any dartboard."
                logger.info("No scores provided, generating generic commentary")
            
            # Query the model (text only, no image)
            response = self.ws.serving_endpoints.query(
                name=model_endpoint,
                messages=[
                    ChatMessage(
                        role=ChatMessageRole.USER,
                        content=user_content
                    )
                ],
                temperature=0.8,  # Higher for varied, enthusiastic commentary
                max_tokens=100   # Short punchy responses
            )
            
            # Extract commentary text
            commentary = self._extract_response_text(response)
            
            # Generate unique ID for this commentary
            commentary_id = str(uuid.uuid4())
            created_at = datetime.utcnow()
            
            result = {
                "id": commentary_id,
                "session_id": session_id,
                "timestamp": created_at.timestamp(),
                "frame_timestamp": frame_timestamp,
                "commentary": commentary,
                "model_used": model_endpoint,
                "scores": scores,
                "confidence": confidence,
                "created_at": created_at.isoformat()
            }
            
            # Save to Delta table
            self._save_to_delta(result)
            
            logger.info(f"Generated commentary: {commentary[:100]}...")
            return result
            
        except Exception as e:
            logger.error(f"Error generating commentary: {str(e)}", exc_info=True)
            raise
    
    def _extract_response_text(self, response) -> str:
        """Extract text content from model response"""
        if hasattr(response, 'choices') and response.choices:
            choice = response.choices[0]
            if hasattr(choice, 'message') and choice.message:
                content = choice.message.content
                
                # Handle list format (Gemini)
                if isinstance(content, list):
                    for part in content:
                        if isinstance(part, dict) and part.get("type") == "text":
                            return part.get("text", "").strip()
                
                # Handle string format
                if isinstance(content, str):
                    return content.strip()
        
        return "And the darts are flying! What precision we're seeing tonight!"
    
    def _save_to_delta(self, commentary_data: Dict[str, Any]):
        """Save commentary to Delta table"""
        try:
            # Format scores array for SQL
            scores_sql = "NULL"
            if commentary_data.get("scores"):
                scores_list = ", ".join(str(s) for s in commentary_data["scores"])
                scores_sql = f"ARRAY({scores_list})"
            
            confidence_sql = commentary_data.get("confidence") or "NULL"
            
            # Escape single quotes in commentary
            commentary_escaped = commentary_data["commentary"].replace("'", "''")
            
            insert_sql = f"""
            INSERT INTO {self.CATALOG}.{self.SCHEMA}.{self.TABLE}
            (id, session_id, timestamp, frame_timestamp, commentary, model_used, scores, confidence, created_at, metadata)
            VALUES (
                '{commentary_data["id"]}',
                '{commentary_data["session_id"]}',
                {commentary_data["timestamp"]},
                {commentary_data["frame_timestamp"]},
                '{commentary_escaped}',
                '{commentary_data["model_used"]}',
                {scores_sql},
                {confidence_sql},
                TIMESTAMP '{commentary_data["created_at"]}',
                NULL
            )
            """
            
            self.ws.statement_execution.execute_statement(
                warehouse_id=self._get_warehouse_id(),
                statement=insert_sql,
                wait_timeout="30s"
            )
            
            logger.info(f"Saved commentary {commentary_data['id']} to Delta table")
            
        except Exception as e:
            logger.error(f"Error saving to Delta table: {e}")
            # Don't raise - commentary was generated successfully, just logging failed
    
    def get_session_commentary(
        self,
        session_id: str,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        Retrieve commentary for a session
        
        Args:
            session_id: The session ID to retrieve commentary for
            limit: Maximum number of records to return
            
        Returns:
            List of commentary records
        """
        try:
            query_sql = f"""
            SELECT id, session_id, timestamp, frame_timestamp, commentary, 
                   model_used, scores, confidence, created_at
            FROM {self.CATALOG}.{self.SCHEMA}.{self.TABLE}
            WHERE session_id = '{session_id}'
            ORDER BY frame_timestamp DESC
            LIMIT {limit}
            """
            
            result = self.ws.statement_execution.execute_statement(
                warehouse_id=self._get_warehouse_id(),
                statement=query_sql,
                wait_timeout="30s"
            )
            
            # Parse results
            commentary_list = []
            if result.result and result.result.data_array:
                columns = [col.name for col in result.manifest.schema.columns]
                for row in result.result.data_array:
                    commentary_list.append(dict(zip(columns, row)))
            
            return commentary_list
            
        except Exception as e:
            logger.error(f"Error retrieving commentary: {e}")
            return []

