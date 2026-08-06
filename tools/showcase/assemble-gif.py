from pathlib import Path
import math
import sys

from PIL import Image, ImageChops, ImageStat


def shared_palette(frames: list[Image.Image], colors: int = 160) -> Image.Image:
    width = 203
    height = 300
    columns = min(10, len(frames))
    rows = math.ceil(len(frames) / columns)
    atlas = Image.new("RGB", (width * columns, height * rows))
    for index, frame in enumerate(frames):
        thumbnail = frame.convert("RGB").resize((width, height), Image.Resampling.LANCZOS)
        atlas.paste(thumbnail, ((index % columns) * width, (index // columns) * height))
        thumbnail.close()
    palette = atlas.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    atlas.close()
    return palette


def verify_animation(output: Path, sources: list[Image.Image], duration: int) -> None:
    animation = Image.open(output)
    if animation.size != sources[0].size or animation.n_frames < 20:
        raise SystemExit("assembled GIF lost its expected geometry or motion")
    source_previews = [frame.convert("RGB").resize((101, 150), Image.Resampling.BILINEAR) for frame in sources]
    elapsed = 0
    worst_error = 0.0
    for index in range(animation.n_frames):
        animation.seek(index)
        rendered = animation.convert("RGB").resize((101, 150), Image.Resampling.BILINEAR)
        expected_index = min(len(source_previews) - 1, round(elapsed / duration))
        candidates = source_previews[max(0, expected_index - 2):min(len(source_previews), expected_index + 3)]
        errors = [sum(ImageStat.Stat(ImageChops.difference(rendered, candidate)).mean) / 3 for candidate in candidates]
        worst_error = max(worst_error, min(errors))
        elapsed += int(animation.info.get("duration", duration))
        rendered.close()
    for preview in source_previews:
        preview.close()
    animation.close()
    if worst_error > 6:
        raise SystemExit(f"assembled GIF drifted from source frames (worst mean error {worst_error:.2f})")


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: assemble-gif.py FRAME_DIR OUTPUT_GIF DURATION_MS")
    frame_dir = Path(sys.argv[1])
    output = Path(sys.argv[2])
    duration = max(20, int(sys.argv[3]))
    paths = sorted(frame_dir.glob("frame-*.png"))
    if not paths:
        raise SystemExit("no PNG frames were found")
    rgba_frames = [Image.open(path).convert("RGBA") for path in paths]
    palette = shared_palette(rgba_frames)
    frames = [
        frame.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE)
        for frame in rgba_frames
    ]
    output.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        output,
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=0,
        disposal=1,
        optimize=True,
    )
    verify_animation(output, rgba_frames, duration)
    for frame in [palette, *frames, *rgba_frames]:
        frame.close()


if __name__ == "__main__":
    main()
