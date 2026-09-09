"""Data models and SQLModel persistence tables for ClipFinder."""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, field_validator
from sqlmodel import Field, Relationship, SQLModel


class ClipStatus(str, Enum):
    prospecto = "prospecto"
    enfoque_generado = "enfoque_generado"
    subtitulado = "subtitulado"
    en_revision = "en_revision"
    publicado = "publicado"
    descartado = "descartado"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Video(SQLModel, table=True):
    """Representa un video procesado en el sistema."""

    id: Optional[int] = Field(default=None, primary_key=True)
    source_url: Optional[str] = None
    source_path: Optional[str] = None
    cliente: Optional[str] = None
    channel: Optional[str] = None
    title: Optional[str] = None
    duration_seconds: float = 0.0
    provider: Optional[str] = None
    llm_model: Optional[str] = None
    created_at: datetime = Field(default_factory=_utc_now)

    clips: List["Clip"] = Relationship(
        back_populates="video", sa_relationship_kwargs={"cascade": "all, delete-orphan"}
    )


class Clip(SQLModel, table=True):
    """Representa un clip viral detectado y su ciclo de vida editorial."""

    id: Optional[int] = Field(default=None, primary_key=True)
    video_id: int = Field(foreign_key="video.id", index=True)
    start_seconds: float
    end_seconds: float
    title: str
    reason: str
    score: int
    status: ClipStatus = Field(default=ClipStatus.prospecto, index=True)
    output_path: Optional[str] = None
    caption: Optional[str] = None
    hashtags: Optional[str] = None
    created_at: datetime = Field(default_factory=_utc_now)
    updated_at: datetime = Field(default_factory=_utc_now)

    video: Optional[Video] = Relationship(back_populates="clips")


class TranscriptSegment(BaseModel):
    """A single segment from the Whisper transcription output."""

    text: str
    start: float  # seconds
    end: float  # seconds
    words: Optional[List[Dict[str, Any]]] = None

    @property
    def duration(self) -> float:
        return self.end - self.start

    def as_timestamped_text(self) -> str:
        """Return segment formatted as '[MM:SS - MM:SS] text'."""
        return f"[{_fmt(self.start)} - {_fmt(self.end)}] {self.text}"


class ClipCandidate(BaseModel):
    """A single clip candidate with viral potential score and social copy."""

    start_seconds: float
    end_seconds: float
    title: str
    reason: str
    score: int
    caption: Optional[str] = None
    hashtags: Optional[Union[List[str], str]] = None

    @field_validator("score", mode="before")
    @classmethod
    def parse_score(cls, v: Any) -> int:
        try:
            return max(1, min(10, int(round(float(v)))))
        except (ValueError, TypeError):
            return 7

    @field_validator("start_seconds", "end_seconds", mode="before")
    @classmethod
    def parse_seconds(cls, v: Any) -> float:
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            val = v.strip()
            # If formatted as MM:SS or HH:MM:SS
            parts = val.split(":")
            if len(parts) == 2:
                try:
                    return float(parts[0]) * 60.0 + float(parts[1])
                except (ValueError, TypeError):
                    pass
            elif len(parts) == 3:
                try:
                    return float(parts[0]) * 3600.0 + float(parts[1]) * 60.0 + float(parts[2])
                except (ValueError, TypeError):
                    pass
            try:
                return float(val)
            except (ValueError, TypeError):
                return 0.0
        return 0.0

    @property
    def duration(self) -> float:
        return self.end_seconds - self.start_seconds

    @property
    def start_fmt(self) -> str:
        return _fmt(self.start_seconds)

    @property
    def end_fmt(self) -> str:
        return _fmt(self.end_seconds)

    @property
    def hashtags_str(self) -> str:
        if isinstance(self.hashtags, list):
            return " ".join(f"#{tag.lstrip('#')}" for tag in self.hashtags)
        return str(self.hashtags or "")


class AnalysisResult(BaseModel):
    """Full analysis result for a video."""

    video_source: str
    duration_seconds: float
    clips: List[ClipCandidate]
    transcript_segments: int = 0
    llm_model: str = ""
    whisper_model: str = ""
    cliente: Optional[str] = None


class LLMClipsResponse(BaseModel):
    """Expected JSON structure returned by the LLM."""

    clips: List[ClipCandidate]


def _fmt(seconds: float) -> str:
    """Format seconds as MM:SS or HH:MM:SS."""
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"
