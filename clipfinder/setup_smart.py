"""Download official TalkNet weights: python -m clipfinder.setup_smart."""

from pathlib import Path


def main():
    import gdown
    path = Path("outputs/models/talknet/pretrain_TalkSet.model")
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.is_file():
        temporary = path.with_suffix(".download")
        try:
            result = gdown.download(id="1AbN9fCf9IexMxEKXLQY2KYBlb-IhSEea", output=str(temporary), quiet=False)
            if not result:
                raise RuntimeError("No se pudo descargar TalkNet.")
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
