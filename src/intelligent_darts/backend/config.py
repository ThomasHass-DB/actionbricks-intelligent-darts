from importlib import resources
from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path
from pydantic import Field, BaseModel
from dotenv import load_dotenv
from .._metadata import app_name, app_slug
from typing import Optional

# project root is the parent of the src folder
project_root = Path(__file__).parent.parent.parent.parent
env_file = project_root / ".env"

if env_file.exists():
    load_dotenv(dotenv_path=env_file)


class DatabaseConfig(BaseModel):
    port: int = Field(description="The port of the database", default=5432)
    database_name: str = Field(
        description="The name of the database", default="databricks_postgres"
    )
    instance_name: str = Field(description="The name of the database instance")


class AppConfig(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=env_file,
        env_prefix=f"{app_slug.upper()}_",
        extra="ignore",
        env_nested_delimiter="__",
    )
    app_name: str = Field(default=app_name)
    api_prefix: str = Field(default="/api")
    # db: Optional[DatabaseConfig] = Field(default=None)  # Disabled for now

    @property
    def static_assets_path(self) -> Path:
        return Path(str(resources.files(app_slug))).joinpath("__dist__")


try:
    conf = AppConfig()
except Exception as e:
    import os
    print("=" * 80)
    print("ERROR INITIALIZING CONFIG:")
    print(str(e))
    print("\nEnvironment variables starting with INTELLIGENT_DARTS_:")
    for key, value in os.environ.items():
        if key.startswith("INTELLIGENT_DARTS_"):
            print(f"  {key}={value}")
    print("=" * 80)
    raise
