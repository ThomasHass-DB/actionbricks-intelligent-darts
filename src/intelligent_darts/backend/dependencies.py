from databricks.sdk import WorkspaceClient
from fastapi import Header
from typing import Annotated, Generator
from sqlmodel import Session
from .runtime import rt


def get_obo_ws(
    token: Annotated[str | None, Header(alias="X-Forwarded-Access-Token")] = None,
) -> WorkspaceClient:
    """
    Returns a Databricks Workspace client with authentication behalf of user.
    If the request contains an X-Forwarded-Access-Token header, on behalf of user authentication is used.

    Example usage:
    @api.get("/items/")
    async def read_items(obo_ws: Annotated[WorkspaceClient, Depends(get_obo_ws)]):
        # do something with the obo_ws
        ...
    """

    if not token:
        raise ValueError(
            "OBO token is not provided in the header X-Forwarded-Access-Token"
        )

    return WorkspaceClient(
        token=token, auth_type="pat"
    )  # set pat explicitly to avoid issues with SP client


def get_app_ws() -> WorkspaceClient:
    """
    Returns a Databricks Workspace client using the app's service principal credentials.
    This should be used for operations that require app-level permissions (like accessing serving endpoints).
    """
    return WorkspaceClient()  # Uses app's service principal credentials from environment


def get_session() -> Generator[Session, None, None]:
    """
    Returns a SQLModel session.
    """
    with rt.get_session() as session:
        yield session
