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

    # ── Stage 2: Social Content fields (added via migration if not present) ────
    core_idea: Optional[str] = Field(default=None)
    surface_topic: Optional[str] = Field(default=None)
    hidden_angle: Optional[str] = Field(default=None)
    hook: Optional[str] = Field(default=None)
    quote: Optional[str] = Field(default=None)
    social_description: Optional[str] = Field(default=None)
    engagement_question: Optional[str] = Field(default=None)
    alternative_hooks: Optional[str] = Field(default=None)  # JSON-encoded list
    social_score: Optional[int] = Field(default=None)
    stage2_done: bool = Field(default=False)

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

    # ── Stage 2: Social Content Analysis fields ───────────────────────────────
    # Populated by enrich_clip_social_content() after Stage 1 detection.
    core_idea: Optional[str] = None          # The deep idea of the clip (beyond the surface topic)
    surface_topic: Optional[str] = None      # The obvious/superficial topic
    hidden_angle: Optional[str] = None       # The most interesting unexpected angle
    hook: Optional[str] = None               # The winning TikTok hook/title (6-14 words)
    alternative_hooks: Optional[List[str]] = None  # Runner-up hook candidates
    quote: Optional[str] = None              # Most memorable quote/sentence from the clip
    social_description: Optional[str] = None  # Full post description: HOOK→EXAMPLE→IDEA→REFLECTION→CTA
    engagement_question: Optional[str] = None  # Concrete question to drive comments
    social_score: Optional[int] = None       # Stage 2 virality re-evaluation (1-10)
    stage2_done: bool = False                # Flag: True once Stage 2 has processed this clip

    @field_validator("score", mode="before")
    @classmethod
    def parse_score(cls, v: Any) -> int:
        try:
            return max(1, min(10, int(round(float(v)))))
        except (ValueError, TypeError):
            return 7

    @field_validator("social_score", mode="before")
    @classmethod
    def parse_social_score(cls, v: Any) -> Optional[int]:
        if v is None:
            return None
        try:
            return max(1, min(10, int(round(float(v)))))
        except (ValueError, TypeError):
            return None

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

    @property
    def effective_title(self) -> str:
        """Return the best available title: hook (Stage 2) > title (Stage 1)."""
        return (self.hook or self.title or "").strip()

    @property
    def effective_caption(self) -> str:
        """Return the best available caption: social_description (Stage 2) > caption (Stage 1)."""
        return (self.social_description or self.caption or "").strip()


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
    """Expected JSON structure returned by the LLM for Stage 1 detection."""

    clips: List[ClipCandidate]


class LLMSocialContentResponse(BaseModel):
    """Expected JSON structure returned by the LLM for Stage 2 social content analysis."""

    core_idea: str
    surface_topic: str
    hidden_angle: str
    hook: str
    alternative_hooks: List[str] = []
    quote: Optional[str] = None
    social_description: str
    hashtags: List[str] = []
    engagement_question: str
    social_score: int = 7

    @field_validator("social_score", mode="before")
    @classmethod
    def parse_score(cls, v: Any) -> int:
        try:
            return max(1, min(10, int(round(float(v)))))
        except (ValueError, TypeError):
            return 7


def _fmt(seconds: float) -> str:
    """Format seconds as MM:SS or HH:MM:SS."""
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"
