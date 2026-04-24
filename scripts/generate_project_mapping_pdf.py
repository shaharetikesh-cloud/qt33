from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
SOURCE_MD = ROOT / "PROJECT_FOLDER_PROJECT_MAPPING.md"
OUTPUT_PDF = ROOT / "PROJECT_FOLDER_PROJECT_MAPPING.pdf"


def draw_wrapped_line(c, text, x, y, max_width, line_height):
    words = text.split()
    if not words:
        return y - line_height
    line = words[0]
    for word in words[1:]:
        trial = f"{line} {word}"
        if c.stringWidth(trial, "Helvetica", 10) <= max_width:
            line = trial
        else:
            c.drawString(x, y, line)
            y -= line_height
            line = word
    c.drawString(x, y, line)
    return y - line_height


def main():
    lines = SOURCE_MD.read_text(encoding="utf-8").splitlines()
    c = canvas.Canvas(str(OUTPUT_PDF), pagesize=A4)
    width, height = A4
    left = 40
    top = height - 40
    y = top
    max_width = width - (left * 2)
    line_height = 14

    for raw in lines:
        line = raw.replace("`", "").replace("##", "").replace("#", "").strip()
        if raw.startswith("# "):
            if y < 70:
                c.showPage()
                y = top
            c.setFont("Helvetica-Bold", 14)
            y = draw_wrapped_line(c, line, left, y, max_width, 18)
            c.setFont("Helvetica", 10)
            continue
        if raw.startswith("## "):
            if y < 70:
                c.showPage()
                y = top
            c.setFont("Helvetica-Bold", 12)
            y = draw_wrapped_line(c, line, left, y, max_width, 16)
            c.setFont("Helvetica", 10)
            continue

        if y < 60:
            c.showPage()
            y = top
            c.setFont("Helvetica", 10)

        c.setFont("Helvetica", 10)
        text = raw.strip()
        if not text:
            y -= line_height
            continue
        if text.startswith("- ") or text[0:2].isdigit():
            text = f"* {text.lstrip('- ').strip()}"
        y = draw_wrapped_line(c, text.replace("`", ""), left, y, max_width, line_height)

    c.save()
    print(f"Generated: {OUTPUT_PDF}")


if __name__ == "__main__":
    main()
