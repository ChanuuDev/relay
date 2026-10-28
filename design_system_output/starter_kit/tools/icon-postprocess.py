"""생성 이미지(보통 1024px RGBA)를 Dock용 256px 앱 아이콘으로 다듬는다.

Relay 아이콘에 쓴 절차를 그대로 옮겼다.
  1. 알파 > 200인 부분만 모양으로 삼고 4px 안쪽으로 깎는다(생성 이미지의 번짐·잡티·어두운 테두리 제거).
  2. 모양 바깥 픽셀의 색을 안쪽 이웃 색으로 번져 채운다(반투명 가장자리가 검정과 섞이지 않게).
  3. rgb.putalpha(alpha)로 합친 뒤 premultiplied(RGBa)로 줄인다.
     paste(rgb, mask=alpha)로 투명 캔버스에 붙이면 가장자리가 검정과 섞여 밝은 바탕에서 회색 외곽선이 생긴다.
  4. 256px 캔버스에 놓는다. 타일형은 가로·세로 11–245px(234px), 타일 없는 모양은 가로 14–242px에 세로 가운데.
  5. 그림자는 아래로만: 6px 아래, 흐림 3, 불투명도 26%.

사용:
  python tools/icon-postprocess.py 입력.png public/icons/내앱.png            # 타일형(기본)
  python tools/icon-postprocess.py 입력.png public/icons/내앱.png --shape     # 타일 없는 모양
"""
import argparse
from PIL import Image, ImageChops, ImageFilter

CANVAS = 256


def clean(source: Image.Image) -> Image.Image:
    image = source.convert("RGBA")
    alpha = image.getchannel("A").point(lambda value: 255 if value > 200 else 0)
    alpha = alpha.filter(ImageFilter.MinFilter(9))  # 반경 4px 깎기
    bbox = alpha.getbbox()
    if not bbox:
        raise SystemExit("모양을 찾지 못했습니다(알파 200 초과 픽셀이 없음). 투명 배경 PNG인지 확인하세요.")
    rgb = image.convert("RGB")
    # 모양 바깥으로 안쪽 색을 번진다: 모양 안 색을 넓게 흐려 평균색을 얻고, 바깥에만 덮는다.
    inside = Image.composite(rgb, Image.new("RGB", rgb.size), alpha)
    weight = alpha.filter(ImageFilter.GaussianBlur(12))
    spread = inside.filter(ImageFilter.GaussianBlur(12))
    # 가중 평균(번진 색 ÷ 번진 알파)
    spread_px, weight_px = spread.load(), weight.load()
    filled = rgb.copy()
    filled_px, alpha_px = filled.load(), alpha.load()
    width, height = rgb.size
    for y in range(height):
        for x in range(width):
            if alpha_px[x, y]:
                continue
            w = weight_px[x, y]
            if w:
                r, g, b = spread_px[x, y]
                filled_px[x, y] = (min(255, r * 255 // w), min(255, g * 255 // w), min(255, b * 255 // w))
    soft = alpha.filter(ImageFilter.GaussianBlur(0.6))  # 가장자리 안티에일리어싱
    filled.putalpha(soft)
    return filled.crop(bbox)


def place(shape: Image.Image, tile: bool) -> Image.Image:
    box = 234 if tile else 228  # 11–245 또는 14–242
    scale = box / max(shape.size)
    size = (max(1, round(shape.size[0] * scale)), max(1, round(shape.size[1] * scale)))
    resized = shape.convert("RGBa").resize(size, Image.LANCZOS).convert("RGBA")
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    left = (CANVAS - size[0]) // 2
    top = (CANVAS - size[1]) // 2
    # 아래로만 떨어지는 그림자
    shadow_alpha = Image.new("L", (CANVAS, CANVAS), 0)
    shadow_alpha.paste(resized.getchannel("A"), (left, top + 6))
    shadow_alpha = shadow_alpha.filter(ImageFilter.GaussianBlur(3)).point(lambda value: value * 26 // 100)
    shadow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    shadow.putalpha(shadow_alpha)
    canvas = Image.alpha_composite(canvas, shadow)
    layer = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    layer.paste(resized, (left, top))
    return Image.alpha_composite(canvas, layer)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source")
    parser.add_argument("target")
    parser.add_argument("--shape", action="store_true", help="타일 없는 모양(가로 14–242px)")
    args = parser.parse_args()
    result = place(clean(Image.open(args.source)), tile=not args.shape)
    result.save(args.target, optimize=True)
    # 밝은·어두운 바탕 미리 보기(가장자리 회색 테두리 확인용)
    for name, color in (("light", (245, 245, 247, 255)), ("dark", (30, 30, 32, 255))):
        preview = Image.alpha_composite(Image.new("RGBA", result.size, color), result)
        preview.save(args.target.replace(".png", f".preview-{name}.png"))
    print(f"저장: {args.target} (+ .preview-light/.preview-dark.png로 가장자리 확인 후 지우세요)")


if __name__ == "__main__":
    main()
