"""ClipFinder CLI — typer-based command line interface."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.panel import Panel
from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TaskProgressColumn,
    TextColumn,
    TimeElapsedColumn,
)
from rich.table import Table

# Load .env file before anything else
from dotenv import load_dotenv

load_dotenv()

app = typer.Typer(
    name="clipfinder",
    help="[bold cyan]🎬 ClipFinder[/bold cyan] — Detecta los mejores momentos virales en videos largos.",
    add_completion=False,
    rich_markup_mode="rich",
    no_args_is_help=True,
)

console = Console()


# ── Helpers ───────────────────────────────────────────────────────────────────


def _fmt_time(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h:02d}h {m:02d}m {s:02d}s"
    return f"{m:02d}m {s:02d}s"


def _resolve_api_key(provider: str, api_key: str | None) -> str:
    """Resolve API key from CLI flag or environment variable."""
    if api_key:
        return api_key

    env_var = f"{provider.upper()}_API_KEY"
    key = os.getenv(env_var)
    if not key:
        console.print(f"\n[red bold]❌ API key no encontrada para '{provider}'.[/red bold]")
        console.print(
            f"[yellow]  Opción 1:[/yellow] Define [bold]{env_var}[/bold] en tu archivo [dim].env[/dim]\n"
            f"[yellow]  Opción 2:[/yellow] Usa el flag [bold]--api-key <tu_key>[/bold]\n"
        )
        raise typer.Exit(1)
    return key


# ── Commands ──────────────────────────────────────────────────────────────────


@app.command(name="analyze")
def analyze(
    source: str = typer.Argument(
        ...,
        help="URL de YouTube o path de archivo local (mp4, mp3, wav, etc.)",
        metavar="URL_O_PATH",
    ),
    provider: str = typer.Option(
        "gemini",
        "--provider",
        "-p",
        help="Proveedor LLM: groq | [bold]gemini[/bold]",
        show_default=True,
    ),
    model: Optional[str] = typer.Option(
        None,
        "--model",
        "-m",
        help="Modelo específico (ej: llama-3.3-70b-versatile). Default: auto según provider.",
    ),
    whisper_model: str = typer.Option(
        "small",
        "--whisper-model",
        "-w",
        help="Modelo Whisper: tiny | base | [bold]small[/bold] | medium | large-v3",
        show_default=True,
    ),
    language: Optional[str] = typer.Option(
        None,
        "--language",
        "-l",
        help="Idioma del audio (ej: 'es', 'en'). Omite para auto-detección.",
    ),
    max_clips: int = typer.Option(
        12,
        "--max-clips",
        "-n",
        help="Número máximo de clips a detectar.",
        min=1,
        max=30,
        show_default=True,
    ),
    output_dir: Optional[Path] = typer.Option(
        None,
        "--output",
        "-o",
        help="Directorio de salida. Default: outputs/<video_id>/",
    ),
    api_key: Optional[str] = typer.Option(
        None,
        "--api-key",
        help="API key del proveedor (alternativa a la variable de entorno).",
        envvar=["GROQ_API_KEY", "GEMINI_API_KEY"],
    ),
    skip_download: bool = typer.Option(
        False,
        "--skip-download",
        help="Saltar la descarga si audio.wav ya existe en el directorio de salida.",
    ),
    keep_audio: bool = typer.Option(
        False,
        "--keep-audio",
        help="Conservar el archivo de audio después del análisis.",
    ),
) -> None:
    """
    Analiza un video y genera una lista de momentos con mayor potencial viral.

    [bold]Ejemplos:[/bold]

    [green]  # Analizar video de YouTube con defaults[/green]
      clipfinder analyze https://youtube.com/watch?v=dQw4w9WgXcQ

    [green]  # Usar Gemini con modelo large, transcripción en español[/green]
      clipfinder analyze mi_video.mp4 --provider gemini --whisper-model medium -l es

    [green]  # Pedir solo los 8 mejores clips con modelo rápido[/green]
      clipfinder analyze https://youtu.be/... --max-clips 8 --model llama-3.1-8b-instant
    """
    # Import pipeline modules
    from clipfinder.downloader import download_audio, get_source_id, is_url
    from clipfinder.transcriber import transcribe
    from clipfinder.analyzer import (
        GEMINI_MODELS,
        GROQ_MODELS,
        analyze_segments,
    )
    from clipfinder.models import AnalysisResult
    from clipfinder.report import save_all

    # ── Header ────────────────────────────────────────────────────────────────
    console.print()
    console.print(
        Panel.fit(
            "[bold cyan]🎬  ClipFinder  v0.1.0[/bold cyan]\n"
            "[dim]Detector de momentos virales con IA[/dim]",
            border_style="cyan",
            padding=(0, 2),
        )
    )
    console.print()

    # ── Validate provider ─────────────────────────────────────────────────────
    provider = provider.lower().strip()
    if provider not in ("groq", "gemini"):
        console.print(f"[red]❌ Provider no soportado: '{provider}'. Usa 'groq' o 'gemini'.[/red]")
        raise typer.Exit(1)

    resolved_api_key = _resolve_api_key(provider, api_key)

    # ── Resolve output dir ────────────────────────────────────────────────────
    video_id = get_source_id(source)
    if output_dir is None:
        output_dir = Path("outputs") / video_id
    output_dir.mkdir(parents=True, exist_ok=True)

    audio_path = output_dir / "audio.wav"
    duration_seconds: float = 0.0

    # ── Step 1: Download / locate audio ──────────────────────────────────────
    console.rule("[bold]Paso 1 — Audio[/bold]", style="cyan")

    if skip_download and audio_path.exists():
        console.print(f"[yellow]⏭️  Skip download:[/yellow] usando {audio_path}")
    else:
        console.print(f"[bold]📥 Descargando audio de:[/bold] [dim]{source}[/dim]")
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            TimeElapsedColumn(),
            console=console,
            transient=True,
        ) as prog:
            t = prog.add_task("Conectando...", total=None)
            try:
                audio_path, duration_seconds = download_audio(source, output_dir)
                prog.update(t, description="✅ Descarga completa")
            except Exception as exc:
                console.print(f"\n[red bold]❌ Error en descarga:[/red bold] {exc}")
                raise typer.Exit(1) from exc

    size_mb = audio_path.stat().st_size / 1_048_576 if audio_path.exists() else 0
    console.print(
        f"[green]✅ Audio listo:[/green] [dim]{audio_path}[/dim] "
        f"[dim]({size_mb:.1f} MB, {_fmt_time(duration_seconds)})[/dim]"
    )
    console.print()

    # ── Step 2: Transcribe ────────────────────────────────────────────────────
    console.rule("[bold]Paso 2 — Transcripción[/bold]", style="cyan")
    console.print(
        f"[bold]🎙️  Transcribiendo con faster-whisper[/bold] "
        f"[dim](modelo: [bold]{whisper_model}[/bold]"
        + (f", idioma: [bold]{language}[/bold]" if language else ", idioma: auto")
        + ")[/dim]"
    )

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        TimeElapsedColumn(),
        console=console,
        transient=True,
    ) as prog:
        t = prog.add_task("Procesando audio...", total=None)
        try:
            segments, audio_dur = transcribe(
                audio_path,
                model_size=whisper_model,  # type: ignore[arg-type]
                language=language,
            )
            if duration_seconds == 0:
                duration_seconds = audio_dur
            prog.update(t, description="✅ Transcripción completa")
        except Exception as exc:
            console.print(f"\n[red bold]❌ Error en transcripción:[/red bold] {exc}")
            raise typer.Exit(1) from exc

    console.print(
        f"[green]✅ Transcripción:[/green] {len(segments)} segmentos · {_fmt_time(duration_seconds)}"
    )
    console.print()

    # ── Step 3: Analyze with LLM ──────────────────────────────────────────────
    model_name = model or (
        GROQ_MODELS["default"] if provider == "groq" else GEMINI_MODELS["default"]
    )

    console.rule("[bold]Paso 3 — Análisis LLM[/bold]", style="cyan")
    console.print(
        f"[bold]🧠 Analizando con [cyan]{provider.upper()}[/cyan][/bold] "
        f"[dim]({model_name})[/dim] — buscando {max_clips} clips virales"
    )

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        TimeElapsedColumn(),
        console=console,
    ) as prog:
        task = prog.add_task("Iniciando...", total=100)

        def on_chunk(current: int, total: int, err: str | None = None) -> None:
            pct = int((current / total) * 100) if total else 0
            label = f"Chunk {current}/{total}"
            if err:
                label += f" [red](⚠ {err[:60]})[/red]"
            prog.update(task, completed=pct, description=label)

        try:
            clips = analyze_segments(
                segments=segments,
                provider=provider,  # type: ignore[arg-type]
                api_key=resolved_api_key,
                model=model_name,
                max_clips=max_clips,
                progress_callback=on_chunk,
            )
            prog.update(task, completed=100, description="✅ Análisis completo")
        except Exception as exc:
            console.print(f"\n[red bold]❌ Error en análisis:[/red bold] {exc}")
            raise typer.Exit(1) from exc

    console.print(f"[green]✅ Detectados:[/green] [bold]{len(clips)}[/bold] clips candidatos")
    console.print()

    # ── Step 4: Save reports ──────────────────────────────────────────────────
    console.rule("[bold]Paso 4 — Reportes[/bold]", style="cyan")

    result = AnalysisResult(
        video_source=source,
        duration_seconds=duration_seconds,
        clips=clips,
        transcript_segments=len(segments),
        llm_model=model_name,
        whisper_model=whisper_model,
    )

    paths = save_all(result, segments, output_dir)

    console.print(f"[green]✅ Archivos guardados en:[/green] [bold cyan]{output_dir}/[/bold cyan]")
    for fmt, p in paths.items():
        console.print(f"   [dim]├── {p.name}  ({fmt})[/dim]")

    if not keep_audio and is_url(source) and audio_path.exists():
        audio_path.unlink(missing_ok=True)
        console.print(
            f"   [dim]└── audio.wav eliminado (usa [bold]--keep-audio[/bold] para conservarlo)[/dim]"
        )

    console.print()

    # ── Step 5: Display results table ─────────────────────────────────────────
    if not clips:
        console.print(
            Panel(
                "[yellow]⚠️  No se detectaron clips.[/yellow]\n"
                "[dim]Posibles causas:[/dim]\n"
                "  • El idioma del audio no coincide con [bold]--language[/bold] especificado\n"
                "  • El modelo Whisper [bold]tiny[/bold]/[bold]base[/bold] transcribió muy poco texto\n"
                "  • El video tiene mucha música/ruido y poco habla\n\n"
                "[cyan]Prueba:[/cyan] usa [bold]-w small[/bold] o [bold]-w medium[/bold] y omite [bold]--language[/bold] para auto-detección.",
                title="Sin resultados",
                border_style="yellow",
            )
        )

    if clips:
        table = Table(
            title="🎯 Top Momentos Virales Detectados",
            show_header=True,
            header_style="bold cyan",
            border_style="cyan",
            show_lines=True,
            min_width=80,
        )
        table.add_column("#", style="bold dim", width=3, justify="right")
        table.add_column("Título", style="bold white", min_width=22, max_width=35)
        table.add_column("Timestamp", style="yellow", width=16)
        table.add_column("Dur.", style="cyan", width=5, justify="right")
        table.add_column("Score", width=10, justify="center")
        table.add_column("Motivo", style="dim", min_width=30)

        for i, clip in enumerate(clips, 1):
            dur = int(clip.end_seconds - clip.start_seconds)
            score_bar = "█" * clip.score + "░" * (10 - clip.score)
            score_label = f"[{'green' if clip.score >= 8 else 'yellow' if clip.score >= 6 else 'red'}]{clip.score}/10[/] {score_bar}"
            table.add_row(
                str(i),
                clip.title[:34] + ("…" if len(clip.title) > 34 else ""),
                f"{clip.start_fmt} → {clip.end_fmt}",
                f"{dur}s",
                score_label,
                (clip.reason[:70] + "…" if len(clip.reason) > 70 else clip.reason),
            )

        console.print(table)
        console.print()

    console.print(
        Panel.fit(
            f"[bold green]✅ ¡Análisis completo![/bold green]\n"
            f"[dim]Reporte completo:[/dim] [cyan]{output_dir / 'report.md'}[/cyan]",
            border_style="green",
        )
    )
    console.print()


@app.command(name="version")
def version_cmd() -> None:
    """Muestra la versión instalada de ClipFinder."""
    from clipfinder import __version__

    console.print(f"[bold cyan]ClipFinder[/bold cyan] v{__version__}")


if __name__ == "__main__":
    app()
